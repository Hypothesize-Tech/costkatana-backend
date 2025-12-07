/**
 * Pricing Registry Types
 * 
 * Types for centralized pricing management with dynamic sync capabilities.
 */

import { AIProviderType } from './aiProvider.types';

/**
 * Pricing Unit - How pricing is measured
 */
export type PricingUnit = 
    | 'per_1k_tokens'       // Per 1,000 tokens
    | 'per_1m_tokens'       // Per 1,000,000 tokens
    | 'per_token'           // Per token
    | 'per_request'         // Flat per request
    | 'per_character'       // Per character
    | 'per_1k_characters';  // Per 1,000 characters

/**
 * Pricing Tier - Volume-based pricing tiers
 */
export interface PricingTier {
    /** Minimum usage volume */
    minVolume: number;
    
    /** Maximum usage volume (undefined = unlimited) */
    maxVolume?: number;
    
    /** Input price at this tier */
    inputPrice: number;
    
    /** Output price at this tier */
    outputPrice: number;
}

/**
 * Model Pricing - Complete pricing information for a model
 */
export interface ModelPricing {
    /** Model identifier (matches ModelRegistry) */
    modelId: string;
    
    /** Provider */
    provider: AIProviderType;
    
    /** Input token price (normalized to per 1K tokens) */
    inputPricePerK: number;
    
    /** Output token price (normalized to per 1K tokens) */
    outputPricePerK: number;
    
    /** Original pricing unit from provider */
    originalUnit: PricingUnit;
    
    /** Cached input price (if different) */
    cachedInputPricePerK?: number;
    
    /** Currency (default: USD) */
    currency: string;
    
    /** Region-specific pricing */
    regionalPricing?: Record<string, {
        inputPricePerK: number;
        outputPricePerK: number;
    }>;
    
    /** Volume-based pricing tiers */
    pricingTiers?: PricingTier[];
    
    /** Minimum billable units */
    minBillableTokens?: number;
    
    /** Last updated timestamp */
    lastUpdated: Date;
    
    /** Data source */
    source: 'manual' | 'provider_api' | 'config' | 'estimated';
    
    /** Pricing notes */
    notes?: string;
}

/**
 * Cost Calculation Request
 */
export interface CostCalculationRequest {
    /** Model identifier */
    modelId: string;
    
    /** Input tokens */
    inputTokens: number;
    
    /** Output tokens */
    outputTokens: number;
    
    /** Whether input was cached */
    cachedInput?: boolean;
    
    /** Region (for regional pricing) */
    region?: string;
    
    /** Volume tier (for tiered pricing) */
    volumeTier?: number;
}

/**
 * Cost Calculation Result
 */
export interface CostCalculationResult {
    /** Model used for calculation */
    modelId: string;
    
    /** Provider */
    provider: AIProviderType;
    
    /** Input cost */
    inputCost: number;
    
    /** Output cost */
    outputCost: number;
    
    /** Total cost */
    totalCost: number;
    
    /** Currency */
    currency: string;
    
    /** Cache savings (if applicable) */
    cacheSavings?: number;
    
    /** Effective rate per 1K tokens */
    effectiveRatePerK: number;
    
    /** Pricing breakdown */
    breakdown: {
        inputTokens: number;
        outputTokens: number;
        inputPricePerK: number;
        outputPricePerK: number;
        cachedInputTokens?: number;
        cachedInputPricePerK?: number;
    };
}

/**
 * Cost Comparison - Compare costs across models
 */
export interface CostComparison {
    /** Models being compared */
    models: {
        modelId: string;
        displayName: string;
        cost: number;
        savings?: number;
        savingsPercent?: number;
    }[];
    
    /** Cheapest option */
    cheapest: string;
    
    /** Most expensive option */
    mostExpensive: string;
    
    /** Calculation parameters */
    parameters: {
        inputTokens: number;
        outputTokens: number;
    };
}

/**
 * Pricing Update Event
 */
export interface PricingUpdateEvent {
    /** Event type */
    type: 'price_change' | 'model_added' | 'model_removed';
    
    /** Model affected */
    modelId: string;
    
    /** Previous pricing (for changes) */
    previousPricing?: ModelPricing;
    
    /** New pricing */
    newPricing: ModelPricing;
    
    /** Timestamp */
    timestamp: Date;
    
    /** Change description */
    description?: string;
}

/**
 * Pricing Sync Configuration
 */
export interface PricingSyncConfig {
    /** Enable automatic sync */
    enabled: boolean;
    
    /** Sync interval (ms) */
    intervalMs: number;
    
    /** Providers to sync */
    providers: AIProviderType[];
    
    /** API endpoints for sync */
    endpoints?: Record<AIProviderType, string>;
    
    /** Last sync timestamp */
    lastSync?: Date;
}

/**
 * Pricing Registry Stats
 */
export interface PricingRegistryStats {
    /** Total models with pricing */
    totalModels: number;
    
    /** Models by provider */
    byProvider: Record<AIProviderType, number>;
    
    /** Average input cost (per 1K tokens) */
    avgInputCostPerK: number;
    
    /** Average output cost (per 1K tokens) */
    avgOutputCostPerK: number;
    
    /** Cheapest model */
    cheapestModel: {
        modelId: string;
        totalCostPerK: number;
    };
    
    /** Most expensive model */
    mostExpensiveModel: {
        modelId: string;
        totalCostPerK: number;
    };
    
    /** Last updated */
    lastUpdated: Date;
    
    /** Data freshness by source */
    freshnessReport: Record<string, {
        count: number;
        oldestUpdate: Date;
        newestUpdate: Date;
    }>;
}

/**
 * Budget Alert Threshold
 */
export interface BudgetAlertThreshold {
    /** Threshold ID */
    id: string;
    
    /** Cost limit */
    limitUSD: number;
    
    /** Time window */
    windowMs: number;
    
    /** Alert action */
    action: 'notify' | 'throttle' | 'block';
    
    /** Current usage */
    currentUsage: number;
    
    /** Percentage used */
    percentageUsed: number;
}

