import { 
  RecommendationOutcome, 
  IRecommendationOutcome,
  RecommendationContext,
  ActualOutcome,
  WeightUpdate
} from '../models/RecommendationOutcome';
import { ModelPerformanceFingerprint } from '../models/ModelPerformanceFingerprint';
import { Usage } from '../models/Usage';
import { Telemetry } from '../models/Telemetry';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

/**
 * Learning Loop Service
 * Implements the core feedback mechanism: Recommendations → Outcomes → Weight Updates
 * Enables continuous system improvement based on real-world results
 */
export class LearningLoopService {
  private static readonly EMA_ALPHA = 0.15; // Exponential moving average smoothing
  private static readonly MIN_SAMPLE_SIZE = 5; // Minimum samples before trusting outcomes
  private static readonly OUTCOME_MEASUREMENT_DAYS = 7; // Days to measure outcome
  private static readonly MAX_WEIGHT_CHANGE = 0.3; // Maximum single weight adjustment

  /**
   * Track a new recommendation
   */
  static async trackRecommendation(params: {
    recommendationId: mongoose.Types.ObjectId;
    recommendationType: string;
    userId: mongoose.Types.ObjectId;
    tenantId?: string;
    workspaceId?: string;
    context: RecommendationContext;
    recommendedAt: Date;
  }): Promise<IRecommendationOutcome> {
    try {
      const outcome = new RecommendationOutcome({
        recommendationId: params.recommendationId,
        recommendationType: params.recommendationType as 'model_switch' | 'prompt_optimization' | 'usage_pattern' | 'cost_alert' | 'efficiency_tip' | 'caching_strategy' | 'routing_change',
        userId: params.userId,
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        context: params.context,
        interaction: {
          status: 'pending'
        },
        weightUpdates: [],
        learningSignals: {
          recommendationQuality: 0.5,
          predictionAccuracy: 0.5,
          userTrust: 0.5,
          systemLearning: 0.5
        },
        recommendedAt: params.recommendedAt
      });

      await outcome.save();

      loggingService.info('✅ Tracked new recommendation', {
        recommendationId: params.recommendationId.toString(),
        type: params.recommendationType,
        userId: params.userId.toString()
      });

      return outcome;
    } catch (error) {
      loggingService.error('❌ Failed to track recommendation', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Record user interaction with recommendation
   */
  static async recordInteraction(params: {
    recommendationId: mongoose.Types.ObjectId;
    status: 'viewed' | 'accepted' | 'rejected' | 'dismissed';
    feedback?: string;
    rating?: number;
    reason?: string;
  }): Promise<IRecommendationOutcome | null> {
    try {
      const outcome = await RecommendationOutcome.findOne({
        recommendationId: params.recommendationId
      });

      if (!outcome) {
        loggingService.warn('Recommendation outcome not found', {
          recommendationId: params.recommendationId.toString()
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

      loggingService.info('✅ Recorded recommendation interaction', {
        recommendationId: params.recommendationId.toString(),
        status: params.status,
        rating: params.rating
      });

      return outcome;
    } catch (error) {
      loggingService.error('❌ Failed to record interaction', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Measure actual outcome after recommendation was accepted
   */
  static async measureOutcome(
    outcomeId: mongoose.Types.ObjectId
  ): Promise<IRecommendationOutcome | null> {
    try {
      const outcome = await RecommendationOutcome.findById(outcomeId);
      if (!outcome) return null;

      if (outcome.interaction.status !== 'accepted') {
        loggingService.warn('Cannot measure outcome for non-accepted recommendation', {
          outcomeId: outcomeId.toString(),
          status: outcome.interaction.status
        });
        return null;
      }

      const measurementStart = outcome.interaction.respondedAt ?? outcome.recommendedAt;
      const measurementEnd = new Date();
      const daysSinceAcceptance = (measurementEnd.getTime() - measurementStart.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceAcceptance < this.OUTCOME_MEASUREMENT_DAYS) {
        loggingService.info('Too early to measure outcome', {
          outcomeId: outcomeId.toString(),
          daysSinceAcceptance: daysSinceAcceptance.toFixed(1)
        });
        return null;
      }

      // Measure actual performance
      const actualOutcome = await this.collectActualMetrics(
        outcome.userId.toString(),
        outcome.recommendationType,
        outcome.context,
        measurementStart,
        measurementEnd
      );

      outcome.outcome = actualOutcome;
      outcome.outcomeRecordedAt = new Date();

      // Calculate learning signals
      outcome.learningSignals = this.calculateLearningSignals(outcome);

      await outcome.save();

      // Apply learning to weights
      await this.applyLearningToWeights(outcome);

      loggingService.info('✅ Measured recommendation outcome', {
        outcomeId: outcome._id ? String(outcome._id) : 'unknown',
        success: actualOutcome.success,
        successScore: actualOutcome.successScore?.toFixed(2)
      });

      return outcome;
    } catch (error) {
      loggingService.error('❌ Failed to measure outcome', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Schedule outcome measurement for later
   */
  /**
   * Schedule outcome measurement by updating the outcome with a future measurement timestamp.
   * In a real implementation, this would enqueue a background job (e.g. BullMQ, Agenda, or native setTimeout),
   * but here we update the document and rely on a downstream background process to pick it up when due.
   */
  private static async scheduleOutcomeMeasurement(outcome: IRecommendationOutcome): Promise<void> {
    const measurementDelay = this.OUTCOME_MEASUREMENT_DAYS * 24 * 60 * 60 * 1000;
    const scheduledDate = new Date(Date.now() + measurementDelay);

    // Update the outcome entity with the scheduled date
    outcome.learningAppliedAt = scheduledDate;
    await outcome.save();

      loggingService.info('📅 Scheduled outcome measurement', {
        outcomeId: outcome._id ? String(outcome._id) : 'unknown',
        measurementDate: scheduledDate.toISOString()
      });
  }

  /**
   * Collect actual performance metrics after recommendation was applied
   */
  private static async collectActualMetrics(
    userId: string,
    recommendationType: string,
    context: RecommendationContext,
    measurementStart: Date,
    measurementEnd: Date
  ): Promise<ActualOutcome> {
    try {
      let actualLatency = 0;
      let actualCost = 0;
      let actualFailureRate = 0;
      let actualSavings = 0;
      let sampleSize = 0;
      let success = false;

      if (recommendationType === 'model_switch' && context.suggestedModel) {
        // Query telemetry for the suggested model
        const telemetryData = await Telemetry.find({
          user_id: userId,
          gen_ai_model: context.suggestedModel.modelId,
          timestamp: { $gte: measurementStart, $lte: measurementEnd }
        }).lean();

        // Query usage data as fallback
        const usageData = await Usage.find({
          userId: new mongoose.Types.ObjectId(userId),
          model: context.suggestedModel.modelId,
          createdAt: { $gte: measurementStart, $lte: measurementEnd }
        }).lean();

        sampleSize = telemetryData.length + usageData.length;

        if (sampleSize >= this.MIN_SAMPLE_SIZE) {
          // Calculate actual metrics
          const latencies = [
            ...telemetryData.map(t => t.duration_ms),
            ...usageData.map(u => u.responseTime)
          ];
          actualLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

          const costs = [
            ...telemetryData.map(t => t.cost_usd ?? 0),
            ...usageData.map(u => u.cost ?? 0)
          ];
          actualCost = costs.reduce((a, b) => a + b, 0) / costs.length;

          const failures = telemetryData.filter(t => t.status === 'error').length +
            usageData.filter(u => u.errorOccurred).length;
          actualFailureRate = failures / sampleSize;

          // Calculate actual savings compared to baseline
          if (context.currentModel) {
            const expectedCost = context.currentModel.avgCost;
            actualSavings = Math.max(0, (expectedCost - actualCost) * sampleSize);
          }

          // Determine success based on multiple factors
          const latencyImproved = context.suggestedModel.expectedLatency 
            ? actualLatency <= context.suggestedModel.expectedLatency * 1.1 // 10% tolerance
            : true;
          
          const costImproved = context.suggestedModel.expectedCost
            ? actualCost <= context.suggestedModel.expectedCost * 1.1
            : true;
          
          const reliabilityMaintained = actualFailureRate <= (context.currentModel?.failureRate ?? 0.1) * 1.2;

          success = latencyImproved && costImproved && reliabilityMaintained;
        }
      } else {
        // For other recommendation types, measure general performance
        const usageData = await Usage.find({
          userId: new mongoose.Types.ObjectId(userId),
          createdAt: { $gte: measurementStart, $lte: measurementEnd }
        }).lean();

        sampleSize = usageData.length;

        if (sampleSize >= this.MIN_SAMPLE_SIZE) {
          actualLatency = usageData.reduce((sum, u) => sum + u.responseTime, 0) / sampleSize;
          actualCost = usageData.reduce((sum, u) => sum + u.cost, 0) / sampleSize;
          actualFailureRate = usageData.filter(u => u.errorOccurred).length / sampleSize;
          
          // Success if metrics improved or stayed stable
          success = actualFailureRate < 0.1 && actualCost < 0.01;
        }
      }

      // Calculate composite success score
      const successScore = this.calculateSuccessScore(
        actualLatency,
        actualCost,
        actualFailureRate,
        context
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
        sampleSize
      };
    } catch (error) {
      loggingService.error('Failed to collect actual metrics', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return failure outcome on error
      return {
        success: false,
        measurementStart,
        measurementEnd,
        sampleSize: 0
      };
    }
  }

  /**
   * Calculate composite success score
   */
  private static calculateSuccessScore(
    actualLatency: number,
    actualCost: number,
    actualFailureRate: number,
    context: RecommendationContext
  ): number {
    let score = 1.0;

    // Penalize based on deviations from expectations
    if (context.suggestedModel) {
      if (context.suggestedModel.expectedLatency > 0) {
        const latencyRatio = actualLatency / context.suggestedModel.expectedLatency;
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
  private static calculateLearningSignals(outcome: IRecommendationOutcome): {
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
        systemLearning: 0.5
      };
    }

    // Recommendation quality based on success
    const recommendationQuality = outcome.outcome.successScore ?? (outcome.outcome.success ? 0.8 : 0.2);

    // Prediction accuracy based on how close actual was to expected
    let predictionAccuracy = 0.5;
    if (outcome.context.suggestedModel && outcome.outcome.actualCost !== undefined) {
      const expectedCost = outcome.context.suggestedModel.expectedCost;
      if (expectedCost > 0) {
        const costError = Math.abs(outcome.outcome.actualCost - expectedCost) / expectedCost;
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
      systemLearning
    };
  }

  /**
   * Apply learning to model routing weights
   */
  private static async applyLearningToWeights(outcome: IRecommendationOutcome): Promise<void> {
    try {
      if (!outcome.outcome || outcome.outcome.sampleSize < this.MIN_SAMPLE_SIZE) {
        loggingService.info('Insufficient data to apply learning', {
          outcomeId: outcome._id ? String(outcome._id) : 'unknown'
        });
        return;
      }

      const weightUpdates: WeightUpdate[] = [];

      // Update model weights for model_switch recommendations
      if (outcome.recommendationType === 'model_switch' && outcome.context.suggestedModel) {
        const modelId = outcome.context.suggestedModel.modelId;
        const weightUpdate = await this.updateModelWeight(
          modelId,
          outcome.outcome.success,
          outcome.learningSignals.systemLearning
        );
        
        if (weightUpdate) {
          weightUpdates.push(weightUpdate);
        }
      }

      // Update recommendation type weights based on acceptance/rejection
      const recTypeUpdate = this.updateRecommendationTypeWeight(
        outcome.recommendationType,
        outcome.interaction.status,
        outcome.outcome.success
      );
      
      if (recTypeUpdate) {
        weightUpdates.push(recTypeUpdate);
      }

      outcome.weightUpdates = weightUpdates;
      outcome.learningAppliedAt = new Date();
      await outcome.save();

      loggingService.info('✅ Applied learning to weights', {
        outcomeId: outcome._id ? String(outcome._id) : 'unknown',
        updatesApplied: weightUpdates.length
      });
    } catch (error) {
      loggingService.error('❌ Failed to apply learning to weights', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Apply immediate learning from rejection
   */
  private static async applyRejectionLearning(outcome: IRecommendationOutcome): Promise<void> {
    try {
      // Reduce weight for rejected recommendation type
      const weightUpdate = this.updateRecommendationTypeWeight(
        outcome.recommendationType,
        'rejected',
        false
      );

      if (weightUpdate) {
        outcome.weightUpdates = [weightUpdate];
        outcome.learningAppliedAt = new Date();
        await outcome.save();
        
        loggingService.info('✅ Applied rejection learning', {
          outcomeId: outcome._id ? String(outcome._id) : 'unknown',
          type: outcome.recommendationType
        });
      }
    } catch (error) {
      loggingService.error('Failed to apply rejection learning', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Update model routing weight based on outcome
   */
  private static async updateModelWeight(
    modelId: string,
    success: boolean,
    learningStrength: number
  ): Promise<WeightUpdate | null> {
    try {
      const fingerprint = await ModelPerformanceFingerprint.findOne({ modelId });
      if (!fingerprint) {
        loggingService.warn('Model fingerprint not found', { modelId });
        return null;
      }

      const previousWeight = fingerprint.routingWeight;
      
      // Calculate weight adjustment
      const baseAdjustment = success ? 0.05 : -0.05;
      const adjustment = baseAdjustment * learningStrength;
      const constrainedAdjustment = Math.max(-this.MAX_WEIGHT_CHANGE, Math.min(this.MAX_WEIGHT_CHANGE, adjustment));
      
      // Apply EMA smoothing
      let newWeight = previousWeight + constrainedAdjustment;
      newWeight = this.applyEMA(previousWeight, newWeight, this.EMA_ALPHA);
      newWeight = Math.max(0, Math.min(1, newWeight));

      fingerprint.routingWeight = newWeight;
      await fingerprint.save();

      const weightUpdate: WeightUpdate = {
        entityType: 'model',
        entityId: modelId,
        previousWeight,
        newWeight,
        deltaWeight: newWeight - previousWeight,
        reason: success ? 'positive_outcome' : 'negative_outcome',
        confidence: learningStrength,
        appliedAt: new Date()
      };

      loggingService.info('✅ Updated model weight', {
        modelId,
        previousWeight: previousWeight.toFixed(3),
        newWeight: newWeight.toFixed(3),
        delta: (newWeight - previousWeight).toFixed(3)
      });

      return weightUpdate;
    } catch (error) {
      loggingService.error('Failed to update model weight', {
        modelId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Update recommendation type weight (stored in-memory or cache)
   */
  private static updateRecommendationTypeWeight(
    recommendationType: string,
    status: string,
    success: boolean
  ): WeightUpdate | null {
    try {
      // In production, this would update a centralized recommendation strategy store
      // For now, we'll just log the update
      
      const previousWeight = 0.5; // Would fetch from store
      let adjustment = 0;

      if (status === 'accepted' && success) {
        adjustment = 0.05;
      } else if (status === 'accepted' && !success) {
        adjustment = -0.03;
      } else if (status === 'rejected') {
        adjustment = -0.02;
      }

      const newWeight = Math.max(0, Math.min(1, previousWeight + adjustment));

      const weightUpdate: WeightUpdate = {
        entityType: 'recommendation_type',
        entityId: recommendationType,
        previousWeight,
        newWeight,
        deltaWeight: adjustment,
        reason: `${status}_${success ? 'success' : 'failure'}`,
        confidence: 0.7,
        appliedAt: new Date()
      };

      loggingService.info('✅ Updated recommendation type weight', {
        type: recommendationType,
        delta: adjustment.toFixed(3)
      });

      return weightUpdate;
    } catch (error) {
      loggingService.error('Failed to update recommendation type weight', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Apply exponential moving average
   */
  private static applyEMA(oldValue: number, newValue: number, alpha: number): number {
    return alpha * newValue + (1 - alpha) * oldValue;
  }

  /**
   * Get learning statistics for a user
   */
  static async getUserLearningStats(userId: string): Promise<{
    totalRecommendations: number;
    acceptanceRate: number;
    avgSuccessRate: number;
    avgUserTrust: number;
    topPerformingTypes: Array<{ type: string; successRate: number; count: number }>;
  }> {
    try {
      const outcomes = await RecommendationOutcome.find({
        userId: new mongoose.Types.ObjectId(userId)
      }).lean();

      // Type guard for lean results
      type LeanOutcome = {
        _id: unknown;
        recommendationType?: string;
        interaction?: { status?: string };
        outcome?: { success?: boolean };
        learningSignals?: { userTrust?: number };
      };

      const totalRecommendations = outcomes.length;
      const accepted = outcomes.filter((o: LeanOutcome) => o.interaction?.status === 'accepted').length;
      const acceptanceRate = totalRecommendations > 0 ? accepted / totalRecommendations : 0;

      const withOutcomes = outcomes.filter((o: LeanOutcome) => o.outcome !== undefined);
      const successful = withOutcomes.filter((o: LeanOutcome) => o.outcome?.success === true).length;
      const avgSuccessRate = withOutcomes.length > 0 ? successful / withOutcomes.length : 0;

      const avgUserTrust = outcomes.length > 0
        ? outcomes.reduce((sum: number, o: LeanOutcome) => sum + (o.learningSignals?.userTrust ?? 0.5), 0) / outcomes.length
        : 0.5;

      // Calculate per-type performance
      const typeStats = new Map<string, { success: number; total: number }>();
      for (const outcome of withOutcomes) {
        const recType = outcome.recommendationType;
        if (!recType) continue;
        if (!typeStats.has(recType)) {
          typeStats.set(recType, { success: 0, total: 0 });
        }
        const stats = typeStats.get(recType);
        if (stats) {
          stats.total++;
          if (outcome.outcome?.success === true) stats.success++;
        }
      }

      const topPerformingTypes = Array.from(typeStats.entries())
        .map(([type, stats]) => ({
          type,
          successRate: stats.total > 0 ? stats.success / stats.total : 0,
          count: stats.total
        }))
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 5);

      return {
        totalRecommendations,
        acceptanceRate,
        avgSuccessRate,
        avgUserTrust,
        topPerformingTypes
      };
    } catch (error) {
      loggingService.error('Failed to get user learning stats', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        totalRecommendations: 0,
        acceptanceRate: 0,
        avgSuccessRate: 0,
        avgUserTrust: 0.5,
        topPerformingTypes: []
      };
    }
  }

  /**
   * Process pending outcome measurements (called by scheduled job)
   */
  static async processPendingOutcomes(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - this.OUTCOME_MEASUREMENT_DAYS * 24 * 60 * 60 * 1000);

      const pendingOutcomes = await RecommendationOutcome.find({
        'interaction.status': 'accepted',
        outcomeRecordedAt: { $exists: false },
        'interaction.respondedAt': { $lte: cutoffDate }
      }).limit(50); // Process in batches

      loggingService.info(`📊 Processing ${pendingOutcomes.length} pending outcomes`);

      let processed = 0;
      let failed = 0;

      for (const outcome of pendingOutcomes) {
        try {
          const outcomeId = outcome._id instanceof mongoose.Types.ObjectId 
            ? outcome._id 
            : new mongoose.Types.ObjectId(String(outcome._id));
          await this.measureOutcome(outcomeId);
          processed++;
        } catch (error) {
          failed++;
          loggingService.warn('Failed to process outcome', {
            outcomeId: outcome._id instanceof mongoose.Types.ObjectId 
              ? String(outcome._id) 
              : String(outcome._id),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      loggingService.info('✅ Completed pending outcomes processing', {
        processed,
        failed,
        total: pendingOutcomes.length
      });
    } catch (error) {
      loggingService.error('❌ Failed to process pending outcomes', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

