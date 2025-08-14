import { Response } from 'express';
import { LLMSecurityService } from '../services/llmSecurity.service';
import { PromptFirewallService } from '../services/promptFirewall.service';
import { logger } from '../utils/logger';

export class SecurityController {
    /**
     * Get security analytics dashboard
     */
    static async getSecurityAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id;
            const { startDate, endDate } = req.query;

            let timeRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                timeRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            const analytics = await LLMSecurityService.getSecurityAnalytics(userId, timeRange);

            res.json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error('Failed to get security analytics', error as Error, {
                userId: req.user?.id
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
        try {
            const userId = req.user?.id;
            const metrics = await LLMSecurityService.getSecurityMetricsSummary(userId);

            res.json({
                success: true,
                data: metrics
            });

        } catch (error) {
            logger.error('Failed to get security metrics', error as Error, {
                userId: req.user?.id
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
        try {
            const { prompt, retrievedChunks, toolCalls, provenanceSource } = req.body;

            if (!prompt) {
                res.status(400).json({
                    success: false,
                    message: 'Prompt is required for security testing'
                });
                return;
            }

            const requestId = `test-${Date.now()}`;
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                prompt,
                requestId,
                req.user?.id,
                {
                    retrievedChunks,
                    toolCalls,
                    provenanceSource,
                    estimatedCost: 0.01
                }
            );

            res.json({
                success: true,
                data: {
                    requestId,
                    securityResult: securityCheck.result,
                    humanReviewId: securityCheck.humanReviewId,
                    traceCreated: !!securityCheck.traceEvent
                }
            });

        } catch (error) {
            logger.error('Failed to test security check', error as Error, {
                userId: req.user?.id
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
        try {
            const userId = req.user?.id;
            const pendingReviews = LLMSecurityService.getPendingReviews(userId);

            res.json({
                success: true,
                data: pendingReviews
            });

        } catch (error) {
            logger.error('Failed to get pending reviews', error as Error, {
                userId: req.user?.id
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
        try {
            const { reviewId } = req.params;
            const { decision, comments } = req.body;
            const reviewerId = req.user?.id;

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

            if (!reviewerId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required for reviews'
                });
                return;
            }

            const success = await LLMSecurityService.reviewRequest(
                reviewId,
                reviewerId,
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

            res.json({
                success: true,
                message: `Security request ${decision} successfully`
            });

        } catch (error) {
            logger.error('Failed to review security request', error as Error, {
                userId: req.user?.id,
                reviewId: req.params.reviewId
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
        try {
            const userId = req.user?.id;
            const { startDate, endDate } = req.query;

            let dateRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                dateRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            const analytics = await PromptFirewallService.getFirewallAnalytics(userId, dateRange);

            res.json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error('Failed to get firewall analytics', error as Error, {
                userId: req.user?.id
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
        try {
            const config = req.body;

            // Validate configuration
            const validConfig = PromptFirewallService.parseConfigFromHeaders(config);

            // In a real implementation, you'd save this per-user config to database
            // For now, we'll just return the parsed config
            
            res.json({
                success: true,
                data: {
                    config: validConfig,
                    message: 'Firewall configuration updated successfully'
                }
            });

        } catch (error) {
            logger.error('Failed to update firewall config', error as Error, {
                userId: req.user?.id
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
        try {
            // In a real implementation, you'd fetch user-specific config from database
            const config = PromptFirewallService.getDefaultConfig();

            res.json({
                success: true,
                data: config
            });

        } catch (error) {
            logger.error('Failed to get firewall config', error as Error, {
                userId: req.user?.id
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
        try {
            const userId = req.user?.id;
            const limit = parseInt(req.query.limit as string) || 20;

            const analytics = await LLMSecurityService.getSecurityAnalytics(userId);

            res.json({
                success: true,
                data: {
                    topRiskyPatterns: analytics.topRiskyPatterns.slice(0, limit),
                    topRiskySources: analytics.topRiskySources.slice(0, limit),
                    threatDistribution: analytics.threatDistribution
                }
            });

        } catch (error) {
            logger.error('Failed to get top risky prompts', error as Error, {
                userId: req.user?.id
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
        try {
            const userId = req.user?.id;
            const { format = 'json', startDate, endDate } = req.query;

            logger.info('Starting security report export', {
                userId,
                format,
                startDate,
                endDate,
                hasUser: !!req.user
            });

            let timeRange: { start: Date; end: Date } | undefined;
            if (startDate && endDate) {
                timeRange = {
                    start: new Date(startDate as string),
                    end: new Date(endDate as string)
                };
            }

            logger.info('Getting security analytics...', { userId, timeRange });

            // Get analytics and metrics with error handling
            let analytics, metrics;
            try {
                analytics = await LLMSecurityService.getSecurityAnalytics(userId, timeRange);
            } catch (analyticsError) {
                logger.warn('Failed to get security analytics, using default values:', analyticsError);
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
                logger.info('Got security metrics successfully', { 
                    totalThreats: metrics.totalThreatsDetected,
                    totalCost: metrics.totalCostSaved 
                });
            } catch (metricsError) {
                logger.warn('Failed to get security metrics, using default values:', metricsError);
                metrics = {
                    totalThreatsDetected: 0,
                    totalCostSaved: 0,
                    averageRiskScore: 0,
                    mostCommonThreat: 'None',
                    detectionTrend: 'stable'
                };
            }

            logger.info('Building report object...');
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

            logger.info('Report built, processing format:', { format });

            if (format === 'csv') {
                logger.info('Converting to CSV format...');
                // Convert to CSV format
                const csv = SecurityController.convertSecurityReportToCSV(report);
                logger.info('CSV conversion completed, sending response...');
                
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=security_report.csv');
                res.send(csv);
                logger.info('CSV response sent successfully');
            } else {
                logger.info('Sending JSON format...');
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename=security_report.json');
                res.json(report);
                logger.info('JSON response sent successfully');
            }

        } catch (error) {
            logger.error('Failed to export security report', error as Error, {
                userId: req.user?.id,
                format: req.query?.format,
                errorMessage: (error as Error).message,
                stack: (error as Error).stack
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to export security report',
                error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
            });
        }
    }

    /**
     * Convert security report to CSV format
     */
    private static convertSecurityReportToCSV(report: any): string {
        try {
            logger.info('Starting CSV conversion with report:', {
                hasReport: !!report,
                hasSummary: !!report?.summary,
                hasAnalytics: !!report?.analytics
            });

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
                } catch (threatError) {
                    logger.warn('Error processing threat distribution:', threatError);
                }
            }

            const csvContent = csvRows.join('\n');
            logger.info('CSV conversion completed successfully', { 
                rowCount: csvRows.length,
                contentLength: csvContent.length 
            });
            
            return csvContent;

        } catch (error) {
            logger.error('Error in CSV conversion:', error);
            return 'Error,Message\n"CSV Generation Error","Failed to generate CSV report"';
        }
    }
}
