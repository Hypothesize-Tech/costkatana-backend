/**
 * Optimization Feedback Loop Service
 *
 * Learns from user interactions to improve future suggestions:
 * - Tracks acceptance/rejection patterns
 * - Updates ML models based on feedback
 * - Personalizes suggestions over time
 * - Records optimization outcomes
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  UserProfile,
  UserProfileDocument,
} from '../../../schemas/analytics/user-profile.schema';
import {
  SuggestionOutcome,
  SuggestionOutcomeDocument,
} from '../../../schemas/analytics/suggestion-outcome.schema';
import {
  ModelPerformance,
  ModelPerformanceDocument,
} from '../../../schemas/analytics/model-performance.schema';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface UserContext {
  promptComplexity: number;
  userTier: 'free' | 'pro' | 'enterprise';
  costBudget: 'low' | 'medium' | 'high';
  taskType: string;
  promptLength: number;
  previousSuggestions?: string[];
  acceptanceRate?: number;
}

export interface OutcomeSignals {
  userAcceptance: boolean;
  costSaved: number;
  qualityMaintained: boolean;
  userRating: number; // 1-5
  errorOccurred: boolean;
  rejectionReason?: string;
  actualUsage?: {
    tokensUsed: number;
    costIncurred: number;
    responseQuality: number;
  };
}

@Injectable()
export class OptimizationFeedbackLoopService {
  private readonly logger = new Logger(OptimizationFeedbackLoopService.name);

  constructor(
    private configService: ConfigService,
    @InjectModel(UserProfile.name)
    private userProfileModel: Model<UserProfileDocument>,
    @InjectModel(SuggestionOutcome.name)
    private suggestionOutcomeModel: Model<SuggestionOutcomeDocument>,
    @InjectModel(ModelPerformance.name)
    private modelPerformanceModel: Model<ModelPerformanceDocument>,
  ) {}

  // Removed static getInstance - now using dependency injection

  /**
   * Learn from user action (accept/reject suggestion)
   */
  async learnFromUserAction(
    userId: string,
    action: 'accept' | 'reject',
    context: UserContext,
  ): Promise<void> {
    try {
      this.logger.log('Learning from user action', {
        userId,
        action,
        taskType: context.taskType,
        promptComplexity: context.promptComplexity,
      });

      // Update user profile
      await this.updateUserProfile(userId, action, context);

      // Update suggestion patterns
      await this.updateSuggestionPatterns(context.taskType, action);

      // Log learning event
      this.logger.debug('Updated learning models', {
        userId,
        action,
        taskType: context.taskType,
      });
    } catch (error) {
      this.logger.error('Failed to learn from user action', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        action,
      });
    }
  }

  /**
   * Record optimization outcome with detailed signals
   */
  async recordOptimizationOutcome(
    suggestionId: string,
    userId: string,
    context: UserContext,
    originalModel: string,
    suggestedModel: string,
    signals: OutcomeSignals,
  ): Promise<void> {
    try {
      this.logger.log('Recording optimization outcome', {
        suggestionId,
        userId,
        originalModel,
        suggestedModel,
        accepted: signals.userAcceptance,
        costSaved: signals.costSaved,
        qualityMaintained: signals.qualityMaintained,
      });

      // Store outcome signals in database
      const suggestionOutcome = new this.suggestionOutcomeModel({
        userId,
        suggestionId,
        suggestionType: `${originalModel}->${suggestedModel}`,
        userAcceptance: signals.userAcceptance,
        costSaved: signals.costSaved,
        qualityMaintained: signals.qualityMaintained,
        userRating: signals.userRating,
        errorOccurred: signals.errorOccurred,
        rejectionReason: signals.rejectionReason,
        actualUsage: signals.actualUsage,
        context: {
          promptComplexity: context.promptComplexity,
          userTier: context.userTier,
          costBudget: context.costBudget,
          taskType: context.taskType,
          promptLength: context.promptLength,
        },
      });

      await suggestionOutcome.save();

      // Update model performance metrics
      await this.updateModelPerformance(originalModel, suggestedModel, signals);

      // Update user learning data
      await this.updateUserLearningData(userId, context, signals);

      // Trigger model retraining if needed
      const shouldRetrain = await this.shouldRetrainModel();
      if (shouldRetrain) {
        await this.triggerModelRetraining();
      }

      // Get signals count for logging
      const signalsCount = await this.suggestionOutcomeModel
        .countDocuments({ suggestionId })
        .exec();

      this.logger.debug('Optimization outcome recorded', {
        suggestionId,
        userId,
        signalsCount,
        shouldRetrain,
      });
    } catch (error) {
      this.logger.error('Failed to record optimization outcome', {
        error: error instanceof Error ? error.message : String(error),
        suggestionId,
        userId,
      });
    }
  }

  /**
   * Get personalized suggestions for user
   */
  async getPersonalizedSuggestions(
    userId: string,
    baseSuggestions: any[],
  ): Promise<any[]> {
    try {
      const userProfile = await this.userProfileModel
        .findOne({ userId })
        .exec();
      if (!userProfile) {
        return baseSuggestions; // Return original suggestions if no profile
      }

      // Convert database UserProfile to UserContext for compatibility
      const userContext: UserContext = {
        promptComplexity: userProfile.promptComplexity,
        userTier: userProfile.userTier,
        costBudget: userProfile.costBudget,
        taskType: userProfile.taskType,
        promptLength: userProfile.promptLength,
        previousSuggestions: userProfile.previousSuggestions,
        acceptanceRate: userProfile.acceptanceRate,
      };

      // Filter and rank suggestions based on user preferences
      const personalized = baseSuggestions
        .filter((suggestion) =>
          this.shouldShowSuggestion(suggestion, userContext),
        )
        .map((suggestion) => ({
          ...suggestion,
          confidence: this.adjustConfidence(suggestion.confidence, userContext),
          priority: this.calculatePersonalizedPriority(suggestion, userContext),
        }))
        .sort((a, b) => b.priority - a.priority);

      this.logger.debug('Generated personalized suggestions', {
        userId,
        originalCount: baseSuggestions.length,
        personalizedCount: personalized.length,
        hasProfile: !!userProfile,
      });

      return personalized;
    } catch (error) {
      this.logger.error('Failed to personalize suggestions', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return baseSuggestions; // Fallback to original suggestions
    }
  }

  /**
   * Get user acceptance rate for personalization
   */
  async getUserAcceptanceRate(
    userId: string,
    suggestionType?: string,
  ): Promise<number> {
    try {
      const userProfile = await this.userProfileModel
        .findOne({ userId })
        .exec();
      if (!userProfile) {
        return 0.5; // Default 50% acceptance rate
      }

      if (suggestionType && userProfile.previousSuggestions) {
        // Calculate type-specific acceptance rate from outcomes
        const recentOutcomes = await this.suggestionOutcomeModel
          .find({ userId, suggestionType })
          .sort({ createdAt: -1 })
          .limit(20)
          .exec();

        if (recentOutcomes.length > 0) {
          const accepted = recentOutcomes.filter(
            (o) => o.userAcceptance,
          ).length;
          return accepted / recentOutcomes.length;
        }
      }

      return userProfile.acceptanceRate || 0.5;
    } catch (error) {
      this.logger.error('Failed to get user acceptance rate', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return 0.5;
    }
  }

  /**
   * Update user profile based on action
   */
  private async updateUserProfile(
    userId: string,
    action: 'accept' | 'reject',
    context: UserContext,
  ): Promise<void> {
    try {
      // Get or create user profile
      let userProfile = await this.userProfileModel.findOne({ userId }).exec();

      if (!userProfile) {
        userProfile = new this.userProfileModel({
          userId,
          promptComplexity: context.promptComplexity || 50,
          userTier: context.userTier,
          costBudget: context.costBudget,
          taskType: context.taskType,
          promptLength: context.promptLength,
          acceptanceRate: 0.5,
          previousSuggestions: [],
          totalSuggestionsShown: 0,
          totalSuggestionsAccepted: 0,
        });
      }

      // Update totals
      userProfile.totalSuggestionsShown += 1;
      if (action === 'accept') {
        userProfile.totalSuggestionsAccepted += 1;
      }

      // Update acceptance rate
      userProfile.acceptanceRate =
        userProfile.totalSuggestionsAccepted /
        userProfile.totalSuggestionsShown;

      // Track suggestion types
      userProfile.previousSuggestions = userProfile.previousSuggestions || [];
      userProfile.previousSuggestions.push(context.taskType);

      // Keep only recent suggestions (last 50)
      if (userProfile.previousSuggestions.length > 50) {
        userProfile.previousSuggestions =
          userProfile.previousSuggestions.slice(-50);
      }

      // Update other context fields
      userProfile.promptComplexity = context.promptComplexity;
      userProfile.taskType = context.taskType;
      userProfile.promptLength = context.promptLength;
      userProfile.lastUpdated = new Date();

      await userProfile.save();
    } catch (error) {
      this.logger.error('Failed to update user profile', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        action,
      });
    }
  }

  /**
   * Update suggestion patterns and model performance
   */
  private async updateSuggestionPatterns(
    taskType: string,
    action: 'accept' | 'reject',
  ): Promise<void> {
    try {
      // Update model performance data (using a generic model ID when specific ID is unavailable)
      const modelId = `pattern_${taskType}`;

      let modelPerf = await this.modelPerformanceModel
        .findOne({
          modelId,
          suggestionType: taskType,
        })
        .exec();

      if (!modelPerf) {
        modelPerf = new this.modelPerformanceModel({
          modelId,
          suggestionType: taskType,
          totalSuggestions: 0,
          acceptedSuggestions: 0,
          averageRating: 3.0,
          totalCostSaved: 0,
          totalTokensSaved: 0,
          averageResponseTime: 0,
          successRate: 0,
          averageCostSavingsPercentage: 0,
          dailyStats: [],
        });
      }

      modelPerf.totalSuggestions += 1;
      if (action === 'accept') {
        modelPerf.acceptedSuggestions += 1;
      }

      modelPerf.successRate =
        modelPerf.acceptedSuggestions / modelPerf.totalSuggestions;
      modelPerf.lastUpdated = new Date();

      await modelPerf.save();

      this.logger.debug('Updated suggestion patterns', {
        taskType,
        action,
        modelId,
      });
    } catch (error) {
      this.logger.error('Failed to update suggestion patterns', {
        error: error instanceof Error ? error.message : String(error),
        taskType,
        action,
      });
    }
  }

  /**
   * Update model performance metrics
   */
  private async updateModelPerformance(
    originalModel: string,
    suggestedModel: string,
    signals: OutcomeSignals,
  ): Promise<void> {
    try {
      const modelId = `${originalModel}->${suggestedModel}`;
      const suggestionType = 'model_optimization';

      let modelPerf = await this.modelPerformanceModel
        .findOne({
          modelId,
          suggestionType,
        })
        .exec();

      if (!modelPerf) {
        modelPerf = new this.modelPerformanceModel({
          modelId,
          suggestionType,
          totalSuggestions: 0,
          acceptedSuggestions: 0,
          averageRating: 3.0,
          totalCostSaved: 0,
          totalTokensSaved: 0,
          averageResponseTime: 0,
          successRate: 0,
          averageCostSavingsPercentage: 0,
          dailyStats: [],
        });
      }

      modelPerf.totalSuggestions++;
      if (signals.userAcceptance) {
        modelPerf.acceptedSuggestions++;
      }
      modelPerf.totalCostSaved += signals.costSaved;

      // Update average rating
      const totalRatings = modelPerf.totalSuggestions;
      modelPerf.averageRating =
        (modelPerf.averageRating * (totalRatings - 1) + signals.userRating) /
        totalRatings;

      modelPerf.successRate =
        modelPerf.acceptedSuggestions / modelPerf.totalSuggestions;
      modelPerf.lastUpdated = new Date();

      await modelPerf.save();
    } catch (error) {
      this.logger.error('Failed to update model performance', {
        error: error instanceof Error ? error.message : String(error),
        originalModel,
        suggestedModel,
      });
    }
  }

  /**
   * Update user learning data
   */
  private async updateUserLearningData(
    userId: string,
    context: UserContext,
    signals: OutcomeSignals,
  ): Promise<void> {
    try {
      // Record detailed outcome data for advanced learning
      const outcomeData = new this.suggestionOutcomeModel({
        userId,
        suggestionId: generateSecureId('learning'),
        suggestionType: context.taskType || 'general',
        userAcceptance: signals.userAcceptance,
        costSaved: signals.costSaved,
        qualityMaintained: signals.qualityMaintained,
        userRating: signals.userRating,
        errorOccurred: signals.errorOccurred,
        rejectionReason: signals.rejectionReason,
        actualUsage: signals.actualUsage,
        context: {
          promptComplexity: context.promptComplexity,
          userTier: context.userTier,
          costBudget: context.costBudget,
          taskType: context.taskType,
          promptLength: context.promptLength,
        },
      });

      await outcomeData.save();

      // Update learning patterns for future suggestions
      await this.updateLearningPatterns(userId, context, signals);

      this.logger.debug('Updated user learning data with detailed outcomes', {
        userId,
        taskType: context.taskType,
        accepted: signals.userAcceptance,
        costSaved: signals.costSaved,
        outcomeId: outcomeData._id,
      });
    } catch (error) {
      this.logger.error('Failed to update user learning data', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Update learning patterns based on user behavior
   */
  private async updateLearningPatterns(
    userId: string,
    context: UserContext,
    signals: OutcomeSignals,
  ): Promise<void> {
    try {
      // Analyze patterns and update future suggestion strategies
      const recentOutcomes = await this.suggestionOutcomeModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .exec();

      // Calculate success patterns
      const successPatterns = this.analyzeSuccessPatterns(recentOutcomes);

      // Update user preferences based on patterns
      await this.updateUserPreferences(userId, successPatterns);

      // Update model performance insights
      await this.updateModelInsights(userId, recentOutcomes, signals);

      this.logger.debug('Updated learning patterns', {
        userId,
        patternsAnalyzed: successPatterns.length,
        recentOutcomes: recentOutcomes.length,
      });
    } catch (error) {
      this.logger.warn('Failed to update learning patterns', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Analyze success patterns from recent outcomes
   */
  private analyzeSuccessPatterns(outcomes: any[]): Array<{
    pattern: string;
    successRate: number;
    confidence: number;
  }> {
    const patterns: Record<string, { accepted: number; total: number }> = {};

    outcomes.forEach((outcome) => {
      const key = `${outcome.suggestionType}_${outcome.context?.userTier || 'unknown'}_${outcome.context?.taskType || 'unknown'}`;

      if (!patterns[key]) {
        patterns[key] = { accepted: 0, total: 0 };
      }

      patterns[key].total++;
      if (outcome.userAcceptance) {
        patterns[key].accepted++;
      }
    });

    return Object.entries(patterns).map(([pattern, stats]) => ({
      pattern,
      successRate: stats.total > 0 ? stats.accepted / stats.total : 0,
      confidence: Math.min(stats.total / 10, 1), // More data = higher confidence
    }));
  }

  /**
   * Update user preferences based on success patterns
   */
  private async updateUserPreferences(
    userId: string,
    patterns: Array<{
      pattern: string;
      successRate: number;
      confidence: number;
    }>,
  ): Promise<void> {
    try {
      // Find most successful patterns
      const successfulPatterns = patterns
        .filter((p) => p.successRate > 0.7 && p.confidence > 0.5)
        .sort((a, b) => b.successRate - a.successRate);

      if (successfulPatterns.length > 0) {
        // Update user profile with successful patterns
        await this.userProfileModel.updateOne(
          { userId },
          {
            $set: {
              lastUpdated: new Date(),
            },
            $push: {
              previousSuggestions: {
                $each: successfulPatterns.slice(0, 3).map((p) => p.pattern),
                $slice: -10, // Keep last 10
              },
            },
          },
        );
      }
    } catch (error) {
      this.logger.warn('Failed to update user preferences', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Update model performance insights
   */
  private async updateModelInsights(
    userId: string,
    outcomes: any[],
    currentSignals: OutcomeSignals,
  ): Promise<void> {
    try {
      // Group outcomes by suggestion type
      const insights: Record<
        string,
        {
          total: number;
          accepted: number;
          avgRating: number;
          totalCostSaved: number;
        }
      > = {};

      outcomes.forEach((outcome) => {
        const type = outcome.suggestionType;
        if (!insights[type]) {
          insights[type] = {
            total: 0,
            accepted: 0,
            avgRating: 0,
            totalCostSaved: 0,
          };
        }

        insights[type].total++;
        if (outcome.userAcceptance) {
          insights[type].accepted++;
        }
        insights[type].avgRating += outcome.userRating;
        insights[type].totalCostSaved += outcome.costSaved || 0;
      });

      // Update model performance records
      for (const [type, data] of Object.entries(insights)) {
        if (data.total > 0) {
          data.avgRating /= data.total;

          await this.modelPerformanceModel.updateOne(
            {
              modelId: `user_${userId}_${type}`,
              suggestionType: type,
            },
            {
              $inc: {
                totalSuggestions: data.total,
                acceptedSuggestions: data.accepted,
                totalCostSaved: data.totalCostSaved,
              },
              $set: {
                averageRating: data.avgRating,
                successRate: data.accepted / data.total,
                lastUpdated: new Date(),
              },
            },
            { upsert: true },
          );
        }
      }
    } catch (error) {
      this.logger.warn('Failed to update model insights', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Check if model retraining should be triggered
   */
  private async shouldRetrainModel(): Promise<boolean> {
    try {
      // Simple heuristic: retrain every 1000 suggestions
      const totalSuggestions = await this.suggestionOutcomeModel
        .countDocuments()
        .exec();

      return totalSuggestions % 1000 === 0;
    } catch (error) {
      this.logger.error('Failed to check retraining trigger', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Trigger model retraining
   */
  private async triggerModelRetraining(): Promise<void> {
    try {
      this.logger.log('Starting model retraining process');

      // Step 1: Analyze recent performance data
      const performanceAnalysis = await this.analyzeModelPerformance();

      // Step 2: Identify models that need retraining
      const modelsNeedingRetraining = performanceAnalysis.filter(
        (model) => model.needsRetraining,
      );

      if (modelsNeedingRetraining.length === 0) {
        this.logger.log('No models require retraining at this time');
        return;
      }

      // Step 3: Update model weights and parameters
      for (const model of modelsNeedingRetraining) {
        await this.retrainModel(model.modelId, model.suggestionType);
      }

      // Step 4: Validate retrained models
      const validationResults = await this.validateRetrainedModels(
        modelsNeedingRetraining,
      );

      // Step 5: Update model performance records
      await this.updateRetrainedModelStats(validationResults);

      this.logger.log('Model retraining completed successfully', {
        modelsRetrained: modelsNeedingRetraining.length,
        validationResults: validationResults.length,
      });
    } catch (error) {
      this.logger.error('Model retraining failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Analyze current model performance to determine retraining needs
   */
  private async analyzeModelPerformance(): Promise<
    Array<{
      modelId: string;
      suggestionType: string;
      needsRetraining: boolean;
      currentSuccessRate: number;
      recentDecline: boolean;
      dataPoints: number;
    }>
  > {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get all model performance records
      const performances = await this.modelPerformanceModel
        .find({ lastUpdated: { $gte: thirtyDaysAgo } })
        .exec();

      const analysisResults = await Promise.all(
        performances.map(async (perf) => {
          // Get recent outcomes for this model type
          const recentOutcomes = await this.suggestionOutcomeModel
            .find({
              suggestionType: perf.suggestionType,
              createdAt: { $gte: thirtyDaysAgo },
            })
            .sort({ createdAt: -1 })
            .limit(100)
            .exec();

          // Analyze performance trends
          const needsRetraining = this.determineRetrainingNeed(
            perf,
            recentOutcomes,
          );

          return {
            modelId: perf.modelId,
            suggestionType: perf.suggestionType,
            needsRetraining,
            currentSuccessRate: perf.successRate,
            recentDecline: this.detectRecentDecline(recentOutcomes),
            dataPoints: recentOutcomes.length,
          };
        }),
      );

      return analysisResults.filter(
        (result) => result.needsRetraining || result.recentDecline,
      );
    } catch (error) {
      this.logger.error('Failed to analyze model performance', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Determine if a model needs retraining
   */
  private determineRetrainingNeed(
    performance: any,
    recentOutcomes: any[],
  ): boolean {
    // Retrain if:
    // 1. Success rate below 60%
    // 2. Significant decline in recent performance
    // 3. Not enough recent data (less than 50 outcomes)
    // 4. High variance in outcomes

    if (performance.successRate < 0.6) return true;
    if (recentOutcomes.length < 50) return true;

    const recentSuccessRate = this.calculateRecentSuccessRate(recentOutcomes);
    const decline = performance.successRate - recentSuccessRate;

    if (decline > 0.1) return true; // 10% decline

    return false;
  }

  /**
   * Calculate recent success rate from outcomes
   */
  private calculateRecentSuccessRate(outcomes: any[]): number {
    if (outcomes.length === 0) return 0;

    const accepted = outcomes.filter((o) => o.userAcceptance).length;
    return accepted / outcomes.length;
  }

  /**
   * Detect recent performance decline
   */
  private detectRecentDecline(outcomes: any[]): boolean {
    if (outcomes.length < 20) return false;

    const midPoint = Math.floor(outcomes.length / 2);
    const recentOutcomes = outcomes.slice(0, midPoint);
    const olderOutcomes = outcomes.slice(midPoint);

    const recentRate = this.calculateRecentSuccessRate(recentOutcomes);
    const olderRate = this.calculateRecentSuccessRate(olderOutcomes);

    return olderRate - recentRate > 0.05; // 5% decline
  }

  /**
   * Retrain a specific model
   */
  private async retrainModel(
    modelId: string,
    suggestionType: string,
  ): Promise<void> {
    try {
      this.logger.log('Retraining model', { modelId, suggestionType });

      // Get training data from recent outcomes
      const trainingData = await this.getTrainingData(suggestionType);

      // Apply retraining algorithm (simplified)
      const newWeights = this.calculateNewModelWeights(trainingData);

      // Update model performance record with new weights
      await this.modelPerformanceModel.updateOne(
        { modelId, suggestionType },
        {
          $set: {
            lastRetrained: new Date(),
            modelVersion:
              (await this.getCurrentModelVersion(modelId, suggestionType)) + 1,
            retrainingMetrics: {
              trainingDataSize: trainingData.length,
              newWeights: newWeights,
              retrainedAt: new Date(),
            },
          },
        },
      );

      this.logger.log('Model retrained successfully', {
        modelId,
        suggestionType,
        trainingDataSize: trainingData.length,
      });
    } catch (error) {
      this.logger.error('Failed to retrain model', {
        error: error instanceof Error ? error.message : String(error),
        modelId,
        suggestionType,
      });
      throw error;
    }
  }

  /**
   * Get training data for model retraining
   */
  private async getTrainingData(suggestionType: string): Promise<any[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return await this.suggestionOutcomeModel
      .find({
        suggestionType,
        createdAt: { $gte: thirtyDaysAgo },
      })
      .sort({ createdAt: -1 })
      .limit(1000)
      .exec();
  }

  /**
   * Calculate new model weights based on training data
   */
  private calculateNewModelWeights(
    trainingData: any[],
  ): Record<string, number> {
    // Simplified weight calculation based on successful patterns
    const weights: Record<string, number> = {
      promptComplexity: 0.3,
      userTier: 0.2,
      costBudget: 0.25,
      taskType: 0.15,
      acceptanceHistory: 0.1,
    };

    // Adjust weights based on training data patterns
    if (trainingData.length > 0) {
      const successfulOutcomes = trainingData.filter((o) => o.userAcceptance);

      // Increase weight for features that correlate with success
      if (successfulOutcomes.length > trainingData.length * 0.6) {
        weights.promptComplexity += 0.1;
        weights.taskType += 0.05;
      }
    }

    return weights;
  }

  /**
   * Get current model version
   */
  private async getCurrentModelVersion(
    modelId: string,
    suggestionType: string,
  ): Promise<number> {
    const model = await this.modelPerformanceModel
      .findOne({ modelId, suggestionType })
      .exec();
    return (model as { modelVersion?: number })?.modelVersion ?? 1;
  }

  /**
   * Validate retrained models
   */
  private async validateRetrainedModels(models: any[]): Promise<
    Array<{
      modelId: string;
      validationScore: number;
      isValid: boolean;
    }>
  > {
    const validationResults = await Promise.all(
      models.map(async (model) => {
        try {
          // Run validation tests
          const score = await this.runModelValidation(
            model.modelId,
            model.suggestionType,
          );

          return {
            modelId: model.modelId,
            validationScore: score,
            isValid: score > 0.7, // 70% validation threshold
          };
        } catch (error) {
          this.logger.error('Model validation failed', {
            error: error instanceof Error ? error.message : String(error),
            modelId: model.modelId,
          });
          return {
            modelId: model.modelId,
            validationScore: 0,
            isValid: false,
          };
        }
      }),
    );

    return validationResults;
  }

  /**
   * Run validation tests on a retrained model
   */
  private async runModelValidation(
    modelId: string,
    suggestionType: string,
  ): Promise<number> {
    // Get recent outcomes for validation
    const recentOutcomes = await this.suggestionOutcomeModel
      .find({ suggestionType })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    if (recentOutcomes.length === 0) return 0.5;

    // Calculate validation score based on consistency
    const successRate = this.calculateRecentSuccessRate(recentOutcomes);
    const consistency = this.calculateOutcomeConsistency(recentOutcomes);

    return (successRate + consistency) / 2;
  }

  /**
   * Calculate outcome consistency
   */
  private calculateOutcomeConsistency(outcomes: any[]): number {
    if (outcomes.length < 10) return 0.5;

    // Measure how consistent the outcomes are
    const accepted = outcomes.filter((o) => o.userAcceptance).length;
    const expectedAccepted = outcomes.length * 0.5; // Expected 50%

    const deviation = Math.abs(accepted - expectedAccepted) / outcomes.length;
    return Math.max(0, 1 - deviation * 2); // Convert to 0-1 score
  }

  /**
   * Update statistics for retrained models
   */
  private async updateRetrainedModelStats(
    validationResults: any[],
  ): Promise<void> {
    for (const result of validationResults) {
      await this.modelPerformanceModel.updateOne(
        { modelId: result.modelId },
        {
          $set: {
            lastValidated: new Date(),
            validationScore: result.validationScore,
            isValid: result.isValid,
          },
          $inc: {
            retrainingCount: 1,
          },
        },
      );
    }
  }

  /**
   * Determine if suggestion should be shown to user
   */
  private shouldShowSuggestion(
    suggestion: any,
    userProfile: UserContext,
  ): boolean {
    // Don't show suggestions user has rejected before
    if (userProfile.previousSuggestions?.includes(suggestion.type)) {
      return (userProfile.acceptanceRate ?? 0) > 0.3; // Show if acceptance rate > 30%
    }

    return true;
  }

  /**
   * Adjust confidence based on user profile
   */
  private adjustConfidence(
    originalConfidence: number,
    userProfile: UserContext,
  ): number {
    const acceptanceRate = userProfile.acceptanceRate || 0.5;

    // Increase confidence for users with high acceptance rates
    if (acceptanceRate > 0.7) {
      return Math.min(1.0, originalConfidence * 1.2);
    }

    // Decrease confidence for users with low acceptance rates
    if (acceptanceRate < 0.3) {
      return Math.max(0.1, originalConfidence * 0.8);
    }

    return originalConfidence;
  }

  /**
   * Calculate personalized priority
   */
  private calculatePersonalizedPriority(
    suggestion: any,
    userProfile: UserContext,
  ): number {
    let priority = suggestion.priority || 1;

    // Boost priority for user's preferred suggestion types
    if (userProfile.previousSuggestions?.includes(suggestion.type)) {
      priority *= 1.5;
    }

    // Adjust based on cost budget
    if (userProfile.costBudget === 'high' && suggestion.estimatedSavings > 50) {
      priority *= 1.3;
    }

    return priority;
  }
}
