import { logger } from '../utils/logger';
import { Usage } from '../models';
import mongoose from 'mongoose';

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

export class AnalyticsService {
    static async getAnalytics(filters: any, options: { groupBy?: string; includeProjectBreakdown?: boolean } = {}) {
        try {
            logger.debug('Getting analytics with filters:', filters);

            const match: any = {
                userId: new mongoose.Types.ObjectId(filters.userId),
            };

            if (filters.startDate || filters.endDate) {
                match.createdAt = {};
                if (filters.startDate) match.createdAt.$gte = filters.startDate;
                if (filters.endDate) match.createdAt.$lte = filters.endDate;
            }

            if (filters.service) match.service = filters.service;
            if (filters.model) match.model = filters.model;

            const [summary, timeline, breakdown] = await Promise.all([
                this.getSummary(match),
                this.getTimeline(match, options.groupBy || 'date'),
                this.getBreakdown(match)
            ]);

            let projectBreakdown = null;
            if (options.includeProjectBreakdown) {
                projectBreakdown = await this.calculateProjectBreakdown(filters.userId);
            }

            const result = {
                summary,
                timeline,
                breakdown,
                trends: {
                    costTrend: 'stable',
                    tokenTrend: 'stable',
                    insights: []
                },
                projectBreakdown
            };

            logger.debug('Analytics result:', result);
            return result;
        } catch (error) {
            logger.error('Error getting analytics:', error);
            throw error;
        }
    }

    static async getProjectAnalytics(projectId: string, filters: any, options: { groupBy?: string } = {}) {
        try {
            logger.debug('Getting project analytics for:', projectId);

            const match = {
                ...filters,
                projectId: new mongoose.Types.ObjectId(projectId)
            };

            const [summary, timeline, breakdown] = await Promise.all([
                this.getSummary(match),
                this.getTimeline(match, options.groupBy || 'date'),
                this.getBreakdown(match)
            ]);

            return {
                summary,
                timeline,
                breakdown,
                trends: {
                    costTrend: 'stable',
                    tokenTrend: 'stable',
                    insights: []
                }
            };
        } catch (error) {
            logger.error('Error getting project analytics:', error);
            throw error;
        }
    }

    static async compareProjects(projectIds: string[], options: { startDate?: Date; endDate?: Date; metric?: string } = {}) {
        try {
            logger.debug('Comparing projects:', projectIds);

            const match: any = {
                projectId: { $in: projectIds.map(id => new mongoose.Types.ObjectId(id)) }
            };

            if (options.startDate || options.endDate) {
                match.createdAt = {};
                if (options.startDate) match.createdAt.$gte = options.startDate;
                if (options.endDate) match.createdAt.$lte = options.endDate;
            }

            const comparison = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$projectId',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        avgCost: { $avg: '$cost' }
                    }
                },
                {
                    $lookup: {
                        from: 'projects',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'project'
                    }
                },
                {
                    $unwind: '$project'
                },
                {
                    $project: {
                        projectId: '$_id',
                        projectName: '$project.name',
                        totalCost: { $round: ['$totalCost', 4] },
                        totalTokens: 1,
                        totalRequests: 1,
                        avgCost: { $round: ['$avgCost', 4] }
                    }
                }
            ]);

            return {
                projects: comparison,
                metric: options.metric || 'cost'
            };
        } catch (error) {
            logger.error('Error comparing projects:', error);
            throw error;
        }
    }

    private static async calculateProjectBreakdown(userId: string) {
        try {
            const breakdown = await Usage.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: '$projectId',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 }
                    }
                },
                {
                    $lookup: {
                        from: 'projects',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'project'
                    }
                },
                {
                    $unwind: '$project'
                },
                {
                    $project: {
                        projectId: '$_id',
                        projectName: '$project.name',
                        totalCost: { $round: ['$totalCost', 4] },
                        totalTokens: 1,
                        totalRequests: 1
                    }
                },
                { $sort: { totalCost: -1 } }
            ]);

            return breakdown;
        } catch (error) {
            logger.error('Error calculating project breakdown:', error);
            return [];
        }
    }

    static async getComparativeAnalytics(
        userId: string,
        period1: { startDate: Date; endDate: Date },
        period2: { startDate: Date; endDate: Date }
    ) {
        try {
            logger.debug('Getting comparative analytics for user:', userId);

            const [data1, data2] = await Promise.all([
                this.getAnalytics({ userId, startDate: period1.startDate, endDate: period1.endDate }),
                this.getAnalytics({ userId, startDate: period2.startDate, endDate: period2.endDate })
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
                    period1: data1.summary.totalRequests,
                    period2: data2.summary.totalRequests,
                    change: data2.summary.totalRequests - data1.summary.totalRequests,
                    percentageChange: this.calculatePercentageChange(
                        data1.summary.totalRequests,
                        data2.summary.totalRequests
                    ),
                },
                avgCostPerCall: {
                    period1: data1.summary.averageCostPerRequest,
                    period2: data2.summary.averageCostPerRequest,
                    change: data2.summary.averageCostPerRequest - data1.summary.averageCostPerRequest,
                    percentageChange: this.calculatePercentageChange(
                        data1.summary.averageCostPerRequest,
                        data2.summary.averageCostPerRequest
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

    static async exportAnalytics(query: AnalyticsQuery, format: 'csv' | 'json' = 'csv') {
        try {
            const data = await this.getAnalytics(query);

            if (format === 'json') {
                return JSON.stringify(data, null, 2);
            }

            // CSV format
            const csvRows = ['Date,Service,Model,Tokens,Cost,Calls'];

            for (const item of data.timeline) {
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

    private static async getSummary(match: any) {
        const result = await Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    totalRequests: { $sum: 1 },
                    averageCostPerRequest: { $avg: '$cost' }
                }
            }
        ]);

        return result[0] || {
            totalCost: 0,
            totalTokens: 0,
            totalRequests: 0,
            averageCostPerRequest: 0
        };
    }

    private static async getTimeline(match: any, groupBy: string): Promise<TimeSeriesData[]> {
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

    private static async getBreakdown(match: any) {
        const [services, models] = await Promise.all([
            Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$service',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        service: '$_id',
                        _id: 0,
                        totalCost: { $round: ['$totalCost', 4] },
                        totalTokens: 1,
                        totalRequests: 1
                    }
                },
                { $sort: { totalCost: -1 } }
            ]),
            Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$model',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        model: '$_id',
                        _id: 0,
                        totalCost: { $round: ['$totalCost', 4] },
                        totalTokens: 1,
                        totalRequests: 1
                    }
                },
                { $sort: { totalCost: -1 } }
            ])
        ]);

        return {
            services,
            models
        };
    }

    private static calculatePercentageChange(oldValue: number, newValue: number): number {
        if (oldValue === 0) return newValue === 0 ? 0 : 100;
        return ((newValue - oldValue) / oldValue) * 100;
    }
}