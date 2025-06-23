import { Usage, IUsage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { logger } from '../utils/logger';
import { PaginationOptions, paginate } from '../utils/helpers';
import { BedrockService } from './bedrock.service';
import { EmailService } from './email.service';
import { CloudWatchService } from './cloudwatch.service';
// import { AICostOptimizer } from 'ai-cost-optimizer-core';
// let AICostOptimizer: any = null;

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
    // private static costOptimizer = new AICostOptimizer();

    static async trackUsage(data: TrackUsageData): Promise<IUsage> {
        try {
            // Create usage record
            const usage = await Usage.create(data);

            // Update user's monthly usage
            await User.findByIdAndUpdate(data.userId, {
                $inc: {
                    'usage.currentMonth.apiCalls': 1,
                    'usage.currentMonth.totalCost': data.cost,
                },
            });

            // Check for cost threshold alerts
            const user = await User.findById(data.userId);
            if (user && user.preferences.emailAlerts) {
                const monthlyTotal = user.usage.currentMonth.totalCost;
                const threshold = user.preferences.alertThreshold;

                if (monthlyTotal >= threshold && monthlyTotal - data.cost < threshold) {
                    await this.createCostAlert(user._id.toString(), monthlyTotal, threshold);
                }
            }

            // Send metrics to CloudWatch
            await CloudWatchService.sendMetrics({
                namespace: 'AICostOptimizer',
                metricData: [
                    {
                        metricName: 'APIUsage',
                        value: 1,
                        unit: 'Count',
                        dimensions: [
                            { name: 'Service', value: data.service },
                            { name: 'Model', value: data.model },
                        ],
                    },
                    {
                        metricName: 'TokenUsage',
                        value: data.totalTokens,
                        unit: 'Count',
                        dimensions: [
                            { name: 'Service', value: data.service },
                            { name: 'Model', value: data.model },
                        ],
                    },
                    {
                        metricName: 'Cost',
                        value: data.cost,
                        unit: 'None',
                        dimensions: [
                            { name: 'Service', value: data.service },
                            { name: 'Model', value: data.model },
                        ],
                    },
                ],
            });

            logger.info('Usage tracked successfully', {
                userId: data.userId,
                service: data.service,
                model: data.model,
                cost: data.cost,
            });

            return usage;
        } catch (error) {
            logger.error('Error tracking usage:', error);
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

            return paginate(data, total, options);
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

            return {
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
                }
            }

            return anomalyResult;
        } catch (error) {
            logger.error('Error detecting anomalies:', error);
            throw error;
        }
    }

    private static async createCostAlert(
        userId: string,
        currentCost: number,
        threshold: number
    ) {
        try {
            const alert = await Alert.create({
                userId,
                type: 'cost_threshold',
                title: 'Cost Threshold Alert',
                message: `Your monthly AI API usage has reached $${currentCost.toFixed(2)}, exceeding your threshold of $${threshold.toFixed(2)}.`,
                severity: 'high',
                data: {
                    currentValue: currentCost,
                    threshold,
                    percentage: (currentCost / threshold) * 100,
                },
                actionRequired: true,
            });

            // Send email notification
            const user = await User.findById(userId);
            if (user && user.preferences.emailAlerts) {
                await EmailService.sendCostAlert(user, currentCost, threshold);
            }

            return alert;
        } catch (error) {
            logger.error('Error creating cost alert:', error);
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

            return paginate(data, total, options);
        } catch (error) {
            logger.error('Error searching usage:', error);
            throw error;
        }
    }
}