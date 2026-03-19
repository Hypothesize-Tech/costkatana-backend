/**
 * Auto Recommendation Agent Service for NestJS
 *
 * AI-powered service that analyzes user behavior patterns and generates personalized
 * cost optimization recommendations using machine learning and historical data.
 *
 * Key Features:
 * - User behavior pattern analysis and learning
 * - AI-generated personalized recommendations
 * - Recommendation effectiveness tracking
 * - Adaptive learning from user interactions
 * - Real-time optimization suggestions
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { BedrockService } from '../../bedrock/bedrock.service';
import { UsageService } from '../../usage/services/usage.service';
import {
  UserBehaviorPattern,
  UserBehaviorPatternDocument,
  UserBehaviorPatternSchema,
} from '../../../schemas/recommendation/user-behavior-pattern.schema';
import {
  AIRecommendation,
  AIRecommendationDocument,
  AIRecommendationSchema,
} from '../../../schemas/recommendation/ai-recommendation.schema';
import { Usage } from '../../../schemas/core/usage.schema';

// Types are now imported from schema files

interface AIRecommendationData {
  type:
    | 'model_switch'
    | 'prompt_optimization'
    | 'usage_pattern'
    | 'cost_alert'
    | 'efficiency_tip';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  description: string;
  reasoning: string;
  actionable: {
    currentModel?: string;
    suggestedModel?: string;
    currentPrompt?: string;
    suggestedPrompt?: string;
    estimatedSavings: number;
    confidenceScore: number;
    implementationComplexity: 'easy' | 'moderate' | 'complex';
  };
  context: {
    triggeredBy: string;
    relevantUsageIds?: string[];
    projectId?: string;
    basedOnPattern: string;
  };
}

@Injectable()
export class AutoRecommendationAgentService {
  private readonly logger = new Logger(AutoRecommendationAgentService.name);
  private readonly enableAIRecommendations: boolean;

  constructor(
    @InjectModel(UserBehaviorPattern.name)
    private userBehaviorPatternModel: Model<UserBehaviorPatternDocument>,
    @InjectModel(AIRecommendation.name)
    private aiRecommendationModel: Model<AIRecommendationDocument>,
    @InjectModel(Usage.name)
    private usageModel: Model<Usage>,
    private readonly usageService: UsageService,
    private readonly configService: ConfigService,
    private readonly bedrockService: BedrockService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.enableAIRecommendations = this.configService.get<boolean>(
      'ENABLE_AI_RECOMMENDATIONS',
      true,
    );
  }

  /**
   * Generate personalized recommendations for a user
   */
  async generateRecommendations(
    userId: string,
    context?: any,
  ): Promise<AIRecommendationDocument[]> {
    try {
      if (!this.enableAIRecommendations) {
        this.logger.debug('AI recommendations disabled, skipping generation');
        return [];
      }

      // Get or create user behavior pattern
      let pattern: UserBehaviorPatternDocument | null =
        await this.userBehaviorPatternModel.findOne({ userId });
      if (!pattern) {
        pattern = await this.createInitialBehaviorPattern(userId);
      }

      if (!pattern) {
        this.logger.warn('Could not obtain or create behavior pattern', {
          userId,
        });
        return [];
      }

      // Analyze recent usage and behavior
      const analysisContext = await this.buildAnalysisContext(
        userId,
        pattern,
        context,
      );

      // Check if we should generate recommendations
      if (!this.shouldGenerateRecommendations(analysisContext, pattern)) {
        return [];
      }

      // Call AI to generate recommendations
      const recommendations =
        await this.callAIForRecommendations(analysisContext);

      // Filter and prioritize recommendations based on user behavior
      const filteredRecommendations = this.filterRecommendationsByBehavior(
        recommendations,
        pattern,
      );

      // Save recommendations to database
      const savedRecommendations = await this.saveRecommendations(
        userId,
        filteredRecommendations,
      );

      this.logger.log(
        `Generated ${savedRecommendations.length} recommendations for user ${userId}`,
      );

      return savedRecommendations;
    } catch (error) {
      this.logger.error('Error generating recommendations', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get pending recommendations for a user
   */
  async getPendingRecommendations(
    userId: string,
  ): Promise<AIRecommendationDocument[]> {
    try {
      return await this.aiRecommendationModel
        .find({
          userId,
          'userInteraction.status': 'pending',
          expiresAt: { $gt: new Date() },
        })
        .sort({ priority: -1, createdAt: -1 })
        .limit(10);
    } catch (error) {
      this.logger.error('Error getting pending recommendations', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Handle user interaction with a recommendation
   */
  async handleRecommendationInteraction(
    recommendationId: string,
    status: 'viewed' | 'accepted' | 'rejected' | 'dismissed',
    feedback?: string,
    rating?: number,
  ): Promise<void> {
    try {
      const recommendation =
        await this.aiRecommendationModel.findById(recommendationId);
      if (!recommendation) {
        throw new Error('Recommendation not found');
      }

      const userId = recommendation.userId;

      // Update recommendation interaction
      await this.aiRecommendationModel.findByIdAndUpdate(recommendationId, {
        'userInteraction.status': status,
        'userInteraction.viewedAt':
          status === 'viewed' ? new Date() : undefined,
        'userInteraction.respondedAt': [
          'accepted',
          'rejected',
          'dismissed',
        ].includes(status)
          ? new Date()
          : undefined,
        'userInteraction.feedback': feedback,
        'userInteraction.rating': rating,
        updatedAt: new Date(),
      });

      // Update user behavior pattern based on interaction
      await this.updateBehaviorFromInteraction(recommendation, status);

      this.logger.log(
        `Recommendation ${recommendationId} marked as ${status} by user ${userId}`,
      );
    } catch (error) {
      this.logger.error('Error handling recommendation interaction', {
        recommendationId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track recommendation effectiveness
   */
  async trackRecommendationEffectiveness(
    recommendationId: string,
    actualSavings?: number,
    userSatisfaction?: number,
    implementationSuccess?: boolean,
  ): Promise<void> {
    try {
      await this.aiRecommendationModel.findByIdAndUpdate(recommendationId, {
        'effectiveness.actualSavings': actualSavings,
        'effectiveness.userSatisfaction': userSatisfaction,
        'effectiveness.implementationSuccess': implementationSuccess,
        'effectiveness.followUpNeeded': implementationSuccess === false,
        updatedAt: new Date(),
      });

      this.logger.debug(
        `Tracked effectiveness for recommendation ${recommendationId}`,
      );
    } catch (error) {
      this.logger.error('Error tracking recommendation effectiveness', {
        recommendationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create initial behavior pattern for a new user
   */
  private async createInitialBehaviorPattern(
    userId: string,
  ): Promise<UserBehaviorPatternDocument> {
    const pattern = new this.userBehaviorPatternModel({
      userId,
      usagePatterns: {
        preferredModels: [],
        commonPromptTypes: [],
        costSensitivity: 'medium',
        qualityTolerance: 'high',
        peakUsageHours: [],
        avgRequestsPerDay: 0,
        avgCostPerDay: 0,
      },
      optimizationBehavior: {
        acceptanceRate: 0.5,
        preferredOptimizationTypes: [],
        riskTolerance: 'medium',
        avgTimeToDecision: 300, // 5 minutes default
        frequentlyRejectedOptimizations: [],
      },
      learningData: {
        totalInteractions: 0,
        successfulRecommendations: 0,
        lastUpdated: new Date(),
        confidence: 0.5,
      },
    });

    return await pattern.save();
  }

  /**
   * Build analysis context for AI recommendation generation
   */
  private async buildAnalysisContext(
    userId: string,
    pattern: UserBehaviorPatternDocument,
    additionalContext?: any,
  ): Promise<any> {
    // Get recent usage data (would typically come from Usage service)
    const recentUsage = await this.getRecentUsageData(userId);

    return {
      userId,
      behaviorPattern: pattern,
      recentUsage,
      currentTime: new Date().toISOString(),
      additionalContext,
      systemContext: {
        availableModels: [
          'claude-opus',
          'claude-sonnet',
          'claude-haiku',
          'nova-pro',
          'nova-lite',
          'gpt-4o',
        ],
        costThresholds: {
          low: 0.001,
          medium: 0.01,
          high: 0.1,
        },
      },
    };
  }

  /**
   * Get recent usage data for analysis via UsageService
   */
  private async getRecentUsageData(userId: string): Promise<any> {
    try {
      const [weeklyStats, monthlyStats] = await Promise.all([
        this.usageService.getUsageStats(userId, 'weekly'),
        this.usageService.getUsageStats(userId, 'monthly'),
      ]);

      const costsByDay =
        (monthlyStats.usageOverTime as Array<{
          date: string;
          cost: number;
          requests: number;
        }>) || [];
      const costTrend = this.calculateCostTrend(
        costsByDay.map((d) => ({ date: d.date, cost: d.cost })),
      );

      // UsageService returns daily buckets; peak hours would need hourly aggregation
      const peakHours: number[] = [];

      return {
        last7Days: {
          totalRequests: weeklyStats.totalRequests,
          totalCost: weeklyStats.totalCost,
          modelsUsed: Object.keys(weeklyStats.costByModel || {}),
          peakHours,
        },
        last30Days: {
          totalRequests: monthlyStats.totalRequests,
          totalCost: monthlyStats.totalCost,
          modelsUsed: Object.keys(monthlyStats.costByModel || {}),
        },
        costTrend,
      };
    } catch (error) {
      this.logger.warn('Failed to get usage data for recommendations', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        last7Days: {
          totalRequests: 0,
          totalCost: 0,
          modelsUsed: [],
          peakHours: [],
        },
        last30Days: { totalRequests: 0, totalCost: 0, modelsUsed: [] },
        costTrend: 'stable',
      };
    }
  }

  private calculateCostTrend(
    costsByDay: Array<{ date: string; cost: number }>,
  ): string {
    if (costsByDay.length < 7) return 'insufficient_data';

    // Group by date and sum costs
    const dailyTotals = costsByDay.reduce(
      (acc, item) => {
        acc[item.date] = (acc[item.date] || 0) + item.cost;
        return acc;
      },
      {} as Record<string, number>,
    );

    const dailyCosts = Object.values(dailyTotals).slice(-14); // Last 14 days
    if (dailyCosts.length < 7) return 'insufficient_data';

    const firstHalf = dailyCosts.slice(0, Math.floor(dailyCosts.length / 2));
    const secondHalf = dailyCosts.slice(Math.floor(dailyCosts.length / 2));

    const firstHalfAvg =
      firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const changePercent = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

    if (changePercent > 10) return 'increasing';
    if (changePercent < -10) return 'decreasing';
    return 'stable';
  }

  /**
   * Determine if we should generate recommendations
   */
  private shouldGenerateRecommendations(
    context: any,
    pattern: UserBehaviorPatternDocument,
  ): boolean {
    // Don't generate if user has too many pending recommendations
    const pendingCount = pattern.learningData?.totalInteractions || 0;
    if (pendingCount > 10) {
      return false;
    }

    // Don't generate too frequently
    const lastUpdated = pattern.learningData?.lastUpdated;
    if (lastUpdated) {
      const hoursSinceLastUpdate =
        (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastUpdate < 24) {
        // Max once per day
        return false;
      }
    }

    return true;
  }

  /**
   * Call AI service to generate recommendations
   */
  private async callAIForRecommendations(
    context: any,
  ): Promise<AIRecommendationData[]> {
    try {
      const prompt = `You are an AI cost optimization expert. Analyze the user's behavior and usage patterns to generate personalized recommendations for reducing AI costs while maintaining quality.

User Context:
${JSON.stringify(context, null, 2)}

Generate 3-5 specific, actionable recommendations. For each recommendation, provide:
1. Type (model_switch, prompt_optimization, usage_pattern, cost_alert, or efficiency_tip)
2. Priority (low, medium, high, urgent)
3. Title (concise, engaging)
4. Description (detailed explanation)
5. Reasoning (why this recommendation makes sense for this user)
6. Actionable details (current vs suggested, estimated savings, confidence score 0-1, complexity)
7. Context (what triggered this, relevant usage patterns)

Focus on:
- User's actual usage patterns and preferences
- Cost optimization opportunities that match their risk tolerance
- Practical recommendations they're likely to accept
- Specific model switches or prompt improvements
- Usage pattern optimizations

Return valid JSON array of recommendations.`;

      const response = await BedrockService.invokeModel(
        prompt,
        'anthropic.claude-3-5-haiku-20241022-v1:0',
        { useSystemPrompt: false },
      );

      let recommendationsText = typeof response === 'string' ? response : '';

      // Extract JSON from the response
      const jsonMatch = recommendationsText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        recommendationsText = jsonMatch[0];
      }

      const recommendations = JSON.parse(recommendationsText);

      // Validate and format recommendations
      return recommendations.map((rec: any) => ({
        type: rec.type || 'efficiency_tip',
        priority: rec.priority || 'medium',
        title: rec.title || 'Optimization Opportunity',
        description: rec.description || 'Consider optimizing your usage',
        reasoning: rec.reasoning || 'Based on your usage patterns',
        actionable: {
          currentModel: rec.actionable?.currentModel,
          suggestedModel: rec.actionable?.suggestedModel,
          currentPrompt: rec.actionable?.currentPrompt,
          suggestedPrompt: rec.actionable?.suggestedPrompt,
          estimatedSavings: rec.actionable?.estimatedSavings || 0,
          confidenceScore: rec.actionable?.confidenceScore || 0.7,
          implementationComplexity:
            rec.actionable?.implementationComplexity || 'moderate',
        },
        context: {
          triggeredBy: rec.context?.triggeredBy || 'usage_analysis',
          relevantUsageIds: rec.context?.relevantUsageIds,
          projectId: rec.context?.projectId,
          basedOnPattern: rec.context?.basedOnPattern || 'general_usage',
        },
      }));
    } catch (error) {
      this.logger.error('Error calling AI for recommendations', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return fallback recommendations
      return [
        {
          type: 'efficiency_tip',
          priority: 'medium',
          title: 'Consider Using More Cost-Effective Models',
          description:
            'Based on your usage patterns, you might benefit from trying more cost-effective models for certain tasks.',
          reasoning: 'Fallback recommendation due to AI service unavailable',
          actionable: {
            estimatedSavings: 0,
            confidenceScore: 0.5,
            implementationComplexity: 'moderate',
          },
          context: {
            triggeredBy: 'fallback',
            basedOnPattern: 'general',
          },
        },
      ];
    }
  }

  /**
   * Filter recommendations based on user behavior patterns
   */
  private filterRecommendationsByBehavior(
    recommendations: AIRecommendationData[],
    pattern: UserBehaviorPatternDocument,
  ): AIRecommendationData[] {
    return recommendations.filter((rec) => {
      // Skip recommendations for optimization types user frequently rejects
      if (
        pattern.optimizationBehavior?.frequentlyRejectedOptimizations?.includes(
          rec.type,
        )
      ) {
        return false;
      }

      // Adjust priority based on user's risk tolerance
      if (
        pattern.optimizationBehavior?.riskTolerance === 'low' &&
        rec.type === 'prompt_optimization'
      ) {
        // Skip risky optimizations for risk-averse users
        return false;
      }

      // Skip low-confidence recommendations for users with low acceptance rates
      if (
        pattern.optimizationBehavior?.acceptanceRate < 0.3 &&
        rec.actionable.confidenceScore < 0.7
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Save recommendations to database
   */
  private async saveRecommendations(
    userId: string,
    recommendations: AIRecommendationData[],
  ): Promise<AIRecommendationDocument[]> {
    const savedRecommendations: AIRecommendationDocument[] = [];

    for (const rec of recommendations) {
      try {
        const recommendation = new this.aiRecommendationModel({
          userId,
          type: rec.type,
          priority: rec.priority,
          title: rec.title,
          description: rec.description,
          reasoning: rec.reasoning,
          actionable: rec.actionable,
          context: rec.context,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });

        const saved = await recommendation.save();
        savedRecommendations.push(saved);
      } catch (error) {
        this.logger.error('Error saving recommendation', {
          userId,
          type: rec.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return savedRecommendations;
  }

  /**
   * Update user behavior pattern based on recommendation interaction
   */
  private async updateBehaviorFromInteraction(
    recommendation: AIRecommendationDocument,
    status: string,
  ): Promise<void> {
    try {
      const isAccepted = status === 'accepted';
      const pattern = await this.userBehaviorPatternModel.findOne({
        userId: recommendation.userId,
      });

      if (!pattern) return;

      // Update learning data
      const totalInteractions =
        (pattern.learningData?.totalInteractions || 0) + 1;
      const successfulRecommendations =
        (pattern.learningData?.successfulRecommendations || 0) +
        (isAccepted ? 1 : 0);

      // Update acceptance rate
      const acceptanceRate = successfulRecommendations / totalInteractions;

      // Update preferred optimization types
      const preferredTypes =
        pattern.optimizationBehavior?.preferredOptimizationTypes || [];
      const existingTypeIndex = preferredTypes.findIndex(
        (t) => t.type === recommendation.type,
      );

      if (existingTypeIndex >= 0) {
        // Update existing type
        const typeData = preferredTypes[existingTypeIndex];
        const totalForType =
          typeData.acceptanceRate * (totalInteractions - 1) +
          (isAccepted ? 1 : 0);
        typeData.acceptanceRate = totalForType / totalInteractions;
      } else {
        // Add new type
        preferredTypes.push({
          type: recommendation.type,
          acceptanceRate: isAccepted ? 1 : 0,
        });
      }

      // Update frequently rejected optimizations
      const rejectedOptimizations =
        pattern.optimizationBehavior?.frequentlyRejectedOptimizations || [];
      if (!isAccepted && !rejectedOptimizations.includes(recommendation.type)) {
        const rejectionCount = await this.aiRecommendationModel.countDocuments({
          userId: recommendation.userId,
          type: recommendation.type,
          'userInteraction.status': 'rejected',
        });

        if (rejectionCount >= 3) {
          // If rejected 3+ times, mark as frequently rejected
          rejectedOptimizations.push(recommendation.type);
        }
      }

      // Update pattern
      await this.userBehaviorPatternModel.findOneAndUpdate(
        { userId: recommendation.userId },
        {
          'optimizationBehavior.acceptanceRate': acceptanceRate,
          'optimizationBehavior.preferredOptimizationTypes': preferredTypes,
          'optimizationBehavior.frequentlyRejectedOptimizations':
            rejectedOptimizations,
          'learningData.totalInteractions': totalInteractions,
          'learningData.successfulRecommendations': successfulRecommendations,
          'learningData.lastUpdated': new Date(),
          'learningData.confidence': Math.min(1, acceptanceRate + 0.2), // Add base confidence
          updatedAt: new Date(),
        },
      );
    } catch (error) {
      this.logger.error('Error updating behavior from interaction', {
        recommendationId: recommendation._id,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up expired recommendations
   */
  async cleanupExpiredRecommendations(): Promise<number> {
    try {
      const result = await this.aiRecommendationModel.deleteMany({
        expiresAt: { $lt: new Date() },
      });

      this.logger.log(
        `Cleaned up ${result.deletedCount} expired recommendations`,
      );
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error('Error cleaning up expired recommendations', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get recommendation statistics for a user
   */
  async getRecommendationStats(userId: string): Promise<any> {
    try {
      const [
        totalRecommendations,
        acceptedRecommendations,
        pendingRecommendations,
        rejectedRecommendations,
      ] = await Promise.all([
        this.aiRecommendationModel.countDocuments({ userId }),
        this.aiRecommendationModel.countDocuments({
          userId,
          'userInteraction.status': 'accepted',
        }),
        this.aiRecommendationModel.countDocuments({
          userId,
          'userInteraction.status': 'pending',
        }),
        this.aiRecommendationModel.countDocuments({
          userId,
          'userInteraction.status': 'rejected',
        }),
      ]);

      const acceptanceRate =
        totalRecommendations > 0
          ? acceptedRecommendations / totalRecommendations
          : 0;

      return {
        totalRecommendations,
        acceptedRecommendations,
        pendingRecommendations,
        rejectedRecommendations,
        acceptanceRate,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error('Error getting recommendation stats', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalRecommendations: 0,
        acceptedRecommendations: 0,
        pendingRecommendations: 0,
        rejectedRecommendations: 0,
        acceptanceRate: 0,
      };
    }
  }
}
