import { loggingService } from './logging.service';
import { PromptFirewallService, ThreatDetectionResult } from './promptFirewall.service';
import { ThreatLog } from '../models/ThreatLog';
import { Types } from 'mongoose';
// TraceEvent model would need to be created - using generic logging for now
import { v4 as uuidv4 } from 'uuid';

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

export class LLMSecurityService {
    private static humanReviewQueue = new Map<string, HumanReviewRequest>();

    /**
     * Comprehensive security check for LLM requests
     */
    static async performSecurityCheck(
        prompt: string,
        requestId: string,
        userId?: string,
        context?: {
            retrievedChunks?: string[];
            toolCalls?: any[];
            provenanceSource?: string;
            estimatedCost?: number;
        }
    ): Promise<{
        result: ThreatDetectionResult;
        traceEvent?: any;
        humanReviewId?: string;
    }> {
        const startTime = Date.now();
        
        try {
            // Get firewall configuration (could be user-specific in the future)
            const config = PromptFirewallService.getDefaultConfig();
            
            // Run comprehensive security check
            const securityResult = await PromptFirewallService.checkPrompt(
                prompt,
                config,
                requestId,
                context?.estimatedCost || 0.01,
                context
            );

            // Create trace event for security check
            const traceEvent = await this.createSecurityTraceEvent(
                requestId,
                userId,
                prompt,
                securityResult,
                context,
                Date.now() - startTime
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
                    context?.retrievedChunks
                );
            }

            return {
                result: securityResult,
                traceEvent,
                humanReviewId
            };

        } catch (error) {
            loggingService.error('LLM security check failed', {
                error: error instanceof Error ? error.message : String(error),
                requestId,
                userId,
                promptLength: prompt.length
            });

            // Return safe default (allow with warning)
            return {
                result: {
                    isBlocked: false,
                    confidence: 0.0,
                    reason: 'Security check failed - allowing request',
                    stage: 'prompt-guard',
                    containmentAction: 'allow'
                }
            };
        }
    }

    /**
     * Create trace event for security check
     */
    private static async createSecurityTraceEvent(
        requestId: string,
        userId: string | undefined,
        prompt: string,
        result: ThreatDetectionResult,
        context: any,
        duration: number
    ): Promise<any> {
        try {
            // Log security trace event (in production, this would save to TraceEvent model)
            const traceData = {
                traceId: `security-${requestId}`,
                spanId: uuidv4(),
                operationName: 'llm_security_check',
                startTime: new Date(Date.now() - duration),
                endTime: new Date(),
                duration,
                userId,
                metadata: {
                    security: {
                        isBlocked: result.isBlocked,
                        threatCategory: result.threatCategory,
                        confidence: result.confidence,
                        stage: result.stage,
                        riskScore: (result as any).riskScore,
                        containmentAction: (result as any).containmentAction,
                        matchedPatterns: (result as any).matchedPatterns,
                        provenanceSource: (result as any).provenanceSource
                    },
                    prompt: {
                        length: prompt.length,
                        hash: this.hashPrompt(prompt)
                    },
                    context: {
                        hasRetrievedChunks: !!context?.retrievedChunks?.length,
                        retrievedChunksCount: context?.retrievedChunks?.length || 0,
                        hasToolCalls: !!context?.toolCalls?.length,
                        toolCallsCount: context?.toolCalls?.length || 0,
                        provenanceSource: context?.provenanceSource
                    }
                },
                tags: {
                    component: 'llm-security',
                    security_stage: result.stage,
                    threat_category: result.threatCategory || 'none',
                    is_blocked: result.isBlocked.toString(),
                    containment_action: (result as any).containmentAction || 'allow'
                }
            };

            loggingService.info('Security trace event', { value:  { value: traceData  } });
            return traceData;

        } catch (error) {
            loggingService.error('Failed to create security trace event', {
                error: error instanceof Error ? error.message : String(error),
                requestId,
                userId
            });
            return null;
        }
    }

    /**
     * Create human review request
     */
    private static async createHumanReviewRequest(
        requestId: string,
        userId: string | undefined,
        threatResult: ThreatDetectionResult,
        originalPrompt: string,
        toolCalls?: any[],
        retrievedChunks?: string[]
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
            retrievedChunks: retrievedChunks?.map(chunk => this.sanitizePromptForReview(chunk)),
            status: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + expirationTime)
        };

        this.humanReviewQueue.set(reviewId, reviewRequest);

        // Auto-expire after timeout
        setTimeout(() => {
            const request = this.humanReviewQueue.get(reviewId);
            if (request && request.status === 'pending') {
                request.status = 'expired';
                this.humanReviewQueue.set(reviewId, request);
                loggingService.info('Human review request expired', { value:  {  reviewId, requestId  } });
            }
        }, expirationTime);

        loggingService.info('Created human review request', { value:  { 
            reviewId,
            requestId,
            userId,
            threatCategory: threatResult.threatCategory,
            riskScore: threatResult.riskScore
         } });

        return reviewId;
    }

    /**
     * Get pending human review requests
     */
    static getPendingReviews(userId?: string): HumanReviewRequest[] {
        const pendingReviews = Array.from(this.humanReviewQueue.values())
            .filter(req => req.status === 'pending');

        if (userId) {
            return pendingReviews.filter(req => req.userId === userId);
        }

        return pendingReviews;
    }

    /**
     * Approve/deny human review request
     */
    static async reviewRequest(
        reviewId: string,
        reviewerId: string,
        decision: 'approved' | 'denied',
        comments?: string
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

        loggingService.info('Human review completed', { value:  { 
            reviewId,
            reviewerId,
            decision,
            requestId: request.requestId
         } });

        return true;
    }

    /**
     * Get security analytics
     */
    static async getSecurityAnalytics(
        userId?: string,
        timeRange?: { start: Date; end: Date }
    ): Promise<SecurityAnalytics> {
        try {
            const defaultTimeRange = {
                start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
                end: new Date()
            };

            const queryTimeRange = timeRange || defaultTimeRange;
            
            const matchQuery: any = {
                timestamp: {
                    $gte: queryTimeRange.start,
                    $lte: queryTimeRange.end
                }
            };

            if (userId) {
                try {
                    matchQuery.userId = new Types.ObjectId(userId);
                } catch (idError) {
                    loggingService.warn('Invalid userId format, skipping user filter:', { value:  { value: userId } });
                    // Continue without user filter if userId is invalid
                }
            }

            // Get threat logs for analysis with error handling
            let threatLogs: any[] = [];
            try {
                threatLogs = await ThreatLog.find(matchQuery).sort({ timestamp: -1 });
            } catch (dbError) {
                loggingService.error('Error fetching threat logs from database:', { error: dbError instanceof Error ? dbError.message : String(dbError) });
                threatLogs = []; // Default to empty array if database query fails
            }

            // Calculate detection rate (threats detected vs total requests)
            // This is a simplified calculation - in production you'd track total requests separately
            const detectionRate = threatLogs.length > 0 ? 1.0 : 0.0;

            // Analyze risky patterns
            const patternCounts = new Map<string, { count: number; totalRiskScore: number }>();
            const sourceCounts = new Map<string, { count: number; totalRiskScore: number }>();
            const threatDistribution: Record<string, number> = {};
            const containmentActions: Record<string, number> = {};
            let totalCostSaved = 0;

            for (const log of threatLogs) {
                // Threat distribution
                threatDistribution[log.threatCategory] = (threatDistribution[log.threatCategory] || 0) + 1;

                // Cost saved
                totalCostSaved += log.costSaved;

                // Pattern analysis from details
                if (log.details?.matchedPatterns) {
                    for (const pattern of log.details.matchedPatterns) {
                        const current = patternCounts.get(pattern) || { count: 0, totalRiskScore: 0 };
                        current.count += 1;
                        current.totalRiskScore += log.confidence;
                        patternCounts.set(pattern, current);
                    }
                }

                // Source analysis
                if (log.details?.provenanceSource) {
                    const source = log.details.provenanceSource;
                    const current = sourceCounts.get(source) || { count: 0, totalRiskScore: 0 };
                    current.count += 1;
                    current.totalRiskScore += log.confidence;
                    sourceCounts.set(source, current);
                }

                // Containment actions
                if (log.details?.containmentAction) {
                    const action = log.details.containmentAction;
                    containmentActions[action] = (containmentActions[action] || 0) + 1;
                }
            }

            // Top risky patterns
            const topRiskyPatterns = Array.from(patternCounts.entries())
                .map(([pattern, data]) => ({
                    pattern,
                    count: data.count,
                    averageRiskScore: data.totalRiskScore / data.count
                }))
                .sort((a, b) => b.averageRiskScore - a.averageRiskScore)
                .slice(0, 10);

            // Top risky sources
            const topRiskySources = Array.from(sourceCounts.entries())
                .map(([source, data]) => ({
                    source,
                    count: data.count,
                    averageRiskScore: data.totalRiskScore / data.count
                }))
                .sort((a, b) => b.averageRiskScore - a.averageRiskScore)
                .slice(0, 10);

            return {
                detectionRate,
                topRiskyPatterns,
                topRiskySources,
                threatDistribution,
                containmentActions,
                costSaved: totalCostSaved,
                timeRange: queryTimeRange
            };

        } catch (error) {
            loggingService.error('Failed to get security analytics', {
                error: error instanceof Error ? error.message : String(error),
                userId
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
                    end: new Date()
                }
            };
        }
    }

    /**
     * Hash prompt for privacy (SHA-256)
     */
    private static hashPrompt(prompt: string): string {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    }

    /**
     * Sanitize prompt for human review (remove sensitive info)
     */
    private static sanitizePromptForReview(text: string): string {
        if (!text) return '';
        
        // Remove potential sensitive patterns
        return text
            .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CREDIT_CARD_REDACTED]')
            .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
            .replace(/password\s*[:=]\s*\S+/gi, 'password:[REDACTED]')
            .replace(/api[_\s]?key\s*[:=]\s*\S+/gi, 'api_key:[REDACTED]')
            .replace(/token\s*[:=]\s*\S+/gi, 'token:[REDACTED]')
            .slice(0, 1000); // Limit length for review
    }

    /**
     * Clean up expired human review requests
     */
    static cleanupExpiredReviews(): void {
        const now = new Date();
        const expiredKeys: string[] = [];

        for (const [key, request] of this.humanReviewQueue.entries()) {
            if (request.expiresAt < now) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => {
            this.humanReviewQueue.delete(key);
        });

        if (expiredKeys.length > 0) {
            loggingService.info(`Cleaned up ${expiredKeys.length} expired human review requests`);
        }
    }

    /**
     * Get security metrics summary
     */
    static async getSecurityMetricsSummary(userId?: string): Promise<{
        totalThreatsDetected: number;
        totalCostSaved: number;
        averageRiskScore: number;
        mostCommonThreat: string;
        detectionTrend: 'increasing' | 'decreasing' | 'stable';
    }> {
        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
            
            const matchQuery: any = { timestamp: { $gte: thirtyDaysAgo } };
            if (userId) {
                try {
                    matchQuery.userId = new Types.ObjectId(userId);
                } catch (idError) {
                    loggingService.warn('Invalid userId format in metrics, skipping user filter:', { value:  { value: userId } });
                    // Continue without user filter if userId is invalid
                }
            }

            let allThreats: any[] = [];
            let recentThreats: any[] = [];
            
            try {
                allThreats = await ThreatLog.find(matchQuery);
                recentThreats = await ThreatLog.find({
                    ...matchQuery,
                    timestamp: { $gte: fifteenDaysAgo }
                });
            } catch (dbError) {
                loggingService.error('Error fetching threat logs for metrics:', { error: dbError instanceof Error ? dbError.message : String(dbError) });
                // Return default values if database query fails
                return {
                    totalThreatsDetected: 0,
                    totalCostSaved: 0,
                    averageRiskScore: 0,
                    mostCommonThreat: 'None',
                    detectionTrend: 'stable' as 'stable'
                };
            }

            const totalThreatsDetected = allThreats.length;
            const totalCostSaved = allThreats.reduce((sum, threat) => sum + threat.costSaved, 0);
            const averageRiskScore = allThreats.length > 0 
                ? allThreats.reduce((sum, threat) => sum + threat.confidence, 0) / allThreats.length 
                : 0;

            // Most common threat
            const threatCounts: Record<string, number> = {};
            allThreats.forEach(threat => {
                threatCounts[threat.threatCategory] = (threatCounts[threat.threatCategory] || 0) + 1;
            });
            const mostCommonThreat = Object.entries(threatCounts)
                .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none';

            // Detection trend
            const oldThreats = allThreats.filter(t => t.timestamp < fifteenDaysAgo);
            let detectionTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
            
            if (recentThreats.length > oldThreats.length * 1.2) {
                detectionTrend = 'increasing';
            } else if (recentThreats.length < oldThreats.length * 0.8) {
                detectionTrend = 'decreasing';
            }

            return {
                totalThreatsDetected,
                totalCostSaved,
                averageRiskScore,
                mostCommonThreat,
                detectionTrend
            };

        } catch (error) {
            loggingService.error('Failed to get security metrics summary', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return {
                totalThreatsDetected: 0,
                totalCostSaved: 0,
                averageRiskScore: 0,
                mostCommonThreat: 'none',
                detectionTrend: 'stable'
            };
        }
    }
}

// Cleanup expired reviews every 10 minutes
setInterval(() => {
    LLMSecurityService.cleanupExpiredReviews();
}, 10 * 60 * 1000);
