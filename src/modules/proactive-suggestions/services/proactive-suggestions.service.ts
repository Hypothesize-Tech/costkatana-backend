import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';
import {
  ProactiveSuggestion as ProactiveSuggestionSchema,
  ProactiveSuggestionDocument,
} from '../../../schemas/analytics/proactive-suggestion.schema';
import { RealtimeUpdateService } from '../../usage/services/realtime-update.service';
import { CacheService } from '../../../common/cache/cache.service';
import { OptimizationFeedbackLoopService } from './optimization-feedback-loop.service';

export interface CostSavingSuggestion {
  id: string;
  userId: string;
  type:
    | 'model_downgrade'
    | 'semantic_cache'
    | 'context_compression'
    | 'lazy_summarization'
    | 'batch_requests'
    | 'cheaper_provider';
  title: string;
  description: string;
  estimatedSavings: number;
  savingsPercentage: number;
  confidence: number;
  context: {
    currentModel?: string;
    suggestedModel?: string;
    currentCost?: number;
    projectedCost?: number;
    pattern?: string;
    requests?: number;
  };
  actions: Array<{
    type: string;
    label: string;
    params?: Record<string, unknown>;
  }>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
  expiresAt?: Date;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

export interface SuggestionFeedback {
  suggestionId: string;
  userId: string;
  action: 'accepted' | 'rejected' | 'dismissed';
  reason?: string;
  appliedAt?: Date;
  resultMetrics?: { actualSavings?: number; userSatisfaction?: number };
}

/** In-memory suggestion shape for accept/reject (Express ProactiveSuggestion) */
export interface ProactiveSuggestionPayload {
  id: string;
  type: string;
  message: string;
  potentialSavings: number;
  details?: Record<string, unknown>;
  timestamp: Date;
  status: 'pending' | 'accepted' | 'rejected';
  userId: string;
}

const LEARNING_TTL = 86400 * 365; // 1 year

@Injectable()
export class ProactiveSuggestionsService {
  private readonly logger = new Logger(ProactiveSuggestionsService.name);
  private readonly suggestionHistory = new Map<
    string,
    ProactiveSuggestionPayload
  >();

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(ProactiveSuggestionSchema.name)
    private proactiveSuggestionModel: Model<ProactiveSuggestionDocument>,
    private realtimeUpdateService: RealtimeUpdateService,
    private cacheService: CacheService,
    private optimizationFeedbackLoop: OptimizationFeedbackLoopService,
  ) {}

  async generateSuggestionsForUser(
    userId: string,
  ): Promise<CostSavingSuggestion[]> {
    try {
      this.logger.log('Generating proactive suggestions', { userId });
      const [modelDowngrade, caching, compression, summarization] =
        await Promise.all([
          this.analyzeModelDowngradeOpportunities(userId),
          this.analyzeSemanticCachingOpportunities(userId),
          this.analyzeCompressionOpportunities(userId),
          this.analyzeLazySummarizationOpportunities(userId),
        ]);
      const all = [
        ...modelDowngrade,
        ...caching,
        ...compression,
        ...summarization,
      ];
      const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const sorted = all.sort((a, b) => {
        const diff = priorityWeight[b.priority] - priorityWeight[a.priority];
        return diff !== 0 ? diff : b.estimatedSavings - a.estimatedSavings;
      });
      for (const s of sorted) {
        await this.proactiveSuggestionModel.findOneAndUpdate(
          { id: s.id },
          s as any,
          { upsert: true, new: true },
        );
      }
      if (sorted.length > 0) {
        await this.pushSuggestionsToUser(userId, sorted.slice(0, 3));
      }
      this.logger.log('Generated proactive suggestions', {
        userId,
        suggestionCount: sorted.length,
        totalSavings: sorted.reduce((sum, s) => sum + s.estimatedSavings, 0),
      });
      return sorted;
    } catch (error) {
      this.logger.error('Error generating suggestions', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return [];
    }
  }

  private async analyzeModelDowngradeOpportunities(
    userId: string,
  ): Promise<CostSavingSuggestion[]> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recent = await this.usageModel
        .find({
          userId: new Types.ObjectId(userId),
          createdAt: { $gte: sevenDaysAgo },
        })
        .limit(100)
        .lean()
        .exec();
      if (recent.length === 0) return [];
      const byModel: Record<
        string,
        { count: number; totalCost: number; avgTokens: number; requests: any[] }
      > = {};
      for (const u of recent as any[]) {
        const model = u.model ?? 'unknown';
        if (!byModel[model])
          byModel[model] = {
            count: 0,
            totalCost: 0,
            avgTokens: 0,
            requests: [],
          };
        byModel[model].count++;
        byModel[model].totalCost += u.cost ?? 0;
        byModel[model].avgTokens += u.totalTokens ?? 0;
        byModel[model].requests.push(u);
      }
      const suggestions: CostSavingSuggestion[] = [];
      for (const [model, stats] of Object.entries(byModel)) {
        const avgTokens = stats.avgTokens / stats.count;
        if (
          (model.includes('gpt-4') || model.includes('claude-opus')) &&
          avgTokens < 2000
        ) {
          const currentCost = stats.totalCost;
          const projectedCost = currentCost * 0.1;
          const savings = currentCost - projectedCost;
          suggestions.push({
            id: `model_downgrade_${userId}_${model}_${Date.now()}`,
            userId,
            type: 'model_downgrade',
            title: `Switch from ${model} to a faster, cheaper model`,
            description: `You're using ${model} for ${stats.count} requests with avg ${Math.round(avgTokens)} tokens. For these simpler tasks, consider using GPT-3.5-Turbo or Claude Haiku for 90% cost savings.`,
            estimatedSavings: savings,
            savingsPercentage: 90,
            confidence: 0.85,
            context: {
              currentModel: model,
              suggestedModel: model.includes('gpt')
                ? 'gpt-3.5-turbo'
                : 'claude-3-haiku-20240307',
              currentCost,
              projectedCost,
              requests: stats.count,
            },
            actions: [
              { type: 'accept', label: 'Auto-switch for simple requests' },
              {
                type: 'customize',
                label: 'Set rules',
                params: { maxTokens: 2000 },
              },
              { type: 'reject', label: 'Not now' },
            ],
            priority: savings > 10 ? 'high' : 'medium',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: 'pending',
          });
        }
      }
      return suggestions;
    } catch (error) {
      this.logger.error('Error analyzing model downgrade opportunities', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async analyzeSemanticCachingOpportunities(
    userId: string,
  ): Promise<CostSavingSuggestion[]> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recent = await this.usageModel
        .find({
          userId: new Types.ObjectId(userId),
          createdAt: { $gte: sevenDaysAgo },
        })
        .limit(200)
        .lean()
        .exec();
      if (recent.length < 10) return [];
      const promptGroups: Record<string, any[]> = {};
      for (const u of recent as any[]) {
        const key = (u.prompt ?? '').substring(0, 100);
        if (!promptGroups[key]) promptGroups[key] = [];
        promptGroups[key].push(u);
      }
      const suggestions: CostSavingSuggestion[] = [];
      for (const [promptKey, usages] of Object.entries(promptGroups)) {
        if (usages.length >= 3) {
          const totalCost = usages.reduce((s, u: any) => s + (u.cost ?? 0), 0);
          const cacheSavings = totalCost * 0.7;
          suggestions.push({
            id: `semantic_cache_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            userId,
            type: 'semantic_cache',
            title: 'Enable semantic caching for repeated requests',
            description: `You've made ${usages.length} similar requests that could be cached, saving ~70% on repeated queries.`,
            estimatedSavings: cacheSavings,
            savingsPercentage: 70,
            confidence: 0.92,
            context: {
              pattern: promptKey,
              requests: usages.length,
              currentCost: totalCost,
              projectedCost: totalCost * 0.3,
            },
            actions: [
              { type: 'accept', label: 'Enable semantic caching' },
              { type: 'learn_more', label: 'How it works' },
              { type: 'reject', label: 'Not interested' },
            ],
            priority: cacheSavings > 5 ? 'high' : 'medium',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            status: 'pending',
          });
        }
      }
      return suggestions;
    } catch (error) {
      this.logger.error('Error analyzing caching opportunities', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async analyzeCompressionOpportunities(
    userId: string,
  ): Promise<CostSavingSuggestion[]> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const large = await this.usageModel
        .find({
          userId: new Types.ObjectId(userId),
          totalTokens: { $gte: 5000 },
          createdAt: { $gte: sevenDaysAgo },
        })
        .limit(50)
        .lean()
        .exec();
      if (large.length === 0) return [];
      const totalCost = (large as any[]).reduce((s, r) => s + (r.cost ?? 0), 0);
      const savings = totalCost * 0.4;
      const suggestions: CostSavingSuggestion[] = [];
      if (large.length >= 5) {
        suggestions.push({
          id: `context_compression_${userId}_${Date.now()}`,
          userId,
          type: 'context_compression',
          title: 'Enable context compression for long prompts',
          description: `${large.length} of your requests use 5K+ tokens. Compressing context can reduce tokens by 40% while maintaining quality.`,
          estimatedSavings: savings,
          savingsPercentage: 40,
          confidence: 0.88,
          context: {
            requests: large.length,
            currentCost: totalCost,
            projectedCost: totalCost * 0.6,
          },
          actions: [
            { type: 'accept', label: 'Enable auto-compression' },
            { type: 'learn_more', label: 'Learn more' },
            { type: 'reject', label: 'Keep full context' },
          ],
          priority: savings > 10 ? 'high' : 'medium',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'pending',
        });
      }
      return suggestions;
    } catch (error) {
      this.logger.error('Error analyzing compression opportunities', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async analyzeLazySummarizationOpportunities(
    userId: string,
  ): Promise<CostSavingSuggestion[]> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const large = await this.usageModel
        .find({
          userId: new Types.ObjectId(userId),
          promptTokens: { $gte: 8000 },
          createdAt: { $gte: sevenDaysAgo },
        })
        .limit(30)
        .lean()
        .exec();
      if (large.length === 0) return [];
      const totalCost = (large as any[]).reduce((s, r) => s + (r.cost ?? 0), 0);
      const savings = totalCost * 0.6;
      const suggestions: CostSavingSuggestion[] = [];
      if (large.length >= 3) {
        suggestions.push({
          id: `lazy_summarization_${userId}_${Date.now()}`,
          userId,
          type: 'lazy_summarization',
          title: 'Use lazy summarization for long documents',
          description: `${large.length} requests contain 8K+ prompt tokens. Lazy summarization extracts only relevant sections, reducing costs by 60%.`,
          estimatedSavings: savings,
          savingsPercentage: 60,
          confidence: 0.82,
          context: {
            requests: large.length,
            currentCost: totalCost,
            projectedCost: totalCost * 0.4,
          },
          actions: [
            { type: 'accept', label: 'Enable lazy summarization' },
            { type: 'learn_more', label: 'How it works' },
            { type: 'reject', label: 'Not now' },
          ],
          priority: savings > 15 ? 'critical' : 'high',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'pending',
        });
      }
      return suggestions;
    } catch (error) {
      this.logger.error('Error analyzing summarization opportunities', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async pushSuggestionsToUser(
    userId: string,
    suggestions: CostSavingSuggestion[],
  ): Promise<void> {
    try {
      const totalSavings = suggestions.reduce(
        (sum, s) => sum + s.estimatedSavings,
        0,
      );
      await this.realtimeUpdateService.broadcastMessageToUser(userId, {
        type: 'cost_saving_suggestions',
        message: `${suggestions.length} new cost-saving opportunities available`,
        totalPotentialSavings: totalSavings,
        suggestions: suggestions.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          description: s.description,
          estimatedSavings: s.estimatedSavings,
          savingsPercentage: s.savingsPercentage,
          priority: s.priority,
          actions: s.actions,
        })),
        timestamp: new Date().toISOString(),
      });
      this.logger.log('Pushed suggestions to user via SSE', {
        userId,
        suggestionCount: suggestions.length,
        totalSavings,
      });
    } catch (error) {
      this.logger.error('Error pushing suggestions via SSE', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async recordSuggestionFeedback(feedback: SuggestionFeedback): Promise<void> {
    try {
      await this.proactiveSuggestionModel.findOneAndUpdate(
        { id: feedback.suggestionId },
        {
          status: feedback.action,
          feedback: {
            action: feedback.action,
            reason: feedback.reason,
            appliedAt: feedback.appliedAt,
            resultMetrics: feedback.resultMetrics,
          },
        },
      );
      await this.updateLearningModel(feedback);
      this.logger.log('Recorded suggestion feedback', {
        suggestionId: feedback.suggestionId,
        action: feedback.action,
      });
    } catch (error) {
      this.logger.error('Error recording feedback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateLearningModel(
    feedback: SuggestionFeedback,
  ): Promise<void> {
    try {
      const key = `learning:suggestion:${feedback.userId}`;
      const existing = await this.cacheService.get<{
        accepted: number;
        rejected: number;
        typePreferences: Record<string, { accepted: number; rejected: number }>;
      }>(key);
      const learningData = existing ?? {
        accepted: 0,
        rejected: 0,
        typePreferences: {},
      };
      if (feedback.action === 'accepted') learningData.accepted++;
      else if (feedback.action === 'rejected') learningData.rejected++;
      const doc = await this.proactiveSuggestionModel
        .findOne({ id: feedback.suggestionId })
        .lean()
        .exec();
      if (doc) {
        const type = (doc as any).type;
        if (!learningData.typePreferences[type])
          learningData.typePreferences[type] = { accepted: 0, rejected: 0 };
        if (feedback.action === 'accepted')
          learningData.typePreferences[type].accepted++;
        else if (feedback.action === 'rejected')
          learningData.typePreferences[type].rejected++;
      }
      await this.cacheService.set(key, learningData, LEARNING_TTL);
      const total = learningData.accepted + learningData.rejected;
      this.logger.log('Updated learning model', {
        userId: feedback.userId,
        acceptanceRate: total > 0 ? (learningData.accepted / total) * 100 : 0,
      });
    } catch (error) {
      this.logger.error('Error updating learning model', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getUserAcceptanceRate(userId: string, type?: string): Promise<number> {
    try {
      const key = `learning:suggestion:${userId}`;
      const data = await this.cacheService.get<{
        accepted: number;
        rejected: number;
        typePreferences: Record<string, { accepted: number; rejected: number }>;
      }>(key);
      if (!data) return 0.5;
      if (type && data.typePreferences?.[type]) {
        const t = data.typePreferences[type];
        const total = t.accepted + t.rejected;
        return total > 0 ? t.accepted / total : 0.5;
      }
      const total = data.accepted + data.rejected;
      return total > 0 ? data.accepted / total : 0.5;
    } catch (error) {
      this.logger.error('Error getting acceptance rate', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  async pushContextCompressionSuggestion(
    userId: string,
    originalTokens: number,
    compressedTokens: number,
    reductionPercentage: number,
  ): Promise<void> {
    const suggestion: ProactiveSuggestionPayload = {
      id: `context_compression_success_${Date.now()}`,
      type: 'context_compression',
      message: `Context compression saved ${originalTokens - compressedTokens} tokens (${reductionPercentage.toFixed(1)}% reduction).`,
      potentialSavings: (originalTokens - compressedTokens) * 0.000002,
      details: { originalTokens, compressedTokens, reductionPercentage },
      timestamp: new Date(),
      status: 'accepted',
      userId,
    };
    this.suggestionHistory.set(suggestion.id, suggestion);
    await this.realtimeUpdateService.broadcastMessageToUser(userId, {
      ...suggestion,
      type: 'proactive_suggestion',
      timestamp: suggestion.timestamp.toISOString(),
    });
    this.logger.log('Context compression suggestion emitted', {
      userId,
      suggestionId: suggestion.id,
      reductionPercentage: reductionPercentage.toFixed(1),
    });
  }

  async pushOptimizationCompletedSuggestion(
    userId: string,
    tokensSaved: number,
    costSaved: number,
    improvementPercentage: number,
  ): Promise<void> {
    const suggestion: ProactiveSuggestionPayload = {
      id: `optimization_complete_${Date.now()}`,
      type: 'lazy_summarization',
      message: `Optimization completed! Saved ${tokensSaved} tokens and $${costSaved.toFixed(4)} (${improvementPercentage.toFixed(1)}% improvement).`,
      potentialSavings: costSaved,
      details: { tokensSaved, costSaved, improvementPercentage },
      timestamp: new Date(),
      status: 'accepted',
      userId,
    };
    this.suggestionHistory.set(suggestion.id, suggestion);
    await this.realtimeUpdateService.broadcastMessageToUser(userId, {
      ...suggestion,
      type: 'proactive_suggestion',
      timestamp: suggestion.timestamp.toISOString(),
    });
    this.logger.log('Optimization completed suggestion emitted', {
      userId,
      suggestionId: suggestion.id,
      improvementPercentage: improvementPercentage.toFixed(1),
    });
  }

  async trackSuggestionAcceptance(
    suggestionId: string,
    userId: string,
  ): Promise<void> {
    let suggestion = this.suggestionHistory.get(suggestionId);
    if (!suggestion) {
      const doc = await this.proactiveSuggestionModel
        .findOne({ id: suggestionId })
        .lean()
        .exec();
      if (doc && String((doc as any).userId) === userId) {
        suggestion = {
          id: (doc as any).id,
          type: (doc as any).type,
          message: (doc as any).description,
          potentialSavings: (doc as any).estimatedSavings ?? 0,
          details: (doc as any).context ?? {},
          timestamp: (doc as any).createdAt ?? new Date(),
          status: 'pending',
          userId,
        };
      }
    }
    if (suggestion && suggestion.userId === userId) {
      suggestion.status = 'accepted';
      this.logger.log('Suggestion accepted', {
        suggestionId,
        userId,
        type: suggestion.type,
      });
      try {
        const details = suggestion.details ?? {};
        const contextData = this.deriveContextFromSuggestion(
          suggestion,
          details,
        );
        await this.optimizationFeedbackLoop.learnFromUserAction(
          userId,
          'accept',
          contextData as import('./optimization-feedback-loop.service').UserContext,
        );
        if (suggestion.id) {
          const contextData = this.deriveContextFromSuggestion(
            suggestion,
            details,
          );
          await this.optimizationFeedbackLoop.recordOptimizationOutcome(
            suggestion.id,
            userId,
            contextData as import('./optimization-feedback-loop.service').UserContext,
            (details.currentModel as string) ?? 'unknown',
            (details.suggestedModel as string) ?? 'unknown',
            {
              userAcceptance: true,
              costSaved: suggestion.potentialSavings,
              qualityMaintained: true,
              userRating: 5,
              errorOccurred: false,
            },
          );
        }
        this.logger.log('Fed suggestion acceptance into learning loop', {
          suggestionId,
          type: suggestion.type,
          potentialSavings: suggestion.potentialSavings,
        });
      } catch (error) {
        this.logger.error('Failed to feed acceptance into learning loop', {
          error: error instanceof Error ? error.message : String(error),
          suggestionId,
        });
      }
      this.suggestionHistory.delete(suggestionId);
    } else {
      this.logger.warn(
        'Suggestion not found or unauthorized acceptance attempt',
        { suggestionId, userId },
      );
    }
  }

  async trackSuggestionRejection(
    suggestionId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    let suggestion = this.suggestionHistory.get(suggestionId);
    if (!suggestion) {
      const doc = await this.proactiveSuggestionModel
        .findOne({ id: suggestionId })
        .lean()
        .exec();
      if (doc && String((doc as any).userId) === userId) {
        suggestion = {
          id: (doc as any).id,
          type: (doc as any).type,
          message: (doc as any).description,
          potentialSavings: (doc as any).estimatedSavings ?? 0,
          details: (doc as any).context ?? {},
          timestamp: (doc as any).createdAt ?? new Date(),
          status: 'pending',
          userId,
        };
      }
    }
    if (suggestion && suggestion.userId === userId) {
      suggestion.status = 'rejected';
      this.logger.log('Suggestion rejected', {
        suggestionId,
        userId,
        type: suggestion.type,
        reason,
      });
      try {
        const details = suggestion.details ?? {};
        const contextData = this.deriveContextFromSuggestion(
          suggestion,
          details,
        );
        await this.optimizationFeedbackLoop.learnFromUserAction(
          userId,
          'reject',
          contextData as import('./optimization-feedback-loop.service').UserContext,
        );
        if (suggestion.id) {
          await this.optimizationFeedbackLoop.recordOptimizationOutcome(
            suggestion.id,
            userId,
            contextData as import('./optimization-feedback-loop.service').UserContext,
            (details.currentModel as string) ?? 'unknown',
            (details.suggestedModel as string) ?? 'unknown',
            {
              userAcceptance: false,
              costSaved: 0,
              qualityMaintained: false,
              userRating: 1,
              errorOccurred: false,
              rejectionReason: reason,
            },
          );
        }
        this.logger.log('Fed suggestion rejection into learning loop', {
          suggestionId,
          type: suggestion.type,
          reason: reason ?? 'no reason provided',
        });
      } catch (error) {
        this.logger.error('Failed to feed rejection into learning loop', {
          error: error instanceof Error ? error.message : String(error),
          suggestionId,
          reason,
        });
      }
      this.suggestionHistory.delete(suggestionId);
    } else {
      this.logger.warn(
        'Suggestion not found or unauthorized rejection attempt',
        { suggestionId, userId },
      );
    }
  }

  /**
   * Derive context data from suggestion for learning
   */
  private deriveContextFromSuggestion(
    suggestion: any,
    details: any,
  ): {
    promptComplexity: number;
    userTier: string;
    costBudget: string;
    taskType: string;
    promptLength: number;
  } {
    // Derive prompt complexity from suggestion type and potential savings
    const promptComplexity = this.calculatePromptComplexity(
      suggestion,
      details,
    );

    // Derive user tier from suggestion details (would need actual user data in production)
    const userTier = this.deriveUserTier(details);

    // Derive cost budget from potential savings
    const costBudget = this.deriveCostBudget(suggestion.potentialSavings || 0);

    // Use actual suggestion type
    const taskType = suggestion.type;

    // Estimate prompt length from details
    const promptLength = this.estimatePromptLength(details);

    return {
      promptComplexity,
      userTier,
      costBudget,
      taskType,
      promptLength,
    };
  }

  private calculatePromptComplexity(suggestion: any, details: any): number {
    let complexity = 50; // Base complexity

    // Adjust based on suggestion type
    switch (suggestion.type) {
      case 'compression':
        complexity += 20;
        break;
      case 'model_selection':
        complexity += 30;
        break;
      case 'context_trimming':
        complexity += 15;
        break;
      case 'semantic_caching':
        complexity += 25;
        break;
    }

    // Adjust based on potential savings (higher savings = more complex prompts)
    if (suggestion.potentialSavings > 0.1) complexity += 20;
    if (suggestion.potentialSavings > 0.5) complexity += 15;

    return Math.min(100, Math.max(0, complexity));
  }

  private deriveUserTier(details: any): string {
    // In production, this would check actual user subscription data
    // For now, derive from context clues
    if (
      details?.currentModel?.includes('claude') ||
      details?.suggestedModel?.includes('claude')
    ) {
      return 'premium';
    }
    if (
      details?.costBudget === 'high' ||
      (details?.currentModel && details.currentModel.includes('gpt-4'))
    ) {
      return 'pro';
    }
    return 'basic';
  }

  private deriveCostBudget(potentialSavings: number): string {
    if (potentialSavings > 0.5) return 'low'; // High savings needed = low budget
    if (potentialSavings > 0.2) return 'medium';
    return 'high'; // Low savings needed = high budget available
  }

  private estimatePromptLength(details: any): number {
    // Estimate prompt length from available data
    let estimatedLength = 100; // Base estimate

    // Adjust based on model names (longer names might indicate more complex prompts)
    if (details?.currentModel) {
      estimatedLength += details.currentModel.length * 10;
    }
    if (details?.suggestedModel) {
      estimatedLength += details.suggestedModel.length * 10;
    }

    // Adjust based on suggestion type
    switch (details?.type) {
      case 'compression':
        estimatedLength += 200; // Longer prompts for compression
        break;
      case 'model_selection':
        estimatedLength += 150;
        break;
      case 'context_trimming':
        estimatedLength += 300; // Context-heavy prompts
        break;
    }

    return Math.min(2000, Math.max(50, estimatedLength));
  }
}
