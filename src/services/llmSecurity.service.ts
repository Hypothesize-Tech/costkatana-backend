import { loggingService } from './logging.service';
import { PromptFirewallService, ThreatDetectionResult } from './promptFirewall.service';
import { ThreatLog } from '../models/ThreatLog';
import { Types } from 'mongoose';
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
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;

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
            ipAddress?: string;
            userAgent?: string;
            source?: string;
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
            
            // Run comprehensive security check (now handles HTML and metadata)
            const securityResult = await PromptFirewallService.checkPrompt(
                prompt,
                config,
                requestId,
                context?.estimatedCost || 0.01,
                {
                    ...context,
                    userId,
                    ipAddress: context?.ipAddress,
                    userAgent: context?.userAgent,
                    source: context?.source
                }
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
     * Get security analytics (optimized with aggregation pipeline)
     */
    static async getSecurityAnalytics(
        userId?: string,
        timeRange?: { start: Date; end: Date }
    ): Promise<SecurityAnalytics> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

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
                    loggingService.warn('Invalid userId format, skipping user filter:', { value: userId });
                    // Continue without user filter if userId is invalid
                }
            }

            // Use MongoDB aggregation pipeline for efficient analytics calculation
            const analyticsResults = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $facet: {
                        // Basic statistics
                        basicStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalThreats: { $sum: 1 },
                                    totalCostSaved: { $sum: '$costSaved' },
                                    avgConfidence: { $avg: '$confidence' }
                                }
                            }
                        ],
                        // Threat distribution
                        threatDistribution: [
                            {
                                $group: {
                                    _id: '$threatCategory',
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        // Containment actions
                        containmentActions: [
                            {
                                $match: { 'details.containmentAction': { $exists: true } }
                            },
                            {
                                $group: {
                                    _id: '$details.containmentAction',
                                    count: { $sum: 1 }
                                }
                            }
                        ],
                        // Pattern analysis
                        patternAnalysis: [
                            {
                                $match: { 'details.matchedPatterns': { $exists: true, $ne: [] } }
                            },
                            { $unwind: '$details.matchedPatterns' },
                            {
                                $group: {
                                    _id: '$details.matchedPatterns',
                                    count: { $sum: 1 },
                                    totalRiskScore: { $sum: '$confidence' },
                                    avgRiskScore: { $avg: '$confidence' }
                                }
                            },
                            { $sort: { avgRiskScore: -1 } },
                            { $limit: 10 }
                        ],
                        // Source analysis
                        sourceAnalysis: [
                            {
                                $match: { 'details.provenanceSource': { $exists: true } }
                            },
                            {
                                $group: {
                                    _id: '$details.provenanceSource',
                                    count: { $sum: 1 },
                                    totalRiskScore: { $sum: '$confidence' },
                                    avgRiskScore: { $avg: '$confidence' }
                                }
                            },
                            { $sort: { avgRiskScore: -1 } },
                            { $limit: 10 }
                        ]
                    }
                }
            ]);

            const result = analyticsResults[0];
            const basicStats = result.basicStats[0] || { totalThreats: 0, totalCostSaved: 0, avgConfidence: 0 };
            
            // Transform threat distribution
            const threatDistribution: Record<string, number> = {};
            result.threatDistribution.forEach((item: any) => {
                threatDistribution[item._id] = item.count;
            });

            // Transform containment actions
            const containmentActions: Record<string, number> = {};
            result.containmentActions.forEach((item: any) => {
                containmentActions[item._id] = item.count;
            });

            // Transform pattern analysis
            const topRiskyPatterns = result.patternAnalysis.map((item: any) => ({
                pattern: item._id,
                count: item.count,
                averageRiskScore: item.avgRiskScore
            }));

            // Transform source analysis
            const topRiskySources = result.sourceAnalysis.map((item: any) => ({
                source: item._id,
                count: item.count,
                averageRiskScore: item.avgRiskScore
            }));

            // Calculate detection rate (simplified)
            const detectionRate = basicStats.totalThreats > 0 ? 1.0 : 0.0;

            // Reset failure count on success
            this.dbFailureCount = 0;

            return {
                detectionRate,
                topRiskyPatterns,
                topRiskySources,
                threatDistribution,
                containmentActions,
                costSaved: basicStats.totalCostSaved,
                timeRange: queryTimeRange
            };

        } catch (error) {
            this.recordDbFailure();
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
     * Get security metrics summary (optimized with aggregation pipeline)
     */
    static async getSecurityMetricsSummary(userId?: string): Promise<{
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
            
            const matchQuery: any = { timestamp: { $gte: thirtyDaysAgo } };
            if (userId) {
                try {
                    matchQuery.userId = new Types.ObjectId(userId);
                } catch (idError) {
                    loggingService.warn('Invalid userId format in metrics, skipping user filter:', { value: userId });
                    // Continue without user filter if userId is invalid
                }
            }

            // Use MongoDB aggregation pipeline for efficient metrics calculation
            const metricsResults = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $facet: {
                        // Overall statistics
                        overallStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalThreatsDetected: { $sum: 1 },
                                    totalCostSaved: { $sum: '$costSaved' },
                                    averageRiskScore: { $avg: '$confidence' }
                                }
                            }
                        ],
                        // Most common threat
                        threatCounts: [
                            {
                                $group: {
                                    _id: '$threatCategory',
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { count: -1 } },
                            { $limit: 1 }
                        ],
                        // Recent threats for trend analysis
                        recentThreats: [
                            {
                                $match: { timestamp: { $gte: fifteenDaysAgo } }
                            },
                            {
                                $group: {
                                    _id: null,
                                    recentCount: { $sum: 1 }
                                }
                            }
                        ],
                        // Old threats for trend analysis
                        oldThreats: [
                            {
                                $match: { timestamp: { $lt: fifteenDaysAgo } }
                            },
                            {
                                $group: {
                                    _id: null,
                                    oldCount: { $sum: 1 }
                                }
                            }
                        ]
                    }
                }
            ]);

            const result = metricsResults[0];
            const overallStats = result.overallStats[0] || { 
                totalThreatsDetected: 0, 
                totalCostSaved: 0, 
                averageRiskScore: 0 
            };
            
            const mostCommonThreat = result.threatCounts[0]?._id || 'none';
            const recentCount = result.recentThreats[0]?.recentCount || 0;
            const oldCount = result.oldThreats[0]?.oldCount || 0;

            // Calculate detection trend
            let detectionTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
            if (recentCount > oldCount * 1.2) {
                detectionTrend = 'increasing';
            } else if (recentCount < oldCount * 0.8) {
                detectionTrend = 'decreasing';
            }

            // Reset failure count on success
            this.dbFailureCount = 0;

            return {
                totalThreatsDetected: overallStats.totalThreatsDetected,
                totalCostSaved: overallStats.totalCostSaved,
                averageRiskScore: overallStats.averageRiskScore,
                mostCommonThreat,
                detectionTrend
            };

        } catch (error) {
            this.recordDbFailure();
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

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
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

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }
}

// Cleanup expired reviews every 10 minutes
setInterval(() => {
    LLMSecurityService.cleanupExpiredReviews();
}, 10 * 60 * 1000);
