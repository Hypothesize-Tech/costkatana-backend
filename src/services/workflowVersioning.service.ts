import mongoose from 'mongoose';
import { WorkflowVersion, IWorkflowVersion } from '../models/WorkflowVersion';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface WorkflowVersionComparison {
    version1: IWorkflowVersion;
    version2: IWorkflowVersion;
    costDifference: number;
    costDifferencePercentage: number;
    executionDifference: number;
    structureChanges: {
        stepsAdded: number;
        stepsRemoved: number;
        stepsModified: number;
        modelsChanged: number;
    };
    efficiencyChange: 'improved' | 'degraded' | 'stable';
}

export class WorkflowVersioningService {
    /**
     * Create a new workflow version snapshot
     */
    static async createWorkflowVersion(
        userId: string,
        workflowId: string,
        workflowName: string,
        platform: 'zapier' | 'make' | 'n8n',
        structure: {
            stepCount: number;
            aiStepCount: number;
            stepTypes: string[];
            complexityScore: number;
        }
    ): Promise<IWorkflowVersion> {
        try {
            // Get the latest version
            const latestVersion = await WorkflowVersion.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId
            }).sort({ version: -1 });

            const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

            // Calculate cost metrics from last 7 days
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const costMetrics = await this.calculateCostMetrics(userId, workflowId, sevenDaysAgo);

            // Calculate changes from previous version
            const changes = latestVersion ? this.calculateChanges(latestVersion, structure, costMetrics) : undefined;

            const version = new WorkflowVersion({
                userId: new mongoose.Types.ObjectId(userId),
                workflowId,
                workflowName,
                platform,
                version: newVersionNumber,
                previousVersionId: latestVersion?._id,
                costMetrics,
                structure,
                changes
            });

            await version.save();

            loggingService.info('Workflow version created', {
                component: 'WorkflowVersioningService',
                operation: 'createWorkflowVersion',
                userId,
                workflowId,
                version: newVersionNumber
            });

            return version;
        } catch (error) {
            loggingService.error('Error creating workflow version', {
                component: 'WorkflowVersioningService',
                operation: 'createWorkflowVersion',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            throw error;
        }
    }

    /**
     * Calculate cost metrics for a workflow
     */
    private static async calculateCostMetrics(
        userId: string,
        workflowId: string,
        startDate: Date
    ): Promise<{
        averageCostPerExecution: number;
        totalExecutions: number;
        totalCost: number;
        modelBreakdown: Array<{ model: string; cost: number; percentage: number }>;
    }> {
        const match: any = {
            userId: new mongoose.Types.ObjectId(userId),
            workflowId: workflowId,
            automationPlatform: { $exists: true, $ne: null },
            createdAt: { $gte: startDate }
        };

        const stats = await Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalCost: { $sum: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] } },
                    totalExecutions: { $sum: 1 },
                    models: {
                        $push: {
                            model: '$model',
                            cost: { $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }] }
                        }
                    }
                }
            }
        ]);

        if (!stats || stats.length === 0) {
            return {
                averageCostPerExecution: 0,
                totalExecutions: 0,
                totalCost: 0,
                modelBreakdown: []
            };
        }

        const data = stats[0];
        const totalCost = data.totalCost || 0;
        const totalExecutions = data.totalExecutions || 0;
        const averageCostPerExecution = totalExecutions > 0 ? totalCost / totalExecutions : 0;

        // Calculate model breakdown
        const modelMap = new Map<string, number>();
        data.models.forEach((m: any) => {
            const existing = modelMap.get(m.model) || 0;
            modelMap.set(m.model, existing + (m.cost || 0));
        });

        const modelBreakdown = Array.from(modelMap.entries())
            .map(([model, cost]) => ({
                model,
                cost,
                percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0
            }))
            .sort((a, b) => b.cost - a.cost);

        return {
            averageCostPerExecution: Math.round(averageCostPerExecution * 100000) / 100000,
            totalExecutions,
            totalCost,
            modelBreakdown
        };
    }

    /**
     * Calculate changes between versions
     */
    private static calculateChanges(
        previousVersion: IWorkflowVersion,
        newStructure: { stepCount: number; aiStepCount: number; stepTypes: string[]; complexityScore: number },
        newCostMetrics: { averageCostPerExecution: number; totalExecutions: number; totalCost: number; modelBreakdown: Array<{ model: string; cost: number; percentage: number }> }
    ): {
        stepsAdded?: number;
        stepsRemoved?: number;
        stepsModified?: number;
        modelsChanged?: Array<{ from: string; to: string }>;
        costImpact?: number;
    } {
        const changes: any = {};

        // Step changes
        const stepDiff = newStructure.stepCount - (previousVersion.structure?.stepCount || 0);
        if (stepDiff > 0) {
            changes.stepsAdded = stepDiff;
        } else if (stepDiff < 0) {
            changes.stepsRemoved = Math.abs(stepDiff);
        }

        // Model changes (simplified - compare top models)
        const previousTopModel = previousVersion.costMetrics?.modelBreakdown?.[0]?.model;
        const newTopModel = newCostMetrics.modelBreakdown?.[0]?.model;
        if (previousTopModel && newTopModel && previousTopModel !== newTopModel) {
            changes.modelsChanged = [{
                from: previousTopModel,
                to: newTopModel
            }];
        }

        // Cost impact
        const previousAvgCost = previousVersion.costMetrics?.averageCostPerExecution || 0;
        const newAvgCost = newCostMetrics.averageCostPerExecution;
        if (previousAvgCost > 0) {
            changes.costImpact = newAvgCost - previousAvgCost;
        }

        return changes;
    }

    /**
     * Get workflow version history
     */
    static async getWorkflowVersionHistory(
        userId: string,
        workflowId: string
    ): Promise<IWorkflowVersion[]> {
        try {
            const versions = await WorkflowVersion.find({
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId
            }).sort({ version: -1 });

            return versions;
        } catch (error) {
            loggingService.error('Error getting workflow version history', {
                component: 'WorkflowVersioningService',
                operation: 'getWorkflowVersionHistory',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            throw error;
        }
    }

    /**
     * Compare two workflow versions
     */
    static async compareWorkflowVersions(
        userId: string,
        workflowId: string,
        version1: number,
        version2: number
    ): Promise<WorkflowVersionComparison | null> {
        try {
            const [v1, v2] = await Promise.all([
                WorkflowVersion.findOne({
                    userId: new mongoose.Types.ObjectId(userId),
                    workflowId: workflowId,
                    version: version1
                }),
                WorkflowVersion.findOne({
                    userId: new mongoose.Types.ObjectId(userId),
                    workflowId: workflowId,
                    version: version2
                })
            ]);

            if (!v1 || !v2) {
                return null;
            }

            const cost1 = v1.costMetrics?.averageCostPerExecution || 0;
            const cost2 = v2.costMetrics?.averageCostPerExecution || 0;
            const costDifference = cost2 - cost1;
            const costDifferencePercentage = cost1 > 0 ? (costDifference / cost1) * 100 : 0;

            const exec1 = v1.costMetrics?.totalExecutions || 0;
            const exec2 = v2.costMetrics?.totalExecutions || 0;
            const executionDifference = exec2 - exec1;

            const structureChanges = {
                stepsAdded: v2.changes?.stepsAdded || 0,
                stepsRemoved: v2.changes?.stepsRemoved || 0,
                stepsModified: v2.changes?.stepsModified || 0,
                modelsChanged: v2.changes?.modelsChanged?.length || 0
            };

            const efficiencyChange = costDifference < -0.01 
                ? 'improved' 
                : costDifference > 0.01 
                ? 'degraded' 
                : 'stable';

            return {
                version1: v1,
                version2: v2,
                costDifference: Math.round(costDifference * 100000) / 100000,
                costDifferencePercentage: Math.round(costDifferencePercentage * 100) / 100,
                executionDifference,
                structureChanges,
                efficiencyChange
            };
        } catch (error) {
            loggingService.error('Error comparing workflow versions', {
                component: 'WorkflowVersioningService',
                operation: 'compareWorkflowVersions',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            throw error;
        }
    }
}

