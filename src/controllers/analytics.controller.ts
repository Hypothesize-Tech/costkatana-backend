import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { analyticsQuerySchema, dateRangeSchema } from '../utils/validators';
import { logger } from '../utils/logger';

export class AnalyticsController {
    static async getAnalytics(req: Request, res: Response, next: NextFunction) {
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

    static async getComparativeAnalytics(req: Request, res: Response, next: NextFunction) {
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

    static async exportAnalytics(req: Request, res: Response, next: NextFunction) {
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

    static async getInsights(req: Request, res: Response, next: NextFunction) {
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

    static async getDashboardData(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            // Get data for the last 30 days
            const endDate = new Date();
            const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const [analytics, todayStats, yesterdayStats] = await Promise.all([
                AnalyticsService.getAnalytics({
                    userId,
                    startDate,
                    endDate,
                }),
                AnalyticsService.getAnalytics({
                    userId,
                    startDate: new Date(new Date().setHours(0, 0, 0, 0)),
                    endDate: new Date(new Date().setHours(23, 59, 59, 999)),
                }),
                AnalyticsService.getAnalytics({
                    userId,
                    startDate: new Date(new Date(Date.now() - 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0)),
                    endDate: new Date(new Date(Date.now() - 24 * 60 * 60 * 1000).setHours(23, 59, 59, 999)),
                }),
            ]);

            const dashboardData = {
                overview: {
                    totalCost: {
                        value: analytics.summary.totalCost,
                        change: this.calculateChange(
                            yesterdayStats.summary.totalCost,
                            todayStats.summary.totalCost
                        ),
                    },
                    totalCalls: {
                        value: analytics.summary.totalCalls,
                        change: this.calculateChange(
                            yesterdayStats.summary.totalCalls,
                            todayStats.summary.totalCalls
                        ),
                    },
                    avgCostPerCall: {
                        value: analytics.summary.avgCost,
                        change: this.calculateChange(
                            yesterdayStats.summary.avgCost,
                            todayStats.summary.avgCost
                        ),
                    },
                    totalOptimizationSavings: {
                        value: analytics.optimizationStats.totalSaved,
                        change: 0, // Calculate if needed
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