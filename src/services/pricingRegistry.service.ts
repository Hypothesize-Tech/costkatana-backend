/**
 * Pricing Registry Service
 * 
 * Centralized pricing registry with dynamic sync, cost calculations,
 * and change tracking. Single source of truth for all model pricing.
 */

import {
    ModelPricing,
    CostCalculationRequest,
    CostCalculationResult,
    CostComparison,
    PricingUpdateEvent,
    PricingSyncConfig,
    PricingRegistryStats
} from '../types/pricingRegistry.types';
import { AIProviderType } from '../types/aiProvider.types';
import { loggingService } from './logging.service';
import { EventEmitter } from 'events';
import { OPENAI_PRICING } from '../utils/pricing/openai';
import { ANTHROPIC_PRICING } from '../utils/pricing/anthropic';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { GOOGLE_PRICING } from '../utils/pricing/google';
import { COHERE_PRICING } from '../utils/pricing/cohere';
import { MISTRAL_PRICING } from '../utils/pricing/mistral';
import { OTHERS_PRICING } from '../utils/pricing/others';
import { PricingUnit } from '../utils/pricing/types';
import type { ModelPricing as UtilModelPricing } from '../utils/pricing/types';

export class PricingRegistryService extends EventEmitter {
    private static instance: PricingRegistryService;
    private pricing: Map<string, ModelPricing> = new Map();
    private syncConfig: PricingSyncConfig = {
        enabled: false,
        intervalMs: 24 * 60 * 60 * 1000, // 24 hours
        providers: [AIProviderType.OpenAI, AIProviderType.Google, AIProviderType.Bedrock]
    };
    private syncTimer?: NodeJS.Timeout;

    private constructor() {
        super();
        this.initializePricing();
    }

    static getInstance(): PricingRegistryService {
        if (!PricingRegistryService.instance) {
            PricingRegistryService.instance = new PricingRegistryService();
        }
        return PricingRegistryService.instance;
    }

    /**
     * Initialize pricing data from existing pricing utilities
     */
    private initializePricing(): void {
        loggingService.info('Initializing pricing registry from utils/pricing');

        // Combine all pricing sources
        const allPricingData = [
            ...OPENAI_PRICING,
            ...ANTHROPIC_PRICING,
            ...AWS_BEDROCK_PRICING,
            ...GOOGLE_PRICING,
            ...COHERE_PRICING,
            ...MISTRAL_PRICING,
            ...OTHERS_PRICING
        ];

        // Convert and normalize pricing data
        const pricingData: ModelPricing[] = allPricingData.map((item: UtilModelPricing) => {
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
                notes: item.notes
            };
        });

        // For backward compatibility, keep some explicit mappings
        const legacyMappings: ModelPricing[] = [
            {
                modelId: 'openai:gpt-4o',
                provider: AIProviderType.OpenAI,
                inputPricePerK: 0.0025,
                outputPricePerK: 0.01,
                originalUnit: 'per_1m_tokens',
                currency: 'USD',
                lastUpdated: new Date(),
                source: 'manual',
                notes: 'GPT-4o standard pricing'
            },
        ];

        // Merge with existing comprehensive data
        const mergedData = [...pricingData, ...legacyMappings];

        // Add pricing to registry (deduplicate by modelId, prefer comprehensive data)
        const uniquePricing = new Map<string, ModelPricing>();
        mergedData.forEach(pricing => {
            if (!uniquePricing.has(pricing.modelId)) {
                uniquePricing.set(pricing.modelId, pricing);
            }
        });

        uniquePricing.forEach((pricing, modelId) => {
            this.pricing.set(modelId, pricing);
        });

        loggingService.info('Pricing registry initialized from utils/pricing', {
            totalModels: this.pricing.size,
            providers: [...new Set(Array.from(this.pricing.values()).map(p => p.provider))],
            sources: ['OpenAI', 'Anthropic', 'AWS Bedrock', 'Google', 'Cohere', 'Mistral', 'Others']
        });
    }

    /**
     * Normalize provider name to standard format
     */
    private normalizeProviderName(provider: string): string {
        const normalized = provider.toLowerCase().trim();
        
        if (normalized.includes('openai')) return 'openai';
        if (normalized.includes('anthropic')) return 'anthropic';
        if (normalized.includes('google')) return 'google';
        if (normalized.includes('bedrock') || normalized.includes('aws')) return 'bedrock';
        if (normalized.includes('cohere')) return 'cohere';
        if (normalized.includes('mistral')) return 'mistral';
        if (normalized.includes('meta')) return 'meta';
        if (normalized.includes('grok') || normalized.includes('x.ai')) return 'grok';
        
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
            case 'bedrock':
                return AIProviderType.Bedrock;
            case 'google':
                return AIProviderType.Google;
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
    private mapPricingUnit(unit: PricingUnit): 'per_1k_tokens' | 'per_1m_tokens' | 'per_token' | 'per_request' | 'per_character' | 'per_1k_characters' {
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
     * Get pricing for a model
     */
    getPricing(modelId: string): ModelPricing | null {
        const pricing = this.pricing.get(modelId);
        
        if (!pricing) {
            loggingService.warn('Pricing not found for model', { modelId });
        }
        
        return pricing || null;
    }

    /**
     * Calculate cost for a request
     */
    calculateCost(request: CostCalculationRequest): CostCalculationResult | null {
        const pricing = this.getPricing(request.modelId);
        
        if (!pricing) {
            loggingService.error('Cannot calculate cost: pricing not found', {
                modelId: request.modelId
            });
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
        const effectiveRatePerK = totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;

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
                cachedInputTokens: request.cachedInput ? request.inputTokens : undefined,
                cachedInputPricePerK: request.cachedInput ? pricing.cachedInputPricePerK : undefined
            }
        };
    }

    /**
     * Compare costs across multiple models
     */
    compareCosts(
        modelIds: string[],
        inputTokens: number,
        outputTokens: number
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
                outputTokens
            });

            if (costResult) {
                results.push({
                    modelId,
                    displayName: modelId.split(':')[1] || modelId,
                    cost: costResult.totalCost
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
        const resultsWithSavings = results.map(result => {
            if (result.modelId !== cheapest.modelId) {
                return {
                    ...result,
                    savings: result.cost - cheapest.cost,
                    savingsPercent: ((result.cost - cheapest.cost) / result.cost) * 100
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
                outputTokens
            }
        };
    }

    /**
     * Get cheapest model for given requirements
     */
    getCheapestModel(
        modelIds: string[],
        inputTokens: number,
        outputTokens: number
    ): { modelId: string; cost: number } | null {
        const comparison = this.compareCosts(modelIds, inputTokens, outputTokens);
        
        if (!comparison) {
            return null;
        }

        const cheapest = comparison.models[0];
        return {
            modelId: cheapest.modelId,
            cost: cheapest.cost
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
            outputPricePerK: pricing.outputPricePerK || existing?.outputPricePerK || 0,
            originalUnit: pricing.originalUnit || existing?.originalUnit || 'per_1m_tokens',
            currency: pricing.currency || existing?.currency || 'USD',
            cachedInputPricePerK: pricing.cachedInputPricePerK || existing?.cachedInputPricePerK,
            regionalPricing: pricing.regionalPricing || existing?.regionalPricing,
            pricingTiers: pricing.pricingTiers || existing?.pricingTiers,
            minBillableTokens: pricing.minBillableTokens || existing?.minBillableTokens,
            lastUpdated: new Date(),
            source: pricing.source || 'manual',
            notes: pricing.notes || existing?.notes
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
                : `New model pricing added`
        };

        this.emit('pricingUpdate', event);

        loggingService.info('Pricing updated', {
            modelId,
            type: event.type,
            newInputPrice: updated.inputPricePerK,
            newOutputPrice: updated.outputPricePerK
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
        return Array.from(this.pricing.values())
            .filter(p => p.provider === provider);
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
            [AIProviderType.Anthropic]: 0
        };

        let totalInputCost = 0;
        let totalOutputCost = 0;
        let cheapest = allPricing[0];
        let mostExpensive = allPricing[0];

        allPricing.forEach(pricing => {
            byProvider[pricing.provider]++;
            totalInputCost += pricing.inputPricePerK;
            totalOutputCost += pricing.outputPricePerK;

            const totalCost = pricing.inputPricePerK + pricing.outputPricePerK;
            const cheapestCost = (cheapest?.inputPricePerK || 0) + (cheapest?.outputPricePerK || 0);
            const expensiveCost = (mostExpensive?.inputPricePerK || 0) + (mostExpensive?.outputPricePerK || 0);

            if (totalCost < cheapestCost) {
                cheapest = pricing;
            }
            if (totalCost > expensiveCost) {
                mostExpensive = pricing;
            }
        });

        const freshnessReport: Record<string, {
            count: number;
            oldestUpdate: Date;
            newestUpdate: Date;
        }> = {};

        allPricing.forEach(pricing => {
            const source = pricing.source;
            if (!freshnessReport[source]) {
                freshnessReport[source] = {
                    count: 0,
                    oldestUpdate: pricing.lastUpdated,
                    newestUpdate: pricing.lastUpdated
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
                totalCostPerK: cheapest.inputPricePerK + cheapest.outputPricePerK
            },
            mostExpensiveModel: {
                modelId: mostExpensive.modelId,
                totalCostPerK: mostExpensive.inputPricePerK + mostExpensive.outputPricePerK
            },
            lastUpdated: new Date(),
            freshnessReport
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

        loggingService.info('Pricing sync enabled', {
            interval: this.syncConfig.intervalMs,
            providers: this.syncConfig.providers
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

        loggingService.info('Pricing sync disabled');
    }

    /**
     * Manually trigger pricing sync
     */
    private syncPricing(): void {
        loggingService.info('Starting pricing sync', {
            providers: this.syncConfig.providers
        });

        // This is a placeholder for actual provider API integration
        // In production, this would fetch latest pricing from provider APIs
        
        this.syncConfig.lastSync = new Date();

        loggingService.info('Pricing sync completed', {
            timestamp: this.syncConfig.lastSync
        });
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

