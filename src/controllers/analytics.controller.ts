import { Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { analyticsQuerySchema, dateRangeSchema } from '../utils/validators';
import { logger } from '../utils/logger';
import { User } from '../models/User';
import { Usage } from '../models/Usage';
import mongoose from 'mongoose';

export class AnalyticsController {
    static async getAnalytics(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const query = analyticsQuerySchema.parse(req.query);

            const analytics = await AnalyticsService.getAnalytics({
                userId,
                startDate: query.startDate ? new Date(query.startDate) : undefined,
                endDate: query.endDate ? new Date(query.endDate) : undefined,
                period: query.period,
                service: query.service,
                model: query.model,
                groupBy: query.groupBy,
            });

            res.json({
                success: true,
                data: analytics,
            });
        } catch (error: any) {
            logger.error('Get analytics error:', error);
            next(error);
        }
    }

    static async getComparativeAnalytics(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { period1, period2 } = req.body;

            if (!period1 || !period2) {
                return res.status(400).json({
                    success: false,
                    message: 'Both period1 and period2 are required',
                });
            }

            const validatedPeriod1 = dateRangeSchema.parse(period1);
            const validatedPeriod2 = dateRangeSchema.parse(period2);

            const comparison = await AnalyticsService.getComparativeAnalytics(
                userId,
                {
                    startDate: new Date(validatedPeriod1.startDate),
                    endDate: new Date(validatedPeriod1.endDate),
                },
                {
                    startDate: new Date(validatedPeriod2.startDate),
                    endDate: new Date(validatedPeriod2.endDate),
                }
            );

            res.json({
                success: true,
                data: comparison,
            });
        } catch (error: any) {
            logger.error('Get comparative analytics error:', error);
            next(error);
        }
        return;
    }

    static async exportAnalytics(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const format = (req.query.format as 'json' | 'csv') || 'json';
            const query = analyticsQuerySchema.parse(req.query);

            const exportData = await AnalyticsService.exportAnalytics(
                userId,
                format,
                {
                    userId,
                    startDate: query.startDate ? new Date(query.startDate) : undefined,
                    endDate: query.endDate ? new Date(query.endDate) : undefined,
                    period: query.period,
                    service: query.service,
                    model: query.model,
                    groupBy: query.groupBy,
                }
            );

            const filename = `analytics-export-${Date.now()}.${format}`;

            if (format === 'csv') {
                res.setHeader('Content-Type', 'text/csv');
            } else {
                res.setHeader('Content-Type', 'application/json');
            }

            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.send(exportData);
        } catch (error: any) {
            logger.error('Export analytics error:', error);
            next(error);
        }
    }

    static async getInsights(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const timeframe = (req.query.timeframe as string) || '30d';

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
                    totalCalls: analytics.summary.totalCalls,
                    avgCostPerCall: analytics.summary.avgCost,
                    totalTokens: analytics.summary.totalTokens,
                },
                trends: analytics.trends,
                topCostDrivers: {
                    services: analytics.serviceBreakdown.slice(0, 3),
                    models: analytics.modelBreakdown.slice(0, 3),
                    prompts: analytics.topPrompts.slice(0, 3),
                },
                optimization: {
                    totalSaved: analytics.optimizationStats.totalSaved,
                    avgImprovement: analytics.optimizationStats.avgImprovement,
                    opportunities: analytics.optimizationStats.totalOptimizations,
                },
                predictions: analytics.predictions,
                recommendations: [
                    ...(analytics.trends.insights || []),
                    ...(analytics.predictions?.recommendations || []),
                ].slice(0, 5),
            };

            res.json({
                success: true,
                data: insights,
            });
        } catch (error: any) {
            logger.error('Get insights error:', error);
            next(error);
        }
    }

    static async getDashboardData(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const objectUserId = new mongoose.Types.ObjectId(userId);

            // Get data for the last 30 days
            let endDate = new Date();
            let startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const hasRecentUsage = await Usage.exists({
                userId: objectUserId,
                createdAt: { $gte: startDate, $lte: endDate },
            });

            if (!hasRecentUsage) {
                const usageBounds = await Usage.aggregate([
                    { $match: { userId: objectUserId } },
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
                }),
                AnalyticsService.getAnalytics({
                    userId,
                    startDate: today,
                    endDate: todayEnd,
                }),
                AnalyticsService.getAnalytics({
                    userId,
                    startDate: yesterday,
                    endDate: yesterdayEnd,
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
                        value: analytics.summary.totalCalls,
                        change: AnalyticsController.calculateChange(
                            yesterdayStats.summary.totalCalls,
                            todayStats.summary.totalCalls
                        ),
                    },
                    avgCostPerCall: {
                        value: analytics.summary.avgCost,
                        change: AnalyticsController.calculateChange(
                            yesterdayStats.summary.avgCost,
                            todayStats.summary.avgCost
                        ),
                    },
                    totalOptimizationSavings: {
                        value: analytics.optimizationStats.totalSaved,
                        change: 0,
                    },
                },
                charts: {
                    costOverTime: analytics.timeSeries,
                    serviceBreakdown: analytics.serviceBreakdown,
                    modelUsage: analytics.modelBreakdown.slice(0, 5),
                },
                recentActivity: {
                    topPrompts: analytics.topPrompts.slice(0, 5),
                    optimizationOpportunities: analytics.optimizationStats.totalOptimizations,
                },
                insights: analytics.trends.insights.slice(0, 3),
            };

            res.json({
                success: true,
                data: dashboardData,
            });
        } catch (error: any) {
            logger.error('Get dashboard data error:', error);
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
}