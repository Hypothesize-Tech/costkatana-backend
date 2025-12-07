/**
 * Proactive Suggestions Service
 * 
 * Autonomously generates and pushes cost-saving suggestions to users:
 * - Model downgrades when appropriate
 * - Semantic caching opportunities
 * - Context compression recommendations
 * - Lazy summarization suggestions
 * - Learning loop from user acceptance/rejection
 */

import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { RealtimeUpdateService } from './realtime-update.service';
import { LearningLoopService } from './learningLoop.service';
import { OptimizationFeedbackLoopService } from './optimizationFeedbackLoop.service';
import mongoose from 'mongoose';

export interface CostSavingSuggestion {
  id: string;
  userId: string;
  type: 'model_downgrade' | 'semantic_cache' | 'context_compression' | 'lazy_summarization' | 'batch_requests' | 'cheaper_provider';
  title: string;
  description: string;
  estimatedSavings: number;
  savingsPercentage: number;
  confidence: number; // 0-1
  context: {
    currentModel?: string;
    suggestedModel?: string;
    currentCost?: number;
    projectedCost?: number;
    pattern?: string;
    requests?: number;
  };
  actions: Array<{
    type: 'accept' | 'reject' | 'learn_more' | 'customize';
    label: string;
    params?: Record<string, any>;
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
  resultMetrics?: {
    actualSavings?: number;
    userSatisfaction?: number; // 1-5
  };
}

export interface ProactiveSuggestion {
  id: string;
  type: string;
  message: string;
  potentialSavings: number;
  details?: Record<string, any>;
  timestamp: Date;
  status: 'pending' | 'accepted' | 'rejected';
  userId: string;
}

export class ProactiveSuggestionsService {
  private static suggestionHistory = new Map<string, ProactiveSuggestion>();
  private static readonly SUGGESTION_MODEL = mongoose.model('ProactiveSuggestion', new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    estimatedSavings: { type: Number, required: true },
    savingsPercentage: { type: Number, required: true },
    confidence: { type: Number, required: true },
    context: { type: mongoose.Schema.Types.Mixed },
    actions: [{ type: mongoose.Schema.Types.Mixed }],
    priority: { type: String, required: true },
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    feedback: { type: mongoose.Schema.Types.Mixed }
  }));

  /**
   * Analyze user usage patterns and generate proactive suggestions
   */
  static async generateSuggestionsForUser(userId: string): Promise<CostSavingSuggestion[]> {
    try {
      loggingService.info('Generating proactive suggestions', { userId });

      const [
        modelDowngradeSuggestions,
        cachingSuggestions,
        compressionSuggestions,
        summarizationSuggestions
      ] = await Promise.all([
        this.analyzeModelDowngradeOpportunities(userId),
        this.analyzeSemanticCachingOpportunities(userId),
        this.analyzeCompressionOpportunities(userId),
        this.analyzeLazySummarizationOpportunities(userId)
      ]);

      const allSuggestions = [
        ...modelDowngradeSuggestions,
        ...cachingSuggestions,
        ...compressionSuggestions,
        ...summarizationSuggestions
      ];

      // Sort by priority and estimated savings
      const sortedSuggestions = allSuggestions.sort((a, b) => {
        const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.estimatedSavings - a.estimatedSavings;
      });

      // Save to database
      for (const suggestion of sortedSuggestions) {
        await this.SUGGESTION_MODEL.findOneAndUpdate(
          { id: suggestion.id },
          suggestion,
          { upsert: true, new: true }
        );
      }

      // Push top 3 suggestions via SSE immediately
      if (sortedSuggestions.length > 0) {
        await this.pushSuggestionsToUser(userId, sortedSuggestions.slice(0, 3));
      }

      loggingService.info('Generated proactive suggestions', {
        userId,
        suggestionCount: sortedSuggestions.length,
        totalSavings: sortedSuggestions.reduce((sum, s) => sum + s.estimatedSavings, 0)
      });

      return sortedSuggestions;
    } catch (error) {
      loggingService.error('Error generating suggestions', {
        error: error instanceof Error ? error.message : String(error),
        userId
      });
      return [];
    }
  }

  /**
   * Analyze model downgrade opportunities
   */
  private static async analyzeModelDowngradeOpportunities(userId: string): Promise<CostSavingSuggestion[]> {
    try {
      const { Usage } = await import('../models/Usage');
      
      // Get recent usage
      const recentUsage = await Usage.find({
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).limit(100).lean();

      if (recentUsage.length === 0) return [];

      // Analyze patterns - find expensive models used for simple tasks
      const modelUsage = recentUsage.reduce((acc: any, usage: any) => {
        const model = usage.model;
        if (!acc[model]) {
          acc[model] = { count: 0, totalCost: 0, avgTokens: 0, requests: [] };
        }
        acc[model].count++;
        acc[model].totalCost += usage.cost;
        acc[model].avgTokens += usage.totalTokens;
        acc[model].requests.push(usage);
        return acc;
      }, {});

      const suggestions: CostSavingSuggestion[] = [];

      for (const [model, stats] of Object.entries(modelUsage) as any) {
        const avgTokens = stats.avgTokens / stats.count;
        
        // If using expensive model (e.g., GPT-4) for small requests, suggest downgrade
        if ((model.includes('gpt-4') || model.includes('claude-opus')) && avgTokens < 2000) {
          const currentCost = stats.totalCost;
          const projectedCost = currentCost * 0.1; // GPT-3.5/Haiku is ~10% of GPT-4/Opus
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
              suggestedModel: model.includes('gpt') ? 'gpt-3.5-turbo' : 'claude-3-haiku-20240307',
              currentCost,
              projectedCost,
              requests: stats.count
            },
            actions: [
              { type: 'accept', label: 'Auto-switch for simple requests' },
              { type: 'customize', label: 'Set rules', params: { maxTokens: 2000 } },
              { type: 'reject', label: 'Not now' }
            ],
            priority: savings > 10 ? 'high' : 'medium',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            status: 'pending'
          });
        }
      }

      return suggestions;
    } catch (error) {
      loggingService.error('Error analyzing model downgrade opportunities', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Analyze semantic caching opportunities
   */
  private static async analyzeSemanticCachingOpportunities(userId: string): Promise<CostSavingSuggestion[]> {
    try {
      const { Usage } = await import('../models/Usage');
      
      // Find repeated similar prompts
      const recentUsage = await Usage.find({
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).limit(200).lean();

      if (recentUsage.length < 10) return [];

      // Simple similarity detection (in production, use vector embeddings)
      const promptGroups: Record<string, any[]> = {};
      for (const usage of recentUsage) {
        const promptKey = (usage as any).prompt?.substring(0, 100) || '';
        if (!promptGroups[promptKey]) {
          promptGroups[promptKey] = [];
        }
        promptGroups[promptKey].push(usage);
      }

      const suggestions: CostSavingSuggestion[] = [];

      for (const [promptKey, usages] of Object.entries(promptGroups)) {
        if (usages.length >= 3) {
          // Found repeated pattern
          const totalCost = usages.reduce((sum, u: any) => sum + u.cost, 0);
          const cacheSavings = totalCost * 0.7; // 70% savings from caching

          suggestions.push({
            id: `semantic_cache_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
              projectedCost: totalCost * 0.3
            },
            actions: [
              { type: 'accept', label: 'Enable semantic caching' },
              { type: 'learn_more', label: 'How it works' },
              { type: 'reject', label: 'Not interested' }
            ],
            priority: cacheSavings > 5 ? 'high' : 'medium',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
            status: 'pending'
          });
        }
      }

      return suggestions;
    } catch (error) {
      loggingService.error('Error analyzing caching opportunities', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Analyze context compression opportunities
   */
  private static async analyzeCompressionOpportunities(userId: string): Promise<CostSavingSuggestion[]> {
    try {
      const { Usage } = await import('../models/Usage');
      
      // Find requests with large token counts
      const largeRequests = await Usage.find({
        userId: new mongoose.Types.ObjectId(userId),
        totalTokens: { $gte: 5000 },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).limit(50).lean();

      if (largeRequests.length === 0) return [];

      const totalCost = largeRequests.reduce((sum, r: any) => sum + r.cost, 0);
      const compressionSavings = totalCost * 0.4; // 40% savings from compression

      const suggestions: CostSavingSuggestion[] = [];

      if (largeRequests.length >= 5) {
        suggestions.push({
          id: `context_compression_${userId}_${Date.now()}`,
          userId,
          type: 'context_compression',
          title: 'Enable context compression for long prompts',
          description: `${largeRequests.length} of your requests use 5K+ tokens. Compressing context can reduce tokens by 40% while maintaining quality.`,
          estimatedSavings: compressionSavings,
          savingsPercentage: 40,
          confidence: 0.88,
          context: {
            requests: largeRequests.length,
            currentCost: totalCost,
            projectedCost: totalCost * 0.6
          },
          actions: [
            { type: 'accept', label: 'Enable auto-compression' },
            { type: 'learn_more', label: 'Learn more' },
            { type: 'reject', label: 'Keep full context' }
          ],
          priority: compressionSavings > 10 ? 'high' : 'medium',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'pending'
        });
      }

      return suggestions;
    } catch (error) {
      loggingService.error('Error analyzing compression opportunities', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Analyze lazy summarization opportunities
   */
  private static async analyzeLazySummarizationOpportunities(userId: string): Promise<CostSavingSuggestion[]> {
    try {
      const { Usage } = await import('../models/Usage');
      
      // Find requests with very large context that could be summarized
      const veryLargeRequests = await Usage.find({
        userId: new mongoose.Types.ObjectId(userId),
        promptTokens: { $gte: 8000 },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }).limit(30).lean();

      if (veryLargeRequests.length === 0) return [];

      const totalCost = veryLargeRequests.reduce((sum, r: any) => sum + r.cost, 0);
      const summarizationSavings = totalCost * 0.6; // 60% savings from lazy summarization

      const suggestions: CostSavingSuggestion[] = [];

      if (veryLargeRequests.length >= 3) {
        suggestions.push({
          id: `lazy_summarization_${userId}_${Date.now()}`,
          userId,
          type: 'lazy_summarization',
          title: 'Use lazy summarization for long documents',
          description: `${veryLargeRequests.length} requests contain 8K+ prompt tokens. Lazy summarization extracts only relevant sections, reducing costs by 60%.`,
          estimatedSavings: summarizationSavings,
          savingsPercentage: 60,
          confidence: 0.82,
          context: {
            requests: veryLargeRequests.length,
            currentCost: totalCost,
            projectedCost: totalCost * 0.4
          },
          actions: [
            { type: 'accept', label: 'Enable lazy summarization' },
            { type: 'learn_more', label: 'How it works' },
            { type: 'reject', label: 'Not now' }
          ],
          priority: summarizationSavings > 15 ? 'critical' : 'high',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'pending'
        });
      }

      return suggestions;
    } catch (error) {
      loggingService.error('Error analyzing summarization opportunities', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Push suggestions to user via SSE
   */
  private static async pushSuggestionsToUser(userId: string, suggestions: CostSavingSuggestion[]): Promise<void> {
    try {
      const totalSavings = suggestions.reduce((sum, s) => sum + s.estimatedSavings, 0);

      RealtimeUpdateService.broadcastToUser(userId, {
        type: 'cost_saving_suggestions',
        message: `${suggestions.length} new cost-saving opportunities available`,
        totalPotentialSavings: totalSavings,
        suggestions: suggestions.map(s => ({
          id: s.id,
          type: s.type,
          title: s.title,
          description: s.description,
          estimatedSavings: s.estimatedSavings,
          savingsPercentage: s.savingsPercentage,
          priority: s.priority,
          actions: s.actions
        })),
        timestamp: new Date().toISOString()
      });

      loggingService.info('🚀 Pushed suggestions to user via SSE', {
        userId,
        suggestionCount: suggestions.length,
        totalSavings
      });
    } catch (error) {
      loggingService.error('Error pushing suggestions via SSE', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Record user feedback on a suggestion
   */
  static async recordSuggestionFeedback(feedback: SuggestionFeedback): Promise<void> {
    try {
      await this.SUGGESTION_MODEL.findOneAndUpdate(
        { id: feedback.suggestionId },
        {
          status: feedback.action,
          feedback: {
            action: feedback.action,
            reason: feedback.reason,
            appliedAt: feedback.appliedAt,
            resultMetrics: feedback.resultMetrics
          }
        }
      );

      // Update learning model
      await this.updateLearningModel(feedback);

      loggingService.info('Recorded suggestion feedback', {
        suggestionId: feedback.suggestionId,
        action: feedback.action
      });
    } catch (error) {
      loggingService.error('Error recording feedback', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Update machine learning model based on feedback
   */
  private static async updateLearningModel(feedback: SuggestionFeedback): Promise<void> {
    try {
      const key = `learning:suggestion:${feedback.userId}`;
      const learningData = await redisService.get(key) || { 
        accepted: 0, 
        rejected: 0, 
        typePreferences: {} 
      };

      // Update acceptance metrics
      if (feedback.action === 'accepted') {
        learningData.accepted++;
      } else if (feedback.action === 'rejected') {
        learningData.rejected++;
      }

      // Track type-specific preferences
      const suggestion = await this.SUGGESTION_MODEL.findOne({ id: feedback.suggestionId }).lean();
      if (suggestion) {
        const type = (suggestion as any).type;
        if (!learningData.typePreferences[type]) {
          learningData.typePreferences[type] = { accepted: 0, rejected: 0 };
        }
        if (feedback.action === 'accepted') {
          learningData.typePreferences[type].accepted++;
        } else if (feedback.action === 'rejected') {
          learningData.typePreferences[type].rejected++;
        }
      }

      await redisService.set(key, learningData, 86400 * 365); // 1 year TTL

      loggingService.info('Updated learning model', {
        userId: feedback.userId,
        acceptanceRate: (learningData.accepted / (learningData.accepted + learningData.rejected)) * 100
      });
    } catch (error) {
      loggingService.error('Error updating learning model', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get user's acceptance rate for personalization
   */
  static async getUserAcceptanceRate(userId: string, type?: string): Promise<number> {
    try {
      const key = `learning:suggestion:${userId}`;
      const learningData = await redisService.get(key);

      if (!learningData) return 0.5; // Default 50%

      if (type && learningData.typePreferences[type]) {
        const typeData = learningData.typePreferences[type];
        const total = typeData.accepted + typeData.rejected;
        return total > 0 ? typeData.accepted / total : 0.5;
      }

      const total = learningData.accepted + learningData.rejected;
      return total > 0 ? learningData.accepted / total : 0.5;
    } catch (error) {
      loggingService.error('Error getting acceptance rate', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0.5;
        }
    }

    /**
     * Pushes a context compression suggestion after successful compression.
     */
    static async pushContextCompressionSuggestion(
        userId: string,
        originalTokens: number,
        compressedTokens: number,
        reductionPercentage: number
    ): Promise<void> {
        const suggestion: ProactiveSuggestion = {
            id: `context_compression_success_${Date.now()}`,
            type: 'context_compression',
            message: `Context compression saved ${originalTokens - compressedTokens} tokens (${reductionPercentage.toFixed(1)}% reduction).`,
            potentialSavings: (originalTokens - compressedTokens) * 0.000002, // Rough estimate
            details: { originalTokens, compressedTokens, reductionPercentage },
            timestamp: new Date(),
            status: 'accepted', // Already applied
            userId
        };

        this.suggestionHistory.set(suggestion.id, suggestion);
        RealtimeUpdateService.emitProactiveSuggestion(userId, suggestion);
        
        loggingService.info('Context compression suggestion emitted', {
            userId,
            suggestionId: suggestion.id,
            reductionPercentage: reductionPercentage.toFixed(1)
        });
    }

    /**
     * Pushes an optimization completed suggestion after successful optimization.
     */
    static async pushOptimizationCompletedSuggestion(
        userId: string,
        tokensSaved: number,
        costSaved: number,
        improvementPercentage: number
    ): Promise<void> {
        const suggestion: ProactiveSuggestion = {
            id: `optimization_complete_${Date.now()}`,
            type: 'lazy_summarization',
            message: `Optimization completed! Saved ${tokensSaved} tokens and $${costSaved.toFixed(4)} (${improvementPercentage.toFixed(1)}% improvement).`,
            potentialSavings: costSaved,
            details: { tokensSaved, costSaved, improvementPercentage },
            timestamp: new Date(),
            status: 'accepted', // Already applied
            userId
        };

        this.suggestionHistory.set(suggestion.id, suggestion);
        RealtimeUpdateService.emitProactiveSuggestion(userId, suggestion);
        
        loggingService.info('Optimization completed suggestion emitted', {
            userId,
            suggestionId: suggestion.id,
            improvementPercentage: improvementPercentage.toFixed(1)
        });
    }

    /**
     * Tracks user acceptance of a suggestion.
     */
    static async trackSuggestionAcceptance(suggestionId: string, userId: string): Promise<void> {
        const suggestion = this.suggestionHistory.get(suggestionId);
        if (suggestion && suggestion.userId === userId) {
            suggestion.status = 'accepted';
            loggingService.info('Suggestion accepted', { suggestionId, userId, type: suggestion.type });
            
            // Feed into learning loop for better future suggestions
            try {
                const feedbackLoop = OptimizationFeedbackLoopService.getInstance();
                const details = suggestion.details || {};
                
                // Record acceptance in feedback loop with positive signals
                await feedbackLoop.learnFromUserAction(
                    userId,
                    'approve', // Correct action type
                    {
                        promptComplexity: 50,
                        userTier: 'pro',
                        costBudget: 'medium',
                        taskType: suggestion.type,
                        promptLength: 100
                    },
                    (details.suggestedModel as string) || 'unknown'
                );
                
                // If suggestion has an ID, record detailed outcome
                if (suggestion.id) {
                    const signals = {
                        userAcceptance: true,
                        costSaved: suggestion.potentialSavings,
                        qualityMaintained: true,
                        userRating: 5,
                        errorOccurred: false
                    };
                    
                    await feedbackLoop.recordOptimizationOutcome(
                        suggestion.id,
                        userId,
                        {
                            promptComplexity: 50,
                            userTier: 'pro',
                            costBudget: 'medium',
                            taskType: suggestion.type,
                            promptLength: 100
                        },
                        (details.currentModel as string) || 'unknown',
                        (details.suggestedModel as string) || 'unknown',
                        signals
                    );
                }
                
                loggingService.info('✅ Fed suggestion acceptance into learning loop', {
                    suggestionId,
                    type: suggestion.type,
                    potentialSavings: suggestion.potentialSavings
                });
            } catch (error) {
                loggingService.error('Failed to feed acceptance into learning loop', {
                    error: error instanceof Error ? error.message : String(error),
                    suggestionId
                });
            }
            
            this.suggestionHistory.delete(suggestionId); // Remove once acted upon
        } else {
            loggingService.warn('Suggestion not found or unauthorized acceptance attempt', { suggestionId, userId });
        }
    }

    /**
     * Tracks user rejection of a suggestion.
     */
    static async trackSuggestionRejection(suggestionId: string, userId: string, reason?: string): Promise<void> {
        const suggestion = this.suggestionHistory.get(suggestionId);
        if (suggestion && suggestion.userId === userId) {
            suggestion.status = 'rejected';
            loggingService.info('Suggestion rejected', { suggestionId, userId, type: suggestion.type, reason });
            
            // Feed into learning loop to avoid similar suggestions
            try {
                const feedbackLoop = OptimizationFeedbackLoopService.getInstance();
                const details = suggestion.details || {};
                
                // Record rejection in feedback loop with negative signals
                await feedbackLoop.learnFromUserAction(
                    userId,
                    'reject', // Correct action type
                    {
                        promptComplexity: 50,
                        userTier: 'pro',
                        costBudget: 'medium',
                        taskType: suggestion.type,
                        promptLength: 100
                    },
                    (details.suggestedModel as string) || 'unknown'
                );
                
                // If suggestion has an ID, record detailed outcome with rejection signals
                if (suggestion.id) {
                    const signals = {
                        userAcceptance: false,
                        costSaved: 0,
                        qualityMaintained: false,
                        userRating: 1,
                        errorOccurred: false,
                        rejectionReason: reason
                    };
                    
                    await feedbackLoop.recordOptimizationOutcome(
                        suggestion.id,
                        userId,
                        {
                            promptComplexity: 50,
                            userTier: 'pro',
                            costBudget: 'medium',
                            taskType: suggestion.type,
                            promptLength: 100
                        },
                        (details.currentModel as string) || 'unknown',
                        (details.suggestedModel as string) || 'unknown',
                        signals
                    );
                }
                
                loggingService.info('✅ Fed suggestion rejection into learning loop', {
                    suggestionId,
                    type: suggestion.type,
                    reason: reason ?? 'no reason provided'
                });
            } catch (error) {
                loggingService.error('Failed to feed rejection into learning loop', {
                    error: error instanceof Error ? error.message : String(error),
                    suggestionId,
                    reason
                });
            }
            
            this.suggestionHistory.delete(suggestionId); // Remove once acted upon
        } else {
            loggingService.warn('Suggestion not found or unauthorized rejection attempt', { suggestionId, userId });
        }
    }
}

