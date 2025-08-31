import { Usage } from '../models';
import mongoose from 'mongoose';
import { mixpanelService } from './mixpanel.service';
import { loggingService } from './logging.service';

interface AnalyticsQuery {
    userId: string;
    startDate?: Date;
    endDate?: Date;
    period?: 'daily' | 'weekly' | 'monthly';
    service?: string;
    model?: string;
    groupBy?: 'service' | 'model' | 'date' | 'hour';
    projectId?: string;
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
            loggingService.debug('Getting analytics with filters:', { value:  { value: filters } });

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
            if (filters.projectId && filters.projectId !== 'all') {
                match.projectId = new mongoose.Types.ObjectId(filters.projectId);
            }

            const [summary, timeline, breakdown] = await Promise.all([
                this.getSummary(match),
                this.getTimeline(match, options.groupBy || 'date'),
                this.getBreakdown(match)
            ]);

            let projectBreakdown = null;
            if (options.includeProjectBreakdown && !filters.projectId) {
                // Only include project breakdown when not filtering by a specific project
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

            loggingService.debug('Analytics result:', { value:  { value: result } });
            
            // Track analytics access
            if (filters.userId) {
                mixpanelService.trackAnalyticsEvent('dashboard_viewed', {
                    userId: filters.userId,
                    projectId: filters.projectId,
                    reportType: options.groupBy,
                    dateRange: filters.startDate && filters.endDate 
                        ? `${filters.startDate.toISOString()}-${filters.endDate.toISOString()}` 
                        : undefined,
                    filters: {
                        service: filters.service,
                        model: filters.model,
                        groupBy: options.groupBy
                    },
                    page: '/analytics',
                    component: 'analytics_service'
                });
            }
            
            return result;
        } catch (error) {
            loggingService.error('Error getting analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async getProjectAnalytics(projectId: string, filters: any, options: { groupBy?: string } = {}) {
        try {
            loggingService.debug('Getting project analytics for:', { value:  { value: projectId } });

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
            loggingService.error('Error getting project analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async compareProjects(projectIds: string[], options: { startDate?: Date; endDate?: Date; metric?: string } = {}) {
        try {
            loggingService.debug('Comparing projects:', { value:  { value: projectIds } });

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
            loggingService.error('Error comparing projects:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async getRecentUsage(filters: {
        userId?: string;
        limit?: number;
        projectId?: string;
        startDate?: Date;
        endDate?: Date;
    } = {}) {
        try {
            const match: any = {};
            
            if (filters.userId) {
                match.userId = new mongoose.Types.ObjectId(filters.userId);
            }
            
            if (filters.projectId && filters.projectId !== 'all') {
                match.projectId = new mongoose.Types.ObjectId(filters.projectId);
            }
            
            if (filters.startDate || filters.endDate) {
                match.createdAt = {};
                if (filters.startDate) match.createdAt.$gte = filters.startDate;
                if (filters.endDate) match.createdAt.$lte = filters.endDate;
            }

            const pipeline = [
                { $match: match },
                {
                    $lookup: {
                        from: 'projects',
                        localField: 'projectId',
                        foreignField: '_id',
                        as: 'project'
                    }
                },
                {
                    $addFields: {
                        projectName: {
                            $cond: {
                                if: { $gt: [{ $size: '$project' }, 0] },
                                then: { $arrayElemAt: ['$project.name', 0] },
                                else: null
                            }
                        }
                    }
                },
                {
                    $project: {
                        userId: 1,
                        service: 1,
                        model: 1,
                        prompt: 1,
                        completion: 1,
                        cost: 1,
                        totalTokens: 1,
                        promptTokens: 1,
                        completionTokens: 1,
                        responseTime: 1,
                        createdAt: 1,
                        projectName: 1,
                        metadata: 1,
                        tags: 1,
                        optimizationApplied: 1,
                        errorOccurred: 1
                    }
                },
                { $sort: { createdAt: -1 as -1 } },
                { $limit: filters.limit || 20 }
            ];

            const recentUsage = await Usage.aggregate(pipeline);
            
            loggingService.debug(`Retrieved ${recentUsage.length} recent usage records`);
            return recentUsage;
        } catch (error) {
            loggingService.error('Error getting recent usage:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.error('Error calculating project breakdown:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    static async getComparativeAnalytics(
        userId: string,
        period1: { startDate: Date; endDate: Date },
        period2: { startDate: Date; endDate: Date }
    ) {
        try {
            loggingService.debug('Getting comparative analytics for user:', { value:  { value: userId } });

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
            loggingService.error('Error getting comparative analytics:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.error('Error exporting analytics:', { error: error instanceof Error ? error.message : String(error) });
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