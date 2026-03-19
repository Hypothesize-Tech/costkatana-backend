/**
 * Chat Security Handler Service for NestJS
 *
 * Centralizes security checks, threat detection, and request validation for chat endpoints.
 * Provides comprehensive security analysis and blocking capabilities.
 */

import { Injectable, Logger, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { LlmSecurityService } from '../../security/llm-security.service';
import { randomUUID } from 'crypto';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface SecurityCheckResult {
  passed: boolean;
  isBlocked: boolean;
  threatCategory?: string;
  confidence?: number;
  stage?: string;
  reason?: string;
}

export interface SecurityContext {
  requestId: string;
  ipAddress: string;
  userAgent: string;
  estimatedTokens: number;
  estimatedCost: number;
  userId?: string;
  sessionId?: string;
}

export interface ThreatPattern {
  pattern: string | RegExp;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

@Injectable()
export class ChatSecurityHandlerService {
  private readonly logger = new Logger(ChatSecurityHandlerService.name);

  // Threat patterns to detect
  private readonly threatPatterns: ThreatPattern[] = [
    {
      pattern: /<script[^>]*>[\s\S]*?<\/script>/gi,
      category: 'xss',
      severity: 'high',
      description: 'Script injection detected',
    },
    {
      pattern: /javascript:/gi,
      category: 'xss',
      severity: 'high',
      description: 'JavaScript URL scheme detected',
    },
    {
      pattern: /on\w+\s*=/gi,
      category: 'xss',
      severity: 'medium',
      description: 'Event handler attribute detected',
    },
    {
      pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b)/gi,
      category: 'sql_injection',
      severity: 'high',
      description: 'SQL keywords detected',
    },
    {
      pattern: /(\b(eval|exec|system|shell_exec|passthru)\b)/gi,
      category: 'code_injection',
      severity: 'critical',
      description: 'Dangerous function calls detected',
    },
    {
      // eslint-disable-next-line no-control-regex -- intentional: detect control characters in user input
      pattern: /[\u0000-\u001F\u007F-\u009F]/g,
      category: 'control_characters',
      severity: 'medium',
      description: 'Control characters detected',
    },
    {
      pattern: /(?:\b\d{1,3}\.){3}\d{1,3}\b/g,
      category: 'ip_address',
      severity: 'low',
      description: 'IP addresses detected',
    },
  ];

  // Rate limiting state
  private requestCounts = new Map<
    string,
    { count: number; resetTime: number }
  >();
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly RATE_LIMIT_MAX = 100; // requests per minute

  /** Tracks number of requests blocked by security checks (for getSecurityStats) */
  private blockedRequestsCount = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmSecurityService: LlmSecurityService,
  ) {}

  /**
   * Extract IP address from execution context
   */
  extractIpAddress(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest();
    return (
      request.ip ||
      request.headers['x-forwarded-for']?.toString().split(',')[0] ||
      request.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Extract user agent from execution context
   */
  extractUserAgent(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest();
    return request.headers['user-agent'] || 'unknown';
  }

  /**
   * Generate request ID for tracking
   */
  generateRequestId(
    context: ExecutionContext,
    prefix: string = 'chat',
  ): string {
    const request = context.switchToHttp().getRequest();
    return (
      (request.headers['x-request-id'] as string) ||
      `${prefix}_${Date.now()}_${randomUUID()}`
    );
  }

  /**
   * Estimate tokens from message content
   */
  estimateTokens(message: string, maxOutputTokens: number = 1000): number {
    const inputTokens = Math.ceil(message.length / 4); // ~4 chars per token
    return inputTokens + maxOutputTokens;
  }

  /**
   * Estimate cost for request
   */
  estimateCost(estimatedTokens: number): number {
    return estimatedTokens * 0.00001; // $0.01 per 1000 tokens
  }

  /**
   * Build security context from execution context
   */
  buildSecurityContext(
    context: ExecutionContext,
    message?: string,
  ): SecurityContext {
    const requestId = this.generateRequestId(context);
    const ipAddress = this.extractIpAddress(context);
    const userAgent = this.extractUserAgent(context);

    const estimatedTokens = message ? this.estimateTokens(message) : 0;
    const estimatedCost = this.estimateCost(estimatedTokens);

    return {
      requestId,
      ipAddress,
      userAgent,
      estimatedTokens,
      estimatedCost,
    };
  }

  /**
   * Build security context from Express Request object
   */
  buildSecurityContextFromRequest(
    req: Request,
    messageLength: number,
    maxTokens: number = 1000,
  ): SecurityContext {
    const requestId =
      (req.headers['x-request-id'] as string) || generateSecureId('chat');
    const ipAddress =
      req.ip ||
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket?.remoteAddress ||
      'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const estimatedTokens = this.estimateTokens(
      messageLength.toString(),
      maxTokens,
    );
    const estimatedCost = this.estimateCost(estimatedTokens);

    return {
      requestId,
      ipAddress,
      userAgent,
      estimatedTokens,
      estimatedCost,
    };
  }

  /**
   * Perform comprehensive security check
   */
  async performSecurityCheck(
    context: ExecutionContext,
    message: string,
    userId?: string,
  ): Promise<SecurityCheckResult> {
    const securityContext = this.buildSecurityContext(context, message);

    try {
      // Stage 1: Input validation
      const validationResult = this.validateInput(message);
      if (!validationResult.passed) {
        return validationResult;
      }

      // Stage 2: Threat detection
      const threatResult = this.detectThreats(message);
      if (!threatResult.passed) {
        return threatResult;
      }

      // Stage 3: Rate limiting
      const rateLimitResult = this.checkRateLimit(
        securityContext.ipAddress,
        userId,
      );
      if (!rateLimitResult.passed) {
        return rateLimitResult;
      }

      // Stage 4: Content analysis
      const contentResult = await this.analyzeContent(message, securityContext);
      if (!contentResult.passed) {
        return contentResult;
      }

      // All checks passed
      return {
        passed: true,
        isBlocked: false,
        stage: 'completed',
        reason: 'All security checks passed',
      };
    } catch (error) {
      this.logger.error('Security check failed with error', {
        error: error instanceof Error ? error.message : String(error),
        requestId: securityContext.requestId,
      });

      return {
        passed: false,
        isBlocked: true,
        threatCategory: 'system_error',
        confidence: 1.0,
        stage: 'error',
        reason: 'Security check failed due to system error',
      };
    }
  }

  /**
   * Check message security with full request context (validation + threat detection + rate limit + AI security).
   * Use when Request object is available for real IP/UA extraction and AI-powered security checks.
   */
  async checkMessageSecurity(
    message: string,
    userId: string,
    req: Request,
    maxTokens: number = 1000,
  ): Promise<SecurityCheckResult> {
    try {
      // Stage 1: Input validation
      const validationResult = this.validateInput(message);
      if (!validationResult.passed) {
        this.recordBlockedRequest();
        return validationResult;
      }

      // Stage 2: Threat detection (regex-based)
      const threatResult = this.detectThreats(message);
      if (!threatResult.passed) {
        this.recordBlockedRequest();
        return threatResult;
      }

      // Stage 3: Rate limiting
      const securityContext = this.buildSecurityContextFromRequest(
        req,
        message.length,
        maxTokens,
      );
      const rateLimitResult = this.checkRateLimit(
        securityContext.ipAddress,
        userId,
      );
      if (!rateLimitResult.passed) {
        this.recordBlockedRequest();
        return rateLimitResult;
      }

      // Stage 4: Content analysis
      const contentResult = await this.analyzeContent(message, securityContext);
      if (!contentResult.passed) {
        this.recordBlockedRequest();
        return contentResult;
      }

      // Stage 5: AI-powered security check (LLMSecurityService)
      const aiSecurityResult =
        await this.llmSecurityService.performSecurityCheck(
          message,
          securityContext.requestId,
          userId,
          {
            estimatedCost: securityContext.estimatedCost,
            provenanceSource: 'chat-api',
            ipAddress: securityContext.ipAddress,
            userAgent: securityContext.userAgent,
            source: 'chat-api',
          },
        );

      if (aiSecurityResult.result.isBlocked) {
        this.recordBlockedRequest();
        this.logger.warn('Chat message blocked by AI security check', {
          requestId: securityContext.requestId,
          userId,
          threatCategory: aiSecurityResult.result.threatCategory,
          confidence: aiSecurityResult.result.confidence,
          stage: aiSecurityResult.result.stage,
          reason: aiSecurityResult.result.reason,
        });

        return {
          passed: false,
          isBlocked: true,
          threatCategory: aiSecurityResult.result.threatCategory,
          confidence: aiSecurityResult.result.confidence,
          stage: aiSecurityResult.result.stage,
          reason: aiSecurityResult.result.reason,
        };
      }

      this.logger.debug('Chat message security check passed', {
        requestId: securityContext.requestId,
        userId,
        messageLength: message.length,
      });

      return {
        passed: true,
        isBlocked: false,
        stage: 'completed',
        reason: 'All security checks passed',
      };
    } catch (error) {
      this.logger.error(
        'Chat message security check failed, allowing request (fail-open)',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
          messageLength: message.length,
        },
      );

      // Fail-open: Return passed=true on error (match Express behavior)
      return {
        passed: true,
        isBlocked: false,
        stage: 'error',
        reason: 'Security check failed due to system error, request allowed',
      };
    }
  }

  /**
   * Validate input parameters
   */
  private validateInput(message: string): SecurityCheckResult {
    // Check message length
    if (message.length > 50000) {
      return {
        passed: false,
        isBlocked: true,
        threatCategory: 'input_validation',
        confidence: 1.0,
        stage: 'input_validation',
        reason: 'Message too long',
      };
    }

    // Check for empty message
    if (!message.trim()) {
      return {
        passed: false,
        isBlocked: true,
        threatCategory: 'input_validation',
        confidence: 1.0,
        stage: 'input_validation',
        reason: 'Empty message',
      };
    }

    return { passed: true, isBlocked: false };
  }

  /**
   * Detect security threats in message content
   */
  private detectThreats(message: string): SecurityCheckResult {
    for (const threatPattern of this.threatPatterns) {
      const matches = message.match(threatPattern.pattern);
      if (matches) {
        // Calculate confidence based on number of matches and pattern severity
        const confidence = Math.min(
          1.0,
          matches.length * 0.1 +
            (threatPattern.severity === 'critical'
              ? 0.9
              : threatPattern.severity === 'high'
                ? 0.7
                : threatPattern.severity === 'medium'
                  ? 0.5
                  : 0.3),
        );

        return {
          passed: false,
          isBlocked: true,
          threatCategory: threatPattern.category,
          confidence,
          stage: 'threat_detection',
          reason: threatPattern.description,
        };
      }
    }

    return { passed: true, isBlocked: false };
  }

  /**
   * Check rate limiting. Uses `key` for the rate-limit bucket (e.g. `user:${userId}` or IP).
   * `userId` is kept for potential future use (e.g. per-user limits).
   */
  private checkRateLimit(key: string, _userId?: string): SecurityCheckResult {
    const now = Date.now();
    let requestData = this.requestCounts.get(key);

    if (!requestData || now > requestData.resetTime) {
      // Initialize or reset window
      requestData = {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW,
      };
    } else {
      requestData.count++;
    }

    this.requestCounts.set(key, requestData);

    if (requestData.count > this.RATE_LIMIT_MAX) {
      return {
        passed: false,
        isBlocked: true,
        threatCategory: 'rate_limit',
        confidence: 1.0,
        stage: 'rate_limiting',
        reason: `Rate limit exceeded: ${requestData.count}/${this.RATE_LIMIT_MAX} requests per minute`,
      };
    }

    return { passed: true, isBlocked: false };
  }

  /**
   * Analyze content for additional security concerns.
   * Uses `context` for logging/tracking when blocking (e.g. requestId).
   */
  private async analyzeContent(
    message: string,
    context: SecurityContext,
  ): Promise<SecurityCheckResult> {
    // Check for repetitive patterns that might indicate abuse
    const words = message.toLowerCase().split(/\s+/);
    const wordCounts = new Map<string, number>();

    for (const word of words) {
      if (word.length > 3) {
        // Only count meaningful words
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    // Check for excessive repetition
    const maxRepetition = Math.max(...Array.from(wordCounts.values()));
    if (maxRepetition > 10) {
      this.logger.debug('Content analysis: excessive repetition', {
        requestId: context.requestId,
        maxRepetition,
      });
      return {
        passed: false,
        isBlocked: true,
        threatCategory: 'content_analysis',
        confidence: 0.8,
        stage: 'content_analysis',
        reason: 'Excessive word repetition detected',
      };
    }

    // Check for base64 encoded content (potential obfuscation)
    const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
    const wordsWithBase64 = words.filter(
      (word) => word.length > 20 && base64Pattern.test(word),
    );

    if (wordsWithBase64.length > 0) {
      this.logger.debug('Content analysis: potential base64 content', {
        requestId: context.requestId,
        count: wordsWithBase64.length,
      });
      return {
        passed: false,
        isBlocked: true,
        threatCategory: 'content_analysis',
        confidence: 0.6,
        stage: 'content_analysis',
        reason: 'Potential base64 encoded content detected',
      };
    }

    return { passed: true, isBlocked: false };
  }

  /**
   * Log security event
   */
  logSecurityEvent(
    result: SecurityCheckResult,
    context: SecurityContext,
    message: string,
  ): void {
    const logData = {
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      passed: result.passed,
      isBlocked: result.isBlocked,
      threatCategory: result.threatCategory,
      confidence: result.confidence,
      stage: result.stage,
      reason: result.reason,
      messageLength: message.length,
      estimatedTokens: context.estimatedTokens,
      estimatedCost: context.estimatedCost,
    };

    if (result.isBlocked) {
      this.logger.warn('Security threat blocked', logData);
    } else {
      this.logger.debug('Security check passed', logData);
    }
  }

  /**
   * Get security statistics
   */
  getSecurityStats(): {
    activeRateLimits: number;
    blockedRequests: number;
    threatCategories: Record<string, number>;
  } {
    const activeRateLimits = this.requestCounts.size;
    const threatCategories: Record<string, number> = {};

    return {
      activeRateLimits,
      blockedRequests: this.blockedRequestsCount,
      threatCategories,
    };
  }

  /** Increment blocked request counter when a request is blocked by security checks */
  private recordBlockedRequest(): void {
    this.blockedRequestsCount += 1;
  }

  /**
   * Reset rate limiting for a specific key
   */
  resetRateLimit(key: string): void {
    this.requestCounts.delete(key);
    this.logger.debug('Rate limit reset', { key });
  }

  /**
   * Clean up expired rate limit data
   */
  cleanupRateLimits(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, data] of this.requestCounts.entries()) {
      if (now > data.resetTime) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.requestCounts.delete(key));

    if (keysToDelete.length > 0) {
      this.logger.debug('Cleaned up expired rate limits', {
        cleanedCount: keysToDelete.length,
      });
    }
  }
}
