import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsService } from '../services/analytics.service';
import { RequestFeedbackService } from '../services/requestFeedback.service';

import { loggingService } from '../services/logging.service';
import { Usage, User } from '../models';
import mongoose from 'mongoose';

const analyticsQuerySchema = z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    period: z.enum(['daily', 'weekly', 'monthly']).optional(),
    service: z.string().optional(),
    model: z.string().optional(),
    groupBy: z.enum(['service', 'model', 'date', 'hour']).optional(),
    projectId: z.string().optional(),
});

export class AnalyticsController {
    static async getAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const query = req.query;

        try {
            loggingService.info('Analytics request initiated', {
                userId,
                queryParams: Object.keys(query),
                hasStartDate: !!query.startDate,
                hasEndDate: !!query.endDate,
                period: query.period,
                service: query.service,
                model: query.model,
                groupBy: query.groupBy,
                projectId: query.projectId,
                requestId: req.headers['x-request-id'] as string
            });

            const validatedQuery = analyticsQuerySchema.parse(query);

            const analytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: validatedQuery.startDate ? new Date(validatedQuery.startDate) : undefined,
                endDate: validatedQuery.endDate ? new Date(validatedQuery.endDate) : undefined,
                period: validatedQuery.period,
                service: validatedQuery.service,
                model: validatedQuery.model,
                groupBy: validatedQuery.groupBy,
                projectId: validatedQuery.projectId,
            }, { includeProjectBreakdown: true });

            const duration = Date.now() - startTime;

            loggingService.info('Analytics retrieved successfully', {
                userId,
                duration,
                totalCost: analytics.summary.totalCost,
                totalRequests: analytics.summary.totalRequests,
                totalTokens: analytics.summary.totalTokens,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'analytics_retrieved',
                category: 'data_analytics',
                value: duration,
                metadata: {
                    userId,
                    totalCost: analytics.summary.totalCost,
                    totalRequests: analytics.summary.totalRequests,
                    totalTokens: analytics.summary.totalTokens,
                    hasProjectBreakdown: !!analytics.breakdown
                }
            });

            res.json({
                success: true,
                data: analytics,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Analytics retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get analytics error:', { error: error instanceof Error ? error.message : String(error) });
            next(error);
        }
    }

    static async getComparativeAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { period1Start, period1End, period2Start, period2End } = req.query;

        try {
            loggingService.info('Comparative analytics request initiated', {
                userId,
                period1Start,
                period1End,
                period2Start,
                period2End,
                requestId: req.headers['x-request-id'] as string
            });

            if (!period1Start || !period1End || !period2Start || !period2End) {
                loggingService.warn('Comparative analytics validation failed - missing period dates', {
                    userId,
                    period1Start,
                    period1End,
                    period2Start,
                    period2End,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'All period dates are required',
                });
                return;
            }

            const comparison = await AnalyticsService.getComparativeAnalytics(
                userId,
                {
                    startDate: new Date(period1Start as string),
                    endDate: new Date(period1End as string),
                },
                {
                    startDate: new Date(period2Start as string),
                    endDate: new Date(period2End as string),
                }
            );

            const duration = Date.now() - startTime;

            loggingService.info('Comparative analytics retrieved successfully', {
                userId,
                duration,
                period1Duration: `${period1Start} to ${period1End}`,
                period2Duration: `${period2Start} to ${period2End}`,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'comparative_analytics_retrieved',
                category: 'data_analytics',
                value: duration,
                metadata: {
                    userId,
                    period1Duration: `${period1Start} to ${period1End}`,
                    period2Duration: `${period2Start} to ${period2End}`
                }
            });

            res.json({
                success: true,
                data: comparison,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Comparative analytics retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Comparative analytics error:', error);
            next(error);
        }
    }

    static async exportAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const format = (req.query.format as 'json' | 'csv') || 'json';
        const query = req.query;

        try {
            loggingService.info('Analytics export request initiated', {
                userId,
                format,
                queryParams: Object.keys(query),
                requestId: req.headers['x-request-id'] as string
            });

            const validatedQuery = analyticsQuerySchema.parse(query);

            const exportData = await AnalyticsService.exportAnalytics(
                {
                    userId,
                    startDate: validatedQuery.startDate ? new Date(validatedQuery.startDate) : undefined,
                    endDate: validatedQuery.endDate ? new Date(validatedQuery.endDate) : undefined,
                    period: validatedQuery.period,
                    service: validatedQuery.service,
                    model: validatedQuery.model,
                    groupBy: validatedQuery.groupBy,
                },
                format
            );

            const duration = Date.now() - startTime;
            const filename = `analytics-export-${Date.now()}.${format}`;

            loggingService.info('Analytics export completed successfully', {
                userId,
                format,
                duration,
                filename,
                dataSize: exportData.length,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'analytics_exported',
                category: 'data_export',
                value: duration,
                metadata: {
                    userId,
                    format,
                    filename,
                    dataSize: exportData.length
                }
            });

            if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
            } else {
                res.setHeader('Content-Type', 'application/json');
            }

            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.send(exportData);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Analytics export failed', {
                userId,
                format,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Export analytics error:', error);
            next(error);
        }
    }

    static async getInsights(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const timeframe = (req.query.timeframe as string) || '30d';

        try {
            loggingService.info('Analytics insights request initiated', {
                userId,
                timeframe,
                requestId: req.headers['x-request-id'] as string
            });

            let startDate: Date;
            const endDate = new Date();

            switch (timeframe) {
                case '7d':
                    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case '90d':
                    startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            }

            const analytics = await AnalyticsService.getAnalytics({
                userId,
                startDate,
                endDate,
            });

            // Extract key insights
            const insights = {
                summary: {
                    totalSpent: analytics.summary.totalCost,
                    totalCalls: analytics.summary.totalRequests,
                    avgCostPerCall: analytics.summary.averageCostPerRequest,
                    totalTokens: analytics.summary.totalTokens,
                },
                trends: analytics.trends,
                topCostDrivers: {
                    services: analytics.breakdown.services.slice(0, 3),
                    models: analytics.breakdown.models.slice(0, 3),
                },
                timeline: analytics.timeline,
                recommendations: analytics.trends.insights.slice(0, 5),
            };

            const duration = Date.now() - startTime;

            loggingService.info('Analytics insights retrieved successfully', {
                userId,
                timeframe,
                duration,
                totalSpent: insights.summary.totalSpent,
                totalCalls: insights.summary.totalCalls,
                insightsCount: insights.recommendations.length,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'analytics_insights_retrieved',
                category: 'data_analytics',
                value: duration,
                metadata: {
                    userId,
                    timeframe,
                    totalSpent: insights.summary.totalSpent,
                    totalCalls: insights.summary.totalCalls,
                    insightsCount: insights.recommendations.length
                }
            });

            res.json({
                success: true,
                data: insights,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Analytics insights retrieval failed', {
                userId,
                timeframe,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get insights error:', error);
            next(error);
        }
    }

    static async getDashboardData(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const objectUserId = new mongoose.Types.ObjectId(userId);
        const { projectId } = req.query;

        try {
            loggingService.info('Dashboard data request initiated', {
                userId,
                projectId: projectId || 'all',
                requestId: req.headers['x-request-id'] as string
            });

            // Build base filter
            const baseFilter: any = { userId: objectUserId };
            if (projectId && projectId !== 'all') {
                baseFilter.projectId = new mongoose.Types.ObjectId(projectId as string);
            }

            // Get data for the last 30 days
            let endDate = new Date();
            let startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const hasRecentUsage = await Usage.exists({
                ...baseFilter,
                createdAt: { $gte: startDate, $lte: endDate },
            });

            if (!hasRecentUsage) {
                const usageBounds = await Usage.aggregate([
                    { $match: baseFilter },
                    {
                        $group: {
                            _id: null,
                            minDate: { $min: '$createdAt' },
                            maxDate: { $max: '$createdAt' },
                        },
                    },
                ]);

                if (usageBounds.length > 0 && usageBounds[0].minDate) {
                    startDate = usageBounds[0].minDate;
                    endDate = usageBounds[0].maxDate;
                }
            }

            const today = new Date(endDate);
            today.setHours(0, 0, 0, 0);
            const todayEnd = new Date(endDate);
            todayEnd.setHours(23, 59, 59, 999);

            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayEnd = new Date(yesterday);
            yesterdayEnd.setHours(23, 59, 59, 999);

            const [analytics, todayStats, yesterdayStats, user] = await Promise.all([
                AnalyticsService.getAnalytics({
                    userId,
                    startDate,
                    endDate,
                    projectId: projectId as string,
                }, { includeProjectBreakdown: true }),
                AnalyticsService.getAnalytics({
                    userId,
                    startDate: today,
                    endDate: todayEnd,
                    projectId: projectId as string,
                }),
                AnalyticsService.getAnalytics({
                    userId,
                    startDate: yesterday,
                    endDate: yesterdayEnd,
                    projectId: projectId as string,
                }),
                User.findById(userId).select('name email subscription usage').lean(),
            ]);

            const dashboardData = {
                user,
                overview: {
                    totalCost: {
                        value: analytics.summary.totalCost,
                        change: AnalyticsController.calculateChange(
                            yesterdayStats.summary.totalCost,
                            todayStats.summary.totalCost
                        ),
                    },
                    totalCalls: {
                        value: analytics.summary.totalRequests,
                        change: AnalyticsController.calculateChange(
                            yesterdayStats.summary.totalRequests,
                            todayStats.summary.totalRequests
                        ),
                    },
                    avgCostPerCall: {
                        value: analytics.summary.averageCostPerRequest,
                        change: AnalyticsController.calculateChange(
                            yesterdayStats.summary.averageCostPerRequest,
                            todayStats.summary.averageCostPerRequest
                        ),
                    },
                    totalOptimizationSavings: {
                        value: 0, // Will be implemented when optimization stats are available
                        change: 0,
                    },
                },
                charts: {
                    costOverTime: analytics.timeline,
                    serviceBreakdown: analytics.breakdown.services,
                    modelUsage: analytics.breakdown.models.slice(0, 5),
                },
                recentActivity: {
                    topPrompts: [], // Will be implemented when top prompts are available
                    optimizationOpportunities: 0, // Will be implemented when optimization stats are available
                },
                insights: analytics.trends.insights.slice(0, 3),
            };

            const duration = Date.now() - startTime;

            loggingService.info('Dashboard data retrieved successfully', {
                userId,
                projectId: projectId || 'all',
                duration,
                totalCost: dashboardData.overview.totalCost.value,
                totalCalls: dashboardData.overview.totalCalls.value,
                insightsCount: dashboardData.insights.length,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'dashboard_data_retrieved',
                category: 'dashboard_analytics',
                value: duration,
                metadata: {
                    userId,
                    projectId: projectId || 'all',
                    totalCost: dashboardData.overview.totalCost.value,
                    totalCalls: dashboardData.overview.totalCalls.value,
                    insightsCount: dashboardData.insights.length
                }
            });

            res.json({
                success: true,
                data: dashboardData,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Dashboard data retrieval failed', {
                userId,
                projectId: projectId || 'all',
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get dashboard data error:', error);
            next(error);
        }
    }

    static async getProjectAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { projectId } = req.params;
        const {
            startDate,
            endDate,
            service,
            model,
            groupBy = 'date'
        } = req.query;

        try {
            loggingService.info('Project analytics request initiated', {
                userId,
                projectId,
                startDate,
                endDate,
                service,
                model,
                groupBy,
                requestId: req.headers['x-request-id'] as string
            });

            // Verify user has access to project
            const { ProjectService } = await import('../services/project.service');
            let project;

            try {
                project = await ProjectService.getProjectById(projectId, userId);
            } catch (error: any) {
                if (error.message === 'Access denied' || error.message === 'Project not found') {
                    loggingService.warn('Project analytics access denied', {
                        userId,
                        projectId,
                        error: error.message,
                        requestId: req.headers['x-request-id'] as string
                    });

                    res.status(404).json({
                        success: false,
                        error: 'Project not found or access denied'
                    });
                    return;
                }
                throw error; // Re-throw other errors
            }

            if (!project) {
                loggingService.warn('Project not found for analytics', {
                    userId,
                    projectId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'Project not found or access denied'
                });
                return;
            }

            // Build filter object
            const filters: any = { projectId };

            if (startDate) filters.createdAt = { $gte: new Date(startDate as string) };
            if (endDate) {
                filters.createdAt = filters.createdAt || {};
                filters.createdAt.$lte = new Date(endDate as string);
            }
            if (service) filters.service = service;
            if (model) filters.model = model;

            const analytics = await AnalyticsService.getProjectAnalytics(projectId, filters, {
                groupBy: groupBy as string
            });

            const duration = Date.now() - startTime;

            loggingService.info('Project analytics retrieved successfully', {
                userId,
                projectId,
                duration,
                filters: Object.keys(filters),
                groupBy,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_analytics_retrieved',
                category: 'project_analytics',
                value: duration,
                metadata: {
                    userId,
                    projectId,
                    filters: Object.keys(filters),
                    groupBy
                }
            });

            res.json({
                success: true,
                data: {
                    ...analytics,
                    project: {
                        id: project._id,
                        name: project.name,
                        budget: project.budget,
                        spending: project.spending
                    }
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project analytics retrieval failed', {
                userId,
                projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get project analytics error:', error);
            next(error);
        }
    }

    static async getProjectComparison(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const {
            projectIds,
            startDate,
            endDate,
            metric = 'cost'
        } = req.query;

        try {
            loggingService.info('Project comparison request initiated', {
                userId,
                projectIds: Array.isArray(projectIds) ? projectIds.length : 1,
                startDate,
                endDate,
                metric,
                requestId: req.headers['x-request-id'] as string
            });

            // Log incoming request for debugging
            loggingService.debug('getProjectComparison called with params:', req.query);

            // Handle array parameter from Express query parsing
            let projectIdsArray: string[] = [];
            if (Array.isArray(projectIds)) {
                projectIdsArray = projectIds;
            } else if (typeof projectIds === 'string') {
                projectIdsArray = [projectIds];
            } else {
                loggingService.warn('Project comparison validation failed - missing projectIds', {
                    userId,
                    projectIds,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'projectIds parameter is required'
                });
                return;
            }

            if (projectIdsArray.length === 0) {
                loggingService.warn('Project comparison validation failed - empty projectIds array', {
                    userId,
                    projectIdsArray,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'At least one project ID is required'
                });
                return;
            }

            // Verify user has access to all projects
            const { ProjectService } = await import('../services/project.service');
            const userProjects = await ProjectService.getUserProjects(userId);
            const accessibleProjectIds = userProjects.map(p => p._id.toString());

            const validProjectIds = projectIdsArray.filter((id: string) =>
                accessibleProjectIds.includes(id)
            );

            if (validProjectIds.length === 0) {
                loggingService.warn('Project comparison access denied - no accessible projects', {
                    userId,
                    requestedProjectIds: projectIdsArray,
                    accessibleProjectIds,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(403).json({
                    success: false,
                    error: 'No accessible projects found'
                });
                return;
            }

            const comparison = await AnalyticsService.compareProjects(validProjectIds, {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                metric: metric as string
            });

            const duration = Date.now() - startTime;

            loggingService.info('Project comparison completed successfully', {
                userId,
                requestedProjectIds: projectIdsArray.length,
                validProjectIds: validProjectIds.length,
                duration,
                metric,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_comparison_completed',
                category: 'project_analytics',
                value: duration,
                metadata: {
                    userId,
                    requestedProjectIds: projectIdsArray.length,
                    validProjectIds: validProjectIds.length,
                    metric
                }
            });

            res.json({
                success: true,
                data: comparison
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Project comparison failed', {
                userId,
                projectIds: Array.isArray(projectIds) ? projectIds.length : 1,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get project comparison error:', error);
            next(error);
        }
    }

    static async getRecentUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { limit, projectId, startDate, endDate } = req.query;

        try {
            loggingService.info('Recent usage request initiated', {
                userId,
                limit: limit || 10,
                projectId: projectId || 'all',
                hasStartDate: !!startDate,
                hasEndDate: !!endDate,
                requestId: req.headers['x-request-id'] as string
            });

            const recentUsage = await AnalyticsService.getRecentUsage({
                userId,
                limit: limit ? parseInt(limit as string) : 10,
                projectId: projectId as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined
            });

            const duration = Date.now() - startTime;

            loggingService.info('Recent usage retrieved successfully', {
                userId,
                duration,
                limit: limit || 10,
                projectId: projectId || 'all',
                usageCount: recentUsage.length,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'recent_usage_retrieved',
                category: 'usage_analytics',
                value: duration,
                metadata: {
                    userId,
                    limit: limit || 10,
                    projectId: projectId || 'all',
                    usageCount: recentUsage.length
                }
            });

            res.json({
                success: true,
                data: recentUsage
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Recent usage retrieval failed', {
                userId,
                limit: limit || 10,
                projectId: projectId || 'all',
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get recent usage error:', error);
            next(error);
        }
    }

    private static calculateChange(oldValue: number, newValue: number): {
        value: number;
        percentage: number;
        trend: 'up' | 'down' | 'stable';
    } {
        const change = newValue - oldValue;
        const percentage = oldValue === 0
            ? (newValue === 0 ? 0 : 100)
            : (change / oldValue) * 100;

        return {
            value: change,
            percentage,
            trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
        };
    }

    /**
     * Get feedback analytics with Return on AI Spend metrics
     * GET /api/analytics/feedback
     */
    static async getFeedbackAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;

        try {
            loggingService.info('Feedback analytics request initiated', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });
            
            const feedbackAnalytics = await RequestFeedbackService.getFeedbackAnalytics(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Feedback analytics retrieved successfully', {
                userId,
                duration,
                totalCost: feedbackAnalytics.totalCost,
                averageRating: feedbackAnalytics.averageRating,
                positiveCost: feedbackAnalytics.positiveCost,
                negativeCost: feedbackAnalytics.negativeCost,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'feedback_analytics_retrieved',
                category: 'feedback_analytics',
                value: duration,
                metadata: {
                    userId,
                    totalCost: feedbackAnalytics.totalCost,
                    averageRating: feedbackAnalytics.averageRating,
                    positiveCost: feedbackAnalytics.positiveCost,
                    negativeCost: feedbackAnalytics.negativeCost
                }
            });

            res.json({
                success: true,
                data: {
                    ...feedbackAnalytics,
                    insights: {
                        wastedSpendPercentage: feedbackAnalytics.totalCost > 0 ? 
                            (feedbackAnalytics.negativeCost / feedbackAnalytics.totalCost) * 100 : 0,
                        returnOnAISpend: feedbackAnalytics.averageRating,
                        costEfficiencyScore: feedbackAnalytics.totalCost > 0 ?
                            (feedbackAnalytics.positiveCost / feedbackAnalytics.totalCost) * 100 : 0,
                        recommendations: AnalyticsController.generateFeedbackRecommendations(feedbackAnalytics)
                    }
                }
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Feedback analytics retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            loggingService.error('Get feedback analytics error:', error);
            next(error);
        }
    }

    /**
     * Generate actionable recommendations based on feedback data
     */
    private static generateFeedbackRecommendations(analytics: any): string[] {
        const recommendations: string[] = [];

        // Check for high negative cost percentage
        if (analytics.totalCost > 0) {
            const wastedPercentage = (analytics.negativeCost / analytics.totalCost) * 100;
            if (wastedPercentage > 30) {
                recommendations.push(`You're spending ${wastedPercentage.toFixed(1)}% of your AI budget on negatively-rated responses. Consider optimizing prompts or switching models.`);
            }
        }

        // Check for low copy rate (implicit signal)
        if (analytics.implicitSignalsAnalysis.copyRate < 0.3) {
            recommendations.push(`Only ${(analytics.implicitSignalsAnalysis.copyRate * 100).toFixed(1)}% of responses are being copied by users. This suggests low practical value - review your prompts.`);
        }

        // Check for high rephrase rate
        if (analytics.implicitSignalsAnalysis.rephraseRate > 0.4) {
            recommendations.push(`${(analytics.implicitSignalsAnalysis.rephraseRate * 100).toFixed(1)}% of users are rephrasing their questions immediately. Your AI may not be understanding queries correctly.`);
        }

        // Check for models with poor performance
        for (const [model, stats] of Object.entries(analytics.ratingsByModel)) {
            const modelStats = stats as any;
            const totalForModel = modelStats.positive + modelStats.negative;
            if (totalForModel > 5 && (modelStats.positive / totalForModel) < 0.5) {
                recommendations.push(`Model "${model}" has a low satisfaction rate (${((modelStats.positive / totalForModel) * 100).toFixed(1)}%). Consider switching to a different model.`);
            }
        }

        // Check for features with poor ROI
        for (const [feature, stats] of Object.entries(analytics.ratingsByFeature)) {
            const featureStats = stats as any;
            const totalForFeature = featureStats.positive + featureStats.negative;
            if (totalForFeature > 3 && (featureStats.positive / totalForFeature) < 0.4) {
                recommendations.push(`Feature "${feature}" has poor user satisfaction (${((featureStats.positive / totalForFeature) * 100).toFixed(1)}%). Consider redesigning this feature.`);
            }
        }

        if (recommendations.length === 0) {
            recommendations.push("Great job! Your AI responses are performing well. Keep monitoring feedback to maintain quality.");
        }

        return recommendations;
    }
}