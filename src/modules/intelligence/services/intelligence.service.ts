import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tip } from '../../../schemas/misc/tip.schema';
import { Usage } from '../../../schemas/core/usage.schema';
import { User } from '../../../schemas/user/user.schema';
import { SubscriptionService } from '../../subscription/subscription.service';
import { ActivityService } from '../../activity/activity.service';
import { MODEL_PRICING } from '../../../utils/pricing';

export interface TipContext {
  usage?: Record<string, unknown>;
  user?: Record<string, unknown>;
  recentUsages?: Record<string, unknown>[];
  optimizationConfig?: Record<string, unknown>;
}

export interface TipRecommendation {
  tip: Record<string, unknown>;
  relevanceScore: number;
  context: Record<string, unknown>;
}

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);
  private readonly EXPENSIVE_INPUT_THRESHOLD = 20;
  private readonly EXPENSIVE_OUTPUT_THRESHOLD = 60;
  private readonly EXPENSIVE_PATTERNS = [
    'gpt-4',
    'claude-3-opus',
    'gemini-ultra',
  ];

  constructor(
    @InjectModel(Tip.name) private tipModel: Model<Tip>,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly subscriptionService: SubscriptionService,
    private readonly activityService: ActivityService,
  ) {}

  async analyzeAndRecommendTips(
    context: TipContext,
  ): Promise<TipRecommendation[]> {
    try {
      const relevantTips = await this.preFilterTips(context);
      const evaluated = await Promise.all(
        relevantTips.map(async (tip) => {
          const relevanceScore = await this.evaluateTipRelevance(tip, context);
          return { tip, relevanceScore };
        }),
      );

      const recommendations = evaluated
        .filter(({ relevanceScore }) => relevanceScore > 0.5)
        .map(({ tip, relevanceScore }) => ({
          tip: tip.toObject ? tip.toObject() : tip,
          relevanceScore,
          context: this.generateTipContext(tip, context),
        }));

      const priorityWeight: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
      };
      recommendations.sort((a, b) => {
        const aP = (priorityWeight[a.tip.priority] || 1) * a.relevanceScore;
        const bP = (priorityWeight[b.tip.priority] || 1) * b.relevanceScore;
        return bP - aP;
      });

      return recommendations.slice(0, 5);
    } catch (error) {
      this.logger.error('Error analyzing tips', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async preFilterTips(context: TipContext): Promise<any[]> {
    try {
      const filters: Record<string, unknown> = { isActive: true };
      const user = context.user as any;
      if (user?.subscriptionId || user?._id) {
        const userId = user._id?.toString() || user.id?.toString() || '';
        const subscription =
          await this.subscriptionService.getSubscriptionByUserId(userId);
        if (subscription?.plan) {
          filters.$or = [
            { targetAudience: 'all' },
            { targetAudience: subscription.plan },
            { targetAudience: { $exists: false } },
          ];
        }
      }
      return this.tipModel.find(filters).lean();
    } catch (error) {
      this.logger.error('Error pre-filtering tips', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.tipModel.find({ isActive: true }).lean();
    }
  }

  private async evaluateTipRelevance(
    tip: any,
    context: TipContext,
  ): Promise<number> {
    const { usage, user, recentUsages, optimizationConfig } = context;
    let relevanceScore = 0;
    const condition = tip.trigger?.condition;

    switch (condition) {
      case 'high_tokens':
        if (
          usage &&
          (usage as any).totalTokens > (tip.trigger?.threshold ?? 4000)
        ) {
          relevanceScore = Math.min((usage as any).totalTokens / 10000, 1);
        }
        break;
      case 'no_optimization':
        if (
          optimizationConfig &&
          !this.hasOptimizationEnabled(optimizationConfig as any)
        ) {
          relevanceScore = 0.9;
        }
        break;
      case 'expensive_model':
        if (usage && this.isExpensiveModel((usage as any).model)) {
          relevanceScore = 0.8;
        }
        break;
      case 'repeated_prompts':
        if (recentUsages && this.hasRepeatedPrompts(recentUsages as any[])) {
          relevanceScore = 0.85;
        }
        break;
      case 'long_context':
        if (
          usage &&
          (usage as any).promptTokens > (tip.trigger?.threshold ?? 3000)
        ) {
          relevanceScore = Math.min((usage as any).promptTokens / 5000, 1);
        }
        break;
      case 'custom':
        if (tip.trigger?.customRule) {
          relevanceScore = await this.evaluateCustomRule(
            tip.trigger.customRule,
            context,
          );
        }
        break;
    }

    if (user && tip.targetAudience && tip.targetAudience !== 'all') {
      let userTier = 'free';
      const userAny = user as any;
      if (userAny.subscriptionId || userAny._id) {
        try {
          const userId =
            userAny._id?.toString() || userAny.id?.toString() || '';
          const subscription =
            await this.subscriptionService.getSubscriptionByUserId(userId);
          userTier = subscription?.plan ?? 'free';
        } catch {
          userTier = 'free';
        }
      }
      if (tip.targetAudience !== userTier) {
        relevanceScore *= 0.5;
      }
    }

    const userId = (user as any)?._id?.toString() ?? null;
    const recentDismissals = await this.getRecentTipDismissals(userId, tip._id);
    if (recentDismissals > 0) {
      relevanceScore *= Math.max(0.1, 1 - recentDismissals * 0.3);
    }

    return relevanceScore;
  }

  private hasOptimizationEnabled(config: any): boolean {
    return (
      config.enableCaching ||
      config.enableModelOptimization ||
      config.enableBatching ||
      config.promptCompression?.enabled ||
      config.contextTrimming?.enabled ||
      config.requestFusion?.enabled
    );
  }

  private isExpensiveModel(model: string): boolean {
    const modelLower = model.toLowerCase();
    const pricing = (MODEL_PRICING as any[]).find(
      (p) =>
        p.modelId?.toLowerCase() === modelLower ||
        p.modelName?.toLowerCase() === modelLower ||
        modelLower.includes(p.modelId?.toLowerCase() || '') ||
        (p.modelId?.toLowerCase() || '').includes(modelLower),
    );
    if (!pricing) {
      return this.EXPENSIVE_PATTERNS.some((pattern) =>
        modelLower.includes(pattern),
      );
    }
    return (
      (pricing.inputPrice ?? 0) > this.EXPENSIVE_INPUT_THRESHOLD ||
      (pricing.outputPrice ?? 0) > this.EXPENSIVE_OUTPUT_THRESHOLD
    );
  }

  private hasRepeatedPrompts(recentUsages: any[]): boolean {
    const prompts = recentUsages
      .map((u) => u.metadata?.prompt || '')
      .filter((p) => p.length > 0);
    const unique = new Set(prompts);
    return prompts.length > 5 && unique.size < prompts.length * 0.7;
  }

  private async evaluateCustomRule(
    rule: string,
    context: TipContext,
  ): Promise<number> {
    try {
      if (rule.includes('usage.cost >') && context.usage) {
        const match = rule.match(/usage\.cost > (\d+\.?\d*)/);
        const threshold = parseFloat(match?.[1] ?? '0');
        return (context.usage as any).cost > threshold ? 1 : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async getRecentTipDismissals(
    _userId: string | null,
    _tipId: string,
  ): Promise<number> {
    return 0;
  }

  private generateTipContext(
    tip: any,
    context: TipContext,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (tip.potentialSavings && context.usage) {
      const usage = context.usage as any;
      if (tip.potentialSavings.percentage) {
        result.estimatedSavings =
          usage.cost * (tip.potentialSavings.percentage / 100);
      }
      if (tip.potentialSavings.amount) {
        result.estimatedSavings = tip.potentialSavings.amount;
      }
    }
    switch (tip.trigger?.condition) {
      case 'high_tokens':
        result.currentTokens = (context.usage as any)?.totalTokens;
        result.threshold = tip.trigger?.threshold;
        break;
      case 'expensive_model':
        result.currentModel = (context.usage as any)?.model;
        result.suggestedModel = tip.action?.targetModel;
        break;
    }
    return result;
  }

  async trackTipInteraction(
    tipId: string,
    interaction: 'display' | 'click' | 'dismiss' | 'success',
    userId?: string,
  ): Promise<void> {
    try {
      const update: any = {};
      switch (interaction) {
        case 'display':
          update.$inc = { displayCount: 1 };
          break;
        case 'click':
          update.$inc = { clickCount: 1 };
          break;
        case 'dismiss':
          update.$inc = { dismissCount: 1 };
          break;
        case 'success':
          update.$inc = { successCount: 1 };
          break;
      }

      const tip = await this.tipModel
        .findOneAndUpdate({ tipId }, update, { new: true })
        .exec();

      if (tip && userId) {
        if (interaction === 'display') {
          await this.activityService.trackActivity(userId, {
            type: 'tip_viewed',
            title: 'Tip Viewed',
            description: tip.message,
            metadata: {
              tipId: (tip as any)._id,
              tipType: tip.type,
              potentialSavings: tip.potentialSavings?.percentage ?? 0,
            },
          });
        } else if (interaction === 'success') {
          await this.activityService.trackActivity(userId, {
            type: 'tip_applied',
            title: 'Tip Applied Successfully',
            description: `Applied tip: ${tip.message}`,
            metadata: {
              tipId: (tip as any)._id,
              tipType: tip.type,
              actualSavings: tip.potentialSavings?.percentage ?? 0,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Error tracking tip interaction', {
        tipId,
        interaction,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getPersonalizedTips(
    userId: string,
    limit: number = 3,
  ): Promise<TipRecommendation[]> {
    try {
      const [user, recentUsages] = await Promise.all([
        this.userModel
          .findById(userId)
          .select('subscription preferences')
          .lean()
          .exec(),
        this.usageModel
          .find({ userId: new Types.ObjectId(userId) })
          .select(
            'totalTokens promptTokens model cost metadata.prompt createdAt',
          )
          .sort({ createdAt: -1 })
          .limit(50)
          .lean()
          .exec(),
      ]);

      const optimizationConfig = {
        enablePromptOptimization: true,
        enableModelSuggestions: true,
        enableCachingSuggestions: true,
      };

      const context: TipContext = {
        user: user as Record<string, unknown>,
        recentUsages: recentUsages as Record<string, unknown>[],
        optimizationConfig,
      };

      const recommendations = await this.analyzeAndRecommendTips(context);
      return recommendations.slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting personalized tips', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async initializeDefaultTips(): Promise<void> {
    const defaultTips = [
      {
        tipId: 'enable-context-trimming',
        title: 'Long Context Detected',
        message:
          'This context is long. Enable Adaptive Context Trimming to potentially save 50% on tokens.',
        type: 'optimization',
        trigger: { condition: 'long_context', threshold: 3000 },
        action: { type: 'enable_feature', feature: 'contextTrimming' },
        potentialSavings: {
          percentage: 50,
          description: 'Reduce tokens by trimming irrelevant context',
        },
        priority: 'high',
      },
      {
        tipId: 'switch-to-cheaper-model',
        title: 'Consider a More Cost-Effective Model',
        message:
          'For this type of query, GPT-3.5-Turbo could provide similar quality at 10x lower cost.',
        type: 'cost_saving',
        trigger: { condition: 'expensive_model' },
        action: { type: 'change_model', targetModel: 'gpt-3.5-turbo' },
        potentialSavings: {
          percentage: 90,
          description: 'Switch to a cheaper model',
        },
        priority: 'high',
      },
      {
        tipId: 'enable-prompt-compression',
        title: 'Repetitive Data Detected',
        message:
          'Your prompt contains repetitive patterns. Enable Prompt Compression to reduce tokens.',
        type: 'optimization',
        trigger: { condition: 'repeated_prompts' },
        action: { type: 'enable_feature', feature: 'promptCompression' },
        potentialSavings: {
          percentage: 30,
          description: 'Compress repetitive content',
        },
        priority: 'medium',
      },
      {
        tipId: 'no-optimization-warning',
        title: 'Optimization Features Disabled',
        message:
          'You have all optimization features disabled. Enable them to start saving on AI costs.',
        type: 'feature',
        trigger: { condition: 'no_optimization' },
        action: { type: 'view_guide', guideUrl: '/optimizations' },
        potentialSavings: {
          percentage: 40,
          description: 'Enable optimization features',
        },
        priority: 'high',
      },
      {
        tipId: 'high-token-usage',
        title: 'High Token Usage Alert',
        message:
          'This request used over 5000 tokens. Consider breaking it into smaller requests or enabling optimizations.',
        type: 'best_practice',
        trigger: { condition: 'high_tokens', threshold: 5000 },
        action: { type: 'run_wizard' },
        potentialSavings: {
          percentage: 60,
          description: 'Optimize high token usage',
        },
        priority: 'high',
      },
    ];

    const operations = defaultTips.map((tipData) => ({
      updateOne: {
        filter: { tipId: tipData.tipId },
        update: { $setOnInsert: tipData as Partial<Tip> },
        upsert: true,
      },
    }));

    await this.tipModel.bulkWrite(operations as any);
    this.logger.log('Default tips initialized');
  }
}
