import { Injectable, Logger } from '@nestjs/common';
import { MODEL_PRICING } from '../../../utils/pricing';
import { PricingUnit } from '../../../utils/pricing/types';

export interface ModelComparisonRequest {
  prompt: string;
  models: Array<{
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }>;
  evaluationCriteria: string[];
  iterations?: number;
}

export interface BedrockModelInfo {
  modelId: string;
  modelName: string;
  provider: string;
  inputPricing: number;
  outputPricing: number;
  maxTokens: number;
  supportedRegions: string[];
  capabilities: string[];
}

/**
 * Experiment Configuration Service - NestJS equivalent of Express ExperimentConfigurationService
 * Handles setup, validation, and configuration of experiments including model selection and pricing
 */
@Injectable()
export class ExperimentConfigurationService {
  private readonly logger = new Logger(ExperimentConfigurationService.name);

  // Configuration limits
  private readonly MAX_MODELS_PER_COMPARISON = 10;
  private readonly MAX_ITERATIONS = 50;
  private readonly MAX_PROMPT_LENGTH = 50000;
  private readonly MIN_PROMPT_LENGTH = 10;

  // Simple in-memory cache for model configurations
  private modelPricingIndex = new Map<string, any>();
  private cache = new Map<string, { data: any; expires: number }>();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private readonly MAX_CACHE_SIZE = 200;

  constructor() {
    this.initializeModelPricing();
  }

  /**
   * Validate model comparison request
   */
  validateModelComparisonRequest(request: ModelComparisonRequest): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate prompt
    if (!request.prompt || typeof request.prompt !== 'string') {
      errors.push('Prompt is required and must be a string');
    } else {
      if (request.prompt.length < this.MIN_PROMPT_LENGTH) {
        errors.push(
          `Prompt must be at least ${this.MIN_PROMPT_LENGTH} characters`,
        );
      }
      if (request.prompt.length > this.MAX_PROMPT_LENGTH) {
        errors.push(
          `Prompt must not exceed ${this.MAX_PROMPT_LENGTH} characters`,
        );
      }
    }

    // Validate models
    if (!Array.isArray(request.models) || request.models.length === 0) {
      errors.push('At least one model must be specified');
    } else {
      if (request.models.length > this.MAX_MODELS_PER_COMPARISON) {
        errors.push(
          `Maximum ${this.MAX_MODELS_PER_COMPARISON} models allowed per comparison`,
        );
      }

      // Validate each model
      const modelIds = new Set<string>();
      request.models.forEach((model, index) => {
        if (!model.provider || !model.model) {
          errors.push(`Model ${index + 1}: provider and model are required`);
        } else {
          const modelKey = `${model.provider}:${model.model}`;
          if (modelIds.has(modelKey)) {
            errors.push(`Model ${modelKey} is specified multiple times`);
          }
          modelIds.add(modelKey);

          // Validate model is supported
          if (!this.isModelSupported(model.provider, model.model)) {
            warnings.push(
              `Model ${model.provider}:${model.model} may not be fully supported`,
            );
          }
        }

        // Validate temperature
        if (model.temperature !== undefined) {
          if (
            typeof model.temperature !== 'number' ||
            model.temperature < 0 ||
            model.temperature > 2
          ) {
            errors.push(
              `Model ${index + 1}: temperature must be between 0 and 2`,
            );
          }
        }

        // Validate maxTokens
        if (model.maxTokens !== undefined) {
          if (
            typeof model.maxTokens !== 'number' ||
            model.maxTokens < 1 ||
            model.maxTokens > 32768
          ) {
            errors.push(
              `Model ${index + 1}: maxTokens must be between 1 and 32768`,
            );
          }
        }
      });
    }

    // Validate evaluation criteria
    if (
      !Array.isArray(request.evaluationCriteria) ||
      request.evaluationCriteria.length === 0
    ) {
      errors.push('At least one evaluation criterion must be specified');
    } else {
      const validCriteria = [
        'relevance',
        'accuracy',
        'coherence',
        'completeness',
        'helpfulness',
        'creativity',
        'speed',
        'cost',
      ];
      request.evaluationCriteria.forEach((criterion) => {
        if (!validCriteria.includes(criterion.toLowerCase())) {
          warnings.push(
            `Evaluation criterion '${criterion}' is not in the standard set`,
          );
        }
      });
    }

    // Validate iterations
    if (request.iterations !== undefined) {
      if (
        typeof request.iterations !== 'number' ||
        request.iterations < 1 ||
        request.iterations > this.MAX_ITERATIONS
      ) {
        errors.push(`Iterations must be between 1 and ${this.MAX_ITERATIONS}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get available models for experiments
   */
  async getAvailableModels(provider?: string): Promise<BedrockModelInfo[]> {
    const cacheKey = `available_models_${provider || 'all'}`;

    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const models: BedrockModelInfo[] = [];

      for (const row of MODEL_PRICING) {
        const pk = this.canonicalProviderKey(row.provider);
        if (provider && pk !== provider) continue;
        const inputPer1k =
          row.unit === PricingUnit.PER_1M_TOKENS
            ? row.inputPrice / 1000
            : row.inputPrice;
        const outputPer1k =
          row.unit === PricingUnit.PER_1M_TOKENS
            ? row.outputPrice / 1000
            : row.outputPrice;
        models.push({
          modelId: row.modelId,
          modelName: row.modelName,
          provider: pk,
          inputPricing: inputPer1k,
          outputPricing: outputPer1k,
          maxTokens: row.contextWindow ?? 8192,
          supportedRegions:
            pk === 'bedrock'
              ? ['us-east-1', 'us-west-2', 'eu-west-1']
              : ['global'],
          capabilities: row.capabilities?.length
            ? row.capabilities
            : ['chat', 'completion'],
        });
      }

      // Cache the results
      this.setCached(cacheKey, models);

      return models;
    } catch (error) {
      this.logger.error('Error getting available models', {
        error: error instanceof Error ? error.message : String(error),
        provider,
      });
      throw error;
    }
  }

  /**
   * Get model pricing information
   */
  getModelPricing(
    provider: string,
    model: string,
  ): {
    input: number;
    output: number;
    maxTokens: number;
  } | null {
    const key = `${provider}:${model}`;
    return this.modelPricingIndex.get(key) || null;
  }

  /**
   * Estimate cost for a model comparison request
   */
  async estimateComparisonCost(request: ModelComparisonRequest): Promise<{
    totalCost: number;
    costPerModel: Record<string, number>;
    breakdown: {
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
    }[];
  }> {
    try {
      const iterations = request.iterations || 1;

      // Estimate token counts
      const promptTokens = Math.ceil(request.prompt.length / 4); // Rough estimation
      const estimatedOutputTokens = Math.ceil(request.prompt.length / 8); // Assume output is ~25% of input

      const breakdown = request.models.map((model) => {
        const pricing = this.getModelPricing(model.provider, model.model);
        const inputCost = pricing ? promptTokens * pricing.input : 0;
        const outputCost = pricing ? estimatedOutputTokens * pricing.output : 0;
        const totalCost = (inputCost + outputCost) * iterations;

        return {
          inputTokens: promptTokens,
          outputTokens: estimatedOutputTokens,
          estimatedCost: totalCost,
        };
      });

      const totalCost = breakdown.reduce(
        (sum, item) => sum + item.estimatedCost,
        0,
      );

      const costPerModel: Record<string, number> = {};
      request.models.forEach((model, index) => {
        costPerModel[`${model.provider}:${model.model}`] =
          breakdown[index].estimatedCost;
      });

      return {
        totalCost,
        costPerModel,
        breakdown,
      };
    } catch (error) {
      this.logger.error('Error estimating comparison cost', {
        error: error instanceof Error ? error.message : String(error),
        modelsCount: request.models.length,
      });
      throw error;
    }
  }

  /**
   * Create optimized experiment configuration
   */
  async createOptimizedConfiguration(
    baseRequest: ModelComparisonRequest,
    optimizationGoals: {
      priority: 'cost' | 'quality' | 'speed' | 'balanced';
      maxBudget?: number;
      minQuality?: number;
      maxLatency?: number;
    },
  ): Promise<ModelComparisonRequest> {
    try {
      // Start with base configuration
      const optimizedRequest = { ...baseRequest };

      switch (optimizationGoals.priority) {
        case 'cost':
          // Select cheapest models within quality constraints
          optimizedRequest.models = await this.selectCostOptimizedModels(
            baseRequest.models,
            optimizationGoals.maxBudget,
          );
          break;

        case 'quality':
          // Select highest quality models
          optimizedRequest.models = await this.selectQualityOptimizedModels(
            baseRequest.models,
          );
          break;

        case 'speed':
          // Select fastest models
          optimizedRequest.models = await this.selectSpeedOptimizedModels(
            baseRequest.models,
            optimizationGoals.maxLatency,
          );
          break;

        case 'balanced':
        default:
          // Select balanced mix
          optimizedRequest.models = await this.selectBalancedModels(
            baseRequest.models,
          );
          break;
      }

      // Adjust iterations based on budget constraints
      if (optimizationGoals.maxBudget) {
        const costEstimate =
          await this.estimateComparisonCost(optimizedRequest);
        if (costEstimate.totalCost > optimizationGoals.maxBudget) {
          const maxIterations = Math.floor(
            optimizationGoals.maxBudget / costEstimate.totalCost,
          );
          optimizedRequest.iterations = Math.max(
            1,
            Math.min(maxIterations, this.MAX_ITERATIONS),
          );
        }
      }

      return optimizedRequest;
    } catch (error) {
      this.logger.error('Error creating optimized configuration', {
        error: error instanceof Error ? error.message : String(error),
        priority: optimizationGoals.priority,
      });
      // Return base request if optimization fails
      return baseRequest;
    }
  }

  /**
   * Initialize model pricing index from merged MODEL_PRICING (per-1k USD).
   */
  private initializeModelPricing(): void {
    for (const row of MODEL_PRICING) {
      const pk = this.canonicalProviderKey(row.provider);
      const inputPer1k =
        row.unit === PricingUnit.PER_1M_TOKENS
          ? row.inputPrice / 1000
          : row.inputPrice;
      const outputPer1k =
        row.unit === PricingUnit.PER_1M_TOKENS
          ? row.outputPrice / 1000
          : row.outputPrice;
      this.modelPricingIndex.set(`${pk}:${row.modelId}`, {
        input: inputPer1k,
        output: outputPer1k,
        maxTokens: row.contextWindow ?? 8192,
      });
    }
  }

  /** Map MODEL_PRICING provider labels to experiment/API provider keys */
  private canonicalProviderKey(provider: string): string {
    const p = provider.toLowerCase().trim();
    if (p.includes('bedrock') || p === 'aws bedrock') return 'bedrock';
    if (p.includes('openai')) return 'openai';
    if (p.includes('anthropic')) return 'anthropic';
    if (p.includes('google')) return 'google';
    if (p.includes('cohere')) return 'cohere';
    if (p.includes('mistral')) return 'mistral';
    if (p.includes('grok')) return 'grok';
    if (p.includes('meta')) return 'meta';
    if (p.includes('deepseek')) return 'deepseek';
    return p.replace(/\s+/g, '-');
  }

  /**
   * Check if model is supported
   */
  private isModelSupported(provider: string, model: string): boolean {
    const key = `${provider}:${model}`;
    return this.modelPricingIndex.has(key);
  }

  /**
   * Format model name for display
   */
  private formatModelName(modelId: string): string {
    return modelId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Select cost-optimized models
   */
  private async selectCostOptimizedModels(
    models: Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>,
    maxBudget?: number,
  ): Promise<
    Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>
  > {
    // Sort by cost (lowest first)
    const sortedModels = models
      .map((model) => ({
        ...model,
        pricing: this.getModelPricing(model.provider, model.model),
      }))
      .filter((model) => model.pricing)
      .sort((a, b) => {
        const costA = a.pricing!.input + a.pricing!.output;
        const costB = b.pricing!.input + b.pricing!.output;
        return costA - costB;
      });

    // Return top 3 cheapest or all if budget allows
    return sortedModels.slice(0, 3).map(({ pricing, ...model }) => model);
  }

  /**
   * Select quality-optimized models
   */
  private async selectQualityOptimizedModels(
    models: Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>,
  ): Promise<
    Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>
  > {
    // Prioritize known high-quality models (GPT-4, Claude-3-Sonnet, etc.)
    const qualityOrder = [
      'gpt-4',
      'claude-3-sonnet',
      'nova-pro',
      'gpt-3.5-turbo',
      'claude-3-haiku',
    ];

    return models
      .sort((a, b) => {
        const aIndex = qualityOrder.findIndex((q) => a.model.includes(q));
        const bIndex = qualityOrder.findIndex((q) => b.model.includes(q));
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })
      .slice(0, 3);
  }

  /**
   * Select speed-optimized models
   */
  private async selectSpeedOptimizedModels(
    models: Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>,
    maxLatency?: number,
  ): Promise<
    Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>
  > {
    // Prioritize faster models (GPT-3.5, Claude-3-Haiku, Nova-Micro, etc.)
    const speedOrder = [
      'nova-micro',
      'claude-3-haiku',
      'gpt-3.5-turbo',
      'nova-lite',
      'gpt-4',
    ];

    return models
      .sort((a, b) => {
        const aIndex = speedOrder.findIndex((s) => a.model.includes(s));
        const bIndex = speedOrder.findIndex((s) => b.model.includes(s));
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })
      .slice(0, 3);
  }

  /**
   * Select balanced models
   */
  private async selectBalancedModels(
    models: Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>,
  ): Promise<
    Array<{
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }>
  > {
    // Return first 3-5 models for balanced comparison
    return models.slice(0, Math.min(5, models.length));
  }

  /**
   * Get cached value
   */
  private getCached(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key);
    }
    return null;
  }

  /**
   * Set cached value
   */
  private setCached(key: string, data: any): void {
    // Clean up expired entries if cache is getting full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.cleanupExpiredCache();
    }

    this.cache.set(key, {
      data,
      expires: Date.now() + this.CACHE_TTL,
    });
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expires <= now) {
        this.cache.delete(key);
      }
    }
  }
}
