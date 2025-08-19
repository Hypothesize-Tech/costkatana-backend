import mongoose from 'mongoose';
import { Usage, IUsage } from '../models/Usage';
import { Alert } from '../models/Alert';
import { logger } from '../utils/logger';
import { PaginationOptions, paginate } from '../utils/helpers';
import { BedrockService } from './bedrock.service';
import { AICostTrackerService } from './aiCostTracker.service';
import { getUserIdFromToken } from '../controllers/usage.controller';

interface TrackUsageData {
    userId: string;
    projectId?: string;
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
    workflowId?: string;
    workflowName?: string;
    workflowStep?: string;
    workflowSequence?: number;
}

interface UsageFilters {
    userId?: string;
    projectId?: string;
    service?: string;
    model?: string;
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    minCost?: number;
    maxCost?: number;
    customProperties?: Record<string, string>; // For filtering by custom properties
    propertyExists?: string[]; // For filtering by existence of specific properties
}


export class UsageService {

    static async trackUsage(data: any, req?: any): Promise<IUsage | null> {
        try {
            // DEBUG: Check workflow fields received by service
            console.log('🔍 WORKFLOW DEBUG - Service received:', {
                workflowId: data.workflowId,
                workflowName: data.workflowName,
                workflowStep: data.workflowStep,
                workflowSequence: data.workflowSequence
            });

            // Ensure userId is a valid ObjectId
            let userId = data.userId;
            // If userId is missing, try to get from req (if provided)
            if (!userId && req) {
                userId = getUserIdFromToken(req) || req.user?.id || req.user?._id || req.userId;
            }
            if (typeof userId === 'string') {
                userId = new mongoose.Types.ObjectId(userId);
            }
            // Create usage document
            const usageData = {
                userId,
                service: data.service,
                model: data.model,
                prompt: data.prompt || '',
                completion: data.completion,
                promptTokens: data.promptTokens,
                completionTokens: data.completionTokens,
                totalTokens: data.totalTokens,
                cost: data.cost || 0,
                responseTime: data.responseTime || 0,
                metadata: data.metadata || {},
                tags: data.tags || [],
                optimizationApplied: data.optimizationApplied || false,
                errorOccurred: data.errorOccurred || false,
                errorMessage: data.errorMessage,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                // Add workflow tracking fields
                workflowId: data.workflowId,
                workflowName: data.workflowName,
                workflowStep: data.workflowStep,
                workflowSequence: data.workflowSequence
            };

            // Only add projectId if it exists and is not empty
            if (data.projectId && typeof data.projectId === 'string' && data.projectId.trim() !== '') {
                (usageData as any).projectId = new mongoose.Types.ObjectId(data.projectId);
            }

            // DEBUG: Check workflow fields before MongoDB save
            console.log('🔍 WORKFLOW DEBUG - Before MongoDB save:', {
                workflowId: usageData.workflowId,
                workflowName: usageData.workflowName,
                workflowStep: usageData.workflowStep,
                workflowSequence: usageData.workflowSequence
            });

            const usage = new Usage(usageData);
            const savedUsage = await usage.save();
            
            // DEBUG: Check workflow fields after MongoDB save
            console.log('🔍 WORKFLOW DEBUG - After MongoDB save:', {
                _id: savedUsage._id,
                workflowId: savedUsage.workflowId,
                workflowName: savedUsage.workflowName,
                workflowStep: savedUsage.workflowStep,
                workflowSequence: savedUsage.workflowSequence
            });
            
            return savedUsage;
        } catch (error: any) {
            console.error('Error in UsageService.trackUsage:', error);
            console.error('Error stack:', error.stack);
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
            if (filters.projectId && filters.projectId !== 'all') {
                query.projectId = new mongoose.Types.ObjectId(filters.projectId);
            }
            if (filters.service) query.service = filters.service;
            if (filters.model) query.model = filters.model;
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

            // Add custom property filtering
            if (filters.customProperties) {
                Object.entries(filters.customProperties).forEach(([key, value]) => {
                    // Special handling for tags - check both tags field and metadata.tags
                    if (key === 'tags') {
                        // Parse the value if it's a JSON string
                        let searchValue = value;
                        try {
                            if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                                searchValue = JSON.parse(value);
                            }
                        } catch (e) {
                            // If parsing fails, use original value
                        }

                        if (!query.$or) query.$or = [];
                        if (Array.isArray(searchValue)) {
                            // Search for any of the array values
                            query.$or.push(
                                { tags: { $in: searchValue } },
                                { 'metadata.tags': { $in: searchValue } }
                            );
                        } else {
                            query.$or.push(
                                { tags: searchValue },
                                { 'metadata.tags': searchValue }
                            );
                        }
                    } else {
                        // For other properties, handle JSON strings and objects
                        let searchValue = value;
                        try {
                            if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                                const parsed = JSON.parse(value);
                                if (Array.isArray(parsed)) {
                                    // For arrays, search for documents containing any of the values
                                    query[`metadata.${key}`] = { $in: parsed };
                                    return;
                                } else if (typeof parsed === 'object' && parsed !== null) {
                                    // For objects, do a partial match
                                    Object.entries(parsed).forEach(([subKey, subValue]) => {
                                        query[`metadata.${key}.${subKey}`] = subValue;
                                    });
                                    return;
                                } else {
                                    searchValue = parsed;
                                }
                            }
                        } catch (e) {
                            // If parsing fails, use original value
                        }
                        
                        query[`metadata.${key}`] = searchValue;
                    }
                });
            }

            // Add regular tags filtering (for backward compatibility)
            if (filters.tags && filters.tags.length > 0) {
                if (!query.$or) query.$or = [];
                query.$or.push(
                    { tags: { $in: filters.tags } },
                    { 'metadata.tags': { $in: filters.tags } }
                );
            }

            // Add property existence filtering
            if (filters.propertyExists && filters.propertyExists.length > 0) {
                filters.propertyExists.forEach(property => {
                    query[`metadata.${property}`] = { $exists: true };
                });
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
                    .populate('projectId', 'name')
                    .lean(),
                Usage.countDocuments(query),
            ]);

            const result = paginate(data, total, options);

            return result;
        } catch (error) {
            logger.error('Error fetching usage:', error);
            throw error;
        }
    }

    static async getUsageStats(userId: string, period: 'daily' | 'weekly' | 'monthly', projectId?: string) {
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

            const matchCondition: any = {
                userId: userId,
                createdAt: { $gte: startDate },
            };

            if (projectId) {
                matchCondition.projectId = new mongoose.Types.ObjectId(projectId);
            }

            const stats = await Usage.aggregate([
                {
                    $match: matchCondition,
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
                    $match: matchCondition,
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
                    $match: matchCondition,
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

            return result;
        } catch (error) {
            logger.error('Error getting usage stats:', error);
            throw error;
        }
    }

    static async detectAnomalies(userId: string, projectId?: string) {
        try {
            // Build query conditions
            const baseQuery: any = { userId };
            if (projectId) {
                baseQuery.projectId = new mongoose.Types.ObjectId(projectId);
            }

            // Get recent usage
            const recentUsage = await Usage.find(baseQuery)
                .sort({ createdAt: -1 })
                .limit(100)
                .select('createdAt cost totalTokens')
                .lean();

            // Get historical average (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const historicalMatchCondition: any = {
                userId: userId,
                createdAt: { $gte: thirtyDaysAgo },
            };

            if (projectId) {
                historicalMatchCondition.projectId = new mongoose.Types.ObjectId(projectId);
            }

            const historicalStats = await Usage.aggregate([
                {
                    $match: historicalMatchCondition,
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

    static async searchUsage(userId: string, searchTerm: string, options: PaginationOptions, projectId?: string, additionalFilters?: any) {
        try {
            const page = options.page || 1;
            const limit = options.limit || 10;
            const skip = (page - 1) * limit;

            const searchQuery: any = {
                userId,
                $text: { $search: searchTerm },
            };

            if (projectId) {
                searchQuery.projectId = new mongoose.Types.ObjectId(projectId);
            }

            // Add additional filters if provided
            if (additionalFilters) {
                if (additionalFilters.service) searchQuery.service = additionalFilters.service;
                if (additionalFilters.model) searchQuery.model = additionalFilters.model;
                if (additionalFilters.minCost !== undefined || additionalFilters.maxCost !== undefined) {
                    searchQuery.cost = {};
                    if (additionalFilters.minCost !== undefined) searchQuery.cost.$gte = additionalFilters.minCost;
                    if (additionalFilters.maxCost !== undefined) searchQuery.cost.$lte = additionalFilters.maxCost;
                }
                if (additionalFilters.startDate || additionalFilters.endDate) {
                    searchQuery.createdAt = {};
                    if (additionalFilters.startDate) searchQuery.createdAt.$gte = additionalFilters.startDate;
                    if (additionalFilters.endDate) searchQuery.createdAt.$lte = additionalFilters.endDate;
                }
            }

            const [data, total] = await Promise.all([
                Usage.find(searchQuery)
                    .sort({ score: { $meta: 'textScore' } })
                    .skip(skip)
                    .limit(limit)
                    .populate('userId', 'name email')
                    .lean(),
                Usage.countDocuments(searchQuery),
            ]);

            const result = paginate(data, total, options);

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
                results.push(usage!);
            }

            return results;
        } catch (error) {
            logger.error('Error bulk tracking usage:', error);
            throw error;
        }
    }

    /**
     * Get real-time usage summary for dashboard
     */
    static async getRealTimeUsageSummary(userId: string, projectId?: string) {
        try {
            const match: any = { userId: new mongoose.Types.ObjectId(userId) };
            if (projectId) {
                match.projectId = new mongoose.Types.ObjectId(projectId);
            }

            const now = new Date();
            const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            const [currentPeriod, previousPeriod, modelBreakdown, serviceBreakdown, recentRequests] = await Promise.all([
                // Current period stats (last 24 hours)
                Usage.aggregate([
                    { $match: { ...match, createdAt: { $gte: last24Hours } } },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            totalRequests: { $sum: 1 },
                            avgResponseTime: { $avg: '$responseTime' },
                            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                            successCount: { $sum: { $cond: ['$errorOccurred', 0, 1] } }
                        }
                    }
                ]),
                // Previous period stats (24 hours before that)
                Usage.aggregate([
                    { 
                        $match: { 
                            ...match, 
                            createdAt: { 
                                $gte: new Date(last24Hours.getTime() - 24 * 60 * 60 * 1000),
                                $lt: last24Hours 
                            } 
                        } 
                    },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            totalRequests: { $sum: 1 },
                            avgResponseTime: { $avg: '$responseTime' }
                        }
                    }
                ]),
                // Model breakdown
                Usage.aggregate([
                    { $match: { ...match, createdAt: { $gte: last7Days } } },
                    {
                        $group: {
                            _id: '$model',
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            requestCount: { $sum: 1 },
                            avgResponseTime: { $avg: '$responseTime' },
                            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } }
                        }
                    },
                    { $sort: { totalCost: -1 } },
                    { $limit: 10 }
                ]),
                // Service breakdown
                Usage.aggregate([
                    { $match: { ...match, createdAt: { $gte: last7Days } } },
                    {
                        $group: {
                            _id: '$service',
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            requestCount: { $sum: 1 },
                            avgResponseTime: { $avg: '$responseTime' },
                            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } }
                        }
                    },
                    { $sort: { totalCost: -1 } }
                ]),
                // Recent requests (last 50)
                Usage.find(match)
                    .sort({ createdAt: -1 })
                    .limit(50)
                    .select('model service promptTokens completionTokens totalTokens cost responseTime errorOccurred createdAt')
                    .lean()
            ]);

            const current = currentPeriod[0] || {
                totalCost: 0, totalTokens: 0, totalRequests: 0, avgResponseTime: 0, errorCount: 0, successCount: 0
            };
            const previous = previousPeriod[0] || {
                totalCost: 0, totalTokens: 0, totalRequests: 0, avgResponseTime: 0
            };

            // Calculate percentage changes
            const costChange = previous.totalCost > 0 ? ((current.totalCost - previous.totalCost) / previous.totalCost) * 100 : 0;
            const requestChange = previous.totalRequests > 0 ? ((current.totalRequests - previous.totalRequests) / previous.totalRequests) * 100 : 0;
            const tokenChange = previous.totalTokens > 0 ? ((current.totalTokens - previous.totalTokens) / previous.totalTokens) * 100 : 0;

            return {
                currentPeriod: {
                    ...current,
                    avgResponseTime: Math.round(current.avgResponseTime || 0)
                },
                previousPeriod: {
                    ...previous,
                    avgResponseTime: Math.round(previous.avgResponseTime || 0)
                },
                changes: {
                    cost: Math.round(costChange * 100) / 100,
                    requests: Math.round(requestChange * 100) / 100,
                    tokens: Math.round(tokenChange * 100) / 100
                },
                modelBreakdown,
                serviceBreakdown,
                recentRequests: recentRequests.map(req => ({
                    ...req,
                    timestamp: req.createdAt,
                    status: req.errorOccurred ? 'error' : 'success',
                    statusCode: req.errorOccurred ? 500 : 200
                }))
            };
        } catch (error) {
            logger.error('Error getting real-time usage summary:', error);
            throw error;
        }
    }

    // New method for real-time requests monitoring
    static async getRealTimeRequests(userId: string, projectId?: string, limit: number = 100) {
        try {
            const match: any = { userId: new mongoose.Types.ObjectId(userId) };
            if (projectId) {
                match.projectId = new mongoose.Types.ObjectId(projectId);
            }

            const requests = await Usage.aggregate([
                { $match: match },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                {
                    $addFields: {
                        userName: {
                            $ifNull: [
                                { $arrayElemAt: ['$user.name', 0] },
                                { $concat: ['user_', { $substr: [{ $toString: '$userId' }, -8, 8] }] }
                            ]
                        }
                    }
                },
                {
                    $project: {
                        _id: 1,
                        model: 1,
                        service: 1,
                        promptTokens: 1,
                        completionTokens: 1,
                        totalTokens: 1,
                        cost: 1,
                        responseTime: 1,
                        errorOccurred: 1,
                        errorMessage: 1,
                        createdAt: 1,
                        ipAddress: 1,
                        userAgent: 1,
                        metadata: 1,
                        userName: 1
                    }
                },
                { $sort: { createdAt: -1 } },
                { $limit: limit }
            ]);

            return requests.map(req => ({
                id: req._id,
                timestamp: req.createdAt,
                model: req.model,
                service: req.service,
                status: req.errorOccurred ? 'error' : 'success',
                statusCode: req.errorOccurred ? 500 : 200,
                latency: Math.round(req.responseTime),
                totalTokens: req.totalTokens,
                cost: req.cost,
                user: req.userName,
                errorMessage: req.errorMessage,
                ipAddress: req.ipAddress,
                userAgent: req.userAgent,
                metadata: req.metadata
            }));
        } catch (error) {
            logger.error('Error getting real-time requests:', error);
            throw error;
        }
    }

    // New method for usage analytics with filters
    static async getUsageAnalytics(userId: string, filters: {
        timeRange?: '1h' | '24h' | '7d' | '30d';
        status?: 'all' | 'success' | 'error';
        model?: string;
        service?: string;
        projectId?: string;
    } = {}) {
        try {
            const match: any = { userId: new mongoose.Types.ObjectId(userId) };
            
            // Time range filter
            if (filters.timeRange) {
                const now = new Date();
                let startDate: Date;
                switch (filters.timeRange) {
                    case '1h':
                        startDate = new Date(now.getTime() - 60 * 60 * 1000);
                        break;
                    case '24h':
                        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                        break;
                    case '7d':
                        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                        break;
                    case '30d':
                        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                        break;
                    default:
                        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                }
                match.createdAt = { $gte: startDate };
            }

            // Status filter
            if (filters.status && filters.status !== 'all') {
                match.errorOccurred = filters.status === 'error';
            }

            // Model filter
            if (filters.model) {
                match.model = filters.model;
            }

            // Service filter
            if (filters.service) {
                match.service = filters.service;
            }

            // Project filter
            if (filters.projectId) {
                match.projectId = new mongoose.Types.ObjectId(filters.projectId);
            }

            const [requests, stats] = await Promise.all([
                Usage.aggregate([
                    { $match: match },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'userId',
                            foreignField: '_id',
                            as: 'user'
                        }
                    },
                    {
                        $addFields: {
                            userName: {
                                $ifNull: [
                                    { $arrayElemAt: ['$user.name', 0] },
                                    { $concat: ['user_', { $substr: [{ $toString: '$userId' }, -8, 8] }] }
                                ]
                            }
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            model: 1,
                            service: 1,
                            promptTokens: 1,
                            completionTokens: 1,
                            totalTokens: 1,
                            cost: 1,
                            responseTime: 1,
                            errorOccurred: 1,
                            createdAt: 1,
                            userName: 1
                        }
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1000 }
                ]),
                Usage.aggregate([
                    { $match: match },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            totalRequests: { $sum: 1 },
                            avgResponseTime: { $avg: '$responseTime' },
                            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                            successCount: { $sum: { $cond: ['$errorOccurred', 0, 1] } }
                        }
                    }
                ])
            ]);

            const statsData = stats[0] || {
                totalCost: 0, totalTokens: 0, totalRequests: 0, avgResponseTime: 0, errorCount: 0, successCount: 0
            };

            return {
                requests: requests.map(req => ({
                    id: req._id,
                    timestamp: req.createdAt,
                    model: req.model,
                    service: req.service,
                    status: req.errorOccurred ? 'error' : 'success',
                    statusCode: req.errorOccurred ? 500 : 200,
                    latency: Math.round(req.responseTime),
                    totalTokens: req.totalTokens,
                    cost: req.cost,
                    user: req.userName
                })),
                stats: {
                    ...statsData,
                    avgResponseTime: Math.round(statsData.avgResponseTime || 0),
                    successRate: statsData.totalRequests > 0 ? 
                        ((statsData.successCount / statsData.totalRequests) * 100).toFixed(1) : '0.0'
                }
            };
        } catch (error) {
            logger.error('Error getting usage analytics:', error);
            throw error;
        }
    }

    // CLI-specific analytics method
    static async getCLIAnalytics(userId: string, options: {
        days?: number;
        project?: string;
        user?: string;
    } = {}) {
        try {
            const { days = 30, project } = options;
            
            // Calculate date range
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));
            const previousStartDate = new Date(startDate.getTime() - (days * 24 * 60 * 60 * 1000));

            // Build match criteria
            const match: any = { 
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startDate, $lte: endDate }
            };

            if (project) {
                // Check if project is a valid ObjectId, otherwise treat as project name
                if (mongoose.Types.ObjectId.isValid(project)) {
                    match.projectId = new mongoose.Types.ObjectId(project);
                } else {
                    // Treat as project name and look up the project ID
                    const projectDoc = await mongoose.model('Project').findOne({ 
                        name: project, 
                        userId: new mongoose.Types.ObjectId(userId) 
                    });
                    if (projectDoc) {
                        match.projectId = projectDoc._id;
                    } else {
                        // If project not found, return empty results
                        return {
                            totalCost: { currentPeriod: 0, previousPeriod: 0, change: 0, budget: 0 },
                            tokenUsage: { total: 0, input: 0, output: 0, inputPercentage: 0, outputPercentage: 0 },
                            topModelsBySpend: [],
                            teamUsage: [],
                            insights: [{ type: 'warning', message: `Project "${project}" not found` }]
                        };
                    }
                }
            }

            // Get current period data
            const currentPeriodData = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        inputTokens: { $sum: '$promptTokens' },
                        outputTokens: { $sum: '$completionTokens' }
                    }
                }
            ]);

            // Get previous period data for comparison
            const previousMatch = { 
                ...match,
                createdAt: { $gte: previousStartDate, $lt: startDate }
            };
            const previousPeriodData = await Usage.aggregate([
                { $match: previousMatch },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 }
                    }
                }
            ]);

            // Get top models by spend
            const topModelsData = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$model',
                        totalCost: { $sum: '$cost' },
                        requests: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        avgCostPerRequest: { $avg: '$cost' }
                    }
                },
                { $sort: { totalCost: -1 } },
                { $limit: 10 }
            ]);

            // Get team member usage
            const teamUsageData = await Usage.aggregate([
                { $match: match },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                {
                    $group: {
                        _id: '$userId',
                        name: { $first: { $arrayElemAt: ['$user.name', 0] } },
                        email: { $first: { $arrayElemAt: ['$user.email', 0] } },
                        totalCost: { $sum: '$cost' },
                        requests: { $sum: 1 },
                        topModel: { $first: '$model' },
                        lastActive: { $max: '$createdAt' }
                    }
                },
                { $sort: { totalCost: -1 } },
                { $limit: 10 }
            ]);

            // Calculate totals
            const currentPeriod = currentPeriodData[0] || { totalCost: 0, totalTokens: 0, totalRequests: 0, inputTokens: 0, outputTokens: 0 };
            const previousPeriod = previousPeriodData[0] || { totalCost: 0, totalTokens: 0, totalRequests: 0 };
            
            const totalCost = currentPeriod.totalCost || 0;
            const previousTotalCost = previousPeriod.totalCost || 0;
            const change = previousTotalCost > 0 ? ((totalCost - previousTotalCost) / previousTotalCost) * 100 : 0;

            // Calculate token percentages
            const totalTokens = currentPeriod.totalTokens || 0;
            const inputTokens = currentPeriod.inputTokens || 0;
            const outputTokens = currentPeriod.outputTokens || 0;
            const inputPercentage = totalTokens > 0 ? (inputTokens / totalTokens) * 100 : 0;
            const outputPercentage = totalTokens > 0 ? (outputTokens / totalTokens) * 100 : 0;

            // Calculate model percentages
            const totalModelCost = topModelsData.reduce((sum, model) => sum + model.totalCost, 0);
            const topModelsBySpend = topModelsData.map(model => ({
                model: model._id,
                totalCost: model.totalCost,
                requests: model.requests,
                percentage: totalModelCost > 0 ? (model.totalCost / totalModelCost) * 100 : 0,
                details: {
                    avgCostPerRequest: model.avgCostPerRequest,
                    totalTokens: model.totalTokens,
                    successRate: 95.0 // Default success rate
                }
            }));

            // Calculate team percentages
            const totalTeamCost = teamUsageData.reduce((sum, member) => sum + member.totalCost, 0);
            const teamUsage = teamUsageData.map(member => ({
                name: member.name || member.email || 'Unknown User',
                email: member.email,
                totalCost: member.totalCost,
                requests: member.requests,
                percentage: totalTeamCost > 0 ? (member.totalCost / totalTeamCost) * 100 : 0,
                details: {
                    topModel: member.topModel,
                    avgCostPerRequest: member.totalCost / member.requests,
                    lastActive: member.lastActive
                }
            }));

            // Generate insights
            const insights = [];
            if (change > 10) {
                insights.push({
                    type: 'warning',
                    message: `Cost increased by ${change.toFixed(1)}% compared to previous period`
                });
            } else if (change < -10) {
                insights.push({
                    type: 'success',
                    message: `Cost decreased by ${Math.abs(change).toFixed(1)}% compared to previous period`
                });
            }

            if (inputPercentage > 80) {
                insights.push({
                    type: 'suggestion',
                    message: 'High input token usage - consider optimizing prompts for cost reduction'
                });
            }

            if (topModelsBySpend.length > 0 && topModelsBySpend[0].totalCost > totalCost * 0.5) {
                insights.push({
                    type: 'suggestion',
                    message: `${topModelsBySpend[0].model} accounts for over 50% of costs - consider alternatives`
                });
            }

            return {
                project: project || null,
                totalCost: {
                    currentPeriod: totalCost,
                    previousPeriod: previousTotalCost,
                    change: change,
                    budget: await this.getUserBudget(userId) || 0
                },
                tokenUsage: {
                    total: totalTokens,
                    input: inputTokens,
                    output: outputTokens,
                    inputPercentage: inputPercentage,
                    outputPercentage: outputPercentage
                },
                topModelsBySpend: topModelsBySpend,
                teamUsage: teamUsage,
                insights: insights
            };
        } catch (error) {
            logger.error('Error getting CLI analytics:', error);
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

    // Add a robust createUsage method for direct usage
    static async createUsage(data: any, req?: any) {
        const mongoose = require('mongoose');
        const jwt = require('jsonwebtoken');

        try {
            console.log('Creating usage with data:', JSON.stringify(data, null, 2));

            // Get userId from request like in usage.controller.ts
            let userId = getUserIdFromToken(req);
            if (!userId && req) {
                // Try to get from JWT token first
                const authHeader = req.headers?.authorization || '';
                const token = authHeader.replace(/^Bearer\s+/, '');
                if (token) {
                    try {
                        const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
                        const decoded: any = jwt.verify(token, JWT_SECRET);
                        userId = decoded.id || decoded.userId;
                    } catch (err) {
                        // Token verification failed, continue with other methods
                    }
                }

                // Fallback to req.user or req.userId
                if (!userId) {
                    userId = req.user?.id || req.userId;
                }
            }

            if (!userId) {
                throw new Error('User authentication required - no userId found');
            }

            // Ensure all required fields are present
            const usageData = {
                userId: userId,
                service: data.service || data.provider,
                model: data.model,
                prompt: data.prompt || '',
                completion: data.completion,
                promptTokens: data.promptTokens,
                completionTokens: data.completionTokens,
                totalTokens: data.totalTokens,
                cost: data.cost ?? data.estimatedCost ?? 0,
                responseTime: data.responseTime ?? 0,
                metadata: data.metadata || {},
                tags: data.tags || [],
                optimizationApplied: data.optimizationApplied ?? false,
                errorOccurred: data.errorOccurred ?? false,
                errorMessage: data.errorMessage,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent
            };

            // Check if userId is valid ObjectId
            if (!mongoose.Types.ObjectId.isValid(usageData.userId)) {
                throw new Error(`Invalid userId: ${usageData.userId}`);
            }

            console.log('Validated usage data:', usageData);
            const usage = new Usage(usageData);
            const savedUsage = await usage.save();
            console.log('Usage saved successfully:', savedUsage._id);
            return savedUsage;
        } catch (error: any) {
            console.error('Error in createUsage:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                errors: error.errors
            });
            throw error;
        }
    }

    /**
     * Get usage by ID and verify ownership
     */
    static async getPropertyAnalytics(userId: string, options: {
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
        groupBy: string; // The property to group by
    }) {
        try {
            const matchStage: any = { userId: new mongoose.Types.ObjectId(userId) };
            
            if (options.projectId && options.projectId !== 'all') {
                matchStage.projectId = new mongoose.Types.ObjectId(options.projectId);
            }
            
            if (options.startDate || options.endDate) {
                matchStage.createdAt = {};
                if (options.startDate) matchStage.createdAt.$gte = options.startDate;
                if (options.endDate) matchStage.createdAt.$lte = options.endDate;
            }

            const pipeline: any[] = [
                { $match: matchStage },
                {
                    $group: {
                        _id: `$metadata.${options.groupBy}`,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        averageCost: { $avg: '$cost' },
                        averageTokens: { $avg: '$totalTokens' },
                        averageResponseTime: { $avg: '$responseTime' }
                    }
                },
                {
                    $project: {
                        propertyValue: '$_id',
                        totalCost: { $round: ['$totalCost', 6] },
                        totalTokens: 1,
                        totalRequests: 1,
                        averageCost: { $round: ['$averageCost', 6] },
                        averageTokens: { $round: ['$averageTokens', 0] },
                        averageResponseTime: { $round: ['$averageResponseTime', 0] },
                        _id: 0
                    }
                },
                { $sort: { totalCost: -1 } }
            ];

            const results = await Usage.aggregate(pipeline);
            
            // Calculate totals
            const totals = results.reduce((acc, item) => ({
                totalCost: acc.totalCost + item.totalCost,
                totalTokens: acc.totalTokens + item.totalTokens,
                totalRequests: acc.totalRequests + item.totalRequests
            }), { totalCost: 0, totalTokens: 0, totalRequests: 0 });

            return {
                groupBy: options.groupBy,
                data: results,
                totals,
                summary: {
                    uniqueValues: results.length,
                    totalCost: Math.round(totals.totalCost * 1000000) / 1000000,
                    totalTokens: totals.totalTokens,
                    totalRequests: totals.totalRequests
                }
            };
        } catch (error) {
            logger.error('Error getting property analytics:', error);
            throw error;
        }
    }

    static async getAvailableProperties(userId: string, options: {
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
    }) {
        try {
            const matchStage: any = { userId: new mongoose.Types.ObjectId(userId) };
            
            if (options.projectId && options.projectId !== 'all') {
                matchStage.projectId = new mongoose.Types.ObjectId(options.projectId);
            }
            
            if (options.startDate || options.endDate) {
                matchStage.createdAt = {};
                if (options.startDate) matchStage.createdAt.$gte = options.startDate;
                if (options.endDate) matchStage.createdAt.$lte = options.endDate;
            }

            // Get regular metadata properties
            const metadataPipeline: any[] = [
                { $match: matchStage },
                { $project: { metadata: { $objectToArray: '$metadata' } } },
                { $unwind: '$metadata' },
                {
                    $group: {
                        _id: '$metadata.k',
                        count: { $sum: 1 },
                        sampleValues: { $addToSet: '$metadata.v' }
                    }
                },
                {
                    $project: {
                        property: '$_id',
                        count: 1,
                        sampleValues: { $slice: ['$sampleValues', 10] },
                        type: 'metadata',
                        _id: 0
                    }
                }
            ];

            // Get tags as a separate property - simplified pipeline
            const tagsPipeline: any[] = [
                { $match: { ...matchStage, $or: [{ tags: { $exists: true, $ne: [] } }, { 'metadata.tags': { $exists: true, $ne: [] } }] } },
                {
                    $project: {
                        allTags: {
                            $concatArrays: [
                                { $ifNull: ['$tags', []] },
                                { $ifNull: ['$metadata.tags', []] }
                            ]
                        }
                    }
                },
                { $unwind: '$allTags' },
                {
                    $group: {
                        _id: '$allTags',
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: {
                        _id: null,
                        property: { $first: 'tags' },
                        count: { $sum: '$count' },
                        sampleValues: { $push: '$_id' },
                        type: { $first: 'tags' }
                    }
                },
                {
                    $project: {
                        property: 1,
                        count: 1,
                        sampleValues: { $slice: ['$sampleValues', 10] },
                        type: 1,
                        _id: 0
                    }
                }
            ];

            const [metadataResults, tagsResults] = await Promise.all([
                Usage.aggregate(metadataPipeline),
                Usage.aggregate(tagsPipeline)
            ]);

            const filteredMetadata = metadataResults.filter(item => 
                item.property && 
                !item.property.startsWith('workspace') && 
                !item.property.startsWith('requestType') &&
                !item.property.startsWith('executionTime') &&
                !item.property.startsWith('contextFiles') &&
                !item.property.startsWith('generatedFiles')
            );

            const results = [...filteredMetadata, ...tagsResults].sort((a, b) => b.count - a.count);
            return results;
        } catch (error) {
            logger.error('Error getting available properties:', error);
            throw error;
        }
    }

    static async updateUsageProperties(usageId: string, userId: string, properties: Record<string, any>): Promise<IUsage | null> {
        try {
            const usage = await Usage.findOne({
                _id: usageId,
                userId: userId
            });

            if (!usage) {
                return null;
            }

            // Merge new properties with existing metadata
            const updatedMetadata = {
                ...usage.metadata,
                ...properties
            };

            const updatedUsage = await Usage.findByIdAndUpdate(
                usageId,
                { 
                    metadata: updatedMetadata,
                    updatedAt: new Date()
                },
                { new: true }
            ).lean();

            logger.info('Usage properties updated:', {
                usageId,
                userId,
                newProperties: Object.keys(properties),
                totalProperties: Object.keys(updatedMetadata).length
            });

            return updatedUsage;
        } catch (error) {
            logger.error('Error updating usage properties:', error);
            throw error;
        }
    }

    static async getUsageById(usageId: string, userId: string): Promise<IUsage | null> {
        try {
            const usage = await Usage.findOne({
                _id: usageId,
                userId: userId
            }).lean();

            return usage;
        } catch (error) {
            logger.error('Error getting usage by ID:', error);
            throw error;
        }
    }

    /**
     * Update usage record
     */
    static async updateUsage(usageId: string, updateData: any): Promise<IUsage | null> {
        try {
            const updatedUsage = await Usage.findByIdAndUpdate(
                usageId,
                {
                    ...updateData,
                    updatedAt: new Date()
                },
                {
                    new: true,
                    runValidators: true
                }
            ).lean();

            return updatedUsage;
        } catch (error) {
            logger.error('Error updating usage:', error);
            throw error;
        }
    }

    /**
     * Delete usage record
     */
    static async deleteUsage(usageId: string): Promise<{ success: boolean, message: string }> {
        try {
            await Usage.findByIdAndDelete(usageId);
            return { success: true, message: 'Usage deleted successfully' };
        } catch (error) {
            logger.error('Error deleting usage:', error);
            throw error;
        }
    }

    /**
     * Get user budget from settings
     */
    private static async getUserBudget(userId: string): Promise<number> {
        try {
            // This would typically come from user settings or billing configuration
            // For now, return a default budget based on user tier
            const user = await mongoose.model('User').findById(userId).select('subscriptionTier billingPlan').lean();
            
            if (user && typeof user === 'object' && 'subscriptionTier' in user) {
                if (user.subscriptionTier === 'enterprise') {
                    return 1000; // $1000 budget for enterprise users
                } else if (user.subscriptionTier === 'pro') {
                    return 500; // $500 budget for pro users
                }
            }
            return 100; // $100 budget for basic users
        } catch (error) {
            logger.error('Error getting user budget:', error);
            return 0;
        }
    }

    /**
     * Get recent usage records for a user
     */
    static async getRecentUsageForUser(userId: string, limit: number = 10): Promise<any[]> {
        try {
            const { Usage } = await import('../models');
            
            const recentUsage = await Usage.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            return recentUsage;
        } catch (error) {
            logger.error('Error getting recent usage:', error);
            return [];
        }
    }
}