import { Injectable, Logger } from '@nestjs/common';

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

  // Supported model configurations
  private readonly SUPPORTED_BEDROCK_MODELS = [
    'amazon.nova-micro-v1:0',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
    'anthropic.claude-3-haiku-20240307-v1:0',
    'anthropic.claude-3-sonnet-20240229-v1:0',
    'meta.llama3-8b-instruct-v1:0',
    'meta.llama3-70b-instruct-v1:0',
    'cohere.command-r-v1:0',
    'cohere.command-r-plus-v1:0',
  ];

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
      // Get models from pricing data
      const models: BedrockModelInfo[] = [];

      // OpenAI models
      if (!provider || provider === 'openai') {
        models.push(
          {
            modelId: 'gpt-3.5-turbo',
            modelName: 'GPT-3.5 Turbo',
            provider: 'openai',
            inputPricing: 0.0015,
            outputPricing: 0.002,
            maxTokens: 4096,
            supportedRegions: ['global'],
            capabilities: ['chat', 'completion'],
          },
          {
            modelId: 'gpt-4',
            modelName: 'GPT-4',
            provider: 'openai',
            inputPricing: 0.03,
            outputPricing: 0.06,
            maxTokens: 8192,
            supportedRegions: ['global'],
            capabilities: ['chat', 'completion', 'vision'],
          },
        );
      }

      // Anthropic models
      if (!provider || provider === 'anthropic') {
        models.push(
          {
            modelId: 'claude-3-haiku',
            modelName: 'Claude 3 Haiku',
            provider: 'anthropic',
            inputPricing: 0.00025,
            outputPricing: 0.00125,
            maxTokens: 4096,
            supportedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
            capabilities: ['chat', 'completion', 'vision'],
          },
          {
            modelId: 'claude-3-sonnet',
            modelName: 'Claude 3 Sonnet',
            provider: 'anthropic',
            inputPricing: 0.003,
            outputPricing: 0.015,
            maxTokens: 4096,
            supportedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
            capabilities: ['chat', 'completion', 'vision'],
          },
        );
      }

      // AWS Bedrock models
      if (!provider || provider === 'bedrock') {
        this.SUPPORTED_BEDROCK_MODELS.forEach((modelId) => {
          const pricing = this.getModelPricing('bedrock', modelId);
          models.push({
            modelId,
            modelName: this.formatModelName(modelId),
            provider: 'bedrock',
            inputPricing: pricing?.input || 0,
            outputPricing: pricing?.output || 0,
            maxTokens: pricing?.maxTokens || 4096,
            supportedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
            capabilities: ['chat', 'completion'],
          });
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
   * Initialize model pricing index
   */
  private initializeModelPricing(): void {
    // OpenAI pricing
    this.modelPricingIndex.set('openai:gpt-3.5-turbo', {
      input: 0.0015,
      output: 0.002,
      maxTokens: 4096,
    });
    this.modelPricingIndex.set('openai:gpt-4', {
      input: 0.03,
      output: 0.06,
      maxTokens: 8192,
    });

    // Anthropic pricing
    this.modelPricingIndex.set('anthropic:claude-3-haiku', {
      input: 0.00025,
      output: 0.00125,
      maxTokens: 4096,
    });
    this.modelPricingIndex.set('anthropic:claude-3-sonnet', {
      input: 0.003,
      output: 0.015,
      maxTokens: 4096,
    });

    // AWS Bedrock pricing (simplified)
    this.SUPPORTED_BEDROCK_MODELS.forEach((modelId) => {
      if (modelId.includes('nova-micro')) {
        this.modelPricingIndex.set(`bedrock:${modelId}`, {
          input: 0.000035,
          output: 0.00014,
          maxTokens: 128000,
        });
      } else if (modelId.includes('nova-lite')) {
        this.modelPricingIndex.set(`bedrock:${modelId}`, {
          input: 0.00006,
          output: 0.00024,
          maxTokens: 128000,
        });
      } else if (modelId.includes('nova-pro')) {
        this.modelPricingIndex.set(`bedrock:${modelId}`, {
          input: 0.0008,
          output: 0.0032,
          maxTokens: 128000,
        });
      } else if (modelId.includes('claude-3-haiku')) {
        this.modelPricingIndex.set(`bedrock:${modelId}`, {
          input: 0.00025,
          output: 0.00125,
          maxTokens: 4096,
        });
      } else if (modelId.includes('claude-3-sonnet')) {
        this.modelPricingIndex.set(`bedrock:${modelId}`, {
          input: 0.003,
          output: 0.015,
          maxTokens: 4096,
        });
      }
      // Add other models with default pricing
      else {
        this.modelPricingIndex.set(`bedrock:${modelId}`, {
          input: 0.001,
          output: 0.002,
          maxTokens: 4096,
        });
      }
    });
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
