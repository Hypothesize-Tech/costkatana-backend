import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  SimulationTracking,
  SimulationTrackingDocument,
} from '@/schemas/analytics/simulation-tracking.schema';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';

export interface SimulationTrackingData {
  userId: string;
  sessionId: string;
  originalUsageId?: string;
  simulationType:
    | 'real_time_analysis'
    | 'prompt_optimization'
    | 'context_trimming'
    | 'model_comparison';
  originalModel: string;
  originalPrompt: string;
  originalCost: number;
  originalTokens: number;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    trimPercentage?: number;
    alternativeModels?: string[];
  };
  optimizationOptions: Array<{
    type: string;
    description: string;
    newModel?: string;
    newCost?: number;
    savings?: number;
    savingsPercentage?: number;
    risk?: 'low' | 'medium' | 'high';
    implementation?: 'easy' | 'moderate' | 'complex';
    confidence?: number;
  }>;
  recommendations: unknown[];
  potentialSavings: number;
  confidence: number;
  userAgent?: string;
  ipAddress?: string;
  projectId?: string;
}

export interface OptimizationApplication {
  optionIndex: number;
  type: string;
  estimatedSavings: number;
  userFeedback?: {
    satisfied?: boolean;
    comment?: string;
    rating?: number;
  };
}

export interface SimulationStats {
  totalSimulations: number;
  totalOptimizationsApplied: number;
  acceptanceRate: number;
  averageSavings: number;
  totalPotentialSavings: number;
  totalActualSavings: number;
  topOptimizationTypes: Array<{
    type: string;
    count: number;
    averageSavings: number;
    acceptanceRate: number;
  }>;
  userEngagement: {
    averageTimeSpent: number;
    averageOptionsViewed: number;
    returnUsers: number;
  };
  weeklyTrends: Array<{
    week: string;
    simulations: number;
    applications: number;
    savings: number;
  }>;
}

const MAX_DB_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MS = 300_000;
const OBJECTID_CACHE_TTL_MS = 300_000;

@Injectable()
export class SimulationTrackingService {
  private readonly logger = new Logger(SimulationTrackingService.name);
  private dbFailureCount = 0;
  private lastDbFailureTime = 0;
  private readonly objectIdCache = new Map<
    string,
    { objectId: Types.ObjectId; timestamp: number }
  >();

  constructor(
    @InjectModel(SimulationTracking.name)
    private readonly simulationModel: Model<SimulationTrackingDocument>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<UsageDocument>,
  ) {}

  async trackSimulation(data: SimulationTrackingData): Promise<string> {
    const doc = new this.simulationModel({
      userId: new Types.ObjectId(data.userId),
      sessionId: data.sessionId,
      originalUsageId: data.originalUsageId
        ? new Types.ObjectId(data.originalUsageId)
        : undefined,
      simulationType: data.simulationType,
      originalModel: data.originalModel,
      originalPrompt: data.originalPrompt,
      originalCost: data.originalCost,
      originalTokens: data.originalTokens,
      parameters: data.parameters,
      optimizationOptions: data.optimizationOptions ?? [],
      recommendations: data.recommendations ?? [],
      potentialSavings: data.potentialSavings,
      confidence: data.confidence,
      userAgent: data.userAgent,
      ipAddress: data.ipAddress,
      projectId: data.projectId
        ? new Types.ObjectId(data.projectId)
        : undefined,
    });
    const saved = await doc.save();
    this.logger.log(`Simulation tracked: ${saved._id} for user ${data.userId}`);
    return saved._id.toString();
  }

  async trackOptimizationApplication(
    trackingId: string,
    application: OptimizationApplication,
  ): Promise<void> {
    await this.simulationModel.findByIdAndUpdate(trackingId, {
      $push: {
        appliedOptimizations: {
          ...application,
          appliedAt: new Date(),
        },
      },
      $set: { updatedAt: new Date() },
    });
    this.logger.log(`Optimization application tracked: ${trackingId}`);
  }

  async updateViewingMetrics(
    trackingId: string,
    timeSpent: number,
    optionsViewed: number[],
  ): Promise<void> {
    await this.simulationModel.findByIdAndUpdate(trackingId, {
      $set: {
        timeSpentViewing: timeSpent,
        optionsViewed: optionsViewed ?? [],
        updatedAt: new Date(),
      },
    });
  }

  async getSimulationStats(
    userId?: string,
    timeRange?: { startDate: Date; endDate: Date },
  ): Promise<SimulationStats> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }

    const matchStage: Record<string, unknown> = {};
    if (userId) {
      matchStage.userId = this.getOptimizedObjectId(userId);
    }
    if (timeRange) {
      matchStage.createdAt = {
        $gte: timeRange.startDate,
        $lte: timeRange.endDate,
      };
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $facet: {
          basicStats: [
            {
              $group: {
                _id: null,
                totalSimulations: { $sum: 1 },
                totalOptimizationsApplied: {
                  $sum: {
                    $size: { $ifNull: ['$appliedOptimizations', []] },
                  },
                },
                totalPotentialSavings: { $sum: '$potentialSavings' },
                averageConfidence: { $avg: '$confidence' },
                averageTimeSpent: { $avg: '$timeSpentViewing' },
                averageOptionsViewed: {
                  $avg: { $size: { $ifNull: ['$optionsViewed', []] } },
                },
                uniqueUsers: { $addToSet: '$userId' },
              },
            },
          ],
          optimizationTypes: [
            { $unwind: '$optimizationOptions' },
            {
              $group: {
                _id: '$optimizationOptions.type',
                count: { $sum: 1 },
                averageSavings: { $avg: '$optimizationOptions.savings' },
                totalApplications: {
                  $sum: {
                    $size: {
                      $filter: {
                        input: { $ifNull: ['$appliedOptimizations', []] },
                        cond: {
                          $eq: ['$$this.type', '$optimizationOptions.type'],
                        },
                      },
                    },
                  },
                },
              },
            },
            {
              $project: {
                type: '$_id',
                count: 1,
                averageSavings: 1,
                acceptanceRate: {
                  $cond: {
                    if: { $gt: ['$count', 0] },
                    then: { $divide: ['$totalApplications', '$count'] },
                    else: 0,
                  },
                },
              },
            },
            { $sort: { count: -1 } },
          ],
          weeklyTrends: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  week: { $week: '$createdAt' },
                },
                simulations: { $sum: 1 },
                applications: {
                  $sum: {
                    $size: { $ifNull: ['$appliedOptimizations', []] },
                  },
                },
                savings: { $sum: '$potentialSavings' },
              },
            },
            {
              $project: {
                week: {
                  $concat: [
                    { $toString: '$_id.year' },
                    '-W',
                    { $toString: '$_id.week' },
                  ],
                },
                simulations: 1,
                applications: 1,
                savings: 1,
              },
            },
            { $sort: { '_id.year': -1, '_id.week': -1 } },
            { $limit: 12 },
          ],
        },
      },
    ];

    const results = await this.simulationModel.aggregate<{
      basicStats: Array<{
        totalSimulations: number;
        totalOptimizationsApplied: number;
        totalPotentialSavings: number;
        averageConfidence: number;
        averageTimeSpent: number;
        averageOptionsViewed: number;
        uniqueUsers: unknown[];
      }>;
      optimizationTypes: Array<{
        type: string;
        count: number;
        averageSavings: number;
        acceptanceRate: number;
      }>;
      weeklyTrends: Array<{
        week: string;
        simulations: number;
        applications: number;
        savings: number;
      }>;
    }>(pipeline);

    const facetResult = results[0];
    const baseStats = facetResult?.basicStats?.[0] ?? {
      totalSimulations: 0,
      totalOptimizationsApplied: 0,
      totalPotentialSavings: 0,
      averageConfidence: 0,
      averageTimeSpent: 0,
      averageOptionsViewed: 0,
      uniqueUsers: [],
    };
    const optimizationTypes = facetResult?.optimizationTypes ?? [];
    const weeklyTrends = facetResult?.weeklyTrends ?? [];

    const totalActualSavings = await this.calculateTotalActualSavings(
      userId,
      timeRange,
    );
    this.dbFailureCount = 0;

    return {
      totalSimulations: baseStats.totalSimulations,
      totalOptimizationsApplied: baseStats.totalOptimizationsApplied,
      acceptanceRate:
        baseStats.totalSimulations > 0
          ? baseStats.totalOptimizationsApplied / baseStats.totalSimulations
          : 0,
      averageSavings:
        baseStats.totalPotentialSavings / (baseStats.totalSimulations || 1),
      totalPotentialSavings: baseStats.totalPotentialSavings,
      totalActualSavings,
      topOptimizationTypes: optimizationTypes.map((t) => ({
        type: t.type,
        count: t.count,
        averageSavings: t.averageSavings ?? 0,
        acceptanceRate: t.acceptanceRate ?? 0,
      })),
      userEngagement: {
        averageTimeSpent: baseStats.averageTimeSpent ?? 0,
        averageOptionsViewed: baseStats.averageOptionsViewed ?? 0,
        returnUsers: Array.isArray(baseStats.uniqueUsers)
          ? baseStats.uniqueUsers.length
          : 0,
      },
      weeklyTrends,
    };
  }

  async getTopOptimizationWins(
    timeRange?: { startDate: Date; endDate: Date },
    limit = 10,
  ): Promise<
    Array<{
      userId: string;
      userName?: string;
      totalSavings: number;
      optimizationsApplied: number;
      averageSavings: number;
      topOptimizationType: string;
    }>
  > {
    const matchStage: Record<string, unknown> = {};
    if (timeRange) {
      matchStage.createdAt = {
        $gte: timeRange.startDate,
        $lte: timeRange.endDate,
      };
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      {
        $unwind: {
          path: '$appliedOptimizations',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $group: {
          _id: '$userId',
          totalSavings: {
            $sum: '$appliedOptimizations.estimatedSavings',
          },
          optimizationsApplied: { $sum: 1 },
          optimizationTypes: { $push: '$appliedOptimizations.type' },
        },
      },
      {
        $project: {
          userId: { $toString: '$_id' },
          totalSavings: 1,
          optimizationsApplied: 1,
          averageSavings: {
            $divide: ['$totalSavings', '$optimizationsApplied'],
          },
          topOptimizationType: { $arrayElemAt: ['$optimizationTypes', 0] },
        },
      },
      { $sort: { totalSavings: -1 } },
      { $limit: limit },
    ];

    const wins = await this.simulationModel.aggregate(pipeline);
    return wins;
  }

  async getUserSimulationHistory(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<unknown[]> {
    const simulations = await this.simulationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .populate('originalUsageId', 'prompt model cost totalTokens')
      .populate('projectId', 'name')
      .lean();
    return simulations as unknown[];
  }

  isCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount < MAX_DB_FAILURES) return false;
    const elapsed = Date.now() - this.lastDbFailureTime;
    if (elapsed < CIRCUIT_BREAKER_RESET_MS) return true;
    this.dbFailureCount = 0;
    return false;
  }

  private recordDbFailure(): void {
    this.dbFailureCount += 1;
    this.lastDbFailureTime = Date.now();
  }

  private getOptimizedObjectId(id: string): Types.ObjectId {
    const cached = this.objectIdCache.get(id);
    if (cached && Date.now() - cached.timestamp < OBJECTID_CACHE_TTL_MS) {
      return cached.objectId;
    }
    const objectId = new Types.ObjectId(id);
    this.objectIdCache.set(id, { objectId, timestamp: Date.now() });
    return objectId;
  }

  private async getAppliedOptimizations(
    userId?: string,
    projectId?: string,
    timeRange?: { startDate: Date; endDate: Date },
  ): Promise<
    Array<{
      optimization: {
        type: string;
        newModel?: string;
        trimPercentage?: number;
        estimatedSavings?: number;
      };
      originalUsage: {
        userId: string;
        prompt?: string;
        model: string;
        cost: number;
        totalTokens?: number;
      };
      appliedAt: Date;
    }>
  > {
    const matchStage: Record<string, unknown> = {
      'appliedOptimizations.0': { $exists: true },
    };
    if (userId) matchStage.userId = new Types.ObjectId(userId);
    if (projectId) matchStage.projectId = new Types.ObjectId(projectId);
    if (timeRange) {
      matchStage.createdAt = {
        $gte: timeRange.startDate,
        $lte: timeRange.endDate,
      };
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      { $unwind: '$appliedOptimizations' },
      {
        $lookup: {
          from: 'usages',
          localField: 'originalUsageId',
          foreignField: '_id',
          as: 'originalUsage',
        },
      },
      {
        $project: {
          originalUsage: { $arrayElemAt: ['$originalUsage', 0] },
          optimization: '$appliedOptimizations',
          appliedAt: '$appliedOptimizations.appliedAt',
        },
      },
      { $sort: { appliedAt: -1 } },
    ];

    const results = await this.simulationModel.aggregate(pipeline);
    return results as typeof results &
      {
        optimization: {
          type: string;
          newModel?: string;
          trimPercentage?: number;
          estimatedSavings?: number;
        };
        originalUsage: {
          userId: string;
          prompt?: string;
          model: string;
          cost: number;
          totalTokens?: number;
        };
        appliedAt: Date;
      }[];
  }

  private async calculateTotalActualSavings(
    userId?: string,
    timeRange?: { startDate: Date; endDate: Date },
  ): Promise<number> {
    try {
      const applied = await this.getAppliedOptimizations(
        userId,
        undefined,
        timeRange,
      );
      let total = 0;
      for (const item of applied) {
        const opt = item.optimization;
        const usage = item.originalUsage;
        if (!usage || !opt) continue;
        switch (opt.type) {
          case 'model_switch':
            total += await this.calculateModelSwitchActualSavings(
              opt,
              usage,
              item.appliedAt,
            );
            break;
          case 'context_trim':
            total += await this.calculateContextTrimActualSavings(
              opt,
              usage,
              item.appliedAt,
            );
            break;
          case 'prompt_optimize':
            total += await this.calculatePromptOptimizeActualSavings(
              opt,
              usage,
              item.appliedAt,
            );
            break;
          default:
            total += opt.estimatedSavings ?? 0;
        }
      }
      return total;
    } catch (error) {
      this.logger.error(
        'Error calculating total actual savings',
        error instanceof Error ? error.message : String(error),
      );
      return 0;
    }
  }

  private async calculateModelSwitchActualSavings(
    optimization: { newModel?: string; estimatedSavings?: number },
    originalUsage: {
      userId: string;
      prompt?: string;
      model: string;
      cost: number;
      totalTokens?: number;
    },
    appliedAt: Date,
  ): Promise<number> {
    if (!optimization.newModel) {
      return optimization.estimatedSavings ?? 0;
    }
    if (this.isCircuitBreakerOpen()) {
      return optimization.estimatedSavings ?? 0;
    }
    try {
      const prompt = originalUsage.prompt ?? '';
      const promptKeywords = prompt
        .substring(0, 100)
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5);
      const orCondition =
        promptKeywords.length > 0
          ? promptKeywords.map((keyword) => ({
              prompt: { $regex: keyword, $options: 'i' },
            }))
          : [{}];

      const subsequent = await this.usageModel
        .find({
          userId: originalUsage.userId,
          model: optimization.newModel,
          createdAt: { $gte: appliedAt },
          $or: orCondition,
        })
        .limit(10)
        .lean();

      if (subsequent.length === 0) {
        return optimization.estimatedSavings ?? 0;
      }

      const costs = subsequent.map((u) => u.cost);
      const tokens = subsequent.map((u) => u.totalTokens ?? 0);
      const avgNewCost = costs.reduce((s, c) => s + c, 0) / costs.length;
      const origTokens = originalUsage.totalTokens ?? 1;
      const origCostPerToken = originalUsage.cost / origTokens;
      const avgNewTokens = tokens.reduce((s, t) => s + t, 0) / tokens.length;
      const estimatedOrig = origCostPerToken * avgNewTokens;
      return Math.max(0, estimatedOrig - avgNewCost);
    } catch (error) {
      this.recordDbFailure();
      this.logger.error(
        'Error calculating model switch actual savings',
        error instanceof Error ? error.message : String(error),
      );
      return optimization.estimatedSavings ?? 0;
    }
  }

  private async calculateContextTrimActualSavings(
    optimization: { trimPercentage?: number; estimatedSavings?: number },
    originalUsage: {
      userId: string;
      model: string;
      cost: number;
      totalTokens?: number;
    },
    appliedAt: Date,
  ): Promise<number> {
    if (optimization.trimPercentage == null) {
      return optimization.estimatedSavings ?? 0;
    }
    try {
      const origTokens = originalUsage.totalTokens ?? 0;
      const subsequent = await this.usageModel
        .find({
          userId: originalUsage.userId,
          model: originalUsage.model,
          createdAt: { $gte: appliedAt },
          totalTokens: { $lt: origTokens * 0.9 },
        })
        .limit(10)
        .lean();

      if (subsequent.length === 0) {
        return optimization.estimatedSavings ?? 0;
      }

      const avgNewTokens =
        subsequent.reduce((s, u) => s + (u.totalTokens ?? 0), 0) /
        subsequent.length;
      const avgNewCost =
        subsequent.reduce((s, u) => s + u.cost, 0) / subsequent.length;
      const costPerToken = originalUsage.cost / (origTokens || 1);
      const trimPct = optimization.trimPercentage / 100;
      const estimatedWithoutTrim =
        (avgNewTokens / (1 - trimPct)) * costPerToken;
      return Math.max(0, estimatedWithoutTrim - avgNewCost);
    } catch (error) {
      this.logger.error(
        'Error calculating context trim actual savings',
        error instanceof Error ? error.message : String(error),
      );
      return optimization.estimatedSavings ?? 0;
    }
  }

  private async calculatePromptOptimizeActualSavings(
    optimization: { estimatedSavings?: number },
    originalUsage: {
      userId: string;
      model: string;
      cost: number;
      totalTokens?: number;
    },
    appliedAt: Date,
  ): Promise<number> {
    try {
      const origTokens = originalUsage.totalTokens ?? 0;
      const subsequent = await this.usageModel
        .find({
          userId: originalUsage.userId,
          model: originalUsage.model,
          createdAt: { $gte: appliedAt },
          totalTokens: { $lt: origTokens * 1.1 },
        })
        .limit(10)
        .lean();

      if (subsequent.length === 0) {
        return optimization.estimatedSavings ?? 0;
      }

      const avgNewCost =
        subsequent.reduce((s, u) => s + u.cost, 0) / subsequent.length;
      const avgNewTokens =
        subsequent.reduce((s, u) => s + (u.totalTokens ?? 0), 0) /
        subsequent.length;
      const origCostPerToken = originalUsage.cost / (origTokens || 1);
      const newCostPerToken = avgNewCost / (avgNewTokens || 1);
      return Math.max(0, origCostPerToken - newCostPerToken) * avgNewTokens;
    } catch (error) {
      this.logger.error(
        'Error calculating prompt optimize actual savings',
        error instanceof Error ? error.message : String(error),
      );
      return optimization.estimatedSavings ?? 0;
    }
  }

  onModuleDestroy(): void {
    this.dbFailureCount = 0;
    this.lastDbFailureTime = 0;
    this.objectIdCache.clear();
  }
}
