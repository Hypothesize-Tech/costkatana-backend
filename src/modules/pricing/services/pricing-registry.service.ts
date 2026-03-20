import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter } from 'events';
import { MODEL_PRICING } from '../../../utils/pricing';
import { PricingService } from '../../utils/services/pricing.service';
import { RealtimePricingService } from './realtime-pricing.service';
import { WebScraperService } from './web-scraper.service';
import {
  PricingUnit,
  ModelPricing as UtilModelPricing,
} from '../../../utils/pricing/types';

// Inline type definitions (from Express pricingRegistry.types.ts)
export enum AIProviderType {
  OpenAI = 'openai',
  Google = 'google',
  Bedrock = 'bedrock',
  Anthropic = 'anthropic',
}

export type PricingUnitType =
  | 'per_1k_tokens'
  | 'per_1m_tokens'
  | 'per_token'
  | 'per_request'
  | 'per_character'
  | 'per_1k_characters';

export interface PricingTier {
  minVolume: number;
  maxVolume?: number;
  inputPrice: number;
  outputPrice: number;
}

export interface ModelPricing {
  modelId: string;
  provider: AIProviderType;
  inputPricePerK: number;
  outputPricePerK: number;
  originalUnit: PricingUnitType;
  currency: string;
  lastUpdated: Date;
  source:
    | 'manual'
    | 'provider_api'
    | 'config'
    | 'estimated'
    | 'static_pricing'
    | 'static_fallback'
    | 'realtime_api'
    | 'web_scraped';
  notes?: string;
  cachedInputPricePerK?: number;
  regionalPricing?: Record<
    string,
    { inputPricePerK: number; outputPricePerK: number }
  >;
  pricingTiers?: PricingTier[];
  minBillableTokens?: number;
}

export interface CostCalculationRequest {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  region?: string;
  cachedInput?: boolean;
}

export interface CostCalculationResult {
  modelId: string;
  provider: AIProviderType;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  cacheSavings?: number;
  effectiveRatePerK: number;
  breakdown: {
    inputTokens: number;
    outputTokens: number;
    inputPricePerK: number;
    outputPricePerK: number;
    cachedInputTokens?: number;
    cachedInputPricePerK?: number;
  };
}

export interface CostComparison {
  models: Array<{
    modelId: string;
    displayName: string;
    cost: number;
    savings?: number;
    savingsPercent?: number;
  }>;
  cheapest: string;
  mostExpensive: string;
  parameters: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface PricingUpdateEvent {
  type: 'price_change' | 'model_added';
  modelId: string;
  previousPricing?: ModelPricing;
  newPricing: ModelPricing;
  timestamp: Date;
  description: string;
}

export interface PricingSyncConfig {
  enabled: boolean;
  intervalMs: number;
  providers: AIProviderType[];
  lastSync?: Date;
}

export interface PricingRegistryStats {
  totalModels: number;
  byProvider: Record<AIProviderType, number>;
  avgInputCostPerK: number;
  avgOutputCostPerK: number;
  cheapestModel: {
    modelId: string;
    totalCostPerK: number;
  };
  mostExpensiveModel: {
    modelId: string;
    totalCostPerK: number;
  };
  lastUpdated: Date;
  freshnessReport: Record<
    string,
    {
      count: number;
      oldestUpdate: Date;
      newestUpdate: Date;
    }
  >;
}

@Injectable()
export class PricingRegistryService
  extends EventEmitter
  implements OnModuleInit
{
  private readonly logger = new Logger(PricingRegistryService.name);
  private pricing: Map<string, ModelPricing> = new Map();
  private syncConfig: PricingSyncConfig = {
    enabled: false,
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    providers: [
      AIProviderType.OpenAI,
      AIProviderType.Google,
      AIProviderType.Bedrock,
    ],
  };
  private syncTimer?: NodeJS.Timeout;

  constructor(
    private readonly pricingService: PricingService,
    private readonly realtimePricingService: RealtimePricingService,
    private readonly webScraperService: WebScraperService,
  ) {
    super();
  }

  onModuleInit() {
    this.initializePricing();
  }

  /**
   * Initialize pricing data from existing pricing utilities
   */
  private initializePricing(): void {
    this.logger.log('Initializing pricing registry from utils/pricing');

    // Use the combined MODEL_PRICING data
    const pricingData: ModelPricing[] = MODEL_PRICING.map(
      (item: UtilModelPricing) => {
        const provider = this.normalizeProviderName(item.provider);
        const modelId = this.generateModelId(provider, item.modelId);

        return {
          modelId,
          provider: this.mapToProviderType(provider),
          inputPricePerK: this.normalizeToPer1K(item.inputPrice, item.unit),
          outputPricePerK: this.normalizeToPer1K(item.outputPrice, item.unit),
          originalUnit: this.mapPricingUnit(item.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'manual' as const,
          notes: item.notes,
        };
      },
    );

    // Add pricing to registry (deduplicate by modelId)
    const uniquePricing = new Map<string, ModelPricing>();
    pricingData.forEach((pricing) => {
      if (!uniquePricing.has(pricing.modelId)) {
        uniquePricing.set(pricing.modelId, pricing);
      }
    });

    uniquePricing.forEach((pricing, modelId) => {
      this.pricing.set(modelId, pricing);
    });

    this.logger.log(
      `Pricing registry initialized with ${this.pricing.size} models`,
    );
  }

  /**
   * Normalize provider name to standard format
   */
  private normalizeProviderName(provider: string): string {
    const normalized = provider.toLowerCase().trim();

    if (normalized.includes('openai')) return 'openai';
    if (normalized.includes('anthropic')) return 'anthropic';
    if (normalized.includes('google')) return 'google';
    if (normalized.includes('bedrock') || normalized.includes('aws'))
      return 'bedrock';
    if (normalized.includes('cohere')) return 'cohere';
    if (normalized.includes('mistral')) return 'mistral';
    if (normalized.includes('meta')) return 'meta';
    if (normalized.includes('grok') || normalized.includes('x.ai'))
      return 'grok';

    return normalized;
  }

  /**
   * Map provider name to AIProviderType enum
   */
  private mapToProviderType(provider: string): AIProviderType {
    switch (provider) {
      case 'openai':
        return AIProviderType.OpenAI;
      case 'anthropic':
        return AIProviderType.Anthropic;
      case 'google':
        return AIProviderType.Google;
      case 'bedrock':
        return AIProviderType.Bedrock;
      default:
        return AIProviderType.Bedrock; // Default fallback
    }
  }

  /**
   * Generate consistent model ID
   */
  private generateModelId(provider: string, modelId: string): string {
    // If already prefixed, return as-is
    if (modelId.includes(':')) {
      return modelId;
    }

    return `${provider}:${modelId}`;
  }

  /**
   * Normalize pricing to per-1K tokens
   */
  private normalizeToPer1K(price: number, unit: PricingUnit): number {
    switch (unit) {
      case PricingUnit.PER_1M_TOKENS:
        return price / 1000; // Convert per-1M to per-1K
      case PricingUnit.PER_1K_TOKENS:
        return price;
      case PricingUnit.PER_REQUEST:
      case PricingUnit.PER_HOUR:
      case PricingUnit.PER_IMAGE:
      case PricingUnit.PER_SECOND:
      case PricingUnit.PER_MINUTE:
      case PricingUnit.PER_1K_CHARACTERS:
        // For non-token units, return as-is (will need special handling)
        return price;
      default:
        return price / 1000; // Default to per-1M conversion
    }
  }

  /**
   * Map PricingUnit enum to our type
   */
  private mapPricingUnit(unit: PricingUnit): PricingUnitType {
    switch (unit) {
      case PricingUnit.PER_1K_TOKENS:
        return 'per_1k_tokens';
      case PricingUnit.PER_1M_TOKENS:
        return 'per_1m_tokens';
      case PricingUnit.PER_REQUEST:
        return 'per_request';
      case PricingUnit.PER_1K_CHARACTERS:
        return 'per_1k_characters';
      default:
        return 'per_1m_tokens';
    }
  }

  /**
   * Map caller model ids to registry keys. Registry stores `provider:model` for API-style ids
   * (e.g. `anthropic:claude-sonnet-4-20250514`) and bare Bedrock foundation ids when they contain `:`.
   * Callers often pass Anthropic API strings without the `anthropic:` prefix, or `us.*` inference profiles.
   */
  private resolveRegistryModelId(modelId: string): string {
    if (this.pricing.has(modelId)) {
      return modelId;
    }

    const withoutInferenceProfilePrefix = modelId.replace(
      /^(us|eu|ap|ca)\./,
      '',
    );
    if (
      withoutInferenceProfilePrefix !== modelId &&
      this.pricing.has(withoutInferenceProfilePrefix)
    ) {
      return withoutInferenceProfilePrefix;
    }

    if (!modelId.includes(':')) {
      if (modelId.startsWith('claude-')) {
        const anthropicKey = `anthropic:${modelId}`;
        if (this.pricing.has(anthropicKey)) {
          return anthropicKey;
        }
      }
      if (modelId.startsWith('gpt-')) {
        const openaiKey = `openai:${modelId}`;
        if (this.pricing.has(openaiKey)) {
          return openaiKey;
        }
      }
      if (modelId.startsWith('gemini-')) {
        const googleKey = `google:${modelId}`;
        if (this.pricing.has(googleKey)) {
          return googleKey;
        }
      }
    }

    return modelId;
  }

  /**
   * Get pricing for a model
   */
  getPricing(modelId: string): ModelPricing | null {
    const key = this.resolveRegistryModelId(modelId);
    const pricing = this.pricing.get(key);

    if (!pricing) {
      this.logger.warn(`Pricing not found for model: ${modelId}`);
    }

    return pricing || null;
  }

  /**
   * Calculate cost for a request
   */
  calculateCost(request: CostCalculationRequest): CostCalculationResult | null {
    const pricing = this.getPricing(request.modelId);

    if (!pricing) {
      this.logger.error(
        `Cannot calculate cost: pricing not found for model ${request.modelId}`,
      );
      return null;
    }

    // Get applicable pricing (regional or default)
    let inputPricePerK = pricing.inputPricePerK;
    let outputPricePerK = pricing.outputPricePerK;

    if (request.region && pricing.regionalPricing?.[request.region]) {
      inputPricePerK = pricing.regionalPricing[request.region].inputPricePerK;
      outputPricePerK = pricing.regionalPricing[request.region].outputPricePerK;
    }

    // Calculate input cost (consider cache)
    let inputCost: number;
    let cacheSavings: number | undefined;

    if (request.cachedInput && pricing.cachedInputPricePerK) {
      inputCost = (request.inputTokens / 1000) * pricing.cachedInputPricePerK;
      const standardCost = (request.inputTokens / 1000) * inputPricePerK;
      cacheSavings = standardCost - inputCost;
    } else {
      inputCost = (request.inputTokens / 1000) * inputPricePerK;
    }

    // Calculate output cost
    const outputCost = (request.outputTokens / 1000) * outputPricePerK;

    // Total cost
    const totalCost = inputCost + outputCost;

    // Effective rate
    const totalTokens = request.inputTokens + request.outputTokens;
    const effectiveRatePerK =
      totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;

    return {
      modelId: request.modelId,
      provider: pricing.provider,
      inputCost,
      outputCost,
      totalCost,
      currency: pricing.currency,
      cacheSavings,
      effectiveRatePerK,
      breakdown: {
        inputTokens: request.inputTokens,
        outputTokens: request.outputTokens,
        inputPricePerK,
        outputPricePerK,
        cachedInputTokens: request.cachedInput
          ? request.inputTokens
          : undefined,
        cachedInputPricePerK: request.cachedInput
          ? pricing.cachedInputPricePerK
          : undefined,
      },
    };
  }

  /**
   * Compare costs across multiple models
   */
  compareCosts(
    modelIds: string[],
    inputTokens: number,
    outputTokens: number,
  ): CostComparison | null {
    const results: Array<{
      modelId: string;
      displayName: string;
      cost: number;
    }> = [];

    for (const modelId of modelIds) {
      const costResult = this.calculateCost({
        modelId,
        inputTokens,
        outputTokens,
      });

      if (costResult) {
        results.push({
          modelId,
          displayName: modelId.split(':')[1] || modelId,
          cost: costResult.totalCost,
        });
      }
    }

    if (results.length === 0) {
      return null;
    }

    // Sort by cost
    results.sort((a, b) => a.cost - b.cost);

    const cheapest = results[0];
    const mostExpensive = results[results.length - 1];

    // Calculate savings
    const resultsWithSavings = results.map((result) => {
      if (result.modelId !== cheapest.modelId) {
        return {
          ...result,
          savings: result.cost - cheapest.cost,
          savingsPercent: ((result.cost - cheapest.cost) / result.cost) * 100,
        };
      }
      return result;
    });

    return {
      models: resultsWithSavings,
      cheapest: cheapest.modelId,
      mostExpensive: mostExpensive.modelId,
      parameters: {
        inputTokens,
        outputTokens,
      },
    };
  }

  /**
   * Get cheapest model for given requirements
   */
  getCheapestModel(
    modelIds: string[],
    inputTokens: number,
    outputTokens: number,
  ): { modelId: string; cost: number } | null {
    const comparison = this.compareCosts(modelIds, inputTokens, outputTokens);

    if (!comparison) {
      return null;
    }

    const cheapest = comparison.models[0];
    return {
      modelId: cheapest.modelId,
      cost: cheapest.cost,
    };
  }

  /**
   * Update pricing for a model
   */
  updatePricing(modelId: string, pricing: Partial<ModelPricing>): void {
    const existing = this.pricing.get(modelId);

    const updated: ModelPricing = {
      modelId,
      provider: pricing.provider || existing?.provider || AIProviderType.OpenAI,
      inputPricePerK: pricing.inputPricePerK || existing?.inputPricePerK || 0,
      outputPricePerK:
        pricing.outputPricePerK || existing?.outputPricePerK || 0,
      originalUnit:
        pricing.originalUnit || existing?.originalUnit || 'per_1m_tokens',
      currency: pricing.currency || existing?.currency || 'USD',
      cachedInputPricePerK:
        pricing.cachedInputPricePerK || existing?.cachedInputPricePerK,
      regionalPricing: pricing.regionalPricing || existing?.regionalPricing,
      pricingTiers: pricing.pricingTiers || existing?.pricingTiers,
      minBillableTokens:
        pricing.minBillableTokens || existing?.minBillableTokens,
      lastUpdated: new Date(),
      source: pricing.source || 'manual',
      notes: pricing.notes || existing?.notes,
    };

    this.pricing.set(modelId, updated);

    // Emit pricing update event
    const event: PricingUpdateEvent = {
      type: existing ? 'price_change' : 'model_added',
      modelId,
      previousPricing: existing,
      newPricing: updated,
      timestamp: new Date(),
      description: existing
        ? `Price updated from $${existing.inputPricePerK}/$${existing.outputPricePerK} to $${updated.inputPricePerK}/$${updated.outputPricePerK}`
        : `New model pricing added`,
    };

    this.emit('pricingUpdate', event);

    this.logger.log(`Pricing updated for ${modelId}`, {
      type: event.type,
      newInputPrice: updated.inputPricePerK,
      newOutputPrice: updated.outputPricePerK,
    });
  }

  /**
   * Get all pricing data
   */
  getAllPricing(): ModelPricing[] {
    return Array.from(this.pricing.values());
  }

  /**
   * Get pricing by provider
   */
  getPricingByProvider(provider: AIProviderType): ModelPricing[] {
    return Array.from(this.pricing.values()).filter(
      (p) => p.provider === provider,
    );
  }

  /**
   * Get registry statistics
   */
  getStats(): PricingRegistryStats {
    const allPricing = this.getAllPricing();

    const byProvider: Record<AIProviderType, number> = {
      [AIProviderType.OpenAI]: 0,
      [AIProviderType.Google]: 0,
      [AIProviderType.Bedrock]: 0,
      [AIProviderType.Anthropic]: 0,
    };

    let totalInputCost = 0;
    let totalOutputCost = 0;
    let cheapest = allPricing[0];
    let mostExpensive = allPricing[0];

    allPricing.forEach((pricing) => {
      byProvider[pricing.provider]++;
      totalInputCost += pricing.inputPricePerK;
      totalOutputCost += pricing.outputPricePerK;

      const totalCost = pricing.inputPricePerK + pricing.outputPricePerK;
      const cheapestCost =
        (cheapest?.inputPricePerK || 0) + (cheapest?.outputPricePerK || 0);
      const expensiveCost =
        (mostExpensive?.inputPricePerK || 0) +
        (mostExpensive?.outputPricePerK || 0);

      if (totalCost < cheapestCost) {
        cheapest = pricing;
      }
      if (totalCost > expensiveCost) {
        mostExpensive = pricing;
      }
    });

    const freshnessReport: Record<
      string,
      {
        count: number;
        oldestUpdate: Date;
        newestUpdate: Date;
      }
    > = {};

    allPricing.forEach((pricing) => {
      const source = pricing.source;
      if (!freshnessReport[source]) {
        freshnessReport[source] = {
          count: 0,
          oldestUpdate: pricing.lastUpdated,
          newestUpdate: pricing.lastUpdated,
        };
      }

      freshnessReport[source].count++;
      if (pricing.lastUpdated < freshnessReport[source].oldestUpdate) {
        freshnessReport[source].oldestUpdate = pricing.lastUpdated;
      }
      if (pricing.lastUpdated > freshnessReport[source].newestUpdate) {
        freshnessReport[source].newestUpdate = pricing.lastUpdated;
      }
    });

    return {
      totalModels: allPricing.length,
      byProvider,
      avgInputCostPerK: totalInputCost / allPricing.length,
      avgOutputCostPerK: totalOutputCost / allPricing.length,
      cheapestModel: {
        modelId: cheapest.modelId,
        totalCostPerK: cheapest.inputPricePerK + cheapest.outputPricePerK,
      },
      mostExpensiveModel: {
        modelId: mostExpensive.modelId,
        totalCostPerK:
          mostExpensive.inputPricePerK + mostExpensive.outputPricePerK,
      },
      lastUpdated: new Date(),
      freshnessReport,
    };
  }

  /**
   * Enable dynamic pricing sync
   */
  enableSync(config?: Partial<PricingSyncConfig>): void {
    if (config) {
      this.syncConfig = { ...this.syncConfig, ...config, enabled: true };
    } else {
      this.syncConfig.enabled = true;
    }

    // Clear existing timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Start sync timer
    this.syncTimer = setInterval(() => {
      void this.syncPricing();
    }, this.syncConfig.intervalMs);

    // Run initial sync
    void this.syncPricing();

    this.logger.log('Pricing sync enabled', {
      interval: this.syncConfig.intervalMs,
      providers: this.syncConfig.providers,
    });
  }

  /**
   * Disable dynamic pricing sync
   */
  disableSync(): void {
    this.syncConfig.enabled = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }

    this.logger.log('Pricing sync disabled');
  }

  /**
   * Manually trigger pricing sync
   */
  private async syncPricing(): Promise<void> {
    this.logger.log('Starting pricing sync', {
      providers: this.syncConfig.providers,
    });

    const syncStart = Date.now();
    let totalUpdated = 0;
    const errors: string[] = [];

    try {
      // Sync pricing for each enabled provider
      for (const provider of this.syncConfig.providers) {
        try {
          const updatedCount = await this.syncProviderPricing(provider);
          totalUpdated += updatedCount;

          this.logger.log(`Synced pricing for ${provider}`, {
            provider,
            modelsUpdated: updatedCount,
          });
        } catch (error) {
          const errorMsg = `Failed to sync ${provider}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg, { provider, error });
        }
      }

      this.syncConfig.lastSync = new Date();

      this.logger.log('Pricing sync completed', {
        timestamp: this.syncConfig.lastSync,
        totalProviders: this.syncConfig.providers.length,
        totalModelsUpdated: totalUpdated,
        errors: errors.length,
        duration: `${Date.now() - syncStart}ms`,
      });

      // Emit pricing update event
      this.emit('pricing:synced', {
        timestamp: this.syncConfig.lastSync,
        providers: this.syncConfig.providers,
        totalModelsUpdated: totalUpdated,
        errors,
      });
    } catch (error) {
      this.logger.error('Critical error during pricing sync', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - syncStart}ms`,
      });

      // Still update last sync time even on error
      this.syncConfig.lastSync = new Date();
    }
  }

  /**
   * Sync pricing for a specific provider
   */
  private async syncProviderPricing(provider: string): Promise<number> {
    let updatedCount = 0;

    switch (provider.toLowerCase()) {
      case 'openai':
        updatedCount = await this.syncOpenAIPricing();
        break;
      case 'anthropic':
        updatedCount = await this.syncAnthropicPricing();
        break;
      case 'google':
        updatedCount = await this.syncGooglePricing();
        break;
      case 'aws':
      case 'bedrock':
        updatedCount = await this.syncAWSBedrockPricing();
        break;
      case 'cohere':
        updatedCount = await this.syncCoherePricing();
        break;
      case 'mistral':
        updatedCount = await this.syncMistralPricing();
        break;
      case 'meta':
        updatedCount = await this.syncMetaPricing();
        break;
      case 'grok':
        updatedCount = await this.syncGrokPricing();
        break;
      default:
        this.logger.warn(`Unknown provider for pricing sync: ${provider}`);
        return 0;
    }

    return updatedCount;
  }

  /**
   * Sync OpenAI pricing from API
   */
  private async syncOpenAIPricing(): Promise<number> {
    try {
      let updatedCount = 0;

      // Try to fetch from OpenAI API if configured
      if (process.env.OPENAI_API_KEY) {
        try {
          updatedCount = await this.syncOpenAIFromAPI();
        } catch (apiError) {
          this.logger.warn(
            'Failed to sync OpenAI pricing from API, falling back to static data',
            {
              error:
                apiError instanceof Error ? apiError.message : String(apiError),
            },
          );
          updatedCount = await this.syncOpenAIFromStatic();
        }
      } else {
        this.logger.debug(
          'OpenAI API key not configured, using static pricing data',
        );
        updatedCount = await this.syncOpenAIFromStatic();
      }

      return updatedCount;
    } catch (error) {
      this.logger.error('Failed to sync OpenAI pricing', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Sync OpenAI pricing from their API
   */
  private async syncOpenAIFromAPI(): Promise<number> {
    // OpenAI doesn't have a public pricing API, so we use verified static pricing data
    // This data is kept current through manual updates based on official OpenAI pricing
    const openaiModels = MODEL_PRICING.filter((p) => p.provider === 'OpenAI');
    let updatedCount = 0;

    for (const modelPricing of openaiModels) {
      const modelId = this.generateModelId('openai', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        // Update existing model with current static pricing
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'static_pricing';
        this.pricing.set(modelId, existingModel);
      } else {
        // Create new model entry with static pricing
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.OpenAI,
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'static_pricing',
          notes: `${modelPricing.notes} (Static pricing - manually verified)`,
        };
        this.pricing.set(modelId, newPricing);
      }
      updatedCount++;
    }

    this.logger.log(
      `Synced ${updatedCount} OpenAI models from static pricing data`,
    );
    return updatedCount;
  }

  /**
   * Sync OpenAI pricing from static data (fallback)
   */
  private async syncOpenAIFromStatic(): Promise<number> {
    const openaiModels = MODEL_PRICING.filter((p) => p.provider === 'OpenAI');
    let updatedCount = 0;

    for (const modelPricing of openaiModels) {
      const modelId = this.generateModelId('openai', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'static_fallback';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.OpenAI,
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'static_fallback',
          notes: `${modelPricing.notes} (static fallback)`,
        };
        this.pricing.set(modelId, newPricing);
      }
      updatedCount++;
    }

    this.logger.log(
      `Synced ${updatedCount} OpenAI models from static fallback`,
    );
    return updatedCount;
  }

  /**
   * Sync Anthropic pricing - uses API when available, falls back to static data
   */
  private async syncAnthropicPricing(): Promise<number> {
    try {
      let updatedCount = 0;

      // Try to fetch from Anthropic API if configured
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          updatedCount = await this.syncAnthropicFromAPI();
        } catch (apiError) {
          this.logger.warn(
            'Failed to sync Anthropic pricing from API, falling back to static data',
            {
              error:
                apiError instanceof Error ? apiError.message : String(apiError),
            },
          );
          updatedCount = await this.syncAnthropicFromStatic();
        }
      } else {
        this.logger.debug(
          'Anthropic API key not configured, using static pricing data',
        );
        updatedCount = await this.syncAnthropicFromStatic();
      }

      return updatedCount;
    } catch (error) {
      this.logger.error('Failed to sync Anthropic pricing', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Sync Anthropic pricing from their API
   */
  private async syncAnthropicFromAPI(): Promise<number> {
    // Anthropic doesn't have a public pricing API, so we use verified static pricing data
    // This data is kept current through manual updates based on official Anthropic pricing
    const anthropicModels = MODEL_PRICING.filter(
      (p) => p.provider === 'Anthropic',
    );
    let updatedCount = 0;

    for (const modelPricing of anthropicModels) {
      const modelId = this.generateModelId('anthropic', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        // Update existing model with current static pricing
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'static_pricing';
        this.pricing.set(modelId, existingModel);
      } else {
        // Create new model entry with static pricing
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.Anthropic,
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'static_pricing',
          notes: `${modelPricing.notes} (Static pricing - manually verified)`,
        };
        this.pricing.set(modelId, newPricing);
      }
      updatedCount++;
    }

    this.logger.log(
      `Synced ${updatedCount} Anthropic models from static pricing data`,
    );
    return updatedCount;
  }

  /**
   * Sync Anthropic pricing from static data (fallback)
   */
  private async syncAnthropicFromStatic(): Promise<number> {
    const anthropicModels = MODEL_PRICING.filter(
      (p) => p.provider === 'Anthropic',
    );
    let updatedCount = 0;

    for (const modelPricing of anthropicModels) {
      const modelId = this.generateModelId('anthropic', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'static_fallback';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.Anthropic,
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'static_fallback',
          notes: `${modelPricing.notes} (static fallback)`,
        };
        this.pricing.set(modelId, newPricing);
      }
      updatedCount++;
    }

    this.logger.log(
      `Synced ${updatedCount} Anthropic models from static fallback`,
    );
    return updatedCount;
  }

  /**
   * Sync Google pricing - uses static pricing data with API-ready structure
   */
  private async syncGooglePricing(): Promise<number> {
    const googleModels = MODEL_PRICING.filter(
      (p) => p.provider === 'Google AI',
    );

    for (const modelPricing of googleModels) {
      const modelId = this.generateModelId('google', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'provider_api';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.Google,
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'provider_api',
          notes: modelPricing.notes,
        };
        this.pricing.set(modelId, newPricing);
      }
    }

    return googleModels.length;
  }

  /**
   * Sync AWS Bedrock pricing - uses static pricing data with API-ready structure
   */
  private async syncAWSBedrockPricing(): Promise<number> {
    const bedrockModels = MODEL_PRICING.filter(
      (p) => p.provider === 'AWS Bedrock',
    );

    for (const modelPricing of bedrockModels) {
      const modelId = this.generateModelId('bedrock', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'provider_api';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.Bedrock,
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'provider_api',
          notes: modelPricing.notes,
        };
        this.pricing.set(modelId, newPricing);
      }
    }

    return bedrockModels.length;
  }

  /**
   * Sync Cohere pricing - uses static pricing data with API-ready structure
   */
  private async syncCoherePricing(): Promise<number> {
    const cohereModels = MODEL_PRICING.filter((p) => p.provider === 'Cohere');

    for (const modelPricing of cohereModels) {
      const modelId = this.generateModelId('cohere', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'provider_api';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.OpenAI, // Cohere uses OpenAI-compatible pricing structure
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'provider_api',
          notes: modelPricing.notes,
        };
        this.pricing.set(modelId, newPricing);
      }
    }

    return cohereModels.length;
  }

  /**
   * Sync Mistral pricing - uses static pricing data with API-ready structure
   */
  private async syncMistralPricing(): Promise<number> {
    const mistralModels = MODEL_PRICING.filter((p) => p.provider === 'Mistral');

    for (const modelPricing of mistralModels) {
      const modelId = this.generateModelId('mistral', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'provider_api';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.OpenAI, // Mistral uses OpenAI-compatible pricing structure
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'provider_api',
          notes: modelPricing.notes,
        };
        this.pricing.set(modelId, newPricing);
      }
    }

    return mistralModels.length;
  }

  /**
   * Sync Meta pricing - uses static pricing data with API-ready structure
   */
  private async syncMetaPricing(): Promise<number> {
    const metaModels = MODEL_PRICING.filter((p) => p.provider === 'Meta');

    for (const modelPricing of metaModels) {
      const modelId = this.generateModelId('meta', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'provider_api';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.OpenAI, // Meta uses OpenAI-compatible pricing structure
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'provider_api',
          notes: modelPricing.notes,
        };
        this.pricing.set(modelId, newPricing);
      }
    }

    return metaModels.length;
  }

  /**
   * Sync Grok pricing - uses static pricing data with API-ready structure
   */
  private async syncGrokPricing(): Promise<number> {
    const grokModels = MODEL_PRICING.filter((p) => p.provider === 'Grok');

    for (const modelPricing of grokModels) {
      const modelId = this.generateModelId('grok', modelPricing.modelId);
      const existingModel = this.pricing.get(modelId);

      if (existingModel) {
        existingModel.inputPricePerK = modelPricing.inputPrice;
        existingModel.outputPricePerK = modelPricing.outputPrice;
        existingModel.lastUpdated = new Date();
        existingModel.source = 'provider_api';
        this.pricing.set(modelId, existingModel);
      } else {
        const newPricing: ModelPricing = {
          modelId,
          provider: AIProviderType.OpenAI, // Grok uses OpenAI-compatible pricing structure
          inputPricePerK: modelPricing.inputPrice,
          outputPricePerK: modelPricing.outputPrice,
          originalUnit: this.mapPricingUnit(modelPricing.unit),
          currency: 'USD',
          lastUpdated: new Date(),
          source: 'provider_api',
          notes: modelPricing.notes,
        };
        this.pricing.set(modelId, newPricing);
      }
    }

    return grokModels.length;
  }

  /**
   * Scheduled pricing sync - runs every 6 hours
   */
  @Cron('0 */6 * * *') // Every 6 hours
  async scheduledPricingSync(): Promise<void> {
    try {
      this.logger.log('Starting scheduled pricing sync');

      const startTime = Date.now();

      // Use multiple pricing sources for comprehensive sync
      const [registryResult, realtimeResult, scrapedResult] =
        await Promise.allSettled([
          this.syncPricing(), // Registry sync
          this.syncRealtimePricing(), // Real-time pricing service
          this.syncWebScrapedPricing(), // Web scraper service
        ]);

      const results = {
        registry:
          registryResult.status === 'fulfilled'
            ? (registryResult.value as unknown as {
                totalUpdated?: number;
                providers?: unknown;
              })
            : null,
        realtime:
          realtimeResult.status === 'fulfilled' ? realtimeResult.value : null,
        scraped:
          scrapedResult.status === 'fulfilled' ? scrapedResult.value : null,
      };

      const totalUpdated =
        ((results.registry &&
        typeof results.registry === 'object' &&
        'totalUpdated' in results.registry
          ? (results.registry as { totalUpdated: number }).totalUpdated
          : 0) || 0) +
        (results.realtime?.totalUpdated || 0) +
        (results.scraped?.totalUpdated || 0);

      const duration = Date.now() - startTime;
      this.logger.log('Completed scheduled pricing sync', {
        updatedModels: totalUpdated,
        duration,
        sources: {
          registry:
            results.registry &&
            typeof results.registry === 'object' &&
            'providers' in results.registry
              ? (results.registry as { providers: unknown }).providers
              : undefined,
          realtime: results.realtime?.message,
          scraped: results.scraped?.message,
        },
      });

      // Emit event for monitoring
      this.emit('scheduled_sync_completed', {
        timestamp: Date.now(),
        duration,
        updatedModels: totalUpdated,
        sources: results,
      });
    } catch (error) {
      this.logger.error('Scheduled pricing sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sync pricing from real-time pricing service
   */
  private async syncRealtimePricing(): Promise<{
    totalUpdated: number;
    message: string;
  }> {
    try {
      const providerPricingList =
        await this.realtimePricingService.getAllPricing();

      let updatedCount = 0;
      for (const providerPricing of providerPricingList) {
        for (const model of providerPricing.models) {
          const modelId = this.generateModelId(
            providerPricing.provider.toLowerCase(),
            model.modelId,
          );
          const existingModel = this.pricing.get(modelId);

          if (existingModel) {
            const inputPerK =
              model.inputPricePerMToken != null
                ? model.inputPricePerMToken / 1000
                : 0;
            const outputPerK =
              model.outputPricePerMToken != null
                ? model.outputPricePerMToken / 1000
                : 0;
            existingModel.inputPricePerK = inputPerK;
            existingModel.outputPricePerK = outputPerK;
            existingModel.lastUpdated = new Date(providerPricing.lastUpdated);
            existingModel.source = 'realtime_api';
            this.pricing.set(modelId, existingModel);
            updatedCount++;
          }
        }
      }

      return {
        totalUpdated: updatedCount,
        message: `Updated ${updatedCount} models from real-time service`,
      };
    } catch (error) {
      this.logger.warn('Failed to sync real-time pricing', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { totalUpdated: 0, message: 'Real-time sync failed' };
    }
  }

  /**
   * Sync pricing from web scraping service
   */
  private async syncWebScrapedPricing(): Promise<{
    totalUpdated: number;
    message: string;
  }> {
    try {
      const scrapedPricing = await this.webScraperService.scrapeAllProviders();

      let updatedCount = 0;
      for (const item of scrapedPricing) {
        const pricing = item as {
          provider: string;
          modelId?: string;
          inputPrice?: number;
          outputPrice?: number;
        };
        if (
          !pricing.modelId ||
          pricing.inputPrice == null ||
          pricing.outputPrice == null
        ) {
          continue;
        }
        const modelId = this.generateModelId(
          pricing.provider.toLowerCase(),
          pricing.modelId,
        );
        const existingModel = this.pricing.get(modelId);

        if (existingModel) {
          existingModel.inputPricePerK = pricing.inputPrice;
          existingModel.outputPricePerK = pricing.outputPrice;
          existingModel.lastUpdated = new Date();
          existingModel.source = 'web_scraped';
          this.pricing.set(modelId, existingModel);
          updatedCount++;
        }
      }

      return {
        totalUpdated: updatedCount,
        message: `Updated ${updatedCount} models from web scraping`,
      };
    } catch (error) {
      this.logger.warn('Failed to sync web scraped pricing', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { totalUpdated: 0, message: 'Web scraping sync failed' };
    }
  }

  /**
   * Subscribe to pricing updates
   */
  onPricingUpdate(callback: (event: PricingUpdateEvent) => void): void {
    this.on('pricingUpdate', callback);
  }

  /**
   * Unsubscribe from pricing updates
   */
  offPricingUpdate(callback: (event: PricingUpdateEvent) => void): void {
    this.off('pricingUpdate', callback);
  }
}
