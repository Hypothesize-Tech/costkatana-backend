import { Usage, IUsage } from '../models/Usage';
import { Alert } from '../models/Alert';
import { logger } from '../utils/logger';
import { PaginationOptions, paginate } from '../utils/helpers';
import { BedrockService } from './bedrock.service';
import { eventService } from './event.service';
import { AICostTrackerService } from './aiCostTracker.service';

interface TrackUsageData {
    userId: string;
    service: string;
    model: string;
    prompt: string;
    completion?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    responseTime: number;
    metadata?: Record<string, any>;
    tags?: string[];
}

interface UsageFilters {
    userId?: string;
    service?: string;
    model?: string;
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    minCost?: number;
    maxCost?: number;
}


export class UsageService {

    static async trackUsage(data: TrackUsageData): Promise<IUsage> {
        try {
            // Initialize AI Cost Tracker if not already done
            await AICostTrackerService.initialize();

            // Let the AI Cost Tracker handle the tracking
            // This will automatically call our custom storage and save to MongoDB
            await AICostTrackerService.trackRequest(
                {
                    model: data.model,
                    prompt: data.prompt,
                    maxTokens: data.metadata?.maxTokens,
                    temperature: data.metadata?.temperature
                },
                {
                    content: data.completion,
                    usage: {
                        promptTokens: data.promptTokens,
                        completionTokens: data.completionTokens,
                        totalTokens: data.totalTokens
                    }
                },
                data.userId,
                {
                    service: data.service,
                    responseTime: data.responseTime,
                    ...data.metadata,
                    tags: data.tags
                }
            );

            // The usage record is already created by our custom storage
            // Just return the latest usage record
            const usage = await Usage.findOne({ userId: data.userId })
                .sort({ createdAt: -1 })
                .limit(1);

            return usage!;
        } catch (error) {
            logger.error('Error tracking usage with AI Cost Tracker:', error);
            throw error;
        }
    }

    static async getUsage(
        filters: UsageFilters,
        options: PaginationOptions
    ) {
        try {
            const query: any = {};

            if (filters.userId) query.userId = filters.userId;
            if (filters.service) query.service = filters.service;
            if (filters.model) query.model = filters.model;
            if (filters.tags && filters.tags.length > 0) {
                query.tags = { $in: filters.tags };
            }
            if (filters.minCost !== undefined || filters.maxCost !== undefined) {
                query.cost = {};
                if (filters.minCost !== undefined) query.cost.$gte = filters.minCost;
                if (filters.maxCost !== undefined) query.cost.$lte = filters.maxCost;
            }
            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            const page = options.page || 1;
            const limit = options.limit || 10;
            const skip = (page - 1) * limit;
            const sort: any = {};

            if (options.sort) {
                sort[options.sort] = options.order === 'asc' ? 1 : -1;
            } else {
                sort.createdAt = -1;
            }

            const [data, total] = await Promise.all([
                Usage.find(query)
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .populate('userId', 'name email')
                    .lean(),
                Usage.countDocuments(query),
            ]);

            const result = paginate(data, total, options);

            // Send usage data update event to frontend
            if (filters.userId) {
                eventService.sendEvent('usage_data_updated', {
                    userId: filters.userId,
                    data: result,
                    filters,
                    timestamp: new Date(),
                });
            }

            return result;
        } catch (error) {
            logger.error('Error fetching usage:', error);
            throw error;
        }
    }

    static async getUsageStats(userId: string, period: 'daily' | 'weekly' | 'monthly') {
        try {
            const now = new Date();
            let startDate: Date;

            switch (period) {
                case 'daily':
                    startDate = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'weekly':
                    startDate = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'monthly':
                    startDate = new Date(now.setMonth(now.getMonth() - 1));
                    break;
            }

            const stats = await Usage.aggregate([
                {
                    $match: {
                        userId: userId,
                        createdAt: { $gte: startDate },
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalCalls: { $sum: 1 },
                        avgCost: { $avg: '$cost' },
                        avgTokens: { $avg: '$totalTokens' },
                        avgResponseTime: { $avg: '$responseTime' },
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
                    },
                },
            ]);

            // Get service breakdown
            const serviceBreakdown = await Usage.aggregate([
                {
                    $match: {
                        userId: userId,
                        createdAt: { $gte: startDate },
                    },
                },
                {
                    $group: {
                        _id: '$service',
                        cost: { $sum: '$cost' },
                        tokens: { $sum: '$totalTokens' },
                        calls: { $sum: 1 },
                    },
                },
                {
                    $project: {
                        service: '$_id',
                        _id: 0,
                        cost: { $round: ['$cost', 4] },
                        tokens: 1,
                        calls: 1,
                    },
                },
            ]);

            // Get model breakdown
            const modelBreakdown = await Usage.aggregate([
                {
                    $match: {
                        userId: userId,
                        createdAt: { $gte: startDate },
                    },
                },
                {
                    $group: {
                        _id: '$model',
                        cost: { $sum: '$cost' },
                        tokens: { $sum: '$totalTokens' },
                        calls: { $sum: 1 },
                    },
                },
                {
                    $project: {
                        model: '$_id',
                        _id: 0,
                        cost: { $round: ['$cost', 4] },
                        tokens: 1,
                        calls: 1,
                    },
                },
                {
                    $sort: { cost: -1 },
                },
                {
                    $limit: 10,
                },
            ]);

            const result = {
                period,
                startDate,
                endDate: new Date(),
                summary: stats[0] || {
                    totalCost: 0,
                    totalTokens: 0,
                    totalCalls: 0,
                    avgCost: 0,
                    avgTokens: 0,
                    avgResponseTime: 0,
                },
                serviceBreakdown,
                modelBreakdown,
            };

            // Send stats update event to frontend
            eventService.sendEvent('usage_stats_updated', {
                userId,
                period,
                stats: result,
                timestamp: new Date(),
            });

            return result;
        } catch (error) {
            logger.error('Error getting usage stats:', error);
            throw error;
        }
    }

    static async detectAnomalies(userId: string) {
        try {
            // Get recent usage
            const recentUsage = await Usage.find({ userId })
                .sort({ createdAt: -1 })
                .limit(100)
                .select('createdAt cost totalTokens')
                .lean();

            // Get historical average (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const historicalStats = await Usage.aggregate([
                {
                    $match: {
                        userId: userId,
                        createdAt: { $gte: thirtyDaysAgo },
                    },
                },
                {
                    $group: {
                        _id: null,
                        avgCost: { $avg: '$cost' },
                        avgTokens: { $avg: '$totalTokens' },
                    },
                },
            ]);

            if (recentUsage.length === 0 || !historicalStats[0]) {
                return { anomalies: [], recommendations: [] };
            }

            // Use Bedrock to detect anomalies
            const anomalyResult = await BedrockService.detectAnomalies(
                recentUsage.map(u => ({
                    timestamp: u.createdAt,
                    cost: u.cost,
                    tokens: u.totalTokens,
                })),
                {
                    cost: historicalStats[0].avgCost,
                    tokens: historicalStats[0].avgTokens,
                }
            );

            // Create alerts for high severity anomalies
            for (const anomaly of anomalyResult.anomalies) {
                if (anomaly.severity === 'high') {
                    await Alert.create({
                        userId,
                        type: 'usage_spike',
                        title: 'Unusual Usage Pattern Detected',
                        message: anomaly.description,
                        severity: anomaly.severity,
                        data: { anomaly },
                    });

                    // Send anomaly alert event to frontend
                    eventService.sendEvent('anomaly_detected', {
                        userId,
                        anomaly,
                        severity: anomaly.severity,
                        timestamp: new Date(),
                    });
                }
            }

            // Send anomaly analysis results to frontend
            eventService.sendEvent('anomaly_analysis_completed', {
                userId,
                anomalies: anomalyResult.anomalies,
                recommendations: anomalyResult.recommendations,
                timestamp: new Date(),
            });

            return anomalyResult;
        } catch (error) {
            logger.error('Error detecting anomalies:', error);
            throw error;
        }
    }

    static async searchUsage(userId: string, searchTerm: string, options: PaginationOptions) {
        try {
            const page = options.page || 1;
            const limit = options.limit || 10;
            const skip = (page - 1) * limit;

            const [data, total] = await Promise.all([
                Usage.find({
                    userId,
                    $text: { $search: searchTerm },
                })
                    .sort({ score: { $meta: 'textScore' } })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Usage.countDocuments({
                    userId,
                    $text: { $search: searchTerm },
                }),
            ]);

            const result = paginate(data, total, options);

            // Send search results event to frontend
            eventService.sendEvent('usage_search_completed', {
                userId,
                searchTerm,
                results: result,
                timestamp: new Date(),
            });

            return result;
        } catch (error) {
            logger.error('Error searching usage:', error);
            throw error;
        }
    }

    /**
     * Bulk track usage for multiple requests
     * Useful for batch processing and integration with ai-cost-tracker package
     */
    static async bulkTrackUsage(usageData: TrackUsageData[]): Promise<IUsage[]> {
        try {
            const results: IUsage[] = [];

            for (const data of usageData) {
                const usage = await this.trackUsage(data);
                results.push(usage);
            }

            // Send bulk update event to frontend
            eventService.sendEvent('bulk_usage_tracked', {
                count: results.length,
                totalCost: results.reduce((sum, usage) => sum + usage.cost, 0),
                totalTokens: results.reduce((sum, usage) => sum + usage.totalTokens, 0),
                timestamp: new Date(),
            });

            return results;
        } catch (error) {
            logger.error('Error bulk tracking usage:', error);
            throw error;
        }
    }

    /**
     * Get real-time usage summary for dashboard
     */
    static async getRealTimeUsageSummary(userId: string) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const summary = await Usage.aggregate([
                {
                    $match: {
                        userId: userId,
                        createdAt: { $gte: today },
                    },
                },
                {
                    $group: {
                        _id: null,
                        todayCost: { $sum: '$cost' },
                        todayTokens: { $sum: '$totalTokens' },
                        todayCalls: { $sum: 1 },
                        lastRequest: { $max: '$createdAt' },
                    },
                },
            ]);

            const result = summary[0] || {
                todayCost: 0,
                todayTokens: 0,
                todayCalls: 0,
                lastRequest: null,
            };

            // Send real-time summary to frontend
            eventService.sendEvent('realtime_usage_summary', {
                userId,
                summary: result,
                timestamp: new Date(),
            });

            return result;
        } catch (error) {
            logger.error('Error getting real-time usage summary:', error);
            throw error;
        }
    }

    // Add a method to sync historical data
    static async syncHistoricalData(userId: string, days: number = 30): Promise<void> {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const historicalUsage = await Usage.find({
                userId,
                createdAt: { $gte: startDate }
            }).lean();

            logger.info(`Syncing ${historicalUsage.length} historical records for user ${userId}`);

            // Process in batches to avoid overwhelming the system
            const batchSize = 100;
            for (let i = 0; i < historicalUsage.length; i += batchSize) {
                const batch = historicalUsage.slice(i, i + batchSize);

                await Promise.all(batch.map(async (usage) => {
                    await AICostTrackerService.trackRequest(
                        {
                            model: usage.model,
                            prompt: usage.prompt
                        },
                        {
                            content: usage.completion,
                            usage: {
                                promptTokens: usage.promptTokens,
                                completionTokens: usage.completionTokens,
                                totalTokens: usage.totalTokens
                            }
                        },
                        usage.userId.toString(),
                        {
                            service: usage.service,
                            historicalSync: true,
                            originalCreatedAt: usage.createdAt
                        }
                    );
                }));
            }

            logger.info(`Historical sync completed for user ${userId}`);
        } catch (error) {
            logger.error('Error syncing historical data:', error);
            throw error;
        }
    }
}