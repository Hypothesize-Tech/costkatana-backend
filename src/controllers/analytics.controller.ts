import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsService } from '../services/analytics.service';
import { RequestFeedbackService } from '../services/requestFeedback.service';

import { loggingService } from '../services/logging.service';
import { Usage, User } from '../models';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
    static async getAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const query = req.query;
        ControllerHelper.logRequestStart('getAnalytics', req, {
            queryParams: Object.keys(query),
            hasStartDate: !!query.startDate,
            hasEndDate: !!query.endDate,
            period: query.period,
            service: query.service,
            model: query.model,
            groupBy: query.groupBy,
            projectId: query.projectId
        });

        try {
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

            ControllerHelper.logRequestSuccess('getAnalytics', req, startTime, {
                totalCost: analytics.summary.totalCost,
                totalRequests: analytics.summary.totalRequests,
                totalTokens: analytics.summary.totalTokens,
                hasProjectBreakdown: !!analytics.breakdown
            });

            // Log business event
            loggingService.logBusiness({
                event: 'analytics_retrieved',
                category: 'data_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getAnalytics', error, req, res, startTime);
        }
    }

    static async getComparativeAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { period1Start, period1End, period2Start, period2End } = req.query;
        ControllerHelper.logRequestStart('getComparativeAnalytics', req, {
            period1Start,
            period1End,
            period2Start,
            period2End
        });

        try {
            if (!period1Start || !period1End || !period2Start || !period2End) {
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

            ControllerHelper.logRequestSuccess('getComparativeAnalytics', req, startTime, {
                period1Duration: `${period1Start} to ${period1End}`,
                period2Duration: `${period2Start} to ${period2End}`
            });

            // Log business event
            loggingService.logBusiness({
                event: 'comparative_analytics_retrieved',
                category: 'data_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getComparativeAnalytics', error, req, res, startTime);
        }
    }

    static async exportAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const format = (req.query.format as 'json' | 'csv') || 'json';
        const query = req.query;
        ControllerHelper.logRequestStart('exportAnalytics', req, {
            format,
            queryParams: Object.keys(query)
        });

        try {
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

            const filename = `analytics-export-${Date.now()}.${format}`;

            ControllerHelper.logRequestSuccess('exportAnalytics', req, startTime, {
                format,
                filename,
                dataSize: exportData.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'analytics_exported',
                category: 'data_export',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('exportAnalytics', error, req, res, startTime, {
                format
            });
        }
    }

    static async getInsights(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const timeframe = (req.query.timeframe as string) || '30d';
        ControllerHelper.logRequestStart('getInsights', req, {
            timeframe
        });

        try {

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

            ControllerHelper.logRequestSuccess('getInsights', req, startTime, {
                timeframe,
                totalSpent: insights.summary.totalSpent,
                totalCalls: insights.summary.totalCalls,
                insightsCount: insights.recommendations.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'analytics_insights_retrieved',
                category: 'data_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getInsights', error, req, res, startTime, {
                timeframe
            });
        }
    }

    static async getDashboardData(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const objectUserId = new mongoose.Types.ObjectId(userId);
        const { projectId } = req.query;
        ControllerHelper.logRequestStart('getDashboardData', req, {
            projectId: projectId || 'all'
        });

        try {

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

            ControllerHelper.logRequestSuccess('getDashboardData', req, startTime, {
                projectId: projectId || 'all',
                totalCost: dashboardData.overview.totalCost.value,
                totalCalls: dashboardData.overview.totalCalls.value,
                insightsCount: dashboardData.insights.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'dashboard_data_retrieved',
                category: 'dashboard_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getDashboardData', error, req, res, startTime, {
                projectId: projectId || 'all'
            });
        }
    }

    static async getProjectAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { projectId } = req.params;
        ServiceHelper.validateObjectId(projectId, 'projectId');
        const {
            startDate,
            endDate,
            service,
            model,
            groupBy = 'date'
        } = req.query;
        ControllerHelper.logRequestStart('getProjectAnalytics', req, {
            projectId,
            startDate,
            endDate,
            service,
            model,
            groupBy
        });

        try {

            // Verify user has access to project
            const { ProjectService } = await import('../services/project.service');
            let project;

            try {
                project = await ProjectService.getProjectById(projectId, userId);
            } catch (error: any) {
                if (error.message === 'Access denied' || error.message === 'Project not found') {
                    res.status(404).json({
                        success: false,
                        error: 'Project not found or access denied'
                    });
                    return;
                }
                throw error; // Re-throw other errors
            }

            if (!project) {
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

            ControllerHelper.logRequestSuccess('getProjectAnalytics', req, startTime, {
                projectId,
                filters: Object.keys(filters),
                groupBy
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_analytics_retrieved',
                category: 'project_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getProjectAnalytics', error, req, res, startTime, {
                projectId
            });
        }
    }

    static async getProjectComparison(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const {
            projectIds,
            startDate,
            endDate,
            metric = 'cost'
        } = req.query;
        ControllerHelper.logRequestStart('getProjectComparison', req, {
            projectIds: Array.isArray(projectIds) ? projectIds.length : 1,
            startDate,
            endDate,
            metric
        });

        try {

            // Handle array parameter from Express query parsing
            let projectIdsArray: string[] = [];
            if (Array.isArray(projectIds)) {
                projectIdsArray = projectIds as string[];
            } else if (typeof projectIds === 'string') {
                projectIdsArray = [projectIds];
            } else {
                res.status(400).json({
                    success: false,
                    error: 'projectIds parameter is required'
                });
                return;
            }

            if (projectIdsArray.length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'At least one project ID is required'
                });
                return;
            }

            // Validate all project IDs
            projectIdsArray.forEach(id => ServiceHelper.validateObjectId(id, 'projectId'));

            // Verify user has access to all projects
            const { ProjectService } = await import('../services/project.service');
            const userProjects = await ProjectService.getUserProjects(userId);
            const accessibleProjectIds = userProjects.map(p => p._id.toString());

            const validProjectIds = projectIdsArray.filter((id: string) =>
                accessibleProjectIds.includes(id)
            );

            if (validProjectIds.length === 0) {
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

            ControllerHelper.logRequestSuccess('getProjectComparison', req, startTime, {
                requestedProjectIds: projectIdsArray.length,
                validProjectIds: validProjectIds.length,
                metric
            });

            // Log business event
            loggingService.logBusiness({
                event: 'project_comparison_completed',
                category: 'project_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getProjectComparison', error, req, res, startTime, {
                projectIds: Array.isArray(projectIds) ? projectIds.length : 1
            });
        }
    }

    static async getRecentUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { limit, projectId, startDate, endDate } = req.query;
        ControllerHelper.logRequestStart('getRecentUsage', req, {
            limit: limit || 10,
            projectId: projectId || 'all',
            hasStartDate: !!startDate,
            hasEndDate: !!endDate
        });

        try {

            const recentUsage = await AnalyticsService.getRecentUsage({
                userId,
                limit: limit ? parseInt(limit as string) : 10,
                projectId: projectId as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined
            });

            ControllerHelper.logRequestSuccess('getRecentUsage', req, startTime, {
                limit: limit || 10,
                projectId: projectId || 'all',
                usageCount: recentUsage.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'recent_usage_retrieved',
                category: 'usage_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getRecentUsage', error, req, res, startTime, {
                limit: limit || 10,
                projectId: projectId || 'all'
            });
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
    static async getFeedbackAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getFeedbackAnalytics', req);

        try {
            
            const feedbackAnalytics = await RequestFeedbackService.getFeedbackAnalytics(userId);

            ControllerHelper.logRequestSuccess('getFeedbackAnalytics', req, startTime, {
                totalCost: feedbackAnalytics.totalCost,
                averageRating: feedbackAnalytics.averageRating,
                positiveCost: feedbackAnalytics.positiveCost,
                negativeCost: feedbackAnalytics.negativeCost
            });

            // Log business event
            loggingService.logBusiness({
                event: 'feedback_analytics_retrieved',
                category: 'feedback_analytics',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getFeedbackAnalytics', error, req, res, startTime);
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