import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';
import {
  AgentTraceVersion,
  AgentTraceVersionDocument,
} from '../../../schemas/agent/agent-trace-version.schema';

export interface AgentTraceVersionComparison {
  version1: AgentTraceVersionDocument;
  version2: AgentTraceVersionDocument;
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

/**
 * Agent Trace Versioning Service - NestJS equivalent of Express AgentTraceVersioningService
 * Handles versioning, comparison, and evolution tracking of agent traces
 */
@Injectable()
export class AgentTraceVersioningService {
  private readonly logger = new Logger(AgentTraceVersioningService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    @InjectModel(AgentTraceVersion.name)
    private readonly agentTraceVersionModel: Model<AgentTraceVersion>,
  ) {}

  /**
   * Create a new agent trace version snapshot
   */
  async createAgentTraceVersion(
    userId: string,
    traceId: string,
    traceName: string,
    platform: 'zapier' | 'make' | 'n8n',
    structure: {
      stepCount: number;
      aiStepCount: number;
      stepTypes: string[];
      complexityScore: number;
    },
  ): Promise<AgentTraceVersionDocument> {
    try {
      // Get the latest version
      const latestVersion = await this.agentTraceVersionModel
        .findOne({ userId, traceId })
        .sort({ version: -1 });

      const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

      // Calculate cost metrics from last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const costMetrics = await this.calculateCostMetrics(
        userId,
        traceId,
        sevenDaysAgo,
      );

      // Calculate changes from previous version
      const changes = latestVersion
        ? this.calculateChanges(latestVersion, structure, costMetrics)
        : undefined;

      const version = new this.agentTraceVersionModel({
        userId,
        traceId,
        traceName,
        platform,
        version: newVersionNumber,
        previousVersionId: latestVersion?._id,
        costMetrics,
        structure,
        changes,
      });

      await version.save();

      this.logger.log(`Agent trace version ${newVersionNumber} created`, {
        userId,
        traceId,
        version: newVersionNumber,
      });

      return version;
    } catch (error) {
      this.logger.error('Error creating agent trace version', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        traceId,
      });
      throw error;
    }
  }

  /**
   * Calculate cost metrics for a workflow
   */
  private async calculateCostMetrics(
    userId: string,
    traceId: string,
    startDate: Date,
  ): Promise<{
    averageCostPerExecution: number;
    totalExecutions: number;
    totalCost: number;
    modelBreakdown: Array<{ model: string; cost: number; percentage: number }>;
  }> {
    try {
      const match = {
        userId,
        traceId,
        createdAt: { $gte: startDate },
        automationPlatform: { $exists: true, $ne: null },
      };

      // Get total executions and cost
      const stats = await this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalCost: {
              $sum: {
                $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }],
              },
            },
            totalExecutions: { $sum: 1 },
            executionsByModel: {
              $push: {
                model: '$model',
                cost: {
                  $add: ['$cost', { $ifNull: ['$orchestrationCost', 0] }],
                },
              },
            },
          },
        },
      ]);

      if (!stats || stats.length === 0) {
        return {
          averageCostPerExecution: 0,
          totalExecutions: 0,
          totalCost: 0,
          modelBreakdown: [],
        };
      }

      const { totalCost, totalExecutions, executionsByModel } = stats[0];
      const averageCostPerExecution =
        totalExecutions > 0 ? totalCost / totalExecutions : 0;

      const modelCosts = new Map<string, number>();
      (executionsByModel as Array<{ model: string; cost: number }>).forEach(
        (exec: { model: string; cost: number }) => {
          const current = modelCosts.get(exec.model) || 0;
          modelCosts.set(exec.model, current + exec.cost);
        },
      );

      const modelBreakdown = Array.from(modelCosts.entries()).map(
        ([model, cost]) => ({
          model,
          cost,
          percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
        }),
      );

      return {
        averageCostPerExecution,
        totalExecutions,
        totalCost,
        modelBreakdown,
      };
    } catch (error) {
      this.logger.error('Error calculating cost metrics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        traceId,
      });
      throw error;
    }
  }

  /**
   * Calculate changes between versions
   */
  private calculateChanges(
    previousVersion: AgentTraceVersionDocument,
    newStructure: any,
    newCostMetrics: any,
  ): {
    costChange: number;
    costChangePercentage: number;
    structureChanges: {
      stepsAdded: number;
      stepsRemoved: number;
      stepsModified: number;
    };
    efficiencyChange: 'improved' | 'degraded' | 'stable';
  } {
    // Calculate cost changes
    const costChange =
      newCostMetrics.averageCostPerExecution -
      previousVersion.costMetrics.averageCostPerExecution;
    const costChangePercentage =
      previousVersion.costMetrics.averageCostPerExecution > 0
        ? (costChange / previousVersion.costMetrics.averageCostPerExecution) *
          100
        : 0;

    // Calculate structure changes
    const stepsAdded = Math.max(
      0,
      newStructure.stepCount - previousVersion.structure.stepCount,
    );
    const stepsRemoved = Math.max(
      0,
      previousVersion.structure.stepCount - newStructure.stepCount,
    );
    const stepsModified = Math.min(
      newStructure.stepCount,
      previousVersion.structure.stepCount,
    );

    // Determine efficiency change
    let efficiencyChange: 'improved' | 'degraded' | 'stable' = 'stable';
    if (costChangePercentage < -10) {
      efficiencyChange = 'improved';
    } else if (costChangePercentage > 10) {
      efficiencyChange = 'degraded';
    }

    return {
      costChange,
      costChangePercentage,
      structureChanges: {
        stepsAdded,
        stepsRemoved,
        stepsModified,
      },
      efficiencyChange,
    };
  }

  /**
   * Compare two agent trace versions
   */
  async compareVersions(
    userId: string,
    version1Id: string,
    version2Id: string,
  ): Promise<AgentTraceVersionComparison> {
    try {
      const [version1, version2] = await Promise.all([
        this.agentTraceVersionModel.findOne({ _id: version1Id, userId }),
        this.agentTraceVersionModel.findOne({ _id: version2Id, userId }),
      ]);

      if (!version1 || !version2) {
        throw new Error('One or both versions not found');
      }

      // Sort versions by version number
      const [older, newer] =
        version1.version <= version2.version
          ? [version1, version2]
          : [version2, version1];

      const costDifference =
        newer.costMetrics.averageCostPerExecution -
        older.costMetrics.averageCostPerExecution;
      const costDifferencePercentage =
        older.costMetrics.averageCostPerExecution > 0
          ? (costDifference / older.costMetrics.averageCostPerExecution) * 100
          : 0;

      const executionDifference =
        newer.costMetrics.totalExecutions - older.costMetrics.totalExecutions;

      // Calculate structure changes
      const stepsAdded = Math.max(
        0,
        newer.structure.stepCount - older.structure.stepCount,
      );
      const stepsRemoved = Math.max(
        0,
        older.structure.stepCount - newer.structure.stepCount,
      );
      const stepsModified = Math.min(
        newer.structure.stepCount,
        older.structure.stepCount,
      );

      // Count model changes
      const oldModels = new Set(
        older.costMetrics.modelBreakdown.map((m: { model: string }) => m.model),
      );
      const newModels = new Set(
        newer.costMetrics.modelBreakdown.map((m: { model: string }) => m.model),
      );
      const onlyInOld = [...oldModels].filter((m) => !newModels.has(m)).length;
      const onlyInNew = [...newModels].filter((m) => !oldModels.has(m)).length;
      const modelsChanged = onlyInOld + onlyInNew;

      // Determine efficiency change
      let efficiencyChange: 'improved' | 'degraded' | 'stable' = 'stable';
      if (costDifferencePercentage < -10) {
        efficiencyChange = 'improved';
      } else if (costDifferencePercentage > 10) {
        efficiencyChange = 'degraded';
      }

      return {
        version1: older,
        version2: newer,
        costDifference,
        costDifferencePercentage,
        executionDifference,
        structureChanges: {
          stepsAdded,
          stepsRemoved,
          stepsModified,
          modelsChanged,
        },
        efficiencyChange,
      };
    } catch (error) {
      this.logger.error('Error comparing versions', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        version1Id,
        version2Id,
      });
      throw error;
    }
  }

  /**
   * Get version history for a trace
   */
  async getVersionHistory(
    userId: string,
    traceId: string,
  ): Promise<AgentTraceVersionDocument[]> {
    try {
      return await this.agentTraceVersionModel
        .find({ userId, traceId })
        .sort({ version: -1 });
    } catch (error) {
      this.logger.error('Error getting version history', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        traceId,
      });
      throw error;
    }
  }

  /**
   * Rollback to a previous version
   */
  async rollbackToVersion(
    userId: string,
    traceId: string,
    versionNumber: number,
  ): Promise<AgentTraceVersionDocument> {
    try {
      const targetVersion = await this.agentTraceVersionModel.findOne({
        userId,
        traceId,
        version: versionNumber,
      });

      if (!targetVersion) {
        throw new Error(
          `Version ${versionNumber} not found for trace ${traceId}`,
        );
      }

      // Create a new version based on the target version
      const rollbackVersion = new this.agentTraceVersionModel({
        userId,
        traceId,
        traceName: targetVersion.traceName,
        platform: targetVersion.platform,
        version: await this.getNextVersionNumber(userId, traceId),
        previousVersionId: targetVersion._id,
        costMetrics: targetVersion.costMetrics,
        structure: targetVersion.structure,
        changes: {
          rollbackFrom: targetVersion.version,
          costChange: 0,
          costChangePercentage: 0,
          structureChanges: {
            stepsAdded: 0,
            stepsRemoved: 0,
            stepsModified: 0,
          },
          efficiencyChange: 'stable',
        },
        isRollback: true,
      });

      await rollbackVersion.save();

      this.logger.log(
        `Rolled back trace ${traceId} to version ${versionNumber}`,
        {
          userId,
          traceId,
          newVersion: rollbackVersion.version,
        },
      );

      return rollbackVersion;
    } catch (error) {
      this.logger.error('Error rolling back version', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        traceId,
        versionNumber,
      });
      throw error;
    }
  }

  /**
   * Get next version number for a trace
   */
  private async getNextVersionNumber(
    userId: string,
    traceId: string,
  ): Promise<number> {
    const latest = await this.agentTraceVersionModel
      .findOne({ userId, traceId })
      .sort({ version: -1 });

    return latest ? latest.version + 1 : 1;
  }
}
