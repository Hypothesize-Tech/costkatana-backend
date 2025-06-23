import { Usage } from '../models/Usage';
import { Optimization } from '../models/Optimization';
import { logger } from '../utils/logger';
import { getDateRange } from '../utils/helpers';
import { BedrockService } from './bedrock.service';

interface AnalyticsQuery {
    userId: string;
    startDate?: Date;
    endDate?: Date;
    period?: 'daily' | 'weekly' | 'monthly';
    service?: string;
    model?: string;
    groupBy?: 'service' | 'model' | 'date' | 'hour';
}

interface TimeSeriesData {
    date: Date;
    cost: number;
    tokens: number;
    calls: number;
}

interface ServiceAnalytics {
    service: string;
    totalCost: number;
    totalTokens: number;
    totalCalls: number;
    avgCost: number;
    avgTokens: number;
    trend: 'up' | 'down' | 'stable';
    percentageChange: number;
}

export class AnalyticsService {
    static async getAnalytics(query: AnalyticsQuery) {
        try {
            const { startDate, endDate } = this.getDateRange(query);

            const baseMatch: any = {
                userId: query.userId,
                createdAt: { $gte: startDate, $lte: endDate },
            };

            if (query.service) baseMatch.service = query.service;
            if (query.model) baseMatch.model = query.model;

            // Get summary statistics
            const summary = await this.getSummaryStats(baseMatch);

            // Get time series data
            const timeSeries = await this.getTimeSeries(baseMatch, query.groupBy || 'date');

            // Get service breakdown
            const serviceBreakdown = await this.getServiceBreakdown(baseMatch);

            // Get model breakdown
            const modelBreakdown = await this.getModelBreakdown(baseMatch);

            // Get top expensive prompts
            const topPrompts = await this.getTopExpensivePrompts(baseMatch);

            // Get optimization stats
            const optimizationStats = await this.getOptimizationStats(query.userId, startDate, endDate);

            // Get cost trends
            const trends = await this.analyzeTrends(query.userId, startDate, endDate);

            // Get predictions
            const predictions = await this.getPredictions(timeSeries);

            return {
                period: { startDate, endDate },
                summary,
                timeSeries,
                serviceBreakdown,
                modelBreakdown,
                topPrompts,
                optimizationStats,
                trends,
                predictions,
            };
        } catch (error) {
            logger.error('Error getting analytics:', error);
            throw error;
        }
    }

    static async getComparativeAnalytics(
        userId: string,
        period1: { startDate: Date; endDate: Date },
        period2: { startDate: Date; endDate: Date }
    ) {
        try {
            const [data1, data2] = await Promise.all([
                this.getAnalytics({
                    userId,
                    startDate: period1.startDate,
                    endDate: period1.endDate,
                }),
                this.getAnalytics({
                    userId,
                    startDate: period2.startDate,
                    endDate: period2.endDate,
                }),
            ]);

            const comparison = {
                cost: {
                    period1: data1.summary.totalCost,
                    period2: data2.summary.totalCost,
                    change: data2.summary.totalCost - data1.summary.totalCost,
                    percentageChange: this.calculatePercentageChange(
                        data1.summary.totalCost,
                        data2.summary.totalCost
                    ),
                },
                tokens: {
                    period1: data1.summary.totalTokens,
                    period2: data2.summary.totalTokens,
                    change: data2.summary.totalTokens - data1.summary.totalTokens,
                    percentageChange: this.calculatePercentageChange(
                        data1.summary.totalTokens,
                        data2.summary.totalTokens
                    ),
                },
                calls: {
                    period1: data1.summary.totalCalls,
                    period2: data2.summary.totalCalls,
                    change: data2.summary.totalCalls - data1.summary.totalCalls,
                    percentageChange: this.calculatePercentageChange(
                        data1.summary.totalCalls,
                        data2.summary.totalCalls
                    ),
                },
                avgCostPerCall: {
                    period1: data1.summary.avgCost,
                    period2: data2.summary.avgCost,
                    change: data2.summary.avgCost - data1.summary.avgCost,
                    percentageChange: this.calculatePercentageChange(
                        data1.summary.avgCost,
                        data2.summary.avgCost
                    ),
                },
            };

            return {
                period1: data1,
                period2: data2,
                comparison,
            };
        } catch (error) {
            logger.error('Error getting comparative analytics:', error);
            throw error;
        }
    }

    static async exportAnalytics(userId: string, format: 'json' | 'csv', query: AnalyticsQuery) {
        try {
            const data = await this.getAnalytics({ ...query, userId });

            if (format === 'json') {
                return JSON.stringify(data, null, 2);
            }

            // Convert to CSV
            const csvRows = ['Date,Service,Model,Tokens,Cost,Calls'];

            for (const item of data.timeSeries) {
                csvRows.push(
                    `${item.date.toISOString()},${query.service || 'All'},${query.model || 'All'},${item.tokens},${item.cost},${item.calls}`
                );
            }

            return csvRows.join('\n');
        } catch (error) {
            logger.error('Error exporting analytics:', error);
            throw error;
        }
    }

    private static async getSummaryStats(match: any) {
        const stats = await Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    totalCalls: { $sum: 1 },
                    avgCost: { $avg: '$cost' },
                    avgTokens: { $avg: '$totalTokens' },
                    avgResponseTime: { $avg: '$responseTime' },
                    uniqueServices: { $addToSet: '$service' },
                    uniqueModels: { $addToSet: '$model' },
                },
            },
            {
                $project: {
                    _id: 0,
                    totalCost: { $round: ['$totalCost', 4] },
                    totalTokens: 1,
                    totalCalls: 1,
                    avgCost: { $round: ['$avgCost', 4] },
                    avgTokens: { $round: ['$avgTokens', 0] },
                    avgResponseTime: { $round: ['$avgResponseTime', 0] },
                    uniqueServicesCount: { $size: '$uniqueServices' },
                    uniqueModelsCount: { $size: '$uniqueModels' },
                },
            },
        ]);

        return stats[0] || {
            totalCost: 0,
            totalTokens: 0,
            totalCalls: 0,
            avgCost: 0,
            avgTokens: 0,
            avgResponseTime: 0,
            uniqueServicesCount: 0,
            uniqueModelsCount: 0,
        };
    }

    private static async getTimeSeries(match: any, groupBy: string): Promise<TimeSeriesData[]> {
        let groupStage: any;

        switch (groupBy) {
            case 'hour':
                groupStage = {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                            day: { $dayOfMonth: '$createdAt' },
                            hour: { $hour: '$createdAt' },
                        },
                        cost: { $sum: '$cost' },
                        tokens: { $sum: '$totalTokens' },
                        calls: { $sum: 1 },
                    },
                };
                break;
            case 'date':
            default:
                groupStage = {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                            day: { $dayOfMonth: '$createdAt' },
                        },
                        cost: { $sum: '$cost' },
                        tokens: { $sum: '$totalTokens' },
                        calls: { $sum: 1 },
                    },
                };
                break;
        }

        const data = await Usage.aggregate([
            { $match: match },
            groupStage,
            {
                $project: {
                    date: {
                        $dateFromParts: {
                            year: '$_id.year',
                            month: '$_id.month',
                            day: '$_id.day',
                            hour: groupBy === 'hour' ? '$_id.hour' : 0,
                        },
                    },
                    cost: { $round: ['$cost', 4] },
                    tokens: 1,
                    calls: 1,
                },
            },
            { $sort: { date: 1 } },
        ]);

        return data;
    }

    private static async getServiceBreakdown(match: any): Promise<ServiceAnalytics[]> {
        const current = await Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$service',
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    totalCalls: { $sum: 1 },
                    avgCost: { $avg: '$cost' },
                    avgTokens: { $avg: '$totalTokens' },
                },
            },
            {
                $project: {
                    service: '$_id',
                    _id: 0,
                    totalCost: { $round: ['$totalCost', 4] },
                    totalTokens: 1,
                    totalCalls: 1,
                    avgCost: { $round: ['$avgCost', 4] },
                    avgTokens: { $round: ['$avgTokens', 0] },
                },
            },
            { $sort: { totalCost: -1 } },
        ]);

        // Get previous period for trend analysis
        const previousMatch = { ...match };
        const currentStart = match.createdAt.$gte;
        const currentEnd = match.createdAt.$lte;
        const duration = currentEnd - currentStart;
        previousMatch.createdAt = {
            $gte: new Date(currentStart.getTime() - duration),
            $lt: currentStart,
        };

        const previous = await Usage.aggregate([
            { $match: previousMatch },
            {
                $group: {
                    _id: '$service',
                    totalCost: { $sum: '$cost' },
                },
            },
        ]);

        const previousMap = new Map(previous.map(p => [p._id, p.totalCost]));

        return current.map(item => {
            const previousCost = previousMap.get(item.service) || 0;
            const percentageChange = this.calculatePercentageChange(previousCost, item.totalCost);

            return {
                ...item,
                trend: percentageChange > 5 ? 'up' : percentageChange < -5 ? 'down' : 'stable',
                percentageChange,
            };
        });
    }

    private static async getModelBreakdown(match: any) {
        return Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: { service: '$service', model: '$model' },
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    totalCalls: { $sum: 1 },
                    avgCost: { $avg: '$cost' },
                    avgTokens: { $avg: '$totalTokens' },
                },
            },
            {
                $project: {
                    service: '$_id.service',
                    model: '$_id.model',
                    _id: 0,
                    totalCost: { $round: ['$totalCost', 4] },
                    totalTokens: 1,
                    totalCalls: 1,
                    avgCost: { $round: ['$avgCost', 4] },
                    avgTokens: { $round: ['$avgTokens', 0] },
                },
            },
            { $sort: { totalCost: -1 } },
            { $limit: 20 },
        ]);
    }

    private static async getTopExpensivePrompts(match: any) {
        return Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$prompt',
                    totalCost: { $sum: '$cost' },
                    totalCalls: { $sum: 1 },
                    avgCost: { $avg: '$cost' },
                    lastUsed: { $max: '$createdAt' },
                    services: { $addToSet: '$service' },
                    models: { $addToSet: '$model' },
                },
            },
            {
                $project: {
                    prompt: {
                        $cond: {
                            if: { $gt: [{ $strLenCP: '$_id' }, 100] },
                            then: { $concat: [{ $substrCP: ['$_id', 0, 100] }, '...'] },
                            else: '$_id',
                        },
                    },
                    fullPrompt: '$_id',
                    _id: 0,
                    totalCost: { $round: ['$totalCost', 4] },
                    totalCalls: 1,
                    avgCost: { $round: ['$avgCost', 4] },
                    lastUsed: 1,
                    services: 1,
                    models: 1,
                },
            },
            { $sort: { totalCost: -1 } },
            { $limit: 10 },
        ]);
    }

    private static async getOptimizationStats(userId: string, startDate: Date, endDate: Date) {
        const stats = await Optimization.aggregate([
            {
                $match: {
                    userId,
                    createdAt: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: null,
                    totalOptimizations: { $sum: 1 },
                    totalSaved: { $sum: '$costSaved' },
                    totalTokensSaved: { $sum: '$tokensSaved' },
                    avgImprovement: { $avg: '$improvementPercentage' },
                    appliedCount: {
                        $sum: { $cond: [{ $eq: ['$applied', true] }, 1, 0] },
                    },
                },
            },
            {
                $project: {
                    _id: 0,
                    totalOptimizations: 1,
                    totalSaved: { $round: ['$totalSaved', 4] },
                    totalTokensSaved: 1,
                    avgImprovement: { $round: ['$avgImprovement', 1] },
                    appliedCount: 1,
                    applicationRate: {
                        $multiply: [
                            { $divide: ['$appliedCount', '$totalOptimizations'] },
                            100,
                        ],
                    },
                },
            },
        ]);

        return stats[0] || {
            totalOptimizations: 0,
            totalSaved: 0,
            totalTokensSaved: 0,
            avgImprovement: 0,
            appliedCount: 0,
            applicationRate: 0,
        };
    }

    private static async analyzeTrends(userId: string, startDate: Date, endDate: Date) {
        const usageData = await Usage.find({
            userId,
            createdAt: { $gte: startDate, $lte: endDate },
        })
            .select('createdAt cost totalTokens')
            .sort('createdAt')
            .lean();

        if (usageData.length < 2) {
            return {
                costTrend: 'stable',
                tokenTrend: 'stable',
                insights: [],
            };
        }

        // Simple linear regression for trend analysis
        const days = usageData.map(d =>
            Math.floor((d.createdAt.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        );
        const costs = usageData.map(d => d.cost);
        const tokens = usageData.map(d => d.totalTokens);

        const costSlope = this.calculateSlope(days, costs);
        const tokenSlope = this.calculateSlope(days, tokens);

        const insights: string[] = [];

        if (costSlope > 0.1) {
            insights.push('Your API costs are trending upward. Consider implementing optimization strategies.');
        } else if (costSlope < -0.1) {
            insights.push('Great job! Your API costs are trending downward.');
        }

        if (tokenSlope > 100) {
            insights.push('Token usage is increasing significantly. Review your prompts for optimization opportunities.');
        }

        return {
            costTrend: costSlope > 0.1 ? 'up' : costSlope < -0.1 ? 'down' : 'stable',
            tokenTrend: tokenSlope > 100 ? 'up' : tokenSlope < -100 ? 'down' : 'stable',
            costSlope,
            tokenSlope,
            insights,
        };
    }

    private static async getPredictions(historicalData: TimeSeriesData[]) {
        if (historicalData.length < 7) {
            return null;
        }

        try {
            // Use Bedrock to analyze patterns and make predictions
            const analysisRequest = {
                usageData: historicalData.slice(-30).map(d => ({
                    prompt: '', // Not needed for prediction
                    tokens: d.tokens,
                    cost: d.cost,
                    timestamp: d.date,
                })),
                timeframe: 'daily' as 'daily',
            };

            const analysis = await BedrockService.analyzeUsagePatterns(analysisRequest);

            // Simple moving average for next 7 days prediction
            const recentDays = historicalData.slice(-7);
            const avgDailyCost = recentDays.reduce((sum, d) => sum + d.cost, 0) / 7;
            const avgDailyTokens = recentDays.reduce((sum, d) => sum + d.tokens, 0) / 7;

            return {
                next7Days: {
                    estimatedCost: avgDailyCost * 7,
                    estimatedTokens: Math.round(avgDailyTokens * 7),
                    confidence: 0.75,
                },
                next30Days: {
                    estimatedCost: avgDailyCost * 30,
                    estimatedTokens: Math.round(avgDailyTokens * 30),
                    confidence: 0.60,
                },
                insights: analysis.patterns,
                recommendations: analysis.recommendations,
            };
        } catch (error) {
            logger.error('Error getting predictions:', error);
            return null;
        }
    }

    private static getDateRange(query: AnalyticsQuery): { startDate: Date; endDate: Date } {
        if (query.startDate && query.endDate) {
            return {
                startDate: query.startDate,
                endDate: query.endDate,
            };
        }

        const period = query.period || 'monthly';
        const { start, end } = getDateRange(period);
        return { startDate: start, endDate: end };
    }

    private static calculatePercentageChange(oldValue: number, newValue: number): number {
        if (oldValue === 0) return newValue === 0 ? 0 : 100;
        return ((newValue - oldValue) / oldValue) * 100;
    }

    private static calculateSlope(x: number[], y: number[]): number {
        const n = x.length;
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
        const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);

        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    }
}