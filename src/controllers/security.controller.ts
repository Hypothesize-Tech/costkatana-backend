import { Response } from 'express';
import { LLMSecurityService } from '../services/llmSecurity.service';
import { PromptFirewallService } from '../services/promptFirewall.service';
import { loggingService } from '../services/logging.service';

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
    static async getSecurityAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { startDate, endDate } = req.query;

        try {
            loggingService.info('Security analytics retrieval initiated', {
                userId,
                requestId,
                startDate,
                endDate
            });

            if (!userId) {
                loggingService.warn('Security analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            let timeRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                timeRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            const analytics = await LLMSecurityService.getSecurityAnalytics(userId, timeRange);
            const duration = Date.now() - startTime;

            loggingService.info('Security analytics retrieved successfully', {
                userId,
                duration,
                requestId
            });

            // Queue background business event logging
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Security analytics retrieval failed', {
                userId,
                requestId,
                error: error.message || 'Unknown error',
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve security analytics'
            });
        }
    }

    /**
     * Get security metrics summary
     */
    static async getSecurityMetrics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Security metrics retrieval initiated', {
                userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('Security metrics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const metrics = await LLMSecurityService.getSecurityMetricsSummary(userId);
            const duration = Date.now() - startTime;

            loggingService.info('Security metrics retrieved successfully', {
                userId,
                duration,
                requestId
            });

            res.json({
                success: true,
                data: metrics
            });

        } catch (error: any) {
            SecurityController.recordServiceFailure();
            const duration = Date.now() - startTime;
            
            loggingService.error('Security metrics retrieval failed', {
                userId,
                requestId,
                error: error.message || 'Unknown error',
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve security metrics'
            });
        }
    }

    /**
     * Test security check manually
     */
    static async testSecurityCheck(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
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

            loggingService.info('Security check test initiated', {
                userId,
                requestId,
                promptLength: prompt?.length || 0
            });

            if (!userId) {
                loggingService.warn('Security check test failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!prompt) {
                loggingService.warn('Security check test failed - prompt is required', {
                    userId,
                    requestId
                });
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
            const duration = Date.now() - startTime;

            loggingService.info('Security check test completed successfully', {
                userId,
                duration,
                testRequestId,
                securityResult: securityCheck.result,
                requestId
            });

            // Queue background business event logging
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Security check test failed', {
                userId,
                requestId,
                error: error.message || 'Unknown error',
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to perform security test'
            });
        }
    }

    /**
     * Get pending human reviews
     */
    static async getPendingReviews(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Pending reviews retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('Pending reviews retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const pendingReviews = LLMSecurityService.getPendingReviews(userId);
            const duration = Date.now() - startTime;

            loggingService.info('Pending reviews retrieved successfully', {
                userId,
                duration,
                pendingReviewsCount: Array.isArray(pendingReviews) ? pendingReviews.length : 0,
                hasPendingReviews: !!pendingReviews && (Array.isArray(pendingReviews) ? pendingReviews.length > 0 : true),
                requestId
            });

            res.json({
                success: true,
                data: pendingReviews
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Pending reviews retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve pending reviews'
            });
        }
    }

    /**
     * Review a security request (approve/deny)
     */
    static async reviewSecurityRequest(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { reviewId } = req.params;
        const { decision, comments } = req.body;

        try {
            loggingService.info('Security request review initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                reviewId,
                hasReviewId: !!reviewId,
                decision,
                hasDecision: !!decision,
                hasComments: !!comments
            });

            if (!userId) {
                loggingService.warn('Security request review failed - user not authenticated', {
                    requestId,
                    reviewId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required for reviews'
                });
                return;
            }

            if (!reviewId) {
                loggingService.warn('Security request review failed - review ID is required', {
                    userId,
                    requestId
                });
                res.status(400).json({
                    success: false,
                    message: 'Review ID is required'
                });
                return;
            }

            if (!decision || !['approved', 'denied'].includes(decision)) {
                loggingService.warn('Security request review failed - invalid decision', {
                    userId,
                    requestId,
                    reviewId,
                    decision,
                    decisionValid: ['approved', 'denied'].includes(decision)
                });
                res.status(400).json({
                    success: false,
                    message: 'Valid decision (approved/denied) is required'
                });
                return;
            }

            const success = await LLMSecurityService.reviewRequest(
                reviewId,
                userId,
                decision,
                comments
            );

            if (!success) {
                loggingService.warn('Security request review failed - review not found or already processed', {
                    userId,
                    requestId,
                    reviewId,
                    decision
                });
                res.status(404).json({
                    success: false,
                    message: 'Review request not found or already processed'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Security request reviewed successfully', {
                userId,
                duration,
                reviewId,
                decision,
                hasComments: !!comments,
                requestId
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Security request review failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                reviewId,
                decision,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to process security review'
            });
        }
    }

    /**
     * Get firewall analytics (from the original service)
     */
    static async getFirewallAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { startDate, endDate } = req.query;

        try {
            loggingService.info('Firewall analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Firewall analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            let dateRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                dateRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            const analytics = await PromptFirewallService.getFirewallAnalytics(userId, dateRange);
            const duration = Date.now() - startTime;

            loggingService.info('Firewall analytics retrieved successfully', {
                userId,
                duration,
                startDate,
                endDate,
                hasDateRange: !!dateRange,
                hasAnalytics: !!analytics,
                requestId
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Firewall analytics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve firewall analytics'
            });
        }
    }

    /**
     * Update firewall configuration
     */
    static async updateFirewallConfig(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const config = req.body;

        try {
            loggingService.info('Firewall configuration update initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                hasConfig: !!config,
                configKeys: Object.keys(config || {})
            });

            if (!userId) {
                loggingService.warn('Firewall configuration update failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Validate configuration
            const validConfig = PromptFirewallService.parseConfigFromHeaders(config);

            // In a real implementation, you'd save this per-user config to database
            // For now, we'll just return the parsed config
            const duration = Date.now() - startTime;

            loggingService.info('Firewall configuration updated successfully', {
                userId,
                duration,
                hasValidConfig: !!validConfig,
                configKeys: Object.keys(validConfig || {}),
                requestId
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Firewall configuration update failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                hasConfig: !!config,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to update firewall configuration'
            });
        }
    }

    /**
     * Get current firewall configuration
     */
    static async getFirewallConfig(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Firewall configuration retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('Firewall configuration retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // In a real implementation, you'd fetch user-specific config from database
            const config = PromptFirewallService.getDefaultConfig();
            const duration = Date.now() - startTime;

            loggingService.info('Firewall configuration retrieved successfully', {
                userId,
                duration,
                hasConfig: !!config,
                configKeys: Object.keys(config || {}),
                requestId
            });

            res.json({
                success: true,
                data: config
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Firewall configuration retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve firewall configuration'
            });
        }
    }

    /**
     * Get top risky prompts (for security analysis)
     */
    static async getTopRiskyPrompts(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const limit = parseInt(req.query.limit as string) || 20;

        try {
            loggingService.info('Top risky prompts retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                limit,
                hasLimit: !!req.query.limit
            });

            if (!userId) {
                loggingService.warn('Top risky prompts retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const analytics = await LLMSecurityService.getSecurityAnalytics(userId);
            const duration = Date.now() - startTime;

            loggingService.info('Top risky prompts retrieved successfully', {
                userId,
                duration,
                limit,
                hasAnalytics: !!analytics,
                topRiskyPatternsCount: analytics?.topRiskyPatterns?.length || 0,
                topRiskySourcesCount: analytics?.topRiskySources?.length || 0,
                hasThreatDistribution: !!analytics?.threatDistribution,
                requestId
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Top risky prompts retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                limit,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve risky prompts analysis'
            });
        }
    }

    /**
     * Export security report
     */
    static async exportSecurityReport(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { format = 'json', startDate, endDate } = req.query;

        try {
            loggingService.info('Security report export initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                format,
                hasFormat: !!format,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            if (!userId) {
                loggingService.warn('Security report export failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

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
                    requestId,
                    error: analytics.reason?.message || 'Unknown error'
                });
            }

            if (metrics.status === 'rejected') {
                loggingService.warn('Failed to get security metrics, using defaults', {
                    userId,
                    requestId,
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

            loggingService.info('Security report exported successfully', {
                userId,
                duration,
                format,
                requestId
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Security report export failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                format,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to export security report',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
