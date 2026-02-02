import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface AgentTraceSummary {
    traceId: string;
    traceName: string;
    automationPlatform?: 'zapier' | 'make' | 'n8n';
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    averageCost: number;
    steps: AgentTraceStep[];
    startTime: Date;
    endTime: Date;
    duration: number; // in milliseconds
}

export interface AgentTraceStep {
    step: string;
    sequence: number;
    cost: number;
    tokens: number;
    responseTime: number;
    model: string;
    service: string;
    timestamp: Date;
}

export interface AgentTraceAnalytics {
    totalTraces: number;
    totalCost: number;
    averageTraceCost: number;
    topTraceTypes: Array<{
        traceName: string;
        count: number;
        totalCost: number;
        averageCost: number;
    }>;
    costByStep: Array<{
        step: string;
        totalCost: number;
        count: number;
        averageCost: number;
    }>;
}

export class AgentTraceService {
    /**
     * Get detailed agent trace information by trace ID
     */
    static async getAgentTraceDetails(traceId: string, userId?: string): Promise<AgentTraceSummary | null> {
        try {
            let query: any;
            if (traceId.includes('_') && ['zapier', 'make', 'n8n'].some(platform => traceId.startsWith(platform + '_'))) {
                const [platform, actualTraceId] = traceId.split('_', 2);
                query = {
                    automationPlatform: platform,
                    $or: [
                        { traceId: actualTraceId },
                        { traceName: actualTraceId }
                    ]
                };
            } else {
                query = { traceId };
            }

            if (userId) {
                query.userId = new mongoose.Types.ObjectId(userId);
            }

            const traceRequests = await Usage.find(query)
                .sort({ traceSequence: 1, createdAt: 1 })
                .lean();

            if (traceRequests.length === 0) {
                return null;
            }

            const totalCost = traceRequests.reduce((sum, req) => sum + req.cost, 0);
            const totalTokens = traceRequests.reduce((sum, req) => sum + req.totalTokens, 0);
            const requestCount = traceRequests.length;
            const averageCost = totalCost / requestCount;

            const steps: AgentTraceStep[] = traceRequests.map((req, index) => ({
                step: req.traceStep || req.traceName || `/step-${index + 1}`,
                sequence: req.traceSequence || index + 1,
                cost: req.cost,
                tokens: req.totalTokens,
                responseTime: req.responseTime || 0,
                model: req.model,
                service: req.service,
                timestamp: req.createdAt
            }));

            const startTime = traceRequests[0].createdAt;
            const endTime = traceRequests[traceRequests.length - 1].createdAt;
            const duration = endTime.getTime() - startTime.getTime();

            return {
                traceId,
                traceName: traceRequests[0].traceName || 'Unknown Trace',
                automationPlatform: traceRequests[0].automationPlatform || undefined,
                totalCost,
                totalTokens,
                requestCount,
                averageCost,
                steps,
                startTime,
                endTime,
                duration
            };
        } catch (error) {
            loggingService.error('Error getting agent trace details:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get all agent traces for a user with pagination
     */
    static async getAgentTraces(
        userId: string,
        options: {
            page?: number;
            limit?: number;
            traceName?: string;
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<{
        traces: AgentTraceSummary[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalItems: number;
            itemsPerPage: number;
        };
    }> {
        try {
            const { page = 1, limit = 20, traceName, startDate, endDate } = options;
            const skip = (page - 1) * limit;

            const matchQuery: any = {
                userId: new mongoose.Types.ObjectId(userId),
                $or: [
                    { traceId: { $exists: true, $ne: null } },
                    { automationPlatform: { $exists: true, $ne: null } }
                ]
            };

            if (traceName) {
                matchQuery.traceName = { $regex: traceName, $options: 'i' };
            }

            if (startDate || endDate) {
                matchQuery.createdAt = {};
                if (startDate) matchQuery.createdAt.$gte = startDate;
                if (endDate) matchQuery.createdAt.$lte = endDate;
            }

            const pipeline = [
                { $match: matchQuery },
                {
                    $addFields: {
                        traceKey: {
                            $cond: {
                                if: { $ne: ['$automationPlatform', null] },
                                then: {
                                    $concat: [
                                        '$automationPlatform',
                                        '_',
                                        { $ifNull: ['$traceId', '$traceName'] }
                                    ]
                                },
                                else: { $ifNull: ['$traceId', { $concat: ['trace_', { $ifNull: ['$traceName', 'unknown'] }] }] }
                            }
                        }
                    }
                },
                {
                    $group: {
                        _id: '$traceKey',
                        traceId: { $first: '$traceId' },
                        traceName: { $first: '$traceName' },
                        automationPlatform: { $first: '$automationPlatform' },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        requestCount: { $sum: 1 },
                        startTime: { $min: '$createdAt' },
                        endTime: { $max: '$createdAt' },
                        steps: {
                            $push: {
                                step: '$traceStep',
                                sequence: '$traceSequence',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                responseTime: '$responseTime',
                                model: '$model',
                                service: '$service',
                                timestamp: '$createdAt',
                                automationPlatform: '$automationPlatform'
                            }
                        }
                    }
                },
                {
                    $addFields: {
                        averageCost: { $divide: ['$totalCost', '$requestCount'] },
                        duration: { $subtract: ['$endTime', '$startTime'] }
                    }
                },
                { $sort: { endTime: -1 as -1 } },
                { $skip: skip },
                { $limit: limit }
            ];

            const [traces, totalCount] = await Promise.all([
                Usage.aggregate(pipeline),
                Usage.aggregate([
                    { $match: matchQuery },
                    {
                        $addFields: {
                            traceKey: {
                                $cond: {
                                    if: { $ne: ['$automationPlatform', null] },
                                    then: {
                                        $concat: [
                                            '$automationPlatform',
                                            '_',
                                            { $ifNull: ['$traceId', '$traceName'] }
                                        ]
                                    },
                                    else: { $ifNull: ['$traceId', { $concat: ['trace_', { $ifNull: ['$traceName', 'unknown'] }] }] }
                                }
                            }
                        }
                    },
                    { $group: { _id: '$traceKey' } },
                    { $count: 'total' }
                ])
            ]);

            const totalItems = totalCount[0]?.total || 0;
            const totalPages = Math.ceil(totalItems / limit);

            const formattedTraces: AgentTraceSummary[] = traces.map(wf => ({
                traceId: wf._id,
                traceName: wf.traceName || 'Unknown Trace',
                automationPlatform: wf.automationPlatform || undefined,
                totalCost: wf.totalCost,
                totalTokens: wf.totalTokens,
                requestCount: wf.requestCount,
                averageCost: wf.averageCost,
                steps: wf.steps.sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0)),
                startTime: wf.startTime,
                endTime: wf.endTime,
                duration: wf.duration
            }));

            return {
                traces: formattedTraces,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems,
                    itemsPerPage: limit
                }
            };
        } catch (error) {
            loggingService.error('Error getting agent traces:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get agent trace analytics for a user
     */
    static async getAgentTraceAnalytics(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<AgentTraceAnalytics> {
        try {
            const { startDate, endDate } = options;

            const matchQuery: any = {
                userId: new mongoose.Types.ObjectId(userId),
                traceId: { $exists: true, $ne: null }
            };

            if (startDate || endDate) {
                matchQuery.createdAt = {};
                if (startDate) matchQuery.createdAt.$gte = startDate;
                if (endDate) matchQuery.createdAt.$lte = endDate;
            }

            const traceTypesPipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: '$traceName',
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        uniqueTraces: { $addToSet: '$traceId' }
                    }
                },
                {
                    $addFields: {
                        traceCount: { $size: '$uniqueTraces' },
                        averageCost: { $divide: ['$totalCost', '$traceCount'] }
                    }
                },
                { $sort: { totalCost: -1 as -1 } },
                { $limit: 10 }
            ];

            const stepsPipeline = [
                { $match: { ...matchQuery, traceStep: { $exists: true, $ne: null } } },
                {
                    $group: {
                        _id: '$traceStep',
                        totalCost: { $sum: '$cost' },
                        count: { $sum: 1 }
                    }
                },
                {
                    $addFields: {
                        averageCost: { $divide: ['$totalCost', '$count'] }
                    }
                },
                { $sort: { totalCost: -1 as -1 } },
                { $limit: 10 }
            ];

            const overallPipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        uniqueTraces: { $addToSet: '$traceId' }
                    }
                },
                {
                    $addFields: {
                        totalTraces: { $size: '$uniqueTraces' },
                        averageTraceCost: { $divide: ['$totalCost', { $size: '$uniqueTraces' }] }
                    }
                }
            ];

            const [traceTypes, steps, overall] = await Promise.all([
                Usage.aggregate(traceTypesPipeline),
                Usage.aggregate(stepsPipeline),
                Usage.aggregate(overallPipeline)
            ]);

            const overallStats = overall[0] || { totalTraces: 0, totalCost: 0, averageTraceCost: 0 };

            return {
                totalTraces: overallStats.totalTraces,
                totalCost: overallStats.totalCost,
                averageTraceCost: overallStats.averageTraceCost,
                topTraceTypes: traceTypes.map(wt => ({
                    traceName: wt._id || 'Unknown',
                    count: wt.traceCount,
                    totalCost: wt.totalCost,
                    averageCost: wt.averageCost
                })),
                costByStep: steps.map(step => ({
                    step: step._id || 'Unknown Step',
                    totalCost: step.totalCost,
                    count: step.count,
                    averageCost: step.averageCost
                }))
            };
        } catch (error) {
            loggingService.error('Error getting agent trace analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Compare agent traces
     */
    static async compareAgentTraces(
        traceIds: string[],
        userId?: string
    ): Promise<AgentTraceSummary[]> {
        try {
            const traces = await Promise.all(
                traceIds.map(id => this.getAgentTraceDetails(id, userId))
            );

            return traces.filter(t => t !== null) as AgentTraceSummary[];
        } catch (error) {
            loggingService.error('Error comparing agent traces:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
}
