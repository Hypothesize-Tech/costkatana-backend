import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface IntegrationStats {
    service: string;
    totalRequests: number;
    totalCost: number;
    totalTokens: number;
    avgResponseTime: number;
    errorRate: number;
    successRate: number;
    activeUsers: number;
    activeProjects: number;
}

export interface IntegrationTrend {
    date: string;
    service: string;
    requests: number;
    cost: number;
    errorRate: number;
    avgResponseTime: number;
}

export interface IntegrationHealth {
    service: string;
    status: 'healthy' | 'degraded' | 'down';
    uptime: number; // percentage
    errorRate: number;
    avgResponseTime: number;
    lastIncident?: Date;
    incidents24h: number;
}

export class AdminIntegrationAnalyticsService {
    /**
     * Get integration statistics
     */
    static async getIntegrationStats(
        startDate?: Date,
        endDate?: Date
    ): Promise<IntegrationStats[]> {
        try {
            const matchStage: any = {};

            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            const aggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$service',
                        totalRequests: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        avgResponseTime: { $avg: '$responseTime' },
                        totalErrors: {
                            $sum: {
                                $cond: [
                                    { $or: ['$errorOccurred', { $gt: ['$httpStatusCode', 399] }] },
                                    1,
                                    0
                                ]
                            }
                        },
                        uniqueUsers: { $addToSet: '$userId' },
                        uniqueProjects: { $addToSet: '$projectId' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        service: '$_id',
                        totalRequests: 1,
                        totalCost: 1,
                        totalTokens: 1,
                        avgResponseTime: 1,
                        totalErrors: 1,
                        activeUsers: { $size: '$uniqueUsers' },
                        activeProjects: {
                            $size: {
                                $filter: {
                                    input: '$uniqueProjects',
                                    cond: { $ne: ['$$this', null] }
                                }
                            }
                        }
                    }
                }
            ]);

            return aggregation.map(item => {
                const errorRate = item.totalRequests > 0 
                    ? (item.totalErrors / item.totalRequests) * 100 
                    : 0;
                const successRate = 100 - errorRate;

                return {
                    service: item.service,
                    totalRequests: item.totalRequests,
                    totalCost: item.totalCost,
                    totalTokens: item.totalTokens,
                    avgResponseTime: item.avgResponseTime || 0,
                    errorRate,
                    successRate,
                    activeUsers: item.activeUsers,
                    activeProjects: item.activeProjects
                };
            }).sort((a, b) => b.totalRequests - a.totalRequests);
        } catch (error) {
            loggingService.error('Error getting integration stats:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get integration trends
     */
    static async getIntegrationTrends(
        service?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<IntegrationTrend[]> {
        try {
            const matchStage: any = {};

            if (service) {
                matchStage.service = service;
            }

            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            } else {
                // Default to last 30 days
                const defaultStartDate = new Date();
                defaultStartDate.setDate(defaultStartDate.getDate() - 30);
                matchStage.createdAt = { $gte: defaultStartDate };
            }

            let dateFormat: any;
            let dateGroup: any;

            if (startDate && endDate) {
                const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                
                if (daysDiff <= 90) {
                    // Daily
                    dateFormat = {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        day: { $dayOfMonth: '$createdAt' }
                    };
                    dateGroup = {
                        year: '$_id.date.year',
                        month: '$_id.date.month',
                        day: '$_id.date.day'
                    };
                } else {
                    // Weekly - use ISO week format
                    dateFormat = {
                        isoWeekYear: { $isoWeekYear: '$createdAt' },
                        isoWeek: { $isoWeek: '$createdAt' }
                    };
                    dateGroup = {
                        isoWeekYear: '$_id.date.isoWeekYear',
                        isoWeek: '$_id.date.isoWeek',
                        isoDayOfWeek: 1 // Set to Monday (start of week)
                    };
                }
            } else {
                // Default: daily
                dateFormat = {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                };
                dateGroup = {
                    year: '$_id.date.year',
                    month: '$_id.date.month',
                    day: '$_id.date.day'
                };
            }

            const aggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            date: dateFormat,
                            service: '$service'
                        },
                        requests: { $sum: 1 },
                        cost: { $sum: '$cost' },
                        totalErrors: {
                            $sum: {
                                $cond: [
                                    { $or: ['$errorOccurred', { $gt: ['$httpStatusCode', 399] }] },
                                    1,
                                    0
                                ]
                            }
                        },
                        avgResponseTime: { $avg: '$responseTime' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        date: {
                            $dateFromParts: dateGroup
                        },
                        service: '$_id.service',
                        requests: 1,
                        cost: 1,
                        errorRate: {
                            $cond: [
                                { $gt: ['$requests', 0] },
                                { $multiply: [{ $divide: ['$totalErrors', '$requests'] }, 100] },
                                0
                            ]
                        },
                        avgResponseTime: 1
                    }
                },
                { $sort: { date: 1, service: 1 } }
            ]);

            return aggregation.map(item => ({
                date: item.date.toISOString().split('T')[0],
                service: item.service,
                requests: item.requests,
                cost: item.cost,
                errorRate: item.errorRate,
                avgResponseTime: item.avgResponseTime || 0
            }));
        } catch (error) {
            loggingService.error('Error getting integration trends:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get integration health status
     */
    static async getIntegrationHealth(): Promise<IntegrationHealth[]> {
        try {
            const now = new Date();
            const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Get stats for last 24 hours
            const stats = await this.getIntegrationStats(last24Hours, now);

            // Get all-time stats for uptime calculation
            const allTimeStats = await this.getIntegrationStats();

            const health: IntegrationHealth[] = [];

            for (const stat of stats) {
                // Note: allTimeStats could be used for uptime calculation in future

                // Calculate uptime (simplified - would need incident tracking)
                const uptime = stat.successRate;

                // Determine status
                let status: 'healthy' | 'degraded' | 'down';
                if (stat.errorRate > 50) {
                    status = 'down';
                } else if (stat.errorRate > 10) {
                    status = 'degraded';
                } else {
                    status = 'healthy';
                }

                // Count incidents (requests with errors)
                const incidents = await Usage.countDocuments({
                    service: stat.service,
                    createdAt: { $gte: last24Hours },
                    $or: [
                        { errorOccurred: true },
                        { httpStatusCode: { $gt: 399 } }
                    ]
                });

                health.push({
                    service: stat.service,
                    status,
                    uptime,
                    errorRate: stat.errorRate,
                    avgResponseTime: stat.avgResponseTime,
                    incidents24h: incidents,
                    // Last incident would need separate tracking
                    // For now, we'll leave it undefined
                });
            }

            return health.sort((a, b) => {
                // Sort by status severity
                const statusOrder = { 'down': 0, 'degraded': 1, 'healthy': 2 };
                return (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3);
            });
        } catch (error) {
            loggingService.error('Error getting integration health:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get top integrations by usage
     */
    static async getTopIntegrations(
        metric: 'requests' | 'cost' | 'errors' = 'requests',
        limit: number = 10
    ): Promise<IntegrationStats[]> {
        try {
            const stats = await this.getIntegrationStats();

            let sorted: IntegrationStats[];
            switch (metric) {
                case 'requests':
                    sorted = stats.sort((a, b) => b.totalRequests - a.totalRequests);
                    break;
                case 'cost':
                    sorted = stats.sort((a, b) => b.totalCost - a.totalCost);
                    break;
                case 'errors':
                    sorted = stats.sort((a, b) => b.errorRate - a.errorRate);
                    break;
                default:
                    sorted = stats.sort((a, b) => b.totalRequests - a.totalRequests);
            }

            return sorted.slice(0, limit);
        } catch (error) {
            loggingService.error('Error getting top integrations:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}


