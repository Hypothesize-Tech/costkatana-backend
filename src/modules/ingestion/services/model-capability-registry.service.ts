/**
 * Model Capability Registry Service for NestJS
 *
 * Single source of truth for model capabilities, provider resolution, and intelligent model selection.
 * Enables provider-agnostic routing by abstracting away provider-specific implementation details.
 *
 * Key Features:
 * - Capability-based model discovery
 * - Strategic model selection (cost, speed, quality, balanced)
 * - Provider adapter resolution
 * - Dynamic model registration
 * - Performance tracking and optimization recommendations
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  ModelRegistryService,
  ModelCapability,
  ModelDefinition,
  AIProviderType,
} from './model-registry.service';

export interface ModelCapabilityDefinition {
  modelId: string;
  provider: string;
  providerType: AIProviderType;
  displayName: string;
  description: string;
  capabilities: Set<ModelCapability>;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
  };
  performance: {
    avgLatencyMs: number;
    reliabilityScore: number;
  };
  lastUpdated: Date;
}

export enum ModelSelectionStrategy {
  COST_OPTIMIZED = 'cost_optimized',
  SPEED_OPTIMIZED = 'speed_optimized',
  QUALITY_OPTIMIZED = 'quality_optimized',
  BALANCED = 'balanced',
  CUSTOM = 'custom',
}

export interface ModelSelectionConstraints {
  requiredCapabilities?: ModelCapability[];
  maxCostPerMillion?: number;
  maxLatency?: number;
  minReliability?: number;
  preferredProviders?: AIProviderType[];
  excludedProviders?: AIProviderType[];
  contextWindow?: number;
}

export interface ModelSelectionRequest {
  strategy: ModelSelectionStrategy;
  constraints?: ModelSelectionConstraints;
  inputTokens?: number;
  expectedOutputTokens?: number;
  customWeights?: {
    costWeight: number;
    latencyWeight: number;
    qualityWeight: number;
    reliabilityWeight: number;
  };
}

export interface ModelSelectionResult {
  selectedModel: ModelCapabilityDefinition;
  score: number; // 0-1, higher is better
  estimatedCost: number;
  estimatedLatency: number;
  reasoning: string;
  alternatives?: Array<{
    model: ModelCapabilityDefinition;
    score: number;
    reasoning: string;
  }>;
}

export interface IProviderAdapter {
  getProviderType(): AIProviderType;
  isModelAvailable(modelId: string): Promise<boolean>;
  getModelPricing(
    modelId: string,
  ): Promise<{ input: number; output: number } | null>;
  getModelCapabilities(modelId: string): Promise<Set<ModelCapability>>;
}

@Injectable()
export class ModelCapabilityRegistryService {
  private readonly logger = new Logger(ModelCapabilityRegistryService.name);
  private models: Map<string, ModelCapabilityDefinition> = new Map();
  private providerAdapters: Map<AIProviderType, IProviderAdapter> = new Map();
  private capabilityIndex: Map<ModelCapability, Set<string>> = new Map();
  private providerIndex: Map<string, Set<string>> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.initializeFromRegistry();
    this.buildIndexes();
  }

  /**
   * Initialize from the comprehensive model registry
   */
  private initializeFromRegistry(): void {
    this.logger.log(
      'Initializing Model Capability Registry from Model Registry',
    );

    const allModels = this.modelRegistry.getModels();

    for (const model of allModels) {
      if (model.status === 'active') {
        const capabilityDef = this.convertToCapabilityDefinition(model);
        this.models.set(model.id, capabilityDef);
      }
    }

    this.logger.log(`Loaded ${this.models.size} active models from registry`);
  }

  /**
   * Convert ModelDefinition to ModelCapabilityDefinition
   */
  private convertToCapabilityDefinition(
    model: ModelDefinition,
  ): ModelCapabilityDefinition {
    return {
      modelId: model.id,
      provider: model.provider,
      providerType: model.provider,
      displayName: model.displayName,
      description: `${model.displayName} - ${model.family || 'AI Model'}`,
      capabilities: new Set(model.capabilities),
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      pricing: {
        inputPricePerMillion: (model.pricing?.input || 0) * 1_000_000,
        outputPricePerMillion: (model.pricing?.output || 0) * 1_000_000,
      },
      performance: {
        avgLatencyMs: model.averageLatencyMs,
        reliabilityScore: model.quality.reliability / 100, // Convert to 0-1 scale
      },
      lastUpdated: new Date(),
    };
  }

  /**
   * Build capability and provider indexes for fast lookup
   */
  private buildIndexes(): void {
    this.capabilityIndex.clear();
    this.providerIndex.clear();

    for (const model of this.models.values()) {
      // Capability index
      model.capabilities.forEach((cap) => {
        if (!this.capabilityIndex.has(cap)) {
          this.capabilityIndex.set(cap, new Set());
        }
        this.capabilityIndex.get(cap)!.add(model.modelId);
      });

      // Provider index
      if (!this.providerIndex.has(model.provider)) {
        this.providerIndex.set(model.provider, new Set());
      }
      this.providerIndex.get(model.provider)!.add(model.modelId);
    }
  }

  /**
   * Register a provider adapter
   */
  registerProviderAdapter(
    provider: AIProviderType,
    adapter: IProviderAdapter,
  ): void {
    this.providerAdapters.set(provider, adapter);
    this.logger.log(`Registered provider adapter for ${provider}`);
  }

  /**
   * Get provider adapter
   */
  getProviderAdapter(provider: AIProviderType): IProviderAdapter | null {
    return this.providerAdapters.get(provider) || null;
  }

  /**
   * Find models by capability
   */
  findModelsByCapability(
    capability: ModelCapability,
  ): ModelCapabilityDefinition[] {
    const modelIds = this.capabilityIndex.get(capability);
    if (!modelIds) return [];

    return Array.from(modelIds)
      .map((id) => this.models.get(id))
      .filter((model) => model !== undefined);
  }

  /**
   * Find models by provider
   */
  findModelsByProvider(provider: string): ModelCapabilityDefinition[] {
    const modelIds = this.providerIndex.get(provider);
    if (!modelIds) return [];

    return Array.from(modelIds)
      .map((id) => this.models.get(id))
      .filter((model) => model !== undefined);
  }

  /**
   * Intelligent model selection based on strategy and constraints
   */
  async selectModel(
    request: ModelSelectionRequest,
  ): Promise<ModelSelectionResult | null> {
    const {
      strategy,
      constraints = {},
      inputTokens = 1000,
      expectedOutputTokens = 500,
    } = request;

    // Get candidate models based on constraints
    const candidates = this.filterModelsByConstraints(constraints);

    if (candidates.length === 0) {
      this.logger.warn('No models match the given constraints', {
        constraints,
      });
      return null;
    }

    // Score each candidate based on strategy
    const scoredCandidates = candidates.map((model) => ({
      model,
      score: this.calculateStrategyScore(
        model,
        strategy,
        request.customWeights,
        inputTokens,
        expectedOutputTokens,
      ),
      estimatedCost: this.estimateCost(
        model,
        inputTokens,
        expectedOutputTokens,
      ),
      estimatedLatency: model.performance.avgLatencyMs,
    }));

    // Sort by score (descending)
    scoredCandidates.sort((a, b) => b.score - a.score);

    const bestCandidate = scoredCandidates[0];

    // Generate reasoning
    const reasoning = this.explainSelection(
      bestCandidate.model,
      strategy,
      bestCandidate.score,
    );

    // Get top 3 alternatives
    const alternatives = scoredCandidates.slice(1, 4).map((candidate) => ({
      model: candidate.model,
      score: candidate.score,
      reasoning: this.explainSelection(
        candidate.model,
        strategy,
        candidate.score,
      ),
    }));

    return {
      selectedModel: bestCandidate.model,
      score: bestCandidate.score,
      estimatedCost: bestCandidate.estimatedCost,
      estimatedLatency: bestCandidate.estimatedLatency,
      reasoning,
      alternatives,
    };
  }

  /**
   * Filter models based on constraints
   */
  private filterModelsByConstraints(
    constraints: ModelSelectionConstraints,
  ): ModelCapabilityDefinition[] {
    return Array.from(this.models.values()).filter((model) => {
      // Required capabilities
      if (constraints.requiredCapabilities) {
        const hasAllCapabilities = constraints.requiredCapabilities.every(
          (cap) => model.capabilities.has(cap),
        );
        if (!hasAllCapabilities) return false;
      }

      // Max cost
      if (constraints.maxCostPerMillion !== undefined) {
        if (
          model.pricing.inputPricePerMillion > constraints.maxCostPerMillion ||
          model.pricing.outputPricePerMillion > constraints.maxCostPerMillion
        ) {
          return false;
        }
      }

      // Max latency
      if (constraints.maxLatency !== undefined) {
        if (model.performance.avgLatencyMs > constraints.maxLatency)
          return false;
      }

      // Min reliability
      if (constraints.minReliability !== undefined) {
        if (model.performance.reliabilityScore < constraints.minReliability)
          return false;
      }

      // Preferred providers
      if (
        constraints.preferredProviders &&
        constraints.preferredProviders.length > 0
      ) {
        if (!constraints.preferredProviders.includes(model.providerType))
          return false;
      }

      // Excluded providers
      if (
        constraints.excludedProviders &&
        constraints.excludedProviders.length > 0
      ) {
        if (constraints.excludedProviders.includes(model.providerType))
          return false;
      }

      // Context window
      if (constraints.contextWindow !== undefined) {
        if (model.contextWindow < constraints.contextWindow) return false;
      }

      return true;
    });
  }

  /**
   * Calculate score based on selection strategy
   */
  private calculateStrategyScore(
    model: ModelCapabilityDefinition,
    strategy: ModelSelectionStrategy,
    customWeights?: {
      costWeight: number;
      latencyWeight: number;
      qualityWeight: number;
      reliabilityWeight: number;
    },
    inputTokens: number = 1000,
    outputTokens: number = 500,
  ): number {
    const costScore = this.normalizeCostScore(model, inputTokens, outputTokens);
    const latencyScore = this.normalizeLatencyScore(model);
    const qualityScore = this.normalizeQualityScore(model);
    const reliabilityScore = model.performance.reliabilityScore;

    // Default weights for balanced strategy
    const weights = customWeights || {
      costWeight: 0.25,
      latencyWeight: 0.25,
      qualityWeight: 0.25,
      reliabilityWeight: 0.25,
    };

    let score: number;

    switch (strategy) {
      case ModelSelectionStrategy.COST_OPTIMIZED:
        score = costScore * 0.7 + latencyScore * 0.2 + qualityScore * 0.1;
        break;

      case ModelSelectionStrategy.SPEED_OPTIMIZED:
        score = latencyScore * 0.7 + costScore * 0.2 + qualityScore * 0.1;
        break;

      case ModelSelectionStrategy.QUALITY_OPTIMIZED:
        score = qualityScore * 0.7 + reliabilityScore * 0.2 + costScore * 0.1;
        break;

      case ModelSelectionStrategy.BALANCED:
        score =
          (costScore + latencyScore + qualityScore + reliabilityScore) / 4;
        break;

      case ModelSelectionStrategy.CUSTOM:
        if (customWeights) {
          score =
            costScore * weights.costWeight +
            latencyScore * weights.latencyWeight +
            qualityScore * weights.qualityWeight +
            reliabilityScore * weights.reliabilityWeight;
        } else {
          score =
            (costScore + latencyScore + qualityScore + reliabilityScore) / 4;
        }
        break;

      default:
        score =
          (costScore + latencyScore + qualityScore + reliabilityScore) / 4;
    }

    return score;
  }

  /**
   * Normalize cost score (lower cost = higher score)
   */
  private normalizeCostScore(
    model: ModelCapabilityDefinition,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const cost = this.estimateCost(model, inputTokens, outputTokens);

    // Map cost to 0-1 scale (inverse: lower cost = higher score)
    // Assume range: $0.0001 (best) to $0.10 (worst)
    const minCost = 0.0001;
    const maxCost = 0.1;

    const normalizedCost = Math.max(
      0,
      Math.min(1, (cost - minCost) / (maxCost - minCost)),
    );
    return 1 - normalizedCost; // Invert so lower cost = higher score
  }

  /**
   * Normalize latency score (lower latency = higher score)
   */
  private normalizeLatencyScore(model: ModelCapabilityDefinition): number {
    const latency = model.performance.avgLatencyMs;

    // Map latency to 0-1 scale (inverse)
    // Assume range: 500ms (best) to 5000ms (worst)
    const minLatency = 500;
    const maxLatency = 5000;

    const normalizedLatency = Math.max(
      0,
      Math.min(1, (latency - minLatency) / (maxLatency - minLatency)),
    );
    return 1 - normalizedLatency;
  }

  /**
   * Normalize quality score (heuristic based on model capabilities)
   */
  private normalizeQualityScore(model: ModelCapabilityDefinition): number {
    let score = 0.5; // Base score

    // Model family-based scoring
    if (model.modelId.includes('opus') || model.modelId.includes('gpt-4o')) {
      score += 0.4;
    } else if (
      model.modelId.includes('sonnet') ||
      model.modelId.includes('pro') ||
      model.modelId.includes('gemini-1.5')
    ) {
      score += 0.3;
    } else if (
      model.modelId.includes('haiku') ||
      model.modelId.includes('mini') ||
      model.modelId.includes('lite') ||
      model.modelId.includes('flash')
    ) {
      score += 0.1;
    }

    // Capability bonus
    const capabilityBonus = Math.min(0.2, model.capabilities.size * 0.02);
    score += capabilityBonus;

    return Math.min(1, score);
  }

  /**
   * Estimate cost for a request
   */
  private estimateCost(
    model: ModelCapabilityDefinition,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const inputCost =
      (inputTokens / 1_000_000) * model.pricing.inputPricePerMillion;
    const outputCost =
      (outputTokens / 1_000_000) * model.pricing.outputPricePerMillion;
    return inputCost + outputCost;
  }

  /**
   * Explain model selection reasoning
   */
  private explainSelection(
    model: ModelCapabilityDefinition,
    strategy: ModelSelectionStrategy,
    score: number,
  ): string {
    switch (strategy) {
      case ModelSelectionStrategy.COST_OPTIMIZED:
        return `Selected ${model.displayName} for lowest cost (${(score * 100).toFixed(1)}% score). May have higher latency or lower quality than premium models.`;
      case ModelSelectionStrategy.SPEED_OPTIMIZED:
        return `Selected ${model.displayName} for fastest response (${(score * 100).toFixed(1)}% score). May cost more than budget models.`;
      case ModelSelectionStrategy.QUALITY_OPTIMIZED:
        return `Selected ${model.displayName} for best quality (${(score * 100).toFixed(1)}% score). Higher cost and latency expected.`;
      case ModelSelectionStrategy.BALANCED:
        return `Selected ${model.displayName} for optimal balance of cost, speed, and quality (${(score * 100).toFixed(1)}% score).`;
      default:
        return `Selected ${model.displayName} based on custom criteria (${(score * 100).toFixed(1)}% score).`;
    }
  }

  /**
   * Get all registered models
   */
  getAllModels(): ModelCapabilityDefinition[] {
    return Array.from(this.models.values());
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): ModelCapabilityDefinition | null {
    return this.models.get(modelId) || null;
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const modelsByProvider: Record<string, number> = {};
    const modelsByCapability: Partial<Record<ModelCapability, number>> = {};

    for (const [provider, models] of this.providerIndex.entries()) {
      modelsByProvider[provider] = models.size;
    }

    for (const [capability, models] of this.capabilityIndex.entries()) {
      modelsByCapability[capability] = models.size;
    }

    const allModels = Array.from(this.models.values());
    const avgCost =
      allModels.reduce((sum, m) => sum + this.estimateCost(m, 1000, 500), 0) /
      allModels.length;

    const avgLatency =
      allModels.reduce((sum, m) => sum + m.performance.avgLatencyMs, 0) /
      allModels.length;

    return {
      totalModels: this.models.size,
      modelsByProvider,
      modelsByCapability: modelsByCapability as Record<ModelCapability, number>,
      averageCostPerMillion: avgCost * 1_000_000,
      averageLatencyMs: avgLatency,
    };
  }

  /**
   * Refresh model data from registry
   */
  async refreshFromRegistry(): Promise<void> {
    this.logger.log('Refreshing model capability registry from model registry');
    this.initializeFromRegistry();
    this.buildIndexes();
    this.logger.log(`Refreshed ${this.models.size} models`);
  }
}
