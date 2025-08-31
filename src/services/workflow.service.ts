import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { loggingService } from '../services/logging.service';

export interface WorkflowSummary {
    workflowId: string;
    workflowName: string;
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    averageCost: number;
    steps: WorkflowStep[];
    startTime: Date;
    endTime: Date;
    duration: number; // in milliseconds
}

export interface WorkflowStep {
    step: string;
    sequence: number;
    cost: number;
    tokens: number;
    responseTime: number;
    model: string;
    service: string;
    timestamp: Date;
}

export interface WorkflowAnalytics {
    totalWorkflows: number;
    totalCost: number;
    averageWorkflowCost: number;
    topWorkflowTypes: Array<{
        workflowName: string;
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

export class WorkflowService {
    /**
     * Get detailed workflow information by workflow ID
     */
    static async getWorkflowDetails(workflowId: string, userId?: string): Promise<WorkflowSummary | null> {
        try {
            const query: any = { workflowId };
            if (userId) {
                query.userId = new mongoose.Types.ObjectId(userId);
            }

            const workflowRequests = await Usage.find(query)
                .sort({ workflowSequence: 1, createdAt: 1 })
                .lean();

            if (workflowRequests.length === 0) {
                return null;
            }

            // Calculate totals
            const totalCost = workflowRequests.reduce((sum, req) => sum + req.cost, 0);
            const totalTokens = workflowRequests.reduce((sum, req) => sum + req.totalTokens, 0);
            const requestCount = workflowRequests.length;
            const averageCost = totalCost / requestCount;

            // Build steps
            const steps: WorkflowStep[] = workflowRequests.map((req, index) => ({
                step: req.workflowStep || `/step-${index + 1}`,
                sequence: req.workflowSequence || index + 1,
                cost: req.cost,
                tokens: req.totalTokens,
                responseTime: req.responseTime,
                model: req.model,
                service: req.service,
                timestamp: req.createdAt
            }));

            // Calculate duration
            const startTime = workflowRequests[0].createdAt;
            const endTime = workflowRequests[workflowRequests.length - 1].createdAt;
            const duration = endTime.getTime() - startTime.getTime();

            return {
                workflowId,
                workflowName: workflowRequests[0].workflowName || 'Unknown Workflow',
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
            loggingService.error('Error getting workflow details:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get all workflows for a user with pagination
     */
    static async getUserWorkflows(
        userId: string,
        options: {
            page?: number;
            limit?: number;
            workflowName?: string;
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<{
        workflows: WorkflowSummary[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalItems: number;
            itemsPerPage: number;
        };
    }> {
        try {
            const { page = 1, limit = 20, workflowName, startDate, endDate } = options;
            const skip = (page - 1) * limit;

            // Build match query
            const matchQuery: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: { $exists: true, $ne: null }
            };

            if (workflowName) {
                matchQuery.workflowName = { $regex: workflowName, $options: 'i' };
            }

            if (startDate || endDate) {
                matchQuery.createdAt = {};
                if (startDate) matchQuery.createdAt.$gte = startDate;
                if (endDate) matchQuery.createdAt.$lte = endDate;
            }

            // Aggregate workflows
            const pipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: '$workflowId',
                        workflowName: { $first: '$workflowName' },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        requestCount: { $sum: 1 },
                        startTime: { $min: '$createdAt' },
                        endTime: { $max: '$createdAt' },
                        steps: {
                            $push: {
                                step: '$workflowStep',
                                sequence: '$workflowSequence',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                responseTime: '$responseTime',
                                model: '$model',
                                service: '$service',
                                timestamp: '$createdAt'
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

            const [workflows, totalCount] = await Promise.all([
                Usage.aggregate(pipeline),
                Usage.aggregate([
                    { $match: matchQuery },
                    { $group: { _id: '$workflowId' } },
                    { $count: 'total' }
                ])
            ]);

            const totalItems = totalCount[0]?.total || 0;
            const totalPages = Math.ceil(totalItems / limit);

            // Format workflows
            const formattedWorkflows: WorkflowSummary[] = workflows.map(wf => ({
                workflowId: wf._id,
                workflowName: wf.workflowName || 'Unknown Workflow',
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
                workflows: formattedWorkflows,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems,
                    itemsPerPage: limit
                }
            };

        } catch (error) {
            loggingService.error('Error getting user workflows:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get workflow analytics for a user
     */
    static async getWorkflowAnalytics(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<WorkflowAnalytics> {
        try {
            const { startDate, endDate } = options;

            // Build match query
            const matchQuery: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: { $exists: true, $ne: null }
            };

            if (startDate || endDate) {
                matchQuery.createdAt = {};
                if (startDate) matchQuery.createdAt.$gte = startDate;
                if (endDate) matchQuery.createdAt.$lte = endDate;
            }

            // Get workflow type analytics
            const workflowTypesPipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: '$workflowName',
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        uniqueWorkflows: { $addToSet: '$workflowId' }
                    }
                },
                {
                    $addFields: {
                        workflowCount: { $size: '$uniqueWorkflows' },
                        averageCost: { $divide: ['$totalCost', '$workflowCount'] }
                    }
                },
                { $sort: { totalCost: -1 as -1 } },
                { $limit: 10 }
            ];

            // Get step analytics
            const stepsPipeline = [
                { $match: { ...matchQuery, workflowStep: { $exists: true, $ne: null } } },
                {
                    $group: {
                        _id: '$workflowStep',
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

            // Get overall stats
            const overallPipeline = [
                { $match: matchQuery },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        uniqueWorkflows: { $addToSet: '$workflowId' }
                    }
                },
                {
                    $addFields: {
                        totalWorkflows: { $size: '$uniqueWorkflows' },
                        averageWorkflowCost: { $divide: ['$totalCost', { $size: '$uniqueWorkflows' }] }
                    }
                }
            ];

            const [workflowTypes, steps, overall] = await Promise.all([
                Usage.aggregate(workflowTypesPipeline),
                Usage.aggregate(stepsPipeline),
                Usage.aggregate(overallPipeline)
            ]);

            const overallStats = overall[0] || { totalWorkflows: 0, totalCost: 0, averageWorkflowCost: 0 };

            return {
                totalWorkflows: overallStats.totalWorkflows,
                totalCost: overallStats.totalCost,
                averageWorkflowCost: overallStats.averageWorkflowCost,
                topWorkflowTypes: workflowTypes.map(wt => ({
                    workflowName: wt._id || 'Unknown',
                    count: wt.workflowCount,
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
            loggingService.error('Error getting workflow analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get workflow comparison data
     */
    static async compareWorkflows(
        workflowIds: string[],
        userId?: string
    ): Promise<WorkflowSummary[]> {
        try {
            const workflows = await Promise.all(
                workflowIds.map(id => this.getWorkflowDetails(id, userId))
            );

            return workflows.filter(wf => wf !== null) as WorkflowSummary[];

        } catch (error) {
            loggingService.error('Error comparing workflows:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
}