/**
 * Pricing Service
 *
 * Provides pricing calculations and model cost estimation for AI services.
 * Handles cost optimization, budget tracking, and pricing intelligence.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface ModelPricing {
  /** Model identifier */
  model: string;

  /** Cost per 1K input tokens */
  inputCostPerToken: number;

  /** Cost per 1K output tokens */
  outputCostPerToken: number;

  /** Currency for pricing */
  currency: string;

  /** Provider name */
  provider: string;

  /** Model capabilities */
  capabilities: string[];

  /** Model tier/category */
  tier: 'budget' | 'standard' | 'premium' | 'enterprise';

  /** Last updated timestamp */
  lastUpdated: Date;

  /** Is model currently active */
  active: boolean;
}

export interface CostEstimate {
  /** Model used for estimation */
  model: string;

  /** Estimated input tokens */
  inputTokens: number;

  /** Estimated output tokens */
  outputTokens: number;

  /** Total estimated cost */
  totalCost: number;

  /** Currency */
  currency: string;

  /** Cost breakdown */
  breakdown: {
    inputCost: number;
    outputCost: number;
  };

  /** Confidence in estimation */
  confidence: number;

  /** Alternative model suggestions */
  alternatives?: Array<{
    model: string;
    totalCost: number;
    savings: number;
    reason: string;
  }>;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  /**
   * Current model pricing data
   * Updated regularly to reflect current market rates
   */
  private readonly MODEL_PRICING: ModelPricing[] = [
    // Anthropic Claude models
    {
      model: 'anthropic.claude-3-opus-20240229-v1:0',
      inputCostPerToken: 0.015,
      outputCostPerToken: 0.075,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'analysis', 'reasoning'],
      tier: 'enterprise',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      inputCostPerToken: 0.003,
      outputCostPerToken: 0.015,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'analysis', 'reasoning', 'multimodal'],
      tier: 'premium',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'anthropic.claude-3-haiku-20240307-v1:0',
      inputCostPerToken: 0.00025,
      outputCostPerToken: 0.00125,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'fast_responses'],
      tier: 'budget',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      inputCostPerToken: 0.0008,
      outputCostPerToken: 0.004,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'fast_responses'],
      tier: 'standard',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'anthropic.claude-sonnet-4-6',
      inputCostPerToken: 0.003,
      outputCostPerToken: 0.015,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: [
        'text',
        'code',
        'analysis',
        'reasoning',
        'coding',
        'agents',
      ],
      tier: 'premium',
      lastUpdated: new Date('2025-02-01'),
      active: true,
    },
    {
      model: 'us.anthropic.claude-sonnet-4-6',
      inputCostPerToken: 0.003,
      outputCostPerToken: 0.015,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: [
        'text',
        'code',
        'analysis',
        'reasoning',
        'coding',
        'agents',
      ],
      tier: 'premium',
      lastUpdated: new Date('2025-02-01'),
      active: true,
    },
    {
      model: 'us.anthropic.claude-sonnet-4-6',
      inputCostPerToken: 0.003,
      outputCostPerToken: 0.015,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: [
        'text',
        'code',
        'analysis',
        'reasoning',
        'coding',
        'agents',
      ],
      tier: 'premium',
      lastUpdated: new Date('2025-02-01'),
      active: true,
    },
    {
      model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      inputCostPerToken: 0.003,
      outputCostPerToken: 0.015,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'analysis', 'reasoning', 'multimodal'],
      tier: 'premium',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      inputCostPerToken: 0.0008,
      outputCostPerToken: 0.004,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'fast_responses', 'analysis'],
      tier: 'budget',
      lastUpdated: new Date('2025-01-01'),
      active: true,
    },
    {
      model: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
      inputCostPerToken: 0.0008,
      outputCostPerToken: 0.004,
      currency: 'USD',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'fast_responses', 'analysis'],
      tier: 'budget',
      lastUpdated: new Date('2025-01-01'),
      active: true,
    },

    // Amazon Nova models (Bedrock)
    {
      model: 'amazon.nova-pro-v1:0',
      inputCostPerToken: 0.0008,
      outputCostPerToken: 0.0032,
      currency: 'USD',
      provider: 'amazon',
      capabilities: ['text', 'image', 'video', 'multimodal', 'reasoning'],
      tier: 'premium',
      lastUpdated: new Date('2025-02-01'),
      active: true,
    },
    {
      model: 'amazon.nova-lite-v1:0',
      inputCostPerToken: 0.0006,
      outputCostPerToken: 0.0024,
      currency: 'USD',
      provider: 'amazon',
      capabilities: ['text', 'image', 'multimodal', 'fast'],
      tier: 'standard',
      lastUpdated: new Date('2025-02-01'),
      active: true,
    },
    {
      model: 'amazon.nova-micro-v1:0',
      inputCostPerToken: 0.00035,
      outputCostPerToken: 0.0014,
      currency: 'USD',
      provider: 'amazon',
      capabilities: ['text', 'fast', 'efficient'],
      tier: 'budget',
      lastUpdated: new Date('2025-02-01'),
      active: true,
    },

    // OpenAI GPT models
    {
      model: 'openai.gpt-4o-2024-08-06',
      inputCostPerToken: 0.0025,
      outputCostPerToken: 0.01,
      currency: 'USD',
      provider: 'openai',
      capabilities: ['text', 'code', 'analysis', 'multimodal'],
      tier: 'premium',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'openai.gpt-4o-mini-2024-07-18',
      inputCostPerToken: 0.00015,
      outputCostPerToken: 0.0006,
      currency: 'USD',
      provider: 'openai',
      capabilities: ['text', 'code', 'fast_responses'],
      tier: 'budget',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'openai.gpt-4-turbo-2024-04-09',
      inputCostPerToken: 0.01,
      outputCostPerToken: 0.03,
      currency: 'USD',
      provider: 'openai',
      capabilities: ['text', 'code', 'analysis'],
      tier: 'standard',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },

    // Google/Gemini models
    {
      model: 'google.gemini-pro-1.5',
      inputCostPerToken: 0.00125,
      outputCostPerToken: 0.005,
      currency: 'USD',
      provider: 'google',
      capabilities: ['text', 'code', 'multimodal'],
      tier: 'standard',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'google.gemini-flash-1.5',
      inputCostPerToken: 0.000075,
      outputCostPerToken: 0.0003,
      currency: 'USD',
      provider: 'google',
      capabilities: ['text', 'code', 'fast_responses'],
      tier: 'budget',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },

    // Meta Llama models
    {
      model: 'meta.llama3-70b-instruct-v1:0',
      inputCostPerToken: 0.00265,
      outputCostPerToken: 0.0035,
      currency: 'USD',
      provider: 'meta',
      capabilities: ['text', 'code', 'analysis'],
      tier: 'standard',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'meta.llama3-8b-instruct-v1:0',
      inputCostPerToken: 0.0003,
      outputCostPerToken: 0.0006,
      currency: 'USD',
      provider: 'meta',
      capabilities: ['text', 'code'],
      tier: 'budget',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },

    // Cohere Command models
    {
      model: 'cohere.command-r-plus-v1:0',
      inputCostPerToken: 0.003,
      outputCostPerToken: 0.015,
      currency: 'USD',
      provider: 'cohere',
      capabilities: ['text', 'code', 'analysis', 'tool_use'],
      tier: 'premium',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },
    {
      model: 'cohere.command-r-v1:0',
      inputCostPerToken: 0.0005,
      outputCostPerToken: 0.0015,
      currency: 'USD',
      provider: 'cohere',
      capabilities: ['text', 'code', 'analysis'],
      tier: 'standard',
      lastUpdated: new Date('2024-12-01'),
      active: true,
    },

    // Mistral AI models (Bedrock)
    {
      model: 'mistral.mistral-large-3-675b-instruct',
      inputCostPerToken: 0.0005,
      outputCostPerToken: 0.0015,
      currency: 'USD',
      provider: 'mistral',
      capabilities: ['text', 'code', 'reasoning', 'analysis'],
      tier: 'premium',
      lastUpdated: new Date('2025-12-01'),
      active: true,
    },
  ];

  /**
   * Inference profile ID to base model ID mapping (AWS Bedrock cross-region profiles use same pricing as base).
   */
  private static readonly INFERENCE_PROFILE_TO_BASE: Record<string, string> = {
    'us.anthropic.claude-3-5-haiku-20241022-v1:0':
      'anthropic.claude-3-5-haiku-20241022-v1:0',
    'global.anthropic.claude-3-5-haiku-20241022-v1:0':
      'anthropic.claude-3-5-haiku-20241022-v1:0',
    'us.anthropic.claude-sonnet-4-5-20250929-v1:0':
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
  };

  /**
   * Get pricing information for a specific model.
   * Falls back to base model pricing for inference profile IDs (us./global.) when exact match not found.
   */
  getModelPricing(model: string): ModelPricing | undefined {
    const exact = this.MODEL_PRICING.find((p) => p.model === model && p.active);
    if (exact) return exact;
    const baseModel = PricingService.INFERENCE_PROFILE_TO_BASE[model];
    if (baseModel) {
      return this.MODEL_PRICING.find((p) => p.model === baseModel && p.active);
    }
    return undefined;
  }

  /**
   * Get all available model pricing
   */
  getAllModelPricing(): ModelPricing[] {
    return this.MODEL_PRICING.filter((p) => p.active);
  }

  /**
   * Get models by provider
   */
  getModelsByProvider(provider: string): ModelPricing[] {
    return this.MODEL_PRICING.filter(
      (p) => p.provider === provider && p.active,
    );
  }

  /**
   * Get models by tier
   */
  getModelsByTier(tier: ModelPricing['tier']): ModelPricing[] {
    return this.MODEL_PRICING.filter((p) => p.tier === tier && p.active);
  }

  /**
   * Get models by capabilities
   */
  getModelsByCapabilities(capabilities: string[]): ModelPricing[] {
    return this.MODEL_PRICING.filter(
      (p) =>
        p.active && capabilities.every((cap) => p.capabilities.includes(cap)),
    );
  }

  /**
   * Estimate cost for a given model and token usage
   */
  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    confidence: number = 0.95,
  ): CostEstimate | null {
    const pricing = this.getModelPricing(model);
    if (!pricing) {
      this.logger.warn(`No pricing found for model: ${model}`);
      return null;
    }

    const inputCost = (inputTokens / 1000) * pricing.inputCostPerToken;
    const outputCost = (outputTokens / 1000) * pricing.outputCostPerToken;
    const totalCost = inputCost + outputCost;

    const estimate: CostEstimate = {
      model,
      inputTokens,
      outputTokens,
      totalCost,
      currency: pricing.currency,
      breakdown: {
        inputCost,
        outputCost,
      },
      confidence,
      alternatives: this.findCostAlternatives(
        model,
        inputTokens,
        outputTokens,
        totalCost,
      ),
    };

    return estimate;
  }

  /**
   * Estimate cost with async token counting
   */
  async estimateCostAsync(
    model: string,
    inputText: string,
    estimatedOutputTokens: number = 0,
    confidence: number = 0.95,
  ): Promise<CostEstimate | null> {
    const pricing = this.getModelPricing(model);
    if (!pricing) {
      this.logger.warn(`No pricing found for model: ${model}`);
      return null;
    }

    // Estimate input tokens (rough approximation)
    const inputTokens = Math.ceil(inputText.length / 4); // ~4 chars per token

    const inputCost = (inputTokens / 1000) * pricing.inputCostPerToken;
    const outputCost =
      (estimatedOutputTokens / 1000) * pricing.outputCostPerToken;
    const totalCost = inputCost + outputCost;

    const estimate: CostEstimate = {
      model,
      inputTokens,
      outputTokens: estimatedOutputTokens,
      totalCost,
      currency: pricing.currency,
      breakdown: {
        inputCost,
        outputCost,
      },
      confidence: confidence * 0.8, // Lower confidence due to token estimation
      alternatives: this.findCostAlternatives(
        model,
        inputTokens,
        estimatedOutputTokens,
        totalCost,
      ),
    };

    return estimate;
  }

  /**
   * Find cheaper alternatives to a given model
   */
  private findCostAlternatives(
    currentModel: string,
    inputTokens: number,
    outputTokens: number,
    currentCost: number,
  ): CostEstimate['alternatives'] {
    const currentPricing = this.getModelPricing(currentModel);
    if (!currentPricing) return [];

    const alternatives: CostEstimate['alternatives'] = [];

    for (const pricing of this.MODEL_PRICING) {
      if (pricing.model === currentModel || !pricing.active) continue;

      // Check if alternative has similar capabilities
      const hasSimilarCapabilities = pricing.capabilities.some((cap) =>
        currentPricing.capabilities.includes(cap),
      );

      if (!hasSimilarCapabilities) continue;

      const altInputCost = (inputTokens / 1000) * pricing.inputCostPerToken;
      const altOutputCost = (outputTokens / 1000) * pricing.outputCostPerToken;
      const altTotalCost = altInputCost + altOutputCost;
      const savings = currentCost - altTotalCost;

      // Only include if it saves at least 10%
      if (savings > currentCost * 0.1) {
        alternatives.push({
          model: pricing.model,
          totalCost: altTotalCost,
          savings,
          reason: this.getAlternativeReason(currentPricing, pricing),
        });
      }
    }

    // Sort by savings (descending)
    return alternatives.sort((a, b) => b.savings - a.savings).slice(0, 3);
  }

  /**
   * Get reason for recommending an alternative model
   */
  private getAlternativeReason(
    current: ModelPricing,
    alternative: ModelPricing,
  ): string {
    if (alternative.tier === 'budget' && current.tier !== 'budget') {
      return 'Budget-friendly option with similar capabilities';
    }
    if (alternative.tier === 'standard' && current.tier === 'premium') {
      return 'Good balance of cost and performance';
    }
    return 'Alternative with potential cost savings';
  }

  /**
   * Calculate total cost for multiple requests
   */
  calculateBatchCost(estimates: CostEstimate[]): {
    totalCost: number;
    currency: string;
    averageCost: number;
    minCost: number;
    maxCost: number;
  } {
    if (estimates.length === 0) {
      return {
        totalCost: 0,
        currency: 'USD',
        averageCost: 0,
        minCost: 0,
        maxCost: 0,
      };
    }

    const costs = estimates.map((e) => e.totalCost);
    const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
    const currency = estimates[0].currency;

    return {
      totalCost,
      currency,
      averageCost: totalCost / estimates.length,
      minCost: Math.min(...costs),
      maxCost: Math.max(...costs),
    };
  }

  /**
   * Get cost optimization recommendations
   */
  getCostOptimizationRecommendations(
    currentModel: string,
    monthlyUsage: {
      inputTokens: number;
      outputTokens: number;
      requestCount: number;
    },
  ): Array<{
    recommendation: string;
    potentialSavings: number;
    confidence: number;
    implementation: string;
  }> {
    const recommendations: Array<{
      recommendation: string;
      potentialSavings: number;
      confidence: number;
      implementation: string;
    }> = [];
    const currentPricing = this.getModelPricing(currentModel);

    if (!currentPricing) return recommendations;

    const monthlyCost = this.calculateMonthlyCost(currentPricing, monthlyUsage);

    // Check for cheaper models with similar capabilities
    const cheaperAlternatives = this.MODEL_PRICING.filter(
      (p) =>
        p.active &&
        p.model !== currentModel &&
        p.capabilities.some((cap) =>
          currentPricing.capabilities.includes(cap),
        ) &&
        this.calculateMonthlyCost(p, monthlyUsage) < monthlyCost * 0.9,
    );

    for (const alt of cheaperAlternatives.slice(0, 2)) {
      const altCost = this.calculateMonthlyCost(alt, monthlyUsage);
      const savings = monthlyCost - altCost;

      recommendations.push({
        recommendation: `Switch from ${currentModel} to ${alt.model}`,
        potentialSavings: savings,
        confidence: 0.85,
        implementation: 'Update model parameter in API calls',
      });
    }

    // Batch processing recommendation
    if (monthlyUsage.requestCount > 100) {
      const batchSavings = monthlyCost * 0.05; // Estimate 5% savings from batching
      recommendations.push({
        recommendation:
          'Implement request batching to reduce per-request overhead',
        potentialSavings: batchSavings,
        confidence: 0.75,
        implementation: 'Group similar requests and process them together',
      });
    }

    // Caching recommendation
    if (monthlyUsage.inputTokens > 100000) {
      const cacheSavings = monthlyCost * 0.15; // Estimate 15% savings from caching
      recommendations.push({
        recommendation: 'Implement semantic caching for repeated queries',
        potentialSavings: cacheSavings,
        confidence: 0.8,
        implementation:
          'Cache responses based on semantic similarity of inputs',
      });
    }

    return recommendations.sort(
      (a, b) => b.potentialSavings - a.potentialSavings,
    );
  }

  /**
   * Calculate monthly cost for a model
   */
  private calculateMonthlyCost(
    pricing: ModelPricing,
    usage: { inputTokens: number; outputTokens: number; requestCount: number },
  ): number {
    const inputCost = (usage.inputTokens / 1000) * pricing.inputCostPerToken;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputCostPerToken;
    return inputCost + outputCost;
  }

  /**
   * Update model pricing (admin function)
   */
  updateModelPricing(model: string, updates: Partial<ModelPricing>): boolean {
    const index = this.MODEL_PRICING.findIndex((p) => p.model === model);
    if (index === -1) return false;

    this.MODEL_PRICING[index] = {
      ...this.MODEL_PRICING[index],
      ...updates,
      lastUpdated: new Date(),
    };

    this.logger.log(`Updated pricing for model: ${model}`);
    return true;
  }

  /**
   * Get pricing statistics
   */
  getPricingStatistics(): {
    totalModels: number;
    activeModels: number;
    providers: string[];
    tiers: Record<string, number>;
    averageInputCost: number;
    averageOutputCost: number;
  } {
    const activeModels = this.MODEL_PRICING.filter((p) => p.active);
    const providers = [...new Set(activeModels.map((p) => p.provider))];
    const tiers = activeModels.reduce(
      (acc, p) => {
        acc[p.tier] = (acc[p.tier] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const totalInputCost = activeModels.reduce(
      (sum, p) => sum + p.inputCostPerToken,
      0,
    );
    const totalOutputCost = activeModels.reduce(
      (sum, p) => sum + p.outputCostPerToken,
      0,
    );

    return {
      totalModels: this.MODEL_PRICING.length,
      activeModels: activeModels.length,
      providers,
      tiers,
      averageInputCost: totalInputCost / activeModels.length,
      averageOutputCost: totalOutputCost / activeModels.length,
    };
  }
}
