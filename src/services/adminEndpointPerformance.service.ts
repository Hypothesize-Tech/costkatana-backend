import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface EndpointPerformance {
    endpoint: string;
    totalRequests: number;
    totalCost: number;
    avgResponseTime: number;
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    errorRate: number;
    totalErrors: number;
    successRate: number;
    requestsPerMinute: number;
    avgCost: number;
    avgTokens: number;
}

export interface EndpointTrend {
    date: string;
    endpoint: string;
    requests: number;
    avgResponseTime: number;
    errorRate: number;
    cost: number;
}

export interface TopEndpoints {
    endpoint: string;
    requests: number;
    avgResponseTime: number;
    errorRate: number;
    cost: number;
    rank: number;
}

export class AdminEndpointPerformanceService {
    /**
     * Get endpoint performance metrics
     */
    static async getEndpointPerformance(
        startDate?: Date,
        endDate?: Date
    ): Promise<EndpointPerformance[]> {
        try {
            const matchStage: any = {
                'metadata.endpoint': { $exists: true, $ne: null }
            };

            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            const now = new Date();
            const periodStart = startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const periodEnd = endDate || now;
            const periodMinutes = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60));

            const aggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$metadata.endpoint',
                        totalRequests: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgResponseTime: { $avg: '$responseTime' },
                        responseTimes: { $push: '$responseTime' },
                        totalErrors: {
                            $sum: {
                                $cond: [{ $or: ['$errorOccurred', { $gt: ['$httpStatusCode', 399] }] }, 1, 0]
                            }
                        },
                        totalTokens: { $sum: '$totalTokens' },
                        createdAt: { $first: '$createdAt' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        endpoint: '$_id',
                        totalRequests: 1,
                        totalCost: 1,
                        avgResponseTime: 1,
                        responseTimes: 1,
                        totalErrors: 1,
                        totalTokens: 1
                    }
                }
            ]);

            const performance: EndpointPerformance[] = [];

            for (const item of aggregation) {
                const responseTimes = item.responseTimes.sort((a: number, b: number) => a - b);
                const count = responseTimes.length;

                const p50 = count > 0 ? responseTimes[Math.floor(count * 0.5)] : 0;
                const p95 = count > 0 ? responseTimes[Math.floor(count * 0.95)] : 0;
                const p99 = count > 0 ? responseTimes[Math.floor(count * 0.99)] : 0;

                const errorRate = item.totalRequests > 0 
                    ? (item.totalErrors / item.totalRequests) * 100 
                    : 0;
                const successRate = 100 - errorRate;

                const avgCost = item.totalRequests > 0 ? item.totalCost / item.totalRequests : 0;
                const avgTokens = item.totalRequests > 0 ? item.totalTokens / item.totalRequests : 0;
                const requestsPerMinute = periodMinutes > 0 ? item.totalRequests / periodMinutes : 0;

                performance.push({
                    endpoint: item.endpoint,
                    totalRequests: item.totalRequests,
                    totalCost: item.totalCost,
                    avgResponseTime: item.avgResponseTime || 0,
                    p50ResponseTime: p50,
                    p95ResponseTime: p95,
                    p99ResponseTime: p99,
                    errorRate,
                    totalErrors: item.totalErrors,
                    successRate,
                    requestsPerMinute,
                    avgCost,
                    avgTokens
                });
            }

            return performance.sort((a, b) => b.totalRequests - a.totalRequests);
        } catch (error) {
            loggingService.error('Error getting endpoint performance:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get endpoint performance trends
     */
    static async getEndpointTrends(
        endpoint?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<EndpointTrend[]> {
        try {
            const matchStage: any = {
                'metadata.endpoint': { $exists: true, $ne: null }
            };

            if (endpoint) {
                matchStage['metadata.endpoint'] = endpoint;
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
                
                if (daysDiff <= 7) {
                    // Daily
                    dateFormat = {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        day: { $dayOfMonth: '$createdAt' }
                    };
                    dateGroup = {
                        year: '$_id.year',
                        month: '$_id.month',
                        day: '$_id.day'
                    };
                } else if (daysDiff <= 30) {
                    // Daily
                    dateFormat = {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        day: { $dayOfMonth: '$createdAt' }
                    };
                    dateGroup = {
                        year: '$_id.year',
                        month: '$_id.month',
                        day: '$_id.day'
                    };
                } else {
                    // Weekly
                    dateFormat = {
                        year: { $year: '$createdAt' },
                        week: { $week: '$createdAt' }
                    };
                    dateGroup = {
                        year: '$_id.year',
                        week: '$_id.week'
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
                    year: '$_id.year',
                    month: '$_id.month',
                    day: '$_id.day'
                };
            }

            const aggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            date: dateFormat,
                            endpoint: '$metadata.endpoint'
                        },
                        requests: { $sum: 1 },
                        avgResponseTime: { $avg: '$responseTime' },
                        totalErrors: {
                            $sum: {
                                $cond: [{ $or: ['$errorOccurred', { $gt: ['$httpStatusCode', 399] }] }, 1, 0]
                            }
                        },
                        cost: { $sum: '$cost' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        date: {
                            $dateFromParts: dateGroup
                        },
                        endpoint: '$_id.endpoint',
                        requests: 1,
                        avgResponseTime: 1,
                        totalErrors: 1,
                        cost: 1
                    }
                },
                { $sort: { date: 1, endpoint: 1 } }
            ]);

            return aggregation.map(item => ({
                date: item.date.toISOString().split('T')[0],
                endpoint: item.endpoint,
                requests: item.requests,
                avgResponseTime: item.avgResponseTime || 0,
                errorRate: item.requests > 0 ? (item.totalErrors / item.requests) * 100 : 0,
                cost: item.cost
            }));
        } catch (error) {
            loggingService.error('Error getting endpoint trends:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get top endpoints by various metrics
     */
    static async getTopEndpoints(
        metric: 'requests' | 'cost' | 'responseTime' | 'errors' = 'requests',
        limit: number = 10
    ): Promise<TopEndpoints[]> {
        try {
            const performance = await this.getEndpointPerformance();

            let sorted: EndpointPerformance[];
            switch (metric) {
                case 'requests':
                    sorted = performance.sort((a, b) => b.totalRequests - a.totalRequests);
                    break;
                case 'cost':
                    sorted = performance.sort((a, b) => b.totalCost - a.totalCost);
                    break;
                case 'responseTime':
                    sorted = performance.sort((a, b) => b.avgResponseTime - a.avgResponseTime);
                    break;
                case 'errors':
                    sorted = performance.sort((a, b) => b.totalErrors - a.totalErrors);
                    break;
                default:
                    sorted = performance.sort((a, b) => b.totalRequests - a.totalRequests);
            }

            return sorted.slice(0, limit).map((item, index) => ({
                endpoint: item.endpoint,
                requests: item.totalRequests,
                avgResponseTime: item.avgResponseTime,
                errorRate: item.errorRate,
                cost: item.totalCost,
                rank: index + 1
            }));
        } catch (error) {
            loggingService.error('Error getting top endpoints:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}


