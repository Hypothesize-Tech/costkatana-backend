import { Tip, ITip, Usage, IUsage, User, IUser } from '../models';
import { logger } from '../utils';
import { ActivityService } from './activity.service';

export interface TipContext {
    usage?: IUsage;
    user?: IUser;
    recentUsages?: IUsage[];
    optimizationConfig?: any;
}

export interface TipRecommendation {
    tip: ITip;
    relevanceScore: number;
    context: any;
}

export class IntelligenceService {
    /**
     * Analyze usage and recommend relevant tips
     */
    async analyzeAndRecommendTips(context: TipContext): Promise<TipRecommendation[]> {
        try {
            const activeTips = await Tip.find({ isActive: true });
            const recommendations: TipRecommendation[] = [];

            for (const tip of activeTips) {
                const relevanceScore = await this.evaluateTipRelevance(tip, context);
                if (relevanceScore > 0.5) { // Threshold for showing tips
                    recommendations.push({
                        tip: tip.toObject(),
                        relevanceScore,
                        context: this.generateTipContext(tip, context)
                    });
                }
            }

            // Sort by priority and relevance
            recommendations.sort((a, b) => {
                const priorityWeight = { high: 3, medium: 2, low: 1 };
                const aPriority = priorityWeight[a.tip.priority] * a.relevanceScore;
                const bPriority = priorityWeight[b.tip.priority] * b.relevanceScore;
                return bPriority - aPriority;
            });

            return recommendations.slice(0, 5); // Return top 5 tips
        } catch (error) {
            logger.error('Error analyzing tips:', error);
            return [];
        }
    }

    /**
     * Evaluate how relevant a tip is to the current context
     */
    private async evaluateTipRelevance(tip: ITip, context: TipContext): Promise<number> {
        const { usage, user, recentUsages, optimizationConfig } = context;
        let relevanceScore = 0;

        switch (tip.trigger.condition) {
            case 'high_tokens':
                if (usage && usage.totalTokens > (tip.trigger.threshold || 4000)) {
                    relevanceScore = Math.min(usage.totalTokens / 10000, 1); // Higher tokens = higher relevance
                }
                break;

            case 'no_optimization':
                if (optimizationConfig && !this.hasOptimizationEnabled(optimizationConfig)) {
                    relevanceScore = 0.9;
                }
                break;

            case 'expensive_model':
                if (usage && this.isExpensiveModel(usage.model)) {
                    relevanceScore = 0.8;
                }
                break;

            case 'repeated_prompts':
                if (recentUsages && this.hasRepeatedPrompts(recentUsages)) {
                    relevanceScore = 0.85;
                }
                break;

            case 'long_context':
                if (usage && usage.promptTokens > (tip.trigger.threshold || 3000)) {
                    relevanceScore = Math.min(usage.promptTokens / 5000, 1);
                }
                break;

            case 'custom':
                // Evaluate custom rule if provided
                if (tip.trigger.customRule) {
                    relevanceScore = await this.evaluateCustomRule(tip.trigger.customRule, context);
                }
                break;
        }

        // Adjust for user tier
        if (user && tip.targetAudience && tip.targetAudience !== 'all') {
            const userTier = user.subscription?.plan || 'free';
            if (tip.targetAudience !== userTier) {
                relevanceScore *= 0.5; // Reduce relevance if not target audience
            }
        }

        // Reduce relevance if tip was recently dismissed
        const userId = (user as any)?._id || null;
        const recentDismissals = await this.getRecentTipDismissals(userId, tip._id);
        if (recentDismissals > 0) {
            relevanceScore *= Math.max(0.1, 1 - (recentDismissals * 0.3));
        }

        return relevanceScore;
    }

    /**
     * Check if any optimization features are enabled
     */
    private hasOptimizationEnabled(config: any): boolean {
        return config.enableCaching ||
            config.enableModelOptimization ||
            config.enableBatching ||
            config.promptCompression?.enabled ||
            config.contextTrimming?.enabled ||
            config.requestFusion?.enabled;
    }

    /**
     * Check if the model is considered expensive
     */
    private isExpensiveModel(model: string): boolean {
        // Import the pricing utilities
        const { MODEL_PRICING } = require('../utils/pricing');

        // Find the model in pricing data
        const modelPricing = MODEL_PRICING.find((pricing: any) =>
            pricing.model.toLowerCase() === model.toLowerCase()
        );

        if (!modelPricing) {
            // If model not found, check against known expensive model patterns
            const expensivePatterns = ['gpt-4', 'claude-3-opus', 'gemini-ultra'];
            return expensivePatterns.some(pattern => model.toLowerCase().includes(pattern));
        }

        // Consider expensive if input price > $20/1M tokens or output price > $60/1M tokens
        const expensiveInputThreshold = 20; // $20 per 1M tokens
        const expensiveOutputThreshold = 60; // $60 per 1M tokens

        return modelPricing.inputPrice > expensiveInputThreshold ||
            modelPricing.outputPrice > expensiveOutputThreshold;
    }

    /**
     * Detect repeated prompts in recent usage
     */
    private hasRepeatedPrompts(recentUsages: IUsage[]): boolean {
        const prompts = recentUsages.map(u => u.metadata?.prompt || '').filter(p => p.length > 0);
        const uniquePrompts = new Set(prompts);
        return prompts.length > 5 && uniquePrompts.size < prompts.length * 0.7; // 30% repetition
    }

    /**
     * Evaluate custom rules (simplified for now)
     */
    private async evaluateCustomRule(rule: string, context: TipContext): Promise<number> {
        // This could be expanded to support a DSL or more complex rules
        try {
            // Simple rule evaluation based on context properties
            if (rule.includes('usage.cost >') && context.usage) {
                const threshold = parseFloat(rule.match(/usage\.cost > (\d+\.?\d*)/)?.[1] || '0');
                return context.usage.cost > threshold ? 1 : 0;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    /**
     * Get recent tip dismissals for a user
     */
    private async getRecentTipDismissals(_userId: string | null, _tipId: string): Promise<number> {
        // This would check a user preferences or interaction log
        // For now, return 0
        return 0;
    }

    /**
     * Generate context-specific data for the tip
     */
    private generateTipContext(tip: ITip, context: TipContext): any {
        const result: any = {};

        if (tip.potentialSavings && context.usage) {
            if (tip.potentialSavings.percentage) {
                result.estimatedSavings = context.usage.cost * (tip.potentialSavings.percentage / 100);
            }
            if (tip.potentialSavings.amount) {
                result.estimatedSavings = tip.potentialSavings.amount;
            }
        }

        // Add specific context based on trigger
        switch (tip.trigger.condition) {
            case 'high_tokens':
                result.currentTokens = context.usage?.totalTokens;
                result.threshold = tip.trigger.threshold;
                break;
            case 'expensive_model':
                result.currentModel = context.usage?.model;
                result.suggestedModel = tip.action?.targetModel;
                break;
        }

        return result;
    }

    /**
     * Track tip interaction
     */
    async trackTipInteraction(tipId: string, interaction: 'display' | 'click' | 'dismiss' | 'success', userId?: string): Promise<void> {
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

            const tip = await Tip.findOneAndUpdate({ tipId }, update, { new: true });

            // Track activity based on action
            if (tip && userId) {
                if (interaction === 'display') {
                    await ActivityService.trackActivity(userId, {
                        type: 'tip_viewed',
                        title: 'Tip Viewed',
                        description: tip.message,
                        metadata: {
                            tipId: tip._id,
                            tipType: tip.type,
                            potentialSavings: tip.potentialSavings?.percentage || 0
                        }
                    });
                } else if (interaction === 'success') {
                    await ActivityService.trackActivity(userId, {
                        type: 'tip_applied',
                        title: 'Tip Applied Successfully',
                        description: `Applied tip: ${tip.message}`,
                        metadata: {
                            tipId: tip._id,
                            tipType: tip.type,
                            actualSavings: tip.potentialSavings?.percentage || 0
                        }
                    });
                }
            }
        } catch (error) {
            logger.error('Error tracking tip interaction:', error);
        }
    }

    /**
     * Get personalized tips for dashboard
     */
    async getPersonalizedTips(userId: string, limit: number = 3): Promise<TipRecommendation[]> {
        try {
            const user = await User.findById(userId);
            const recentUsages = await Usage.find({ userId })
                .sort({ createdAt: -1 })
                .limit(50);

            // Use internal optimization utilities instead of external tracker
            // For now, return empty config until we implement internal optimization config
            const optimizationConfig = {
                enablePromptOptimization: true,
                enableModelSuggestions: true,
                enableCachingSuggestions: true
            };

            const context: TipContext = {
                user: user?.toObject(),
                recentUsages: recentUsages.map(u => u.toObject()),
                optimizationConfig
            };

            const recommendations = await this.analyzeAndRecommendTips(context);
            return recommendations.slice(0, limit);
        } catch (error) {
            logger.error('Error getting personalized tips:', error);
            return [];
        }
    }

    /**
     * Initialize default tips in the database
     */
    async initializeDefaultTips(): Promise<void> {
        const defaultTips: Partial<ITip>[] = [
            {
                tipId: 'enable-context-trimming',
                title: 'Long Context Detected',
                message: 'This context is long. Enable Adaptive Context Trimming to potentially save 50% on tokens.',
                type: 'optimization',
                trigger: { condition: 'long_context', threshold: 3000 },
                action: { type: 'enable_feature', feature: 'contextTrimming' },
                potentialSavings: { percentage: 50, description: 'Reduce tokens by trimming irrelevant context' },
                priority: 'high'
            },
            {
                tipId: 'switch-to-cheaper-model',
                title: 'Consider a More Cost-Effective Model',
                message: 'For this type of query, GPT-3.5-Turbo could provide similar quality at 10x lower cost.',
                type: 'cost_saving',
                trigger: { condition: 'expensive_model' },
                action: { type: 'change_model', targetModel: 'gpt-3.5-turbo' },
                potentialSavings: { percentage: 90, description: 'Switch to a cheaper model' },
                priority: 'high'
            },
            {
                tipId: 'enable-prompt-compression',
                title: 'Repetitive Data Detected',
                message: 'Your prompt contains repetitive patterns. Enable Prompt Compression to reduce tokens.',
                type: 'optimization',
                trigger: { condition: 'repeated_prompts' },
                action: { type: 'enable_feature', feature: 'promptCompression' },
                potentialSavings: { percentage: 30, description: 'Compress repetitive content' },
                priority: 'medium'
            },
            {
                tipId: 'no-optimization-warning',
                title: 'Optimization Features Disabled',
                message: 'You have all optimization features disabled. Enable them to start saving on AI costs.',
                type: 'feature',
                trigger: { condition: 'no_optimization' },
                action: { type: 'view_guide', guideUrl: '/optimizations' },
                potentialSavings: { percentage: 40, description: 'Enable optimization features' },
                priority: 'high'
            },
            {
                tipId: 'high-token-usage',
                title: 'High Token Usage Alert',
                message: 'This request used over 5000 tokens. Consider breaking it into smaller requests or enabling optimizations.',
                type: 'best_practice',
                trigger: { condition: 'high_tokens', threshold: 5000 },
                action: { type: 'run_wizard' },
                potentialSavings: { percentage: 60, description: 'Optimize high token usage' },
                priority: 'high'
            }
        ];

        for (const tipData of defaultTips) {
            await Tip.findOneAndUpdate(
                { tipId: tipData.tipId },
                { $setOnInsert: tipData },
                { upsert: true, new: true }
            );
        }

        logger.info('Default tips initialized');
    }


}

// Export singleton instance
export const intelligenceService = new IntelligenceService(); 