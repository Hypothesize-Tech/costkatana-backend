/**
 * LLM Security Service
 * Comprehensive security checks for LLM requests with analytics and human review
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ThreatLog } from '../../schemas/security/threat-log.schema';
import { TraceSpan } from '../../schemas/trace/trace-span.schema';
import {
  PromptFirewallService,
  ThreatDetectionResult,
} from './prompt-firewall.service';

export interface SecurityAnalytics {
  detectionRate: number;
  topRiskyPatterns: Array<{
    pattern: string;
    count: number;
    averageRiskScore: number;
  }>;
  topRiskySources: Array<{
    source: string;
    count: number;
    averageRiskScore: number;
  }>;
  threatDistribution: Record<string, number>;
  containmentActions: Record<string, number>;
  costSaved: number;
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface HumanReviewRequest {
  id: string;
  requestId: string;
  userId?: string;
  threatResult: ThreatDetectionResult;
  originalPrompt: string;
  toolCalls?: any[];
  retrievedChunks?: string[];
  status: 'pending' | 'approved' | 'denied' | 'expired';
  reviewerId?: string;
  reviewedAt?: Date;
  decision?: string;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class LlmSecurityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmSecurityService.name);
  private humanReviewQueue = new Map<string, HumanReviewRequest>();

  // Trusted domains whitelist - bypass security for legitimate websites
  private readonly TRUSTED_DOMAINS = [
    // Video platforms
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'vimeo.com',
    'www.vimeo.com',
    'dailymotion.com',
    'www.dailymotion.com',

    // Social media
    'twitter.com',
    'www.twitter.com',
    'x.com',
    'www.x.com',
    'facebook.com',
    'www.facebook.com',
    'linkedin.com',
    'www.linkedin.com',
    'instagram.com',
    'www.instagram.com',

    // Development platforms
    'github.com',
    'www.github.com',
    'gitlab.com',
    'www.gitlab.com',
    'bitbucket.org',
    'www.bitbucket.org',
    'stackoverflow.com',
    'www.stackoverflow.com',

    // Documentation sites
    'docs.google.com',
    'medium.com',
    'www.medium.com',
    'dev.to',
    'www.dev.to',
    'reddit.com',
    'www.reddit.com',

    // Cloud services
    'drive.google.com',
    'dropbox.com',
    'www.dropbox.com',
    'onedrive.com',
    'www.onedrive.com',

    // News and information
    'wikipedia.org',
    'www.wikipedia.org',
    'en.wikipedia.org',
    'google.com',
    'www.google.com',

    // Development tools
    'npmjs.com',
    'www.npmjs.com',
    'pypi.org',
    'www.pypi.org',

    // AI platforms
    'claude.ai',
    'www.claude.ai',
    'openai.com',
    'www.openai.com',
    'chat.openai.com',
    'anthropic.com',
    'www.anthropic.com',
  ];

  // Circuit breaker for database operations
  private dbFailureCount: number = 0;
  private readonly MAX_DB_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
  private lastDbFailureTime: number = 0;

  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @InjectModel(ThreatLog.name) private threatLogModel: Model<ThreatLog>,
    @InjectModel(TraceSpan.name) private traceSpanModel: Model<TraceSpan>,
    private readonly promptFirewallService: PromptFirewallService,
  ) {}

  onModuleInit() {
    // Start cleanup interval for expired human review requests
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredReviews();
      },
      10 * 60 * 1000,
    ); // Every 10 minutes
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Validate that all URLs use HTTPS (reject HTTP links)
   */
  private validateHttpsOnly(content: string): {
    isValid: boolean;
    httpUrls?: string[];
  } {
    const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
    const urls = content.match(urlPattern);

    if (!urls || urls.length === 0) {
      return { isValid: true }; // No URLs found, validation passes
    }

    const httpUrls: string[] = [];

    for (const url of urls) {
      // Check if URL starts with http:// (insecure)
      if (url.toLowerCase().startsWith('http://')) {
        httpUrls.push(url);
      }
    }

    if (httpUrls.length > 0) {
      return { isValid: false, httpUrls };
    }

    return { isValid: true }; // All URLs use HTTPS
  }

  /**
   * Check if content contains only trusted domain links
   */
  private containsOnlyTrustedLinks(content: string): boolean {
    // Extract all URLs from content
    const urlPattern =
      /(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+)/gi;
    const urls = content.match(urlPattern);

    if (!urls || urls.length === 0) {
      return false; // No URLs found, proceed with normal security check
    }

    // Check if all URLs are from trusted domains
    for (const url of urls) {
      try {
        // Add protocol if missing
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const urlObj = new URL(fullUrl);
        const hostname = urlObj.hostname.toLowerCase();

        // Check if domain is trusted
        const isTrusted = this.TRUSTED_DOMAINS.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );

        if (!isTrusted) {
          return false; // Found untrusted domain
        }
      } catch (error) {
        // Invalid URL, let security check handle it
        return false;
      }
    }

    return true; // All URLs are from trusted domains
  }

  /**
   * Comprehensive security check for LLM requests
   */
  async performSecurityCheck(
    prompt: string,
    requestId: string,
    userId?: string,
    context?: {
      retrievedChunks?: string[];
      toolCalls?: any[];
      provenanceSource?: string;
      estimatedCost?: number;
      ipAddress?: string;
      userAgent?: string;
      source?: string;
    },
  ): Promise<{
    result: ThreatDetectionResult;
    traceEvent?: any;
    humanReviewId?: string;
  }> {
    const startTime = Date.now();

    try {
      // HTTPS VALIDATION: Reject HTTP links, only allow HTTPS
      const httpsValidation = this.validateHttpsOnly(prompt);
      if (!httpsValidation.isValid && httpsValidation.httpUrls) {
        this.logger.warn('Security check blocked - HTTP links detected', {
          requestId,
          userId,
          source: context?.source,
          httpUrls: httpsValidation.httpUrls,
        });

        return {
          result: {
            isBlocked: true,
            confidence: 1.0,
            reason: `Only HTTPS links are allowed. HTTP links detected: ${httpsValidation.httpUrls.join(', ')}`,
            stage: 'prompt-guard',
            threatCategory: 'insecure_protocol',
            containmentAction: 'block',
          },
        };
      }

      // TRUSTED DOMAINS WHITELIST: Bypass security for content with only trusted links
      if (this.containsOnlyTrustedLinks(prompt)) {
        this.logger.log('Security check bypassed for trusted domain links', {
          requestId,
          userId,
          source: context?.source,
          promptPreview: prompt.substring(0, 150),
        });

        return {
          result: {
            isBlocked: false,
            confidence: 0.0,
            reason:
              'Content contains only trusted domain links - bypassed security check',
            stage: 'openai-safeguard',
            containmentAction: 'allow',
          },
        };
      }

      // INTEGRATION WHITELIST: Detect Google/integration commands and bypass security for user's own data
      const integrationMentions =
        /@(gmail|calendar|drive|sheets|docs|slides|forms|google|github|jira|linear|slack|discord|webhook|vercel|aws|mongodb)\b/i;
      const hasIntegrationMention = integrationMentions.test(prompt);

      if (hasIntegrationMention && userId) {
        // Log bypass decision for audit
        this.logger.log('Security check bypassed for integration command', {
          requestId,
          userId,
          source: context?.source,
          integrationDetected:
            prompt.match(integrationMentions)?.[1] ?? 'unknown',
          promptPreview: prompt.substring(0, 100),
        });

        // Return allow result
        return {
          result: {
            isBlocked: false,
            confidence: 0.0,
            reason: 'Integration command - bypassed security check',
            stage: 'openai-safeguard',
            containmentAction: 'allow',
          },
        };
      }

      // Get firewall configuration (could be user-specific in the future)
      const config = this.promptFirewallService.getDefaultConfig();

      // Run comprehensive security check (now handles HTML and metadata)
      const securityResult = await this.promptFirewallService.checkPrompt(
        prompt,
        config,
        requestId,
        context?.estimatedCost || 0.01,
        {
          ...context,
          userId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          source: context?.source,
        },
      );

      // Create trace event for security check
      const traceEvent = await this.createSecurityTraceEvent(
        requestId,
        userId,
        prompt,
        securityResult,
        context,
        Date.now() - startTime,
      );

      // Handle containment actions
      let humanReviewId: string | undefined;
      if (securityResult.containmentAction === 'human_review') {
        humanReviewId = await this.createHumanReviewRequest(
          requestId,
          userId,
          securityResult,
          prompt,
          context?.toolCalls,
          context?.retrievedChunks,
        );
      }

      return {
        result: securityResult,
        traceEvent,
        humanReviewId,
      };
    } catch (error) {
      this.logger.error('LLM security check failed', {
        error: error instanceof Error ? error.message : String(error),
        requestId,
        userId,
        promptLength: prompt.length,
      });

      // Return safe default (allow with warning)
      return {
        result: {
          isBlocked: false,
          confidence: 0.0,
          reason: 'Security check failed - allowing request',
          stage: 'prompt-guard',
          containmentAction: 'allow',
        },
      };
    }
  }

  /**
   * Create trace event for security check
   */
  private async createSecurityTraceEvent(
    requestId: string,
    userId: string | undefined,
    prompt: string,
    result: ThreatDetectionResult,
    context: any,
    duration: number,
  ): Promise<any> {
    try {
      // Save security trace event to TraceSpan model for production traceability
      const traceSpan = new this.traceSpanModel({
        traceId: `security-${requestId}`,
        sessionId: `session-${userId || 'anonymous'}-${Date.now()}`,
        name: 'llm_security_check',
        type: 'llm',
        startedAt: new Date(Date.now() - duration),
        endedAt: new Date(),
        duration,
        status: result.isBlocked ? 'error' : 'ok',
        aiModel: context?.model || 'unknown',
        resourceIds: [requestId],
        metadata: {
          security: {
            isBlocked: result.isBlocked,
            threatCategory: result.threatCategory,
            confidence: result.confidence,
            stage: result.stage,
            riskScore: (result as any).riskScore,
            containmentAction: (result as any).containmentAction,
            matchedPatterns: (result as any).matchedPatterns,
            provenanceSource: (result as any).provenanceSource,
          },
          prompt: {
            length: prompt.length,
            hash: this.hashPrompt(prompt),
          },
          context: {
            hasRetrievedChunks: !!context?.retrievedChunks?.length,
            retrievedChunksCount: context?.retrievedChunks?.length || 0,
            hasToolCalls: !!context?.toolCalls?.length,
            toolCallsCount: context?.toolCalls?.length || 0,
            provenanceSource: context?.provenanceSource,
          },
        },
        tags: {
          component: 'llm-security',
          security_stage: result.stage,
          threat_category: result.threatCategory || 'none',
          is_blocked: result.isBlocked.toString(),
          containment_action: (result as any).containmentAction || 'allow',
        },
      });

      // Save the trace span to the database
      await traceSpan.save();

      this.logger.log('Security trace event saved', {
        traceId: traceSpan.traceId,
        spanId: traceSpan._id,
        isBlocked: result.isBlocked,
        threatCategory: result.threatCategory,
      });

      return traceSpan;
    } catch (error) {
      this.logger.error('Failed to create security trace event', {
        error: error instanceof Error ? error.message : String(error),
        requestId,
        userId,
      });
      return null;
    }
  }

  /**
   * Create human review request
   */
  private async createHumanReviewRequest(
    requestId: string,
    userId: string | undefined,
    threatResult: ThreatDetectionResult,
    originalPrompt: string,
    toolCalls?: any[],
    retrievedChunks?: string[],
  ): Promise<string> {
    const reviewId = uuidv4();
    const expirationTime = 15 * 60 * 1000; // 15 minutes

    const reviewRequest: HumanReviewRequest = {
      id: reviewId,
      requestId,
      userId,
      threatResult,
      originalPrompt: this.sanitizePromptForReview(originalPrompt),
      toolCalls,
      retrievedChunks: retrievedChunks?.map((chunk) =>
        this.sanitizePromptForReview(chunk),
      ),
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + expirationTime),
    };

    this.humanReviewQueue.set(reviewId, reviewRequest);

    // Auto-expire after timeout
    setTimeout(() => {
      const request = this.humanReviewQueue.get(reviewId);
      if (request && request.status === 'pending') {
        request.status = 'expired';
        this.humanReviewQueue.set(reviewId, request);
        this.logger.log('Human review request expired', {
          reviewId,
          requestId,
        });
      }
    }, expirationTime);

    this.logger.log('Created human review request', {
      reviewId,
      requestId,
      userId,
      threatCategory: threatResult.threatCategory,
      riskScore: threatResult.riskScore,
    });

    return reviewId;
  }

  /**
   * Get pending human review requests
   */
  getPendingReviews(userId?: string): HumanReviewRequest[] {
    const pendingReviews = Array.from(this.humanReviewQueue.values()).filter(
      (req) => req.status === 'pending',
    );

    if (userId) {
      return pendingReviews.filter((req) => req.userId === userId);
    }
    return pendingReviews;
  }

  /**
   * Approve/deny human review request
   */
  async reviewRequest(
    reviewId: string,
    reviewerId: string,
    decision: 'approved' | 'denied',
    comments?: string,
  ): Promise<boolean> {
    const request = this.humanReviewQueue.get(reviewId);

    if (!request || request.status !== 'pending') {
      return false;
    }

    request.status = decision;
    request.reviewerId = reviewerId;
    request.reviewedAt = new Date();
    request.decision = comments;

    this.humanReviewQueue.set(reviewId, request);

    this.logger.log('Human review completed', {
      reviewId,
      reviewerId,
      decision,
      requestId: request.requestId,
    });

    return true;
  }

  /**
   * Analyze prompt for threats (used by enterprise security guard).
   * Wraps performSecurityCheck and returns a normalized shape for content filtering.
   */
  async analyzePrompt(
    prompt: string,
    context: {
      userId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<{
    threatLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    riskScore: number;
    modified: boolean;
    detections: string[];
    blockedReason?: string;
  }> {
    const requestId = `guard_${Date.now()}`;
    const { result } = await this.performSecurityCheck(
      prompt,
      requestId,
      context.userId,
      {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    );
    const riskScore = (result as any).riskScore ?? result.confidence ?? 0;
    const threatLevel = result.isBlocked
      ? 'critical'
      : riskScore >= 0.8
        ? 'high'
        : riskScore >= 0.5
          ? 'medium'
          : riskScore >= 0.2
            ? 'low'
            : 'safe';
    return {
      threatLevel,
      riskScore,
      modified: false,
      detections: (result as any).matchedPatterns ?? [],
      blockedReason: result.isBlocked ? result.reason : undefined,
    };
  }

  /**
   * Perform AI provider audit (used by enterprise security guard).
   * Wraps performSecurityCheck with provider/model context.
   */
  async performAIAudit(
    content: string,
    context: {
      provider: string;
      model: string;
      userId?: string;
      sessionId?: string;
      ipAddress?: string;
    },
  ): Promise<{
    allowed: boolean;
    riskLevel: string;
    redactionApplied: boolean;
    blockedReason?: string;
    auditId?: string;
  }> {
    const requestId = `audit_${Date.now()}`;
    const { result } = await this.performSecurityCheck(
      content,
      requestId,
      context.userId,
      {
        ipAddress: context.ipAddress,
        source: `${context.provider}:${context.model}`,
      },
    );
    const riskScore = (result as any).riskScore ?? result.confidence ?? 0;
    return {
      allowed: !result.isBlocked,
      riskLevel:
        riskScore >= 0.8 ? 'high' : riskScore >= 0.5 ? 'medium' : 'low',
      redactionApplied: false,
      blockedReason: result.isBlocked ? result.reason : undefined,
      auditId: requestId,
    };
  }

  /**
   * Get security analytics (optimized with aggregation pipeline)
   */
  async getSecurityAnalytics(
    userId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<SecurityAnalytics> {
    try {
      // Check circuit breaker
      if (this.isDbCircuitBreakerOpen()) {
        throw new Error('Database circuit breaker is open');
      }

      const defaultTimeRange = {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        end: new Date(),
      };

      const queryTimeRange = timeRange || defaultTimeRange;

      const matchQuery: any = {
        timestamp: {
          $gte: queryTimeRange.start,
          $lte: queryTimeRange.end,
        },
      };

      if (userId) {
        try {
          matchQuery.userId = new Types.ObjectId(userId);
        } catch (idError) {
          this.logger.warn(
            'Invalid userId format, skipping user filter:',
            userId,
          );
          // Continue without user filter if userId is invalid
        }
      }

      // Use MongoDB aggregation pipeline for efficient analytics calculation
      const analyticsResults =
        await this.promptFirewallService.getFirewallAnalytics(
          userId,
          queryTimeRange,
        );

      // Get firewall analytics
      const firewallAnalytics =
        await this.promptFirewallService.getFirewallAnalytics(
          userId,
          queryTimeRange,
        );

      // Calculate detection rate using ThreatLog data
      const totalThreatsInPeriod = await this.threatLogModel.countDocuments({
        userId: new Types.ObjectId(userId),
        timestamp: {
          $gte: queryTimeRange.start,
          $lte: queryTimeRange.end,
        },
      });

      // Get total requests in the same period (from firewall analytics)
      const totalRequestsInPeriod = firewallAnalytics.totalRequests;
      const detectionRate =
        totalRequestsInPeriod > 0
          ? totalThreatsInPeriod / totalRequestsInPeriod
          : 0;

      // Get top risky patterns and sources from ThreatLog
      const [topRiskyPatterns, topRiskySources] = await Promise.all([
        // Aggregate top threat categories (patterns)
        this.threatLogModel.aggregate([
          {
            $match: {
              userId: new Types.ObjectId(userId),
              timestamp: {
                $gte: queryTimeRange.start,
                $lte: queryTimeRange.end,
              },
            },
          },
          {
            $group: {
              _id: '$threatCategory',
              count: { $sum: 1 },
              averageRiskScore: { $avg: '$confidence' },
              totalCostSaved: { $sum: '$costSaved' },
            },
          },
          {
            $sort: { count: -1 },
          },
          {
            $limit: 10,
          },
          {
            $project: {
              pattern: '$_id',
              count: 1,
              averageRiskScore: { $round: ['$averageRiskScore', 3] },
              totalCostSaved: 1,
            },
          },
        ]),

        // Aggregate top threat sources (by IP or user agent patterns)
        this.threatLogModel.aggregate([
          {
            $match: {
              userId: new Types.ObjectId(userId),
              timestamp: {
                $gte: queryTimeRange.start,
                $lte: queryTimeRange.end,
              },
              ipAddress: { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: '$ipAddress',
              count: { $sum: 1 },
              averageRiskScore: { $avg: '$confidence' },
              threatCategories: { $addToSet: '$threatCategory' },
            },
          },
          {
            $sort: { count: -1 },
          },
          {
            $limit: 10,
          },
          {
            $project: {
              source: '$_id',
              count: 1,
              averageRiskScore: { $round: ['$averageRiskScore', 3] },
              uniqueThreatTypes: { $size: '$threatCategories' },
            },
          },
        ]),
      ]);

      // Reset failure count on success
      this.dbFailureCount = 0;

      return {
        detectionRate,
        topRiskyPatterns,
        topRiskySources,
        threatDistribution: firewallAnalytics.threatsByCategory,
        containmentActions: {}, // Would need additional aggregation
        costSaved: firewallAnalytics.costSaved,
        timeRange: queryTimeRange,
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Failed to get security analytics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Return empty analytics
      return {
        detectionRate: 0,
        topRiskyPatterns: [],
        topRiskySources: [],
        threatDistribution: {},
        containmentActions: {},
        costSaved: 0,
        timeRange: timeRange || {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: new Date(),
        },
      };
    }
  }

  /**
   * Hash prompt for privacy (SHA-256)
   */
  private hashPrompt(prompt: string): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(prompt)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Sanitize prompt for human review (remove sensitive info)
   */
  private sanitizePromptForReview(text: string): string {
    if (!text) return '';

    // Remove potential sensitive patterns
    return text
      .replace(
        /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
        '[CREDIT_CARD_REDACTED]',
      )
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
      .replace(/password\s*[:=]\s*\S+/gi, 'password:[REDACTED]')
      .replace(/api[_\s]?key\s*[:=]\s*\S+/gi, 'api_key:[REDACTED]')
      .replace(/token\s*[:=]\s*\S+/gi, 'token:[REDACTED]')
      .slice(0, 1000); // Limit length for review
  }

  /**
   * Clean up expired human review requests
   */
  cleanupExpiredReviews(): void {
    const now = new Date();
    const expiredKeys: string[] = [];

    for (const [key, request] of this.humanReviewQueue.entries()) {
      if (request.expiresAt < now) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach((key) => {
      this.humanReviewQueue.delete(key);
    });

    if (expiredKeys.length > 0) {
      this.logger.log(
        `Cleaned up ${expiredKeys.length} expired human review requests`,
      );
    }
  }

  /**
   * Get security metrics summary (optimized with aggregation pipeline)
   */
  async getSecurityMetricsSummary(userId?: string): Promise<{
    totalThreatsDetected: number;
    totalCostSaved: number;
    averageRiskScore: number;
    mostCommonThreat: string;
    detectionTrend: 'increasing' | 'decreasing' | 'stable';
  }> {
    try {
      // Check circuit breaker
      if (this.isDbCircuitBreakerOpen()) {
        throw new Error('Database circuit breaker is open');
      }

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

      // Get firewall analytics and ThreatLog data for comprehensive metrics
      const [firewallAnalytics, threatStats] = await Promise.all([
        this.promptFirewallService.getFirewallAnalytics(userId, {
          start: thirtyDaysAgo,
          end: new Date(),
        }),
        // Aggregate threat statistics from ThreatLog
        this.threatLogModel.aggregate([
          {
            $match: {
              userId: new Types.ObjectId(userId),
              timestamp: { $gte: thirtyDaysAgo },
            },
          },
          {
            $group: {
              _id: null,
              totalThreatsDetected: { $sum: 1 },
              totalCostSaved: { $sum: '$costSaved' },
              averageRiskScore: { $avg: '$confidence' },
              threatCategories: {
                $push: '$threatCategory',
              },
            },
          },
          {
            $project: {
              totalThreatsDetected: 1,
              totalCostSaved: 1,
              averageRiskScore: { $round: ['$averageRiskScore', 3] },
              threatCategories: 1,
            },
          },
        ]),
      ]);

      // Extract threat statistics
      const threatData = threatStats[0] || {
        totalThreatsDetected: 0,
        totalCostSaved: 0,
        averageRiskScore: 0,
        threatCategories: [],
      };

      const totalThreatsDetected = threatData.totalThreatsDetected;
      const totalCostSaved = threatData.totalCostSaved;
      const averageRiskScore = threatData.averageRiskScore;

      // Find most common threat from actual ThreatLog data
      const threatCounts: Record<string, number> = {};
      threatData.threatCategories.forEach((category: string) => {
        threatCounts[category] = (threatCounts[category] || 0) + 1;
      });

      let mostCommonThreat = 'none';
      let maxCount = 0;
      for (const [threat, count] of Object.entries(threatCounts)) {
        if (count > maxCount) {
          maxCount = count;
          mostCommonThreat = threat;
        }
      }

      // Calculate detection trend (simplified - would need time-based analysis)
      const detectionTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';

      // Reset failure count on success
      this.dbFailureCount = 0;

      return {
        totalThreatsDetected,
        totalCostSaved,
        averageRiskScore,
        mostCommonThreat,
        detectionTrend,
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Failed to get security metrics summary', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return {
        totalThreatsDetected: 0,
        totalCostSaved: 0,
        averageRiskScore: 0,
        mostCommonThreat: 'none',
        detectionTrend: 'stable',
      };
    }
  }

  /**
   * Circuit breaker utilities for database operations
   */
  private isDbCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
      const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      } else {
        // Reset circuit breaker
        this.dbFailureCount = 0;
        return false;
      }
    }
    return false;
  }

  private recordDbFailure(): void {
    this.dbFailureCount++;
    this.lastDbFailureTime = Date.now();
  }
}
