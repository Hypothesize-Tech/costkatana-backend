/**
 * Recommendation Rules Service for NestJS
 * Generates rule-based recommendations for cost optimization and usage improvements
 */

import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

const RECOMMENDATIONS_COUNTER_KEY = 'recommendation_rules:recommendations_generated';
const COUNTER_TTL_YEARS = 10; // Persistent counter - long TTL

export interface SmartRecommendation {
  type:
    | 'prompt_optimization'
    | 'model_switch'
    | 'cost_reduction'
    | 'timing'
    | 'limit_warning'
    | 'personalized_coaching';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  message: string;
  suggestedAction: string;
  potentialSavings?: {
    tokens: number;
    cost: number;
    percentage: number;
  };
  costKatanaUrl?: string;
  aiGenerated: boolean;
  personalized: boolean;
  confidence: number;
  metadata?: {
    ruleName: string;
    triggerCondition: string;
    dataPoints: any[];
  };
}

export interface UsagePattern {
  averageTokensPerRequest: number;
  mostUsedModels: string[];
  peakUsageHours: number[];
  commonTopics: string[];
  inefficiencyScore: number;
  totalRequests: number;
  totalCost: number;
  averageCostPerRequest: number;
}

export interface ChatGPTPlan {
  name: string;
  cost: number;
  monthlyLimit?: number;
  dailyLimit?: number;
}

@Injectable()
export class RecommendationRulesService {
  private readonly logger = new Logger(RecommendationRulesService.name);

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Generate rule-based recommendations
   */
  generateRecommendations(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    plan: ChatGPTPlan,
  ): SmartRecommendation[] {
    const recommendations: SmartRecommendation[] = [];

    // Run all rule checks
    const ruleChecks = [
      this.checkHighGPT4Usage,
      this.checkLargePrompts,
      this.checkRepetitivePatterns,
      this.checkPeakHourUsage,
      this.checkModelMismatch,
      this.checkLimitApproaching,
      this.checkInefficiency,
      this.checkUnusedFeatures,
      this.checkCostSpike,
    ];

    for (const ruleCheck of ruleChecks) {
      try {
        const result = ruleCheck.call(
          this,
          userId,
          monthlyUsage,
          pattern,
          plan,
        );
        if (result) {
          if (Array.isArray(result)) {
            recommendations.push(...result);
          } else {
            recommendations.push(result);
          }
        }
      } catch (error) {
        this.logger.warn(`Rule check failed`, {
          rule: ruleCheck.name,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Sort by priority and potential savings
    const sorted = recommendations.sort((a, b) => {
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      const priorityDiff =
        priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      const aSavings = a.potentialSavings?.cost || 0;
      const bSavings = b.potentialSavings?.cost || 0;
      return bSavings - aSavings;
    });

    if (sorted.length > 0) {
      this.incrementRecommendationsGenerated(sorted.length).catch((err) =>
        this.logger.warn('Failed to persist recommendations counter', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    return sorted;
  }

  private async incrementRecommendationsGenerated(delta: number): Promise<void> {
    const ttl = COUNTER_TTL_YEARS * 365 * 24 * 60 * 60;
    const current =
      (await this.cacheService.get<number>(RECOMMENDATIONS_COUNTER_KEY)) ?? 0;
    await this.cacheService.set(RECOMMENDATIONS_COUNTER_KEY, current + delta, ttl);
  }

  /**
   * Check for high GPT-4 usage
   */
  private checkHighGPT4Usage(
    userId: string,
    monthlyUsage: any[],
    _pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    const gpt4Usage = monthlyUsage.filter(
      (u) => u.model.includes('gpt-4') || u.model.includes('gpt4'),
    );

    if (gpt4Usage.length === 0) return null;

    const gpt4Cost = gpt4Usage.reduce((sum, u) => sum + u.cost, 0);
    const totalCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0);
    const percentage = (gpt4Cost / totalCost) * 100;

    if (percentage > 70) {
      const potentialSavings = gpt4Cost * 0.4; // 40% savings by switching 50% to GPT-3.5

      return {
        type: 'model_switch',
        priority: 'high',
        title: 'High GPT-4 Usage Detected',
        message: `You're using GPT-4 for ${percentage.toFixed(1)}% of your requests, which is very expensive.`,
        suggestedAction:
          'Consider switching simpler queries to GPT-3.5-turbo for significant cost savings.',
        potentialSavings: {
          tokens: 0,
          cost: potentialSavings,
          percentage: 40,
        },
        costKatanaUrl: '/optimization/model-selection',
        aiGenerated: false,
        personalized: true,
        confidence: 0.95,
        metadata: {
          ruleName: 'high_gpt4_usage',
          triggerCondition: 'gpt4_usage_percentage > 70%',
          dataPoints: [percentage, gpt4Cost, totalCost],
        },
      };
    }

    return null;
  }

  /**
   * Check for large prompts that could be optimized
   */
  private checkLargePrompts(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    if (pattern.averageTokensPerRequest < 1000) return null;

    const largeRequests = monthlyUsage.filter((u) => u.tokens > 2000);
    if (largeRequests.length === 0) return null;

    const averageLargeTokens =
      largeRequests.reduce((sum, u) => sum + u.tokens, 0) /
      largeRequests.length;
    const potentialSavings =
      (averageLargeTokens - 1000) * largeRequests.length * 0.00002; // Rough token cost

    return {
      type: 'prompt_optimization',
      priority: 'medium',
      title: 'Large Prompts Detected',
      message: `Your average prompt size is ${pattern.averageTokensPerRequest} tokens, which could be optimized.`,
      suggestedAction:
        'Consider breaking down large prompts or using prompt compression techniques.',
      potentialSavings: {
        tokens: (averageLargeTokens - 1000) * largeRequests.length,
        cost: potentialSavings,
        percentage: 20,
      },
      costKatanaUrl: '/optimization/prompt-compression',
      aiGenerated: false,
      personalized: true,
      confidence: 0.85,
      metadata: {
        ruleName: 'large_prompts',
        triggerCondition: 'average_tokens_per_request > 1000',
        dataPoints: [pattern.averageTokensPerRequest, largeRequests.length],
      },
    };
  }

  /**
   * Check for repetitive patterns that could be templated
   */
  private checkRepetitivePatterns(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    // Check for repeated similar prompts
    const promptGroups = new Map<string, number>();
    for (const usage of monthlyUsage) {
      const promptKey = this.normalizePrompt(
        usage.prompt?.substring(0, 100) || '',
      );
      promptGroups.set(promptKey, (promptGroups.get(promptKey) || 0) + 1);
    }

    const repetitivePrompts = Array.from(promptGroups.entries()).filter(
      ([, count]) => count > 5,
    );

    if (repetitivePrompts.length > 0) {
      const totalRepetitive = repetitivePrompts.reduce(
        (sum, [, count]) => sum + count,
        0,
      );
      const avgCost =
        pattern.totalRequests > 0
          ? pattern.totalCost / pattern.totalRequests
          : 0;
      const potentialSavings = totalRepetitive * avgCost * 0.3;

      return {
        type: 'prompt_optimization',
        priority: 'medium',
        title: 'Repetitive Prompts Detected',
        message: `You have ${repetitivePrompts.length} repetitive prompt patterns that could be templated.`,
        suggestedAction:
          'Create reusable prompt templates to reduce token usage and improve consistency.',
        potentialSavings: {
          tokens: totalRepetitive * 200, // Estimate 200 tokens saved per repetitive prompt
          cost: potentialSavings,
          percentage: 30,
        },
        costKatanaUrl: '/templates/create',
        aiGenerated: false,
        personalized: true,
        confidence: 0.8,
        metadata: {
          ruleName: 'repetitive_patterns',
          triggerCondition: 'repetitive_prompts > 5',
          dataPoints: [repetitivePrompts.length, totalRepetitive],
        },
      };
    }

    return null;
  }

  /**
   * Check for peak hour usage that could be shifted
   */
  private checkPeakHourUsage(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    if (pattern.peakUsageHours.length === 0) return null;

    const peakHourUsage = monthlyUsage.filter((u) => {
      const hour = new Date(u.timestamp).getHours();
      return pattern.peakUsageHours.includes(hour);
    });

    if (peakHourUsage.length > monthlyUsage.length * 0.7) {
      // 70% of usage is during peak hours
      const potentialSavings = pattern.totalCost * 0.15; // 15% savings by shifting usage

      return {
        type: 'timing',
        priority: 'low',
        title: 'Peak Hour Usage Detected',
        message: `${((peakHourUsage.length / monthlyUsage.length) * 100).toFixed(1)}% of your usage occurs during peak hours.`,
        suggestedAction:
          'Consider scheduling non-urgent requests during off-peak hours for cost savings.',
        potentialSavings: {
          tokens: 0,
          cost: potentialSavings,
          percentage: 15,
        },
        costKatanaUrl: '/optimization/scheduling',
        aiGenerated: false,
        personalized: true,
        confidence: 0.75,
        metadata: {
          ruleName: 'peak_hour_usage',
          triggerCondition: 'peak_usage_percentage > 70%',
          dataPoints: [pattern.peakUsageHours, peakHourUsage.length],
        },
      };
    }

    return null;
  }

  /**
   * Check for model mismatch (using expensive models for simple tasks)
   */
  private checkModelMismatch(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    const simpleTasks = monthlyUsage.filter(
      (u) =>
        u.tokens < 500 &&
        (u.model.includes('gpt-4') || u.model.includes('claude-3-opus')),
    );

    if (simpleTasks.length > 10) {
      const expensiveCost = simpleTasks.reduce((sum, u) => sum + u.cost, 0);
      const potentialSavings = expensiveCost * 0.8; // 80% savings by switching to cheaper models

      return {
        type: 'model_switch',
        priority: 'high',
        title: 'Model Oversizing Detected',
        message: `You're using expensive models for ${simpleTasks.length} simple tasks that could use cheaper alternatives.`,
        suggestedAction:
          'Switch simple queries (<500 tokens) to GPT-3.5-turbo or Claude-3-Haiku.',
        potentialSavings: {
          tokens: 0,
          cost: potentialSavings,
          percentage: 80,
        },
        costKatanaUrl: '/optimization/model-selection',
        aiGenerated: false,
        personalized: true,
        confidence: 0.9,
        metadata: {
          ruleName: 'model_mismatch',
          triggerCondition: 'simple_tasks_with_expensive_models > 10',
          dataPoints: [simpleTasks.length, expensiveCost],
        },
      };
    }

    return null;
  }

  /**
   * Check if approaching usage limits
   */
  private checkLimitApproaching(
    userId: string,
    monthlyUsage: any[],
    _pattern: UsagePattern,
    plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    if (!plan.monthlyLimit) return null;

    const currentUsage = monthlyUsage.reduce((sum, u) => sum + u.tokens, 0);
    const usagePercentage = (currentUsage / plan.monthlyLimit) * 100;

    if (usagePercentage > 80) {
      const priority: 'low' | 'medium' | 'high' | 'urgent' =
        usagePercentage > 95
          ? 'urgent'
          : usagePercentage > 90
            ? 'high'
            : 'medium';

      return {
        type: 'limit_warning',
        priority,
        title: `Approaching ${plan.name} Limit`,
        message: `You've used ${usagePercentage.toFixed(1)}% of your monthly token limit.`,
        suggestedAction:
          usagePercentage > 95
            ? 'Immediately reduce usage or upgrade your plan to avoid service interruption.'
            : 'Monitor your usage closely and consider cost optimization measures.',
        costKatanaUrl: '/usage/limits',
        aiGenerated: false,
        personalized: true,
        confidence: 1.0,
        metadata: {
          ruleName: 'limit_approaching',
          triggerCondition: `usage_percentage > 80% (${usagePercentage.toFixed(1)}%)`,
          dataPoints: [currentUsage, plan.monthlyLimit, usagePercentage],
        },
      };
    }

    return null;
  }

  /**
   * Check for inefficiency patterns
   */
  private checkInefficiency(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    if (pattern.inefficiencyScore < 0.3) return null;

    const potentialSavings =
      pattern.totalCost * pattern.inefficiencyScore * 0.5;

    return {
      type: 'cost_reduction',
      priority: pattern.inefficiencyScore > 0.7 ? 'high' : 'medium',
      title: 'Usage Inefficiency Detected',
      message: `Your usage patterns show ${(pattern.inefficiencyScore * 100).toFixed(1)}% inefficiency.`,
      suggestedAction:
        'Review your usage patterns and implement cost optimization strategies.',
      potentialSavings: {
        tokens: Math.floor(
          pattern.averageTokensPerRequest *
            monthlyUsage.length *
            pattern.inefficiencyScore,
        ),
        cost: potentialSavings,
        percentage: pattern.inefficiencyScore * 50,
      },
      costKatanaUrl: '/optimization/analysis',
      aiGenerated: false,
      personalized: true,
      confidence: 0.85,
      metadata: {
        ruleName: 'inefficiency',
        triggerCondition: `inefficiency_score > 0.3 (${pattern.inefficiencyScore.toFixed(2)})`,
        dataPoints: [pattern.inefficiencyScore, pattern.totalCost],
      },
    };
  }

  /**
   * Check for unused features that could be removed
   */
  private checkUnusedFeatures(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    if (monthlyUsage.length < 30) return null;

    const modelsUsed = new Set(monthlyUsage.map((u) => u.model));
    const planLimit = plan.monthlyLimit ?? 0;
    const totalTokens = monthlyUsage.reduce(
      (sum, u) => sum + (u.tokens ?? 0),
      0,
    );
    const avgPerRequest =
      pattern.totalRequests > 0 ? pattern.totalCost / pattern.totalRequests : 0;

    // If user has very low utilization vs plan, suggest reviewing plan
    if (
      planLimit > 0 &&
      totalTokens < planLimit * 0.1 &&
      pattern.totalCost > 0
    ) {
      return {
        type: 'personalized_coaching',
        priority: 'low',
        title: 'Low Plan Utilization',
        message: `You're using under 10% of your plan limit. Consider downgrading or optimizing usage.`,
        suggestedAction:
          'Review your plan tier and usage patterns in the dashboard.',
        costKatanaUrl: '/usage/limits',
        aiGenerated: false,
        personalized: true,
        confidence: 0.75,
        metadata: {
          ruleName: 'unused_features',
          triggerCondition: 'total_tokens < 10% of plan limit',
          dataPoints: [totalTokens, planLimit, avgPerRequest],
        },
      };
    }

    return null;
  }

  /**
   * Check for cost spikes
   */
  private checkCostSpike(
    userId: string,
    monthlyUsage: any[],
    pattern: UsagePattern,
    _plan: ChatGPTPlan,
  ): SmartRecommendation | null {
    if (monthlyUsage.length < 7) return null;

    // Group by day and check for spikes
    const dailyCosts = new Map<string, number>();
    for (const usage of monthlyUsage) {
      const day = new Date(usage.timestamp).toDateString();
      dailyCosts.set(day, (dailyCosts.get(day) || 0) + usage.cost);
    }

    const costs = Array.from(dailyCosts.values());
    const averageCost =
      costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    const maxCost = Math.max(...costs);

    if (maxCost > averageCost * 3) {
      return {
        type: 'cost_reduction',
        priority: 'medium',
        title: 'Cost Spike Detected',
        message: `Unusual cost spike detected: $${maxCost.toFixed(2)} vs average $${averageCost.toFixed(2)}.`,
        suggestedAction:
          'Review recent usage to identify the cause and implement controls.',
        costKatanaUrl: '/usage/analysis',
        aiGenerated: false,
        personalized: true,
        confidence: 0.9,
        metadata: {
          ruleName: 'cost_spike',
          triggerCondition: `max_daily_cost > 3x_average (${maxCost.toFixed(2)} > ${averageCost.toFixed(2)})`,
          dataPoints: [maxCost, averageCost],
        },
      };
    }

    return null;
  }

  /**
   * Normalize prompt for similarity comparison
   */
  private normalizePrompt(prompt: string): string {
    return prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .slice(0, 10)
      .join(' ')
      .trim();
  }

  /**
   * Get recommendations statistics with persisted counter
   */
  async getStatistics(): Promise<{
    totalRules: number;
    activeRules: string[];
    averageConfidence: number;
    recommendationsGenerated: number;
  }> {
    const recommendationsGenerated =
      (await this.cacheService.get<number>(RECOMMENDATIONS_COUNTER_KEY)) ?? 0;
    return {
      totalRules: 9, // Number of rule check methods
      activeRules: [
        'checkHighGPT4Usage',
        'checkLargePrompts',
        'checkRepetitivePatterns',
        'checkPeakHourUsage',
        'checkModelMismatch',
        'checkLimitApproaching',
        'checkInefficiency',
        'checkUnusedFeatures',
        'checkCostSpike',
      ],
      averageConfidence: 0.85,
      recommendationsGenerated,
    };
  }
}
