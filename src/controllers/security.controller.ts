import { Response } from 'express';
import { LLMSecurityService } from '../services/llmSecurity.service';
import { PromptFirewallService } from '../services/promptFirewall.service';
import { loggingService } from '../services/logging.service';

export class SecurityController {
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
                hasUserId: !!userId,
                requestId,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
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
                startDate,
                endDate,
                hasTimeRange: !!timeRange,
                hasAnalytics: !!analytics,
                requestId
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Security analytics retrieval failed', {
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
                hasUserId: !!userId,
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
                hasMetrics: !!metrics,
                requestId
            });

            res.json({
                success: true,
                data: metrics
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Security metrics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
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
            loggingService.info('Security check test initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                hasPrompt: !!prompt,
                promptLength: prompt?.length || 0,
                hasRetrievedChunks: !!retrievedChunks,
                hasToolCalls: !!toolCalls,
                hasProvenanceSource: !!provenanceSource
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
            const securityCheck = await LLMSecurityService.performSecurityCheck(
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
            const duration = Date.now() - startTime;

            loggingService.info('Security check test completed successfully', {
                userId,
                duration,
                testRequestId,
                securityResult: securityCheck.result,
                hasHumanReviewId: !!securityCheck.humanReviewId,
                traceCreated: !!securityCheck.traceEvent,
                requestId
            });

            // Log business event
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Security check test failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                hasPrompt: !!prompt,
                error: error.message || 'Unknown error',
                stack: error.stack,
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

            // Get analytics and metrics with error handling
            let analytics, metrics;
            try {
                analytics = await LLMSecurityService.getSecurityAnalytics(userId, timeRange);
            } catch (analyticsError: any) {
                loggingService.warn('Failed to get security analytics, using default values', {
                    userId,
                    requestId,
                    error: analyticsError.message || 'Unknown error'
                });
                analytics = {
                    detectionRate: 0,
                    topRiskyPatterns: [],
                    topRiskySources: [],
                    threatDistribution: {},
                    containmentActions: {},
                    costSaved: 0,
                    timeRange: timeRange || { start: new Date(), end: new Date() }
                };
            }

            try {
                metrics = await LLMSecurityService.getSecurityMetricsSummary(userId);
                loggingService.info('Security metrics retrieved successfully', { 
                    userId,
                    requestId,
                    totalThreats: metrics.totalThreatsDetected,
                    totalCost: metrics.totalCostSaved 
                });
            } catch (metricsError: any) {
                loggingService.warn('Failed to get security metrics, using default values', {
                    userId,
                    requestId,
                    error: metricsError.message || 'Unknown error'
                });
                metrics = {
                    totalThreatsDetected: 0,
                    totalCostSaved: 0,
                    averageRiskScore: 0,
                    mostCommonThreat: 'None',
                    detectionTrend: 'stable'
                };
            }

            const report = {
                generatedAt: new Date(),
                timeRange: analytics?.timeRange || timeRange || { start: new Date(), end: new Date() },
                summary: metrics || {},
                analytics: analytics || {},
                metadata: {
                    userId,
                    reportType: 'security_comprehensive',
                    version: '1.0'
                }
            };

            if (format === 'csv') {
                // Convert to CSV format
                const csv = SecurityController.convertSecurityReportToCSV(report);
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=security_report.csv');
                res.send(csv);
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
                startDate,
                endDate,
                hasTimeRange: !!timeRange,
                hasAnalytics: !!analytics,
                hasMetrics: !!metrics,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'security_report_exported',
                category: 'security',
                value: duration,
                metadata: {
                    userId,
                    format,
                    startDate: !!startDate,
                    endDate: !!endDate
                }
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
     * Convert security report to CSV format
     */
    private static convertSecurityReportToCSV(report: any): string {
        try {
            // Simple CSV with basic data
            const timestamp = new Date().toISOString();
            const summary = report?.summary || {};
            const analytics = report?.analytics || {};

            const csvRows = [
                // Header row
                'Metric,Value,Category,Timestamp',
                // Summary data
                `Total Threats Detected,"${summary.totalThreatsDetected || 0}",Summary,"${timestamp}"`,
                `Total Cost Saved,"${summary.totalCostSaved || 0}",Summary,"${timestamp}"`,
                `Average Risk Score,"${summary.averageRiskScore || 0}",Summary,"${timestamp}"`,
                `Most Common Threat,"${summary.mostCommonThreat || 'None'}",Summary,"${timestamp}"`,
                `Detection Trend,"${summary.detectionTrend || 'Unknown'}",Summary,"${timestamp}"`,
                `Detection Rate,"${analytics.detectionRate || 0}",Analytics,"${timestamp}"`
            ];

            // Add threat distribution data safely
            if (analytics.threatDistribution && typeof analytics.threatDistribution === 'object') {
                try {
                    for (const [threat, count] of Object.entries(analytics.threatDistribution)) {
                        const safeThreat = String(threat || 'unknown').replace(/"/g, '""');
                        const safeCount = Number(count) || 0;
                        csvRows.push(`"${safeThreat} Threats","${safeCount}",Threat Distribution,"${timestamp}"`);
                    }
                } catch (threatError: any) {
                    // Silent error handling for CSV conversion
                }
            }

            const csvContent = csvRows.join('\n');
            return csvContent;

        } catch (error: any) {
            return 'Error,Message\n"CSV Generation Error","Failed to generate CSV report"';
        }
    }
}
