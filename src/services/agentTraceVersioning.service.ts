import mongoose from 'mongoose';
import { AgentTraceVersion, IAgentTraceVersion } from '../models/AgentTraceVersion';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface AgentTraceVersionComparison {
    version1: IAgentTraceVersion;
    version2: IAgentTraceVersion;
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

export class AgentTraceVersioningService {
    /**
     * Create a new agent trace version snapshot
     */
    static async createAgentTraceVersion(
        userId: string,
        traceId: string,
        traceName: string,
        platform: 'zapier' | 'make' | 'n8n',
        structure: {
            stepCount: number;
            aiStepCount: number;
            stepTypes: string[];
            complexityScore: number;
        }
    ): Promise<IAgentTraceVersion> {
        try {
            // Get the latest version
            const latestVersion = await AgentTraceVersion.findOne({
                userId: new mongoose.Types.ObjectId(userId),
                traceId: traceId
            }).sort({ version: -1 });

            const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

            // Calculate cost metrics from last 7 days
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const costMetrics = await this.calculateCostMetrics(userId, traceId, sevenDaysAgo);

            // Calculate changes from previous version
            const changes = latestVersion ? this.calculateChanges(latestVersion, structure, costMetrics) : undefined;

            const version = new AgentTraceVersion({
                userId: new mongoose.Types.ObjectId(userId),
                traceId,
                traceName,
                platform,
                version: newVersionNumber,
                previousVersionId: latestVersion?._id,
                costMetrics,
                structure,
                changes
            });

            await version.save();

            loggingService.info('Agent trace version created', {
                component: 'AgentTraceVersioningService',
                operation: 'createAgentTraceVersion',
                userId,
                traceId,
                version: newVersionNumber
            });

            return version;
        } catch (error) {
            loggingService.error('Error creating agent trace version', {
                component: 'AgentTraceVersioningService',
                operation: 'createAgentTraceVersion',
                error: error instanceof Error ? error.message : String(error),
                userId,
                traceId
            });
            throw error;
        }
    }

    /**
     * Calculate cost metrics for a workflow
     */
    private static async calculateCostMetrics(
        userId: string,
        traceId: string,
        startDate: Date
    ): Promise<{
        averageCostPerExecution: number;
        totalExecutions: number;
        totalCost: number;
        modelBreakdown: Array<{ model: string; cost: number; percentage: number }>;
    }> {
        const match: any = {
            userId: new mongoose.Types.ObjectId(userId),
            traceId: traceId,
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
        previousVersion: IAgentTraceVersion,
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
     * Get agent trace version history
     */
    static async getAgentTraceVersionHistory(
        userId: string,
        traceId: string
    ): Promise<IAgentTraceVersion[]> {
        try {
            const versions = await AgentTraceVersion.find({
                userId: new mongoose.Types.ObjectId(userId),
                traceId: traceId
            }).sort({ version: -1 });

            return versions;
        } catch (error) {
            loggingService.error('Error getting agent trace version history', {
                component: 'AgentTraceVersioningService',
                operation: 'getAgentTraceVersionHistory',
                error: error instanceof Error ? error.message : String(error),
                userId,
                traceId
            });
            throw error;
        }
    }

    /**
     * Compare two agent trace versions
     */
    static async compareAgentTraceVersions(
        userId: string,
        traceId: string,
        version1: number,
        version2: number
    ): Promise<AgentTraceVersionComparison | null> {
        try {
            const [v1, v2] = await Promise.all([
                AgentTraceVersion.findOne({
                    userId: new mongoose.Types.ObjectId(userId),
                    traceId: traceId,
                    version: version1
                }),
                AgentTraceVersion.findOne({
                    userId: new mongoose.Types.ObjectId(userId),
                    traceId: traceId,
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
            loggingService.error('Error comparing agent trace versions', {
                component: 'AgentTraceVersioningService',
                operation: 'compareAgentTraceVersions',
                error: error instanceof Error ? error.message : String(error),
                userId,
                traceId
            });
            throw error;
        }
    }
}

