/**
 * Model Registry Service for NestJS
 *
 * Centralized registry for all model metadata, capabilities, and availability.
 * Single source of truth for model information across the platform.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export enum AIProviderType {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  AWS = 'aws',
  Google = 'google',
  Cohere = 'cohere',
  Mistral = 'mistral',
  Meta = 'meta',
}

export enum ModelStatus {
  Active = 'active',
  Deprecated = 'deprecated',
  Inactive = 'inactive',
  EOL = 'eol',
}

export enum ModelTier {
  Free = 'free',
  Basic = 'basic',
  Balanced = 'balanced',
  Premium = 'premium',
  Enterprise = 'enterprise',
}

export enum ModelCapability {
  Chat = 'chat',
  Vision = 'vision',
  Audio = 'audio',
  Code = 'code',
  Json = 'json',
  Tools = 'tools',
  Streaming = 'streaming',
  Multimodal = 'multimodal',
  Reasoning = 'reasoning',
  Analysis = 'analysis',
  Translation = 'translation',
  Summarization = 'summarization',
}

export interface ModelQualityScores {
  reasoning: number; // 0-100
  speed: number; // 0-100
  reliability: number; // 0-100
  codeQuality: number; // 0-100
  creativity: number; // 0-100
  instructionFollowing: number; // 0-100
}

export interface ModelDefinition {
  id: string;
  name: string;
  displayName: string;
  provider: AIProviderType;
  status: ModelStatus;
  tier: ModelTier;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens: number;
  defaultOutputTokens: number;
  quality: ModelQualityScores;
  averageLatencyMs: number;
  family?: string;
  aliases?: string[];
  releaseDate?: Date;
  deprecationDate?: Date;
  pricing?: {
    input: number;
    output: number;
    unit: string;
  };
}

export interface ModelRequirements {
  minContextWindow?: number;
  requiredCapabilities?: ModelCapability[];
  maxLatency?: number;
  minQualityScore?: number;
  preferredProviders?: AIProviderType[];
  excludedProviders?: AIProviderType[];
  maxCostPerToken?: number;
  tier?: ModelTier;
}

export interface ModelMatchResult {
  model: ModelDefinition;
  score: number; // 0-1, higher is better match
  reasons: string[];
  costEstimate?: number;
}

export interface ModelFilterOptions {
  provider?: AIProviderType;
  tier?: ModelTier;
  status?: ModelStatus;
  capabilities?: ModelCapability[];
  minContextWindow?: number;
  maxLatency?: number;
  family?: string;
}

export interface ModelRegistryStats {
  totalModels: number;
  activeModels: number;
  byProvider: Record<AIProviderType, number>;
  byTier: Record<ModelTier, number>;
  byStatus: Record<ModelStatus, number>;
  lastUpdated: Date;
}

@Injectable()
export class ModelRegistryService {
  private readonly logger = new Logger(ModelRegistryService.name);
  private models: Map<string, ModelDefinition> = new Map();
  private modelsByProvider: Map<AIProviderType, ModelDefinition[]> = new Map();
  private lastUpdated: Date = new Date();

  constructor(private readonly configService: ConfigService) {
    this.initializeModels();
    this.buildIndices();
  }

  /**
   * Initialize model registry with all supported models
   */
  private initializeModels(): void {
    this.logger.log('Initializing comprehensive model registry');

    const models: ModelDefinition[] = [
      // === Anthropic Models ===
      {
        id: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
        name: 'claude-opus-4-1',
        displayName: 'Claude Opus 4.1',
        provider: AIProviderType.Anthropic,
        status: ModelStatus.Active,
        tier: ModelTier.Premium,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Reasoning,
          ModelCapability.Code,
          ModelCapability.Tools,
          ModelCapability.Streaming,
          ModelCapability.Json,
        ],
        contextWindow: 200000,
        maxOutputTokens: 4096,
        defaultOutputTokens: 2048,
        quality: {
          reasoning: 98,
          speed: 75,
          reliability: 98,
          codeQuality: 98,
          creativity: 95,
          instructionFollowing: 98,
        },
        averageLatencyMs: 2500,
        family: 'claude-opus',
        pricing: {
          input: 0.000015,
          output: 0.000075,
          unit: 'per token',
        },
      },
      {
        id: 'us.anthropic.claude-3-haiku-20240307-v1:0',
        name: 'claude-3-haiku',
        displayName: 'Claude 3 Haiku',
        provider: AIProviderType.Anthropic,
        status: ModelStatus.Active,
        tier: ModelTier.Balanced,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Reasoning,
          ModelCapability.Code,
          ModelCapability.Tools,
          ModelCapability.Streaming,
          ModelCapability.Json,
        ],
        contextWindow: 200000,
        maxOutputTokens: 4096,
        defaultOutputTokens: 2048,
        quality: {
          reasoning: 88,
          speed: 95,
          reliability: 92,
          codeQuality: 88,
          creativity: 85,
          instructionFollowing: 92,
        },
        averageLatencyMs: 1200,
        family: 'claude-3',
        pricing: {
          input: 0.000001,
          output: 0.000005,
          unit: 'per token',
        },
      },
      {
        id: 'us.anthropic.claude-3-sonnet-20240229-v1:0',
        name: 'claude-3-sonnet',
        displayName: 'Claude 3 Sonnet',
        provider: AIProviderType.Anthropic,
        status: ModelStatus.Active,
        tier: ModelTier.Premium,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Reasoning,
          ModelCapability.Code,
          ModelCapability.Tools,
          ModelCapability.Streaming,
          ModelCapability.Json,
        ],
        contextWindow: 200000,
        maxOutputTokens: 4096,
        defaultOutputTokens: 2048,
        quality: {
          reasoning: 95,
          speed: 80,
          reliability: 95,
          codeQuality: 95,
          creativity: 90,
          instructionFollowing: 95,
        },
        averageLatencyMs: 1800,
        family: 'claude-3',
        pricing: {
          input: 0.000003,
          output: 0.000015,
          unit: 'per token',
        },
      },

      // === Amazon Nova Models ===
      {
        id: 'us.amazon.nova-pro-v1:0',
        name: 'nova-pro',
        displayName: 'Nova Pro',
        provider: AIProviderType.AWS,
        status: ModelStatus.Active,
        tier: ModelTier.Premium,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Vision,
          ModelCapability.Multimodal,
          ModelCapability.Tools,
          ModelCapability.Streaming,
          ModelCapability.Json,
        ],
        contextWindow: 300000,
        maxOutputTokens: 4096,
        defaultOutputTokens: 2048,
        quality: {
          reasoning: 92,
          speed: 85,
          reliability: 90,
          codeQuality: 88,
          creativity: 88,
          instructionFollowing: 92,
        },
        averageLatencyMs: 2200,
        family: 'nova',
        pricing: {
          input: 0.0000014,
          output: 0.000007,
          unit: 'per token',
        },
      },
      {
        id: 'us.amazon.nova-lite-v1:0',
        name: 'nova-lite',
        displayName: 'Nova Lite',
        provider: AIProviderType.AWS,
        status: ModelStatus.Active,
        tier: ModelTier.Balanced,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Vision,
          ModelCapability.Multimodal,
          ModelCapability.Tools,
          ModelCapability.Streaming,
        ],
        contextWindow: 300000,
        maxOutputTokens: 4096,
        defaultOutputTokens: 2048,
        quality: {
          reasoning: 85,
          speed: 95,
          reliability: 85,
          codeQuality: 80,
          creativity: 82,
          instructionFollowing: 85,
        },
        averageLatencyMs: 1500,
        family: 'nova',
        pricing: {
          input: 0.0000006,
          output: 0.0000024,
          unit: 'per token',
        },
      },

      // === OpenAI Models ===
      {
        id: 'gpt-4o-2024-08-06',
        name: 'gpt-4o',
        displayName: 'GPT-4o',
        provider: AIProviderType.OpenAI,
        status: ModelStatus.Active,
        tier: ModelTier.Premium,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Vision,
          ModelCapability.Multimodal,
          ModelCapability.Code,
          ModelCapability.Tools,
          ModelCapability.Streaming,
          ModelCapability.Json,
        ],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        defaultOutputTokens: 2048,
        quality: {
          reasoning: 95,
          speed: 85,
          reliability: 95,
          codeQuality: 95,
          creativity: 90,
          instructionFollowing: 95,
        },
        averageLatencyMs: 2000,
        family: 'gpt-4',
        pricing: {
          input: 0.000005,
          output: 0.000015,
          unit: 'per token',
        },
      },

      // === Google Models ===
      {
        id: 'gemini-1.5-pro',
        name: 'gemini-1.5-pro',
        displayName: 'Gemini 1.5 Pro',
        provider: AIProviderType.Google,
        status: ModelStatus.Active,
        tier: ModelTier.Premium,
        capabilities: [
          ModelCapability.Chat,
          ModelCapability.Vision,
          ModelCapability.Multimodal,
          ModelCapability.Code,
          ModelCapability.Tools,
          ModelCapability.Streaming,
        ],
        contextWindow: 1048576, // 1M tokens
        maxOutputTokens: 8192,
        defaultOutputTokens: 4096,
        quality: {
          reasoning: 90,
          speed: 80,
          reliability: 88,
          codeQuality: 88,
          creativity: 85,
          instructionFollowing: 90,
        },
        averageLatencyMs: 3000,
        family: 'gemini-1.5',
        pricing: {
          input: 0.0000035,
          output: 0.0000105,
          unit: 'per token',
        },
      },
    ];

    // Add models to registry
    models.forEach((model) => {
      this.models.set(model.id, model);

      // Also add by name and aliases
      this.models.set(model.name, model);
      if (model.aliases) {
        model.aliases.forEach((alias) => this.models.set(alias, model));
      }
    });

    this.lastUpdated = new Date();
    this.logger.log(`Initialized model registry with ${models.length} models`);
  }

  /**
   * Build provider indices for fast lookup
   */
  private buildIndices(): void {
    this.modelsByProvider.clear();

    for (const model of this.models.values()) {
      if (!this.modelsByProvider.has(model.provider)) {
        this.modelsByProvider.set(model.provider, []);
      }
      this.modelsByProvider.get(model.provider)!.push(model);
    }
  }

  /**
   * Get model by ID, name, or alias
   */
  getModel(identifier: string): ModelDefinition | null {
    return this.models.get(identifier) || null;
  }

  /**
   * Find best matching model based on requirements
   */
  findBestMatch(requirements: ModelRequirements): ModelMatchResult | null {
    const candidates = Array.from(this.models.values())
      .filter((model) => model.status === ModelStatus.Active)
      .map((model) => this.scoreModel(model, requirements))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Score how well a model matches requirements
   */
  private scoreModel(
    model: ModelDefinition,
    requirements: ModelRequirements,
  ): ModelMatchResult {
    let score = 0;
    const reasons: string[] = [];

    // Provider preferences/exclusions
    if (requirements.preferredProviders?.includes(model.provider)) {
      score += 0.2;
      reasons.push(`Preferred provider: ${model.provider}`);
    }
    if (requirements.excludedProviders?.includes(model.provider)) {
      return { model, score: 0, reasons: ['Excluded provider'] };
    }

    // Tier matching
    if (requirements.tier && model.tier === requirements.tier) {
      score += 0.15;
      reasons.push(`Tier match: ${model.tier}`);
    }

    // Context window
    if (
      requirements.minContextWindow &&
      model.contextWindow >= requirements.minContextWindow
    ) {
      const contextBonus = Math.min(
        (model.contextWindow - requirements.minContextWindow) / 10000,
        0.2,
      );
      score += contextBonus;
      reasons.push(`Context window: ${model.contextWindow}`);
    } else if (
      requirements.minContextWindow &&
      model.contextWindow < requirements.minContextWindow
    ) {
      return { model, score: 0, reasons: ['Insufficient context window'] };
    }

    // Required capabilities
    if (requirements.requiredCapabilities) {
      const hasAllCapabilities = requirements.requiredCapabilities.every(
        (cap) => model.capabilities.includes(cap),
      );
      if (hasAllCapabilities) {
        score += 0.3;
        reasons.push(
          `Has required capabilities: ${requirements.requiredCapabilities.join(', ')}`,
        );
      } else {
        return { model, score: 0, reasons: ['Missing required capabilities'] };
      }
    }

    // Latency
    if (
      requirements.maxLatency &&
      model.averageLatencyMs <= requirements.maxLatency
    ) {
      score += 0.1;
      reasons.push(`Latency: ${model.averageLatencyMs}ms`);
    }

    // Quality score
    if (requirements.minQualityScore) {
      const avgQuality =
        Object.values(model.quality).reduce((sum, val) => sum + val, 0) /
        Object.values(model.quality).length;
      if (avgQuality >= requirements.minQualityScore) {
        score += 0.15;
        reasons.push(`Quality score: ${avgQuality.toFixed(1)}`);
      }
    }

    // Cost constraint
    if (requirements.maxCostPerToken && model.pricing) {
      const maxCost = Math.max(model.pricing.input, model.pricing.output);
      if (maxCost <= requirements.maxCostPerToken) {
        score += 0.1;
        reasons.push(`Cost: $${maxCost}/token`);
      }
    }

    return { model, score, reasons };
  }

  /**
   * Get all models matching filters
   */
  getModels(filters?: ModelFilterOptions): ModelDefinition[] {
    let models = Array.from(this.models.values());

    if (filters?.provider) {
      models = models.filter((m) => m.provider === filters.provider);
    }
    if (filters?.tier) {
      models = models.filter((m) => m.tier === filters.tier);
    }
    if (filters?.status) {
      models = models.filter((m) => m.status === filters.status);
    }
    if (filters?.capabilities) {
      models = models.filter((m) =>
        filters.capabilities!.every((cap) => m.capabilities.includes(cap)),
      );
    }
    if (filters?.minContextWindow) {
      models = models.filter(
        (m) => m.contextWindow >= filters.minContextWindow!,
      );
    }
    if (filters?.maxLatency) {
      models = models.filter((m) => m.averageLatencyMs <= filters.maxLatency!);
    }
    if (filters?.family) {
      models = models.filter((m) => m.family === filters.family);
    }

    return models;
  }

  /**
   * Get registry statistics
   */
  getStats(): ModelRegistryStats {
    const allModels = Array.from(this.models.values());

    const byProvider: Record<AIProviderType, number> = {} as any;
    const byTier: Record<ModelTier, number> = {} as any;
    const byStatus: Record<ModelStatus, number> = {} as any;

    Object.values(AIProviderType).forEach((provider) => {
      byProvider[provider] = 0;
    });
    Object.values(ModelTier).forEach((tier) => {
      byTier[tier] = 0;
    });
    Object.values(ModelStatus).forEach((status) => {
      byStatus[status] = 0;
    });

    allModels.forEach((model) => {
      byProvider[model.provider]++;
      byTier[model.tier]++;
      byStatus[model.status]++;
    });

    return {
      totalModels: allModels.length,
      activeModels: byStatus[ModelStatus.Active],
      byProvider,
      byTier,
      byStatus,
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Update model latency from telemetry
   */
  updateModelLatency(modelId: string, latencyMs: number): void {
    const model = this.getModel(modelId);
    if (model) {
      // Exponential moving average
      const alpha = 0.2;
      model.averageLatencyMs = model.averageLatencyMs
        ? model.averageLatencyMs * (1 - alpha) + latencyMs * alpha
        : latencyMs;
    }
  }

  /**
   * Check if model supports capability
   */
  hasCapability(modelId: string, capability: ModelCapability): boolean {
    const model = this.getModel(modelId);
    return model ? model.capabilities.includes(capability) : false;
  }

  /**
   * Get models by provider
   */
  getModelsByProvider(provider: AIProviderType): ModelDefinition[] {
    return this.modelsByProvider.get(provider) || [];
  }

  /**
   * Get model display name (for compatibility with existing code)
   */
  static getDisplayName(modelId: string): string {
    // This maintains compatibility with the existing simple registry
    const displayNames: Record<string, string> = {
      'us.anthropic.claude-opus-4-1-20250805-v1:0': 'Claude Opus 4.1',
      'us.anthropic.claude-3-haiku-20240307-v1:0': 'Claude 3 Haiku',
      'us.anthropic.claude-3-sonnet-20240229-v1:0': 'Claude 3 Sonnet',
      'us.amazon.nova-pro-v1:0': 'Nova Pro',
      'us.amazon.nova-lite-v1:0': 'Nova Lite',
    };

    return displayNames[modelId] || modelId;
  }
}
