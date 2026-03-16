import {
  IWeightUpdate,
  RecommendationOutcome,
  RecommendationOutcomeDocument,
} from '../../../schemas/analytics/recommendation-outcome.schema';
import {
  RecommendationStrategy,
  RecommendationStrategyDocument,
} from '../../../schemas/analytics/recommendation-strategy.schema';
import { ModelPerformanceFingerprint } from '../../../schemas/ai/model-performance-fingerprint.schema';
import { Telemetry } from '../../../schemas/core/telemetry.schema';
import { Usage } from '../../../schemas/core/usage.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { Model, Types } from 'mongoose';

/**
 * Learning Loop Service
 * Implements the core feedback mechanism: Recommendations → Outcomes → Weight Updates
 * Enables continuous system improvement based on real-world results
 */
@Injectable()
export class LearningLoopService {
  private readonly logger = new Logger(LearningLoopService.name);

  // Learning constants
  private static readonly EMA_ALPHA = 0.3; // Exponential moving average smoothing factor
  private static readonly MAX_WEIGHT_CHANGE = 0.1; // Maximum weight change per update
  private static readonly MIN_SAMPLE_SIZE = 5; // Minimum samples before trusting outcomes
  private static readonly OUTCOME_MEASUREMENT_DAYS = 7; // Days to measure outcome

  constructor(
    @InjectModel(RecommendationOutcome.name)
    private recommendationOutcomeModel: Model<RecommendationOutcomeDocument>,
    @InjectModel(RecommendationStrategy.name)
    private recommendationStrategyModel: Model<RecommendationStrategyDocument>,
    @InjectModel(ModelPerformanceFingerprint.name)
    private modelPerformanceFingerprintModel: Model<any>,
    @InjectModel(Telemetry.name)
    private telemetryModel: Model<any>,
    @InjectModel(Usage.name)
    private usageModel: Model<any>,
  ) {}

  /**
   * Track a new recommendation
   */
  async trackRecommendation(params: {
    recommendationId: Types.ObjectId;
    recommendationType: string;
    userId: Types.ObjectId;
    tenantId?: string;
    workspaceId?: string;
    context: any;
    recommendedAt: Date;
  }): Promise<RecommendationOutcomeDocument> {
    try {
      const outcome = new this.recommendationOutcomeModel({
        recommendationId: params.recommendationId,
        recommendationType: params.recommendationType as any,
        userId: params.userId,
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        context: params.context,
        interaction: {
          status: 'pending',
        },
        weightUpdates: [],
        learningSignals: {
          recommendationQuality: 0.5,
          predictionAccuracy: 0.5,
          userTrust: 0.5,
          systemLearning: 0.5,
        },
        recommendedAt: params.recommendedAt,
      });

      await outcome.save();

      this.logger.log(`✅ Tracked new recommendation`, {
        recommendationId: params.recommendationId.toString(),
        type: params.recommendationType,
        userId: params.userId.toString(),
      });

      return outcome;
    } catch (error) {
      this.logger.error(`❌ Failed to track recommendation`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Record user interaction with recommendation
   */
  async recordInteraction(params: {
    recommendationId: Types.ObjectId;
    status: 'viewed' | 'accepted' | 'rejected' | 'dismissed';
    feedback?: string;
    rating?: number;
    reason?: string;
  }): Promise<RecommendationOutcomeDocument | null> {
    try {
      const outcome = await this.recommendationOutcomeModel.findOne({
        recommendationId: params.recommendationId,
      });

      if (!outcome) {
        this.logger.warn('Recommendation outcome not found', {
          recommendationId: params.recommendationId.toString(),
        });
        return null;
      }

      const now = new Date();
      const decisionTime = outcome.interaction.viewedAt
        ? (now.getTime() - outcome.interaction.viewedAt.getTime()) / 1000
        : undefined;

      outcome.interaction.status = params.status;
      outcome.interaction.respondedAt = now;
      outcome.interaction.feedback = params.feedback;
      outcome.interaction.rating = params.rating;
      outcome.interaction.decisionTimeSeconds = decisionTime;

      if (params.status === 'accepted') {
        outcome.interaction.acceptanceReason = params.reason;

        // Schedule outcome measurement
        await this.scheduleOutcomeMeasurement(outcome);
      } else if (params.status === 'rejected') {
        outcome.interaction.rejectionReason = params.reason;

        // Immediate learning from rejection
        await this.applyRejectionLearning(outcome);
      }

      await outcome.save();

      this.logger.log(`✅ Recorded recommendation interaction`, {
        recommendationId: params.recommendationId.toString(),
        status: params.status,
        rating: params.rating,
      });

      return outcome;
    } catch (error) {
      this.logger.error(`❌ Failed to record interaction`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Measure actual outcome after recommendation was accepted
   */
  async measureOutcome(
    outcomeId: Types.ObjectId,
  ): Promise<RecommendationOutcomeDocument | null> {
    try {
      const outcome = await this.recommendationOutcomeModel.findById(outcomeId);
      if (!outcome) return null;

      if (outcome.interaction.status !== 'accepted') {
        this.logger.warn(
          'Cannot measure outcome for non-accepted recommendation',
          {
            outcomeId: outcomeId.toString(),
            status: outcome.interaction.status,
          },
        );
        return null;
      }

      const measurementStart =
        outcome.interaction.respondedAt ?? outcome.recommendedAt;
      const measurementEnd = new Date();
      const daysSinceAcceptance =
        (measurementEnd.getTime() - measurementStart.getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysSinceAcceptance < LearningLoopService.OUTCOME_MEASUREMENT_DAYS) {
        this.logger.log('Too early to measure outcome', {
          outcomeId: outcomeId.toString(),
          daysSinceAcceptance: daysSinceAcceptance.toFixed(1),
        });
        return null;
      }

      // Measure actual performance
      const actualOutcome = await this.collectActualMetrics(
        outcome.userId.toString(),
        outcome.recommendationType,
        outcome.context,
        measurementStart,
        measurementEnd,
      );

      outcome.outcome = actualOutcome;
      outcome.outcomeRecordedAt = new Date();

      // Calculate learning signals
      outcome.learningSignals = this.calculateLearningSignals(outcome);

      await outcome.save();

      // Apply learning to weights
      await this.applyLearningToWeights(outcome);

      this.logger.log(`✅ Measured recommendation outcome`, {
        outcomeId: outcome._id ? String(outcome._id) : 'unknown',
        success: actualOutcome.success,
        successScore: actualOutcome.successScore?.toFixed(2),
      });

      return outcome;
    } catch (error) {
      this.logger.error(`❌ Failed to measure outcome`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Schedule outcome measurement for later
   */
  private async scheduleOutcomeMeasurement(
    outcome: RecommendationOutcomeDocument,
  ): Promise<void> {
    const measurementDelay =
      LearningLoopService.OUTCOME_MEASUREMENT_DAYS * 24 * 60 * 60 * 1000;
    const scheduledDate = new Date(Date.now() + measurementDelay);

    // Update the outcome entity with the scheduled date
    outcome.learningAppliedAt = scheduledDate;
    await outcome.save();

    this.logger.log('📅 Scheduled outcome measurement', {
      outcomeId: outcome._id ? String(outcome._id) : 'unknown',
      measurementDate: scheduledDate.toISOString(),
    });
  }

  /**
   * Collect actual performance metrics after recommendation was applied
   */
  private async collectActualMetrics(
    userId: string,
    recommendationType: string,
    context: any,
    measurementStart: Date,
    measurementEnd: Date,
  ): Promise<any> {
    try {
      let actualLatency = 0;
      let actualCost = 0;
      let actualFailureRate = 0;
      let actualSavings = 0;
      let sampleSize = 0;
      let success = false;

      if (recommendationType === 'model_switch' && context.suggestedModel) {
        // Query telemetry for the suggested model
        const telemetryData = await this.telemetryModel
          .find({
            user_id: userId,
            gen_ai_model: context.suggestedModel.modelId,
            timestamp: { $gte: measurementStart, $lte: measurementEnd },
          })
          .lean();

        // Query usage data as fallback
        const usageData = await this.usageModel
          .find({
            userId: new Types.ObjectId(userId),
            model: context.suggestedModel.modelId,
            createdAt: { $gte: measurementStart, $lte: measurementEnd },
          })
          .lean();

        sampleSize = telemetryData.length + usageData.length;

        if (sampleSize >= LearningLoopService.MIN_SAMPLE_SIZE) {
          // Calculate actual metrics
          const latencies = [
            ...telemetryData.map((t) => t.duration_ms),
            ...usageData.map((u) => u.responseTime),
          ];
          actualLatency =
            latencies.reduce((a, b) => a + b, 0) / latencies.length;

          const costs = [
            ...telemetryData.map((t) => t.cost_usd ?? 0),
            ...usageData.map((u) => u.cost ?? 0),
          ];
          actualCost = costs.reduce((a, b) => a + b, 0) / costs.length;

          const failures =
            telemetryData.filter((t) => t.status === 'error').length +
            usageData.filter((u) => u.errorOccurred).length;
          actualFailureRate = failures / sampleSize;

          // Calculate actual savings compared to baseline
          if (context.currentModel) {
            const expectedCost = context.currentModel.avgCost;
            actualSavings = Math.max(
              0,
              (expectedCost - actualCost) * sampleSize,
            );
          }

          // Determine success based on multiple factors
          const latencyImproved = context.suggestedModel.expectedLatency
            ? actualLatency <= context.suggestedModel.expectedLatency * 1.1 // 10% tolerance
            : true;

          const costImproved = context.suggestedModel.expectedCost
            ? actualCost <= context.suggestedModel.expectedCost * 1.1
            : true;

          const reliabilityMaintained =
            actualFailureRate <=
            (context.currentModel?.failureRate ?? 0.1) * 1.2;

          success = latencyImproved && costImproved && reliabilityMaintained;
        }
      } else {
        // For other recommendation types, measure general performance
        const usageData = await this.usageModel
          .find({
            userId: new Types.ObjectId(userId),
            createdAt: { $gte: measurementStart, $lte: measurementEnd },
          })
          .lean();

        sampleSize = usageData.length;

        if (sampleSize >= LearningLoopService.MIN_SAMPLE_SIZE) {
          actualLatency =
            usageData.reduce((sum, u) => sum + u.responseTime, 0) / sampleSize;
          actualCost =
            usageData.reduce((sum, u) => sum + u.cost, 0) / sampleSize;
          actualFailureRate =
            usageData.filter((u) => u.errorOccurred).length / sampleSize;

          // Success if metrics improved or stayed stable
          success = actualFailureRate < 0.1 && actualCost < 0.01;
        }
      }

      // Calculate composite success score
      const successScore = this.calculateSuccessScore(
        actualLatency,
        actualCost,
        actualFailureRate,
        context,
      );

      return {
        actualLatency,
        actualCost,
        actualFailureRate,
        actualSavings,
        success,
        successScore,
        measurementStart,
        measurementEnd,
        sampleSize,
      };
    } catch (error) {
      this.logger.error('Failed to collect actual metrics', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return failure outcome on error
      return {
        success: false,
        measurementStart,
        measurementEnd,
        sampleSize: 0,
      };
    }
  }

  /**
   * Calculate composite success score
   */
  private calculateSuccessScore(
    actualLatency: number,
    actualCost: number,
    actualFailureRate: number,
    context: any,
  ): number {
    let score = 1.0;

    // Penalize based on deviations from expectations
    if (context.suggestedModel) {
      if (context.suggestedModel.expectedLatency > 0) {
        const latencyRatio =
          actualLatency / context.suggestedModel.expectedLatency;
        score *= Math.max(0, Math.min(1, 2 - latencyRatio)); // 0 if 2x worse, 1 if as expected
      }

      if (context.suggestedModel.expectedCost > 0) {
        const costRatio = actualCost / context.suggestedModel.expectedCost;
        score *= Math.max(0, Math.min(1, 2 - costRatio));
      }
    }

    // Penalize for high failure rate
    score *= Math.max(0, 1 - actualFailureRate * 5); // 0 at 20% failure rate

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate learning signals from outcome
   */
  private calculateLearningSignals(outcome: RecommendationOutcomeDocument): {
    recommendationQuality: number;
    predictionAccuracy: number;
    userTrust: number;
    systemLearning: number;
  } {
    if (!outcome.outcome) {
      return {
        recommendationQuality: 0.5,
        predictionAccuracy: 0.5,
        userTrust: 0.5,
        systemLearning: 0.5,
      };
    }

    // Recommendation quality based on success
    const recommendationQuality =
      outcome.outcome.successScore ?? (outcome.outcome.success ? 0.8 : 0.2);

    // Prediction accuracy based on how close actual was to expected
    let predictionAccuracy = 0.5;
    if (
      outcome.context.suggestedModel &&
      outcome.outcome.actualCost !== undefined
    ) {
      const expectedCost = outcome.context.suggestedModel.expectedCost;
      if (expectedCost > 0) {
        const costError =
          Math.abs(outcome.outcome.actualCost - expectedCost) / expectedCost;
        predictionAccuracy = Math.max(0, 1 - costError);
      }
    }

    // User trust based on rating and past interactions
    let userTrust = 0.5;
    if (outcome.interaction.rating) {
      userTrust = outcome.interaction.rating / 5;
    } else if (outcome.interaction.status === 'accepted') {
      userTrust = 0.7;
    } else if (outcome.interaction.status === 'rejected') {
      userTrust = 0.3;
    }

    // System learning: how confident we are in the lesson
    const sampleSize = outcome.outcome.sampleSize || 0;
    const confidence = Math.min(1, sampleSize / 50); // Confidence increases with sample size
    const systemLearning = confidence * recommendationQuality;

    return {
      recommendationQuality,
      predictionAccuracy,
      userTrust,
      systemLearning,
    };
  }

  /**
   * Apply learning to model routing weights
   */
  private async applyLearningToWeights(
    outcome: RecommendationOutcomeDocument,
  ): Promise<void> {
    try {
      if (
        !outcome.outcome ||
        outcome.outcome.sampleSize < LearningLoopService.MIN_SAMPLE_SIZE
      ) {
        this.logger.log('Insufficient data to apply learning', {
          outcomeId: outcome._id ? String(outcome._id) : 'unknown',
        });
        return;
      }

      const weightUpdates: any[] = [];

      // Update model weights for model_switch recommendations
      if (
        outcome.recommendationType === 'model_switch' &&
        outcome.context.suggestedModel
      ) {
        const modelId = outcome.context.suggestedModel.modelId;
        const weightUpdate = await this.updateModelWeight(
          modelId,
          outcome.outcome.success,
          outcome.learningSignals.systemLearning,
        );

        if (weightUpdate) {
          weightUpdates.push(weightUpdate);
        }
      }

      // Update recommendation type weights based on acceptance/rejection
      const recTypeUpdate = await this.updateRecommendationTypeWeight(
        outcome.recommendationType,
        outcome.interaction.status,
        outcome.outcome.success,
      );

      if (recTypeUpdate) {
        weightUpdates.push(recTypeUpdate);
      }

      outcome.weightUpdates = weightUpdates as IWeightUpdate[];
      outcome.learningAppliedAt = new Date();
      await outcome.save();

      this.logger.log('✅ Applied learning to weights', {
        outcomeId: outcome._id ? String(outcome._id) : 'unknown',
        updatesApplied: weightUpdates.length,
      });
    } catch (error) {
      this.logger.error('❌ Failed to apply learning to weights', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Apply immediate learning from rejection
   */
  private async applyRejectionLearning(
    outcome: RecommendationOutcomeDocument,
  ): Promise<void> {
    try {
      // Reduce weight for rejected recommendation type
      const weightUpdate = await this.updateRecommendationTypeWeight(
        outcome.recommendationType,
        'rejected',
        false,
      );

      if (weightUpdate) {
        outcome.weightUpdates = [weightUpdate as IWeightUpdate];
        outcome.learningAppliedAt = new Date();
        await outcome.save();

        this.logger.log('✅ Applied rejection learning', {
          outcomeId: outcome._id ? String(outcome._id) : 'unknown',
          type: outcome.recommendationType,
        });
      }
    } catch (error) {
      this.logger.error('Failed to apply rejection learning', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Update model routing weight based on outcome
   */
  private async updateModelWeight(
    modelId: string,
    success: boolean,
    learningStrength: number,
  ): Promise<any | null> {
    try {
      const fingerprint = await this.modelPerformanceFingerprintModel.findOne({
        modelId,
      });
      if (!fingerprint) {
        this.logger.warn('Model fingerprint not found', { modelId });
        return null;
      }

      const previousWeight = fingerprint.routingWeight;

      // Calculate weight adjustment
      const baseAdjustment = success ? 0.05 : -0.05;
      const adjustment = baseAdjustment * learningStrength;
      const constrainedAdjustment = Math.max(
        -LearningLoopService.MAX_WEIGHT_CHANGE,
        Math.min(LearningLoopService.MAX_WEIGHT_CHANGE, adjustment),
      );

      // Apply EMA smoothing
      let newWeight = previousWeight + constrainedAdjustment;
      newWeight = this.applyEMA(
        previousWeight,
        newWeight,
        LearningLoopService.EMA_ALPHA,
      );
      newWeight = Math.max(0, Math.min(1, newWeight));

      fingerprint.routingWeight = newWeight;
      await fingerprint.save();

      const weightUpdate: any = {
        entityType: 'model',
        entityId: modelId,
        previousWeight,
        newWeight,
        deltaWeight: newWeight - previousWeight,
        reason: success ? 'positive_outcome' : 'negative_outcome',
        confidence: learningStrength,
        appliedAt: new Date(),
      };

      this.logger.log('✅ Updated model weight', {
        modelId,
        previousWeight: previousWeight.toFixed(3),
        newWeight: newWeight.toFixed(3),
        delta: (newWeight - previousWeight).toFixed(3),
      });

      return weightUpdate;
    } catch (error) {
      this.logger.error('Failed to update model weight', {
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Update recommendation type weight in the strategy store
   */
  private async updateRecommendationTypeWeight(
    recommendationType: string,
    status: string,
    success: boolean,
  ): Promise<{
    entityType: string;
    entityId: string;
    previousWeight: number;
    newWeight: number;
    deltaWeight: number;
    reason: string;
    confidence: number;
    appliedAt: Date;
    stats: any;
  } | null> {
    try {
      // Get or create the recommendation strategy
      let strategy = await this.recommendationStrategyModel.findOne({
        strategyId: recommendationType,
        isActive: true,
      });

      if (!strategy) {
        strategy = new this.recommendationStrategyModel({
          strategyId: recommendationType,
          strategyName: this.getStrategyDisplayName(recommendationType),
          strategyType: recommendationType as any,
          currentWeight: 0.5,
          baselineWeight: 0.5,
          totalRecommendations: 0,
          totalAccepted: 0,
          totalRejected: 0,
          totalSuccessful: 0,
          totalFailed: 0,
          acceptanceRate: 0.5,
          successRate: 0.5,
          confidence: 0.5,
          averageSavings: 0,
          totalSavings: 0,
          averageProcessingTime: 0,
          isActive: true,
        });
      }

      const previousWeight = strategy.currentWeight;
      const previousStats = {
        totalRecommendations: strategy.totalRecommendations,
        totalAccepted: strategy.totalAccepted,
        totalRejected: strategy.totalRejected,
        totalSuccessful: strategy.totalSuccessful,
        totalFailed: strategy.totalFailed,
      };

      // Update counters based on interaction
      strategy.totalRecommendations += 1;

      if (status === 'accepted') {
        strategy.totalAccepted += 1;
        if (success) {
          strategy.totalSuccessful += 1;
        } else {
          strategy.totalFailed += 1;
        }
      } else if (status === 'rejected') {
        strategy.totalRejected += 1;
      }

      // Calculate rates
      strategy.acceptanceRate =
        strategy.totalRecommendations > 0
          ? strategy.totalAccepted / strategy.totalRecommendations
          : 0.5;

      strategy.successRate =
        strategy.totalAccepted > 0
          ? strategy.totalSuccessful / strategy.totalAccepted
          : 0.5;

      // Calculate confidence based on sample size
      strategy.confidence = Math.min(1, strategy.totalRecommendations / 50);

      // Calculate weight adjustment using adaptive learning
      const adjustment = this.calculateWeightAdjustment(
        strategy,
        status,
        success,
      );

      // Apply EMA smoothing to prevent wild swings
      const smoothedAdjustment = adjustment * LearningLoopService.EMA_ALPHA;
      strategy.currentWeight = Math.max(
        0,
        Math.min(1, previousWeight + smoothedAdjustment),
      );

      // Ensure weight doesn't deviate too far from baseline initially
      const maxDeviation = Math.max(0.2, strategy.confidence * 0.5);
      if (
        Math.abs(strategy.currentWeight - strategy.baselineWeight) >
        maxDeviation
      ) {
        strategy.currentWeight =
          strategy.baselineWeight +
          maxDeviation *
            Math.sign(strategy.currentWeight - strategy.baselineWeight);
      }

      strategy.lastUpdated = new Date();

      await strategy.save();

      const weightUpdate: any = {
        entityType: 'recommendation_type',
        entityId: recommendationType,
        previousWeight,
        newWeight: strategy.currentWeight,
        deltaWeight: strategy.currentWeight - previousWeight,
        reason: `${status}_${success ? 'success' : 'failure'}`,
        confidence: strategy.confidence,
        appliedAt: new Date(),
        stats: {
          previous: previousStats,
          current: {
            totalRecommendations: strategy.totalRecommendations,
            totalAccepted: strategy.totalAccepted,
            totalRejected: strategy.totalRejected,
            totalSuccessful: strategy.totalSuccessful,
            totalFailed: strategy.totalFailed,
            acceptanceRate: strategy.acceptanceRate,
            successRate: strategy.successRate,
          },
        },
      };

      this.logger.log('✅ Updated recommendation type weight', {
        type: recommendationType,
        previousWeight: previousWeight.toFixed(3),
        newWeight: strategy.currentWeight.toFixed(3),
        delta: (strategy.currentWeight - previousWeight).toFixed(3),
        confidence: strategy.confidence.toFixed(2),
        acceptanceRate: strategy.acceptanceRate.toFixed(2),
      });

      return weightUpdate;
    } catch (error) {
      this.logger.error('Failed to update recommendation type weight', {
        recommendationType,
        status,
        success,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Calculate weight adjustment based on learning algorithm
   */
  private calculateWeightAdjustment(
    strategy: RecommendationStrategyDocument,
    status: string,
    success: boolean,
  ): number {
    // Base adjustment factors
    const baseAdjustment = 0.02; // Small base adjustment
    const successMultiplier = 1.5; // Bonus for successful recommendations
    const failurePenalty = 2.0; // Penalty for failed recommendations

    let adjustment = 0;

    if (status === 'accepted' && success) {
      // Positive reinforcement: increase weight for successful recommendations
      adjustment = baseAdjustment * successMultiplier;
    } else if (status === 'accepted' && !success) {
      // Negative reinforcement: decrease weight for failed but accepted recommendations
      adjustment = -baseAdjustment * failurePenalty;
    } else if (status === 'rejected') {
      // Strong negative reinforcement: significantly decrease weight for rejected recommendations
      adjustment = -baseAdjustment * failurePenalty * 1.5;
    }

    // Scale adjustment by confidence (more confident = larger adjustments)
    adjustment *= Math.max(0.1, strategy.confidence);

    // Scale by acceptance rate (harder to recommend if acceptance is low)
    const acceptanceFactor = strategy.acceptanceRate < 0.3 ? 0.5 : 1;
    adjustment *= acceptanceFactor;

    // Scale by success rate (more successful = larger positive adjustments)
    if (status === 'accepted') {
      const successFactor = strategy.successRate > 0.7 ? 1.2 : 0.8;
      adjustment *= successFactor;
    }

    // Limit maximum adjustment per update
    return Math.max(
      -LearningLoopService.MAX_WEIGHT_CHANGE,
      Math.min(LearningLoopService.MAX_WEIGHT_CHANGE, adjustment),
    );
  }

  /**
   * Get human-readable strategy name
   */
  private getStrategyDisplayName(strategyId: string): string {
    const names: Record<string, string> = {
      model_switch: 'Model Switching',
      prompt_optimization: 'Prompt Optimization',
      usage_pattern: 'Usage Pattern Analysis',
      cost_alert: 'Cost Alert',
      efficiency_tip: 'Efficiency Tip',
      caching_strategy: 'Caching Strategy',
      routing_change: 'Routing Change',
    };

    return (
      names[strategyId] ||
      strategyId.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())
    );
  }

  /**
   * Apply exponential moving average
   */
  private applyEMA(oldValue: number, newValue: number, alpha: number): number {
    return alpha * newValue + (1 - alpha) * oldValue;
  }

  /**
   * Get learning statistics for a user
   */
  async getUserLearningStats(userId: string): Promise<{
    totalRecommendations: number;
    acceptanceRate: number;
    avgSuccessRate: number;
    avgUserTrust: number;
    topPerformingTypes: Array<{
      type: string;
      successRate: number;
      count: number;
    }>;
  }> {
    try {
      const outcomes = await this.recommendationOutcomeModel
        .find({
          userId: new Types.ObjectId(userId),
        })
        .lean();

      const totalRecommendations = outcomes.length;
      const accepted = outcomes.filter(
        (o: any) => o.interaction?.status === 'accepted',
      ).length;
      const acceptanceRate =
        totalRecommendations > 0 ? accepted / totalRecommendations : 0;

      const withOutcomes = outcomes.filter((o: any) => o.outcome !== undefined);
      const successful = withOutcomes.filter(
        (o: any) => o.outcome?.success === true,
      ).length;
      const avgSuccessRate =
        withOutcomes.length > 0 ? successful / withOutcomes.length : 0;

      const avgUserTrust =
        outcomes.length > 0
          ? outcomes.reduce(
              (sum: number, o: any) =>
                sum + (o.learningSignals?.userTrust ?? 0.5),
              0,
            ) / outcomes.length
          : 0.5;

      // Calculate per-type performance
      const typeStats = new Map<string, { success: number; total: number }>();
      for (const outcome of withOutcomes) {
        const recType = (outcome as any).recommendationType;
        if (!recType) continue;
        if (!typeStats.has(recType)) {
          typeStats.set(recType, { success: 0, total: 0 });
        }
        const stats = typeStats.get(recType);
        if (stats) {
          stats.total++;
          if ((outcome as any).outcome?.success === true) stats.success++;
        }
      }

      const topPerformingTypes = Array.from(typeStats.entries())
        .map(([type, stats]) => ({
          type,
          successRate: stats.total > 0 ? stats.success / stats.total : 0,
          count: stats.total,
        }))
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 5);

      return {
        totalRecommendations,
        acceptanceRate,
        avgSuccessRate,
        avgUserTrust,
        topPerformingTypes,
      };
    } catch (error) {
      this.logger.error('Failed to get user learning stats', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalRecommendations: 0,
        acceptanceRate: 0,
        avgSuccessRate: 0,
        avgUserTrust: 0.5,
        topPerformingTypes: [],
      };
    }
  }

  /**
   * Process pending outcome measurements (called by scheduled job)
   */
  async processPendingOutcomes(): Promise<void> {
    try {
      const cutoffDate = new Date(
        Date.now() -
          LearningLoopService.OUTCOME_MEASUREMENT_DAYS * 24 * 60 * 60 * 1000,
      );

      const pendingOutcomes = await this.recommendationOutcomeModel
        .find({
          'interaction.status': 'accepted',
          outcomeRecordedAt: { $exists: false },
          'interaction.respondedAt': { $lte: cutoffDate },
        })
        .limit(50); // Process in batches

      this.logger.log(
        `📊 Processing ${pendingOutcomes.length} pending outcomes`,
      );

      let processed = 0;
      let failed = 0;

      for (const outcome of pendingOutcomes) {
        try {
          const outcomeId =
            outcome._id instanceof Types.ObjectId
              ? outcome._id
              : new Types.ObjectId(String(outcome._id));
          await this.measureOutcome(outcomeId);
          processed++;
        } catch (error) {
          failed++;
          this.logger.warn('Failed to process outcome', {
            outcomeId:
              outcome._id instanceof Types.ObjectId
                ? String(outcome._id)
                : String(outcome._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.log('✅ Completed pending outcomes processing', {
        processed,
        failed,
        total: pendingOutcomes.length,
      });
    } catch (error) {
      this.logger.error('❌ Failed to process pending outcomes', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get recent recommendation outcomes
   */
  async getRecentRecommendationOutcomes(params: {
    userId?: string;
    startDate: Date;
    endDate: Date;
    limit: number;
  }): Promise<RecommendationOutcomeDocument[]> {
    try {
      const query: any = {
        recommendedAt: {
          $gte: params.startDate,
          $lte: params.endDate,
        },
      };

      if (params.userId) {
        query.userId = new Types.ObjectId(params.userId);
      }

      const outcomes = await this.recommendationOutcomeModel
        .find(query)
        .sort({ recommendedAt: -1 })
        .limit(params.limit)
        .lean();

      this.logger.log('Retrieved recent recommendation outcomes', {
        count: outcomes.length,
        userId: params.userId,
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
      });

      return outcomes as unknown as RecommendationOutcomeDocument[];
    } catch (error) {
      this.logger.error('Failed to get recent recommendation outcomes', {
        error: error instanceof Error ? error.message : String(error),
        userId: params.userId,
      });
      throw error;
    }
  }
}
