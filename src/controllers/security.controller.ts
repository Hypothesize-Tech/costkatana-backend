import { Response } from 'express';
import { LLMSecurityService } from '../services/llmSecurity.service';
import { PromptFirewallService } from '../services/promptFirewall.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class SecurityController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for external services
    private static serviceFailureCount: number = 0;
    private static readonly MAX_SERVICE_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastServiceFailureTime: number = 0;
    
    // Firewall configuration cache
    private static configCache = new Map<string, { config: any; timestamp: number }>();
    private static readonly CONFIG_CACHE_TTL = 300000; // 5 minutes
    
    /**
     * Initialize background processor
     */
    static {
        SecurityController.startBackgroundProcessor();
    }
    /**
     * Get security analytics dashboard
     */
    static async getSecurityAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getSecurityAnalytics', req);
        const { startDate, endDate } = req.query;

        try {
            let timeRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                timeRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            const analytics = await LLMSecurityService.getSecurityAnalytics(userId, timeRange);

            ControllerHelper.logRequestSuccess('getSecurityAnalytics', req, startTime, {
                hasTimeRange: !!timeRange
            });

            // Queue background business event logging
            const duration = Date.now() - startTime;
            SecurityController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'security_analytics_retrieved',
                    category: 'security',
                    value: duration,
                    metadata: {
                        userId,
                        hasTimeRange: !!timeRange
                    }
                });
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            SecurityController.recordServiceFailure();
            ControllerHelper.handleError('getSecurityAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get security metrics summary
     */
    static async getSecurityMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getSecurityMetrics', req);

        try {
            const metrics = await LLMSecurityService.getSecurityMetricsSummary(userId);

            ControllerHelper.logRequestSuccess('getSecurityMetrics', req, startTime);

            res.json({
                success: true,
                data: metrics
            });

        } catch (error: any) {
            SecurityController.recordServiceFailure();
            ControllerHelper.handleError('getSecurityMetrics', error, req, res, startTime);
        }
    }

    /**
     * Test security check manually
     */
    static async testSecurityCheck(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('testSecurityCheck', req);
        const { prompt, retrievedChunks, toolCalls, provenanceSource } = req.body;

        try {
            // Check circuit breaker
            if (SecurityController.isServiceCircuitBreakerOpen()) {
                res.status(503).json({
                    success: false,
                    message: 'Security service temporarily unavailable. Please try again later.'
                });
                return;
            }

            if (!prompt) {
                res.status(400).json({
                    success: false,
                    message: 'Prompt is required for security testing'
                });
                return;
            }

            const testRequestId = `test-${Date.now()}`;
            
            // Add timeout handling for security check
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Security check timeout')), 30000);
            });

            const securityCheckPromise = LLMSecurityService.performSecurityCheck(
                prompt,
                testRequestId,
                userId,
                {
                    retrievedChunks,
                    toolCalls,
                    provenanceSource,
                    estimatedCost: 0.01
                }
            );

            const securityCheck = await Promise.race([securityCheckPromise, timeoutPromise]);

            ControllerHelper.logRequestSuccess('testSecurityCheck', req, startTime, {
                testRequestId,
                securityResult: securityCheck.result,
                hasHumanReview: !!securityCheck.humanReviewId
            });

            // Queue background business event logging
            const duration = Date.now() - startTime;
            SecurityController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'security_check_tested',
                    category: 'security',
                    value: duration,
                    metadata: {
                        userId,
                        testRequestId,
                        securityResult: securityCheck.result,
                        hasHumanReview: !!securityCheck.humanReviewId
                    }
                });
            });

            res.json({
                success: true,
                data: {
                    requestId: testRequestId,
                    securityResult: securityCheck.result,
                    humanReviewId: securityCheck.humanReviewId,
                    traceCreated: !!securityCheck.traceEvent
                }
            });

        } catch (error: any) {
            SecurityController.recordServiceFailure();
            ControllerHelper.handleError('testSecurityCheck', error, req, res, startTime);
        }
    }

    /**
     * Get pending human reviews
     */
    static async getPendingReviews(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getPendingReviews', req);

        try {
            const pendingReviews = LLMSecurityService.getPendingReviews(userId);

            ControllerHelper.logRequestSuccess('getPendingReviews', req, startTime, {
                pendingReviewsCount: Array.isArray(pendingReviews) ? pendingReviews.length : 0,
                hasPendingReviews: !!pendingReviews && (Array.isArray(pendingReviews) ? pendingReviews.length > 0 : true)
            });

            res.json({
                success: true,
                data: pendingReviews
            });

        } catch (error: any) {
            ControllerHelper.handleError('getPendingReviews', error, req, res, startTime);
        }
    }

    /**
     * Review a security request (approve/deny)
     */
    static async reviewSecurityRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('reviewSecurityRequest', req);
        const { reviewId } = req.params;
        const { decision, comments } = req.body;

        try {
            if (!reviewId) {
                res.status(400).json({
                    success: false,
                    message: 'Review ID is required'
                });
                return;
            }

            if (!decision || !['approved', 'denied'].includes(decision)) {
                res.status(400).json({
                    success: false,
                    message: 'Valid decision (approved/denied) is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(reviewId, 'reviewId');

            const success = await LLMSecurityService.reviewRequest(
                reviewId,
                userId,
                decision,
                comments
            );

            if (!success) {
                res.status(404).json({
                    success: false,
                    message: 'Review request not found or already processed'
                });
                return;
            }

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('reviewSecurityRequest', req, startTime, {
                reviewId,
                decision,
                hasComments: !!comments
            });

            // Log business event
            loggingService.logBusiness({
                event: 'security_request_reviewed',
                category: 'security',
                value: duration,
                metadata: {
                    userId,
                    reviewId,
                    decision,
                    hasComments: !!comments
                }
            });

            res.json({
                success: true,
                message: `Security request ${decision} successfully`
            });

        } catch (error: any) {
            ControllerHelper.handleError('reviewSecurityRequest', error, req, res, startTime, {
                reviewId,
                decision
            });
        }
    }

    /**
     * Get firewall analytics (from the original service)
     */
    static async getFirewallAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getFirewallAnalytics', req);
        const { startDate, endDate } = req.query;

        try {
            let dateRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                dateRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            const analytics = await PromptFirewallService.getFirewallAnalytics(userId, dateRange);

            ControllerHelper.logRequestSuccess('getFirewallAnalytics', req, startTime, {
                hasDateRange: !!dateRange,
                hasAnalytics: !!analytics
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            ControllerHelper.handleError('getFirewallAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Update firewall configuration
     */
    static async updateFirewallConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('updateFirewallConfig', req);
        const config = req.body;

        try {
            // Validate configuration
            const validConfig = PromptFirewallService.parseConfigFromHeaders(config);

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('updateFirewallConfig', req, startTime, {
                hasValidConfig: !!validConfig,
                configKeys: Object.keys(validConfig || {})
            });

            // Log business event
            loggingService.logBusiness({
                event: 'firewall_config_updated',
                category: 'security',
                value: duration,
                metadata: {
                    userId,
                    configKeys: Object.keys(validConfig || {})
                }
            });
            
            res.json({
                success: true,
                data: {
                    config: validConfig,
                    message: 'Firewall configuration updated successfully'
                }
            });

        } catch (error: any) {
            ControllerHelper.handleError('updateFirewallConfig', error, req, res, startTime, {
                hasConfig: !!config
            });
        }
    }

    /**
     * Get current firewall configuration
     */
    static async getFirewallConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getFirewallConfig', req);

        try {
            // In a real implementation, you'd fetch user-specific config from database
            const config = PromptFirewallService.getDefaultConfig();

            ControllerHelper.logRequestSuccess('getFirewallConfig', req, startTime, {
                hasConfig: !!config,
                configKeys: Object.keys(config || {})
            });

            res.json({
                success: true,
                data: config
            });

        } catch (error: any) {
            ControllerHelper.handleError('getFirewallConfig', error, req, res, startTime);
        }
    }

    /**
     * Get top risky prompts (for security analysis)
     */
    static async getTopRiskyPrompts(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getTopRiskyPrompts', req);
        const limit = parseInt(req.query.limit as string) || 20;

        try {
            const analytics = await LLMSecurityService.getSecurityAnalytics(userId);

            ControllerHelper.logRequestSuccess('getTopRiskyPrompts', req, startTime, {
                limit,
                hasAnalytics: !!analytics,
                topRiskyPatternsCount: analytics?.topRiskyPatterns?.length || 0,
                topRiskySourcesCount: analytics?.topRiskySources?.length || 0,
                hasThreatDistribution: !!analytics?.threatDistribution
            });

            res.json({
                success: true,
                data: {
                    topRiskyPatterns: analytics.topRiskyPatterns.slice(0, limit),
                    topRiskySources: analytics.topRiskySources.slice(0, limit),
                    threatDistribution: analytics.threatDistribution
                }
            });

        } catch (error: any) {
            ControllerHelper.handleError('getTopRiskyPrompts', error, req, res, startTime, { limit });
        }
    }

    /**
     * Export security report
     */
    static async exportSecurityReport(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('exportSecurityReport', req);
        const { format = 'json', startDate, endDate } = req.query;

        try {

            let timeRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                timeRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            // Get analytics and metrics with parallel processing and error handling
            const [analytics, metrics] = await Promise.allSettled([
                LLMSecurityService.getSecurityAnalytics(userId, timeRange),
                LLMSecurityService.getSecurityMetricsSummary(userId)
            ]);

            const finalAnalytics = analytics.status === 'fulfilled' ? analytics.value : {
                detectionRate: 0,
                topRiskyPatterns: [],
                topRiskySources: [],
                threatDistribution: {},
                containmentActions: {},
                costSaved: 0,
                timeRange: timeRange || { start: new Date(), end: new Date() }
            };

            const finalMetrics = metrics.status === 'fulfilled' ? metrics.value : {
                totalThreatsDetected: 0,
                totalCostSaved: 0,
                averageRiskScore: 0,
                mostCommonThreat: 'None',
                detectionTrend: 'stable' as 'stable'
            };

            if (analytics.status === 'rejected') {
                loggingService.warn('Failed to get security analytics, using defaults', {
                    userId,
                    requestId: req.headers['x-request-id'] as string,
                    error: analytics.reason?.message || 'Unknown error'
                });
            }

            if (metrics.status === 'rejected') {
                loggingService.warn('Failed to get security metrics, using defaults', {
                    userId,
                    requestId: req.headers['x-request-id'] as string,
                    error: metrics.reason?.message || 'Unknown error'
                });
            }

            const report = {
                generatedAt: new Date(),
                timeRange: finalAnalytics.timeRange || timeRange || { start: new Date(), end: new Date() },
                summary: finalMetrics,
                analytics: finalAnalytics,
                metadata: {
                    userId,
                    reportType: 'security_comprehensive',
                    version: '1.0'
                }
            };

            if (format === 'csv') {
                // Stream CSV generation for better memory efficiency
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=security_report.csv');
                
                // Generate CSV in chunks to avoid memory issues
                const csvContent = SecurityController.generateStreamedCSV(report);
                res.send(csvContent);
            } else {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename=security_report.json');
                res.json(report);
            }

            const duration = Date.now() - startTime;
            ControllerHelper.logRequestSuccess('exportSecurityReport', req, startTime, {
                format,
                hasTimeRange: !!timeRange
            });

            // Queue background business event logging
            SecurityController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'security_report_exported',
                    category: 'security',
                    value: duration,
                    metadata: {
                        userId,
                        format,
                        hasTimeRange: !!timeRange
                    }
                });
            });

        } catch (error: any) {
            ControllerHelper.handleError('exportSecurityReport', error, req, res, startTime, {
                format,
                startDate,
                endDate
            });
        }
    }

    /**
     * Generate streamed CSV for better memory efficiency
     */
    private static generateStreamedCSV(report: any): string {
        try {
            const timestamp = new Date().toISOString();
            const summary = report?.summary || {};
            const analytics = report?.analytics || {};

            // Use array for better performance than string concatenation
            const csvRows: string[] = [
                'Metric,Value,Category,Timestamp',
                `Total Threats Detected,"${summary.totalThreatsDetected || 0}",Summary,"${timestamp}"`,
                `Total Cost Saved,"${summary.totalCostSaved || 0}",Summary,"${timestamp}"`,
                `Average Risk Score,"${summary.averageRiskScore || 0}",Summary,"${timestamp}"`,
                `Most Common Threat,"${summary.mostCommonThreat || 'None'}",Summary,"${timestamp}"`,
                `Detection Trend,"${summary.detectionTrend || 'Unknown'}",Summary,"${timestamp}"`,
                `Detection Rate,"${analytics.detectionRate || 0}",Analytics,"${timestamp}"`
            ];

            // Process threat distribution in chunks
            if (analytics.threatDistribution && typeof analytics.threatDistribution === 'object') {
                const entries = Object.entries(analytics.threatDistribution);
                for (let i = 0; i < entries.length; i += 100) { // Process in chunks of 100
                    const chunk = entries.slice(i, i + 100);
                    for (const [threat, count] of chunk) {
                        const safeThreat = String(threat || 'unknown').replace(/"/g, '""');
                        const safeCount = Number(count) || 0;
                        csvRows.push(`"${safeThreat} Threats","${safeCount}",Threat Distribution,"${timestamp}"`);
                    }
                }
            }

            return csvRows.join('\n');
        } catch (error: any) {
            return 'Error,Message\n"CSV Generation Error","Failed to generate CSV report"';
        }
    }

    /**
     * Circuit breaker utilities for external services
     */
    private static isServiceCircuitBreakerOpen(): boolean {
        if (this.serviceFailureCount >= this.MAX_SERVICE_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastServiceFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.serviceFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordServiceFailure(): void {
        this.serviceFailureCount++;
        this.lastServiceFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Get cached firewall configuration
     */
    private static getCachedFirewallConfig(userId: string): any | null {
        const cached = this.configCache.get(userId);
        if (cached && Date.now() - cached.timestamp < this.CONFIG_CACHE_TTL) {
            return cached.config;
        }
        return null;
    }

    private static setCachedFirewallConfig(userId: string, config: any): void {
        this.configCache.set(userId, {
            config,
            timestamp: Date.now()
        });
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
        
        // Clear caches
        this.configCache.clear();
    }
}
