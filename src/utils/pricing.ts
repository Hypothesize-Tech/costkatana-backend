import { loggingService } from '../services/logging.service';

import { ModelPricing, PricingUnit } from './pricing/types';
import { OPENAI_PRICING } from './pricing/openai';

// Re-export types for external use
export { ModelPricing, PricingUnit } from './pricing/types';
import { ANTHROPIC_PRICING } from './pricing/anthropic';
import { AWS_BEDROCK_PRICING } from './pricing/aws-bedrock';
import { GOOGLE_PRICING } from './pricing/google';
import { COHERE_PRICING } from './pricing/cohere';
import { MISTRAL_PRICING } from './pricing/mistral';
import { OTHERS_PRICING } from './pricing/others';
import { normalizeProvider } from './helpers';

export const MODEL_PRICING: ModelPricing[] = [
    ...OPENAI_PRICING,
    ...ANTHROPIC_PRICING,
    ...AWS_BEDROCK_PRICING,
    ...GOOGLE_PRICING,
    ...COHERE_PRICING,
    ...MISTRAL_PRICING,
    ...OTHERS_PRICING
];

export const REGIONAL_PRICING_ADJUSTMENTS: Record<string, number> = {
    'us-east-1': 1.0,
    'us-west-2': 1.0,
    'eu-west-1': 1.1,
    'eu-central-1': 1.1,
    'ap-southeast-1': 1.15,
    'ap-northeast-1': 1.15,
    'default': 1.0
};

export const VOLUME_DISCOUNTS: Record<string, Array<{ threshold: number; discount: number }>> = {
    'us-east-1': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    'us-west-2': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    'eu-west-1': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    'eu-central-1': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    'ap-southeast-1': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    'ap-northeast-1': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    'default': [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ]
};

export function normalizeModelName(model: string): string {
    let normalizedModel = model.toLowerCase();
    if (normalizedModel.startsWith('arn:aws:bedrock:')) {
        const arnParts = normalizedModel.split('/');
        if (arnParts.length > 1) {
            normalizedModel = arnParts[arnParts.length - 1];
        }
    }
    return normalizedModel
        .replace(/^(us|eu|ap-[a-z]+|ca-[a-z]+)\./, '')
        .replace(/-\d{8}-v\d+:\d+$/, '')
        .replace(/-\d{8}$/, '')
        .replace(/-\d{4}-\d{2}-\d{2}$/, '')
        .replace(/latest$/, '')
        .trim();
}

export function getModelNameVariations(model: string): string[] {
    const normalized = normalizeModelName(model);
    const variations = [normalized, model.toLowerCase()];
    if (normalized.includes('claude-3-5-haiku')) {
        variations.push('claude-3-5-haiku', 'claude-3-5-haiku-20241022-v1:0', 'anthropic.claude-3-5-haiku-20241022-v1:0', 'us.anthropic.claude-3-5-haiku-20241022-v1:0');
    }
    if (normalized.includes('claude-3-5-sonnet')) {
        variations.push('claude-3-5-sonnet', 'claude-3-5-sonnet-20241022-v1:0', 'anthropic.claude-sonnet-4-20250514-v1:0');
    }
    if (normalized.includes('claude-3-opus')) {
        variations.push('claude-3-opus', 'claude-3-opus-20240229-v1:0', 'anthropic.claude-3-opus-20240229-v1:0');
    }
    if (normalized.includes('claude-3-sonnet')) {
        variations.push('claude-3-sonnet', 'claude-3-sonnet-20240229-v1:0', 'anthropic.claude-3-sonnet-20240229-v1:0');
    }
    if (normalized.includes('claude-3-haiku')) {
        variations.push('claude-3-haiku', 'claude-3-5-haiku-20241022-v1:0', 'anthropic.claude-3-5-haiku-20241022-v1:0');
    }
    if (normalized.includes('command-a')) {
        variations.push('command-a', 'command-a-03-2025');
    }
    if (normalized.includes('command-r7b')) {
        variations.push('command-r7b', 'command-r7b-12-2024');
    }
    if (normalized.includes('command-r-plus')) {
        variations.push('command-r-plus', 'command-r-plus-04-2024');
    }
    if (normalized.includes('command-r')) {
        variations.push('command-r', 'command-r-08-2024', 'command-r-03-2024');
    }
    if (normalized.includes('gemini-2.5-pro')) {
        variations.push('gemini-2.5-pro', 'gemini-2.5-pro-2025');
    }
    if (normalized.includes('gemini-2.5-flash')) {
        variations.push('gemini-2.5-flash', 'gemini-2.5-flash-2025');
    }
    if (normalized.includes('gemini-2.0-flash')) {
        variations.push('gemini-2.0-flash', 'gemini-2.0-flash-2025');
    }
    if (normalized.includes('gemini-1.5-pro')) {
        variations.push('gemini-1.5-pro', 'gemini-1.5-pro-2024');
    }
    if (normalized.includes('gemini-1.5-flash')) {
        variations.push('gemini-1.5-flash', 'gemini-1.5-flash-2024');
    }
    if (normalized.includes('gemini-1.0-pro')) {
        variations.push('gemini-1.0-pro', 'gemini-pro', 'gemini-1.0-pro-2023');
    }
    if (normalized.includes('gemini-1.0-pro-vision')) {
        variations.push('gemini-1.0-pro-vision', 'gemini-pro-vision', 'gemini-1.0-pro-vision-2023');
    }
    if (normalized.includes('gemma')) {
        variations.push('gemma', 'gemma-2', 'gemma-3', 'gemma-3n');
    }
    if (normalized.includes('imagen')) {
        variations.push('imagen-3', 'imagen-4', 'imagen-generation', 'imagen-editing');
    }
    if (normalized.includes('veo')) {
        variations.push('veo-2', 'veo-3', 'veo-generation', 'veo-preview');
    }
    if (normalized.includes('mistral-medium')) {
        variations.push('mistral-medium', 'mistral-medium-2508', 'mistral-medium-latest');
    }
    if (normalized.includes('magistral-medium')) {
        variations.push('magistral-medium', 'magistral-medium-2507', 'magistral-medium-latest');
    }
    if (normalized.includes('codestral')) {
        variations.push('codestral', 'codestral-2508', 'codestral-latest');
    }
    if (normalized.includes('voxtral-mini')) {
        variations.push('voxtral-mini', 'voxtral-mini-2507', 'voxtral-mini-latest');
    }
    if (normalized.includes('devstral-medium')) {
        variations.push('devstral-medium', 'devstral-medium-2507', 'devstral-medium-latest');
    }
    if (normalized.includes('mistral-ocr')) {
        variations.push('mistral-ocr', 'mistral-ocr-2505', 'mistral-ocr-latest');
    }
    if (normalized.includes('mistral-large')) {
        variations.push('mistral-large', 'mistral-large-2411', 'mistral-large-latest');
    }
    if (normalized.includes('pixtral-large')) {
        variations.push('pixtral-large', 'pixtral-large-2411', 'pixtral-large-latest');
    }
    if (normalized.includes('mistral-small')) {
        variations.push('mistral-small', 'mistral-small-2506', 'mistral-small-2503', 'mistral-small-2501', 'mistral-small-2407');
    }
    if (normalized.includes('mistral-embed')) {
        variations.push('mistral-embed');
    }
    if (normalized.includes('codestral-embed')) {
        variations.push('codestral-embed', 'codestral-embed-2505');
    }
    if (normalized.includes('mistral-moderation')) {
        variations.push('mistral-moderation', 'mistral-moderation-2411', 'mistral-moderation-latest');
    }
    if (normalized.includes('magistral-small')) {
        variations.push('magistral-small', 'magistral-small-2507', 'magistral-small-latest');
    }
    if (normalized.includes('voxtral-small')) {
        variations.push('voxtral-small', 'voxtral-small-2507', 'voxtral-small-latest');
    }
    if (normalized.includes('devstral-small')) {
        variations.push('devstral-small', 'devstral-small-2507', 'devstral-small-latest', 'devstral-small-2505');
    }
    if (normalized.includes('pixtral-12b')) {
        variations.push('pixtral-12b', 'pixtral-12b-2409');
    }
    if (normalized.includes('open-mistral-nemo')) {
        variations.push('open-mistral-nemo', 'open-mistral-nemo-2407');
    }
    if (normalized.includes('mistral-nemo')) {
        variations.push('mistral-nemo');
    }
    if (normalized.includes('open-mistral-7b')) {
        variations.push('open-mistral-7b');
    }
    if (normalized.includes('open-mixtral-8x7b')) {
        variations.push('open-mixtral-8x7b');
    }
    if (normalized.includes('open-mixtral-8x22b')) {
        variations.push('open-mixtral-8x22b');
    }
    if (normalized.includes('grok-4')) {
        variations.push('grok-4', 'grok-4-0709', 'grok-4-latest');
    }
    if (normalized.includes('grok-3')) {
        variations.push('grok-3', 'grok-3-latest');
    }
    if (normalized.includes('grok-3-mini')) {
        variations.push('grok-3-mini', 'grok-3-mini-latest');
    }
    if (normalized.includes('grok-2-image')) {
        variations.push('grok-2-image', 'grok-2-image-1212', 'grok-2-image-latest');
    }
    if (normalized.includes('llama-4-scout')) {
        variations.push('llama-4-scout');
    }
    if (normalized.includes('llama-4-maverick')) {
        variations.push('llama-4-maverick');
    }
    if (normalized.includes('llama-4-behemoth')) {
        variations.push('llama-4-behemoth', 'llama-4-behemoth-preview');
    }
    return Array.from(new Set(variations));
}

export function calculateCost(
    inputTokens: number,
    outputTokens: number,
    provider: string,
    model: string
): number {
    if (!provider || !model) {
        loggingService.warn('Invalid provider or model in calculateCost', {
            provider,
            model,
            inputTokens,
            outputTokens
        });
        return 0;
    }
    let pricing = MODEL_PRICING.find(p =>
        p.provider.toLowerCase() === provider.toLowerCase() &&
        p.modelId.toLowerCase() === model.toLowerCase()
    );
    if (!pricing) {
        const modelVariations = getModelNameVariations(model);
        pricing = MODEL_PRICING.find(p => {
            const providerMatch = normalizeProvider(p.provider) === normalizeProvider(provider);
            const modelMatch = modelVariations.some(variant =>
                p.modelId.toLowerCase() === variant ||
                p.modelName.toLowerCase() === variant ||
                p.modelId.toLowerCase().includes(variant) ||
                p.modelName.toLowerCase().includes(variant) ||
                variant.includes(p.modelId.toLowerCase()) ||
                variant.includes(p.modelName.toLowerCase())
            );
            return providerMatch && modelMatch;
        });
    }
    
    if (!pricing && provider.toLowerCase().includes('bedrock')) {
        const normalizedModel = normalizeModelName(model);
        pricing = MODEL_PRICING.find(p => {
            const providerMatch = normalizeProvider(p.provider) === normalizeProvider(provider);
            const normalizedPricingModel = normalizeModelName(p.modelId);
            const normalizedPricingName = normalizeModelName(p.modelName);
            return providerMatch && (
                normalizedPricingModel === normalizedModel ||
                normalizedPricingName === normalizedModel ||
                normalizedPricingModel.includes(normalizedModel) ||
                normalizedPricingName.includes(normalizedModel) ||
                normalizedModel.includes(normalizedPricingModel) ||
                normalizedModel.includes(normalizedPricingName)
            );
        });
    }
    if (!pricing) {
        const availableModels = MODEL_PRICING
            .filter(p => p.provider.toLowerCase() === provider.toLowerCase())
            .map(p => `${p.modelId} (${p.modelName})`)
            .slice(0, 10);
        loggingService.warn('No pricing data found in calculateCost', {
            provider,
            model,
            inputTokens,
            outputTokens,
            availableModels
        });
        throw new Error(`No pricing data found for ${provider}/${model}`);
    }
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice;
    loggingService.info('Cost calculated', {
        provider,
        model,
        inputTokens,
        outputTokens,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost
    });
    return inputCost + outputCost;
}

export function estimateCost(
    inputTokens: number,
    outputTokens: number,
    provider: string,
    model: string
): { inputCost: number; outputCost: number; totalCost: number } {
    if (!provider || !model) {
        loggingService.warn('Invalid provider or model in estimateCost', {
            provider,
            model,
            inputTokens,
            outputTokens
        });
        return { inputCost: 0, outputCost: 0, totalCost: 0 };
    }
    let pricing = MODEL_PRICING.find(p =>
        p.provider.toLowerCase() === provider.toLowerCase() &&
        p.modelId.toLowerCase() === model.toLowerCase()
    );
    if (!pricing) {
        const modelVariations = getModelNameVariations(model);
        pricing = MODEL_PRICING.find(p => {
            const providerMatch = normalizeProvider(p.provider) === normalizeProvider(provider);
            const modelMatch = modelVariations.some(variant =>
                p.modelId.toLowerCase() === variant ||
                p.modelName.toLowerCase() === variant ||
                p.modelId.toLowerCase().includes(variant) ||
                p.modelName.toLowerCase().includes(variant) ||
                variant.includes(p.modelId.toLowerCase()) ||
                variant.includes(p.modelName.toLowerCase())
            );
            return providerMatch && modelMatch;
        });
    }
    if (!pricing && provider.toLowerCase().includes('bedrock')) {
        const normalizedModel = normalizeModelName(model);
        pricing = MODEL_PRICING.find(p => {
            const providerMatch = p.provider.toLowerCase() === provider.toLowerCase();
            const normalizedPricingModel = normalizeModelName(p.modelId);
            const normalizedPricingName = normalizeModelName(p.modelName);
            return providerMatch && (
                normalizedPricingModel === normalizedModel ||
                normalizedPricingName === normalizedModel ||
                normalizedPricingModel.includes(normalizedModel) ||
                normalizedPricingName.includes(normalizedModel) ||
                normalizedModel.includes(normalizedPricingModel) ||
                normalizedModel.includes(normalizedPricingName)
            );
        });
    }
    if (!pricing) {
        const availableModels = MODEL_PRICING
            .filter(p => p.provider.toLowerCase() === provider.toLowerCase())
            .map(p => `${p.modelId} (${p.modelName})`)
            .slice(0, 10);
        loggingService.warn('No pricing data found in estimateCost', {
            provider,
            model,
            inputTokens,
            outputTokens,
            availableModels
        });
        throw new Error(`No pricing data found for ${provider}/${model}`);
    }
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice;
    loggingService.info('Cost estimated', {
        provider,
        model,
        inputTokens,
        outputTokens,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost
    });
    return {
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost
    };
}

export function getModelPricing(provider: string, model: string): ModelPricing | null {
    let pricing = MODEL_PRICING.find(p =>
        p.provider.toLowerCase() === provider.toLowerCase() &&
        p.modelId.toLowerCase() === model.toLowerCase()
    );
    if (!pricing) {
        const modelVariations = getModelNameVariations(model);
        pricing = MODEL_PRICING.find(p => {
            const providerMatch = p.provider.toLowerCase() === provider.toLowerCase();
            const modelMatch = modelVariations.some(variant =>
                p.modelId.toLowerCase() === variant ||
                p.modelName.toLowerCase() === variant ||
                p.modelId.toLowerCase().includes(variant) ||
                p.modelName.toLowerCase().includes(variant) ||
                variant.includes(p.modelId.toLowerCase()) ||
                variant.includes(p.modelName.toLowerCase())
            );
            return providerMatch && modelMatch;
        });
    }
    if (!pricing && provider.toLowerCase().includes('bedrock')) {
        const normalizedModel = normalizeModelName(model);
        pricing = MODEL_PRICING.find(p => {
            const providerMatch = normalizeProvider(p.provider) === normalizeProvider(provider);
            const normalizedPricingModel = normalizeModelName(p.modelId);
            const normalizedPricingName = normalizeModelName(p.modelName);
            return providerMatch && (
                normalizedPricingModel === normalizedModel ||
                normalizedPricingName === normalizedModel ||
                normalizedPricingModel.includes(normalizedModel) ||
                normalizedPricingName.includes(normalizedModel) ||
                normalizedModel.includes(normalizedPricingModel) ||
                normalizedModel.includes(normalizedPricingName)
            );
        });
    }
    if (!pricing) {
        const availableModels = MODEL_PRICING
            .filter(p => p.provider.toLowerCase() === provider.toLowerCase())
            .map(p => `${p.modelId} (${p.modelName})`)
            .slice(0, 10);
        loggingService.warn('No pricing data found in getModelPricing', {
            provider,
            model,
            availableModels
        });
    }
    return pricing || null;
}

export function getProviderModels(provider: string): ModelPricing[] {
    const models = MODEL_PRICING.filter(p =>
        p.provider.toLowerCase() === provider.toLowerCase()
    ).sort((a, b) => {
        if (a.isLatest && !b.isLatest) return -1;
        if (!a.isLatest && b.isLatest) return 1;
        const aCost = a.inputPrice + a.outputPrice;
        const bCost = b.inputPrice + b.outputPrice;
        return aCost - bCost;
    });
    loggingService.info('Provider models fetched', {
        provider,
        count: models.length
    });
    return models;
}

export function getAllProviders(): string[] {
    const providers = Array.from(new Set(MODEL_PRICING.map(p => p.provider))).sort();
    loggingService.info('All providers fetched', {
        count: providers.length
    });
    return providers;
}

export function getModelsByCategory(category: string): ModelPricing[] {
    const models = MODEL_PRICING.filter(p =>
        p.category?.toLowerCase() === category.toLowerCase()
    ).sort((a, b) => {
        const aCost = a.inputPrice + a.outputPrice;
        const bCost = b.inputPrice + b.outputPrice;
        return aCost - bCost;
    });
    loggingService.info('Models by category fetched', {
        category,
        count: models.length
    });
    return models;
}

export function findCheapestModel(provider?: string, category?: string): ModelPricing | null {
    let models = MODEL_PRICING;
    if (provider) {
        models = models.filter(p => normalizeProvider(p.provider) === normalizeProvider(provider));
    }
    if (category) {
        models = models.filter(p => p.category?.toLowerCase() === category.toLowerCase());
    }
    if (models.length === 0) {
        loggingService.warn('No models found in findCheapestModel', { provider, category });
        return null;
    }
    const cheapest = models.reduce((cheapest, current) => {
        const cheapestCost = cheapest.inputPrice + cheapest.outputPrice;
        const currentCost = current.inputPrice + current.outputPrice;
        return currentCost < cheapestCost ? current : cheapest;
    });
    loggingService.info('Cheapest model found', {
        provider,
        category,
        modelId: cheapest.modelId,
        modelName: cheapest.modelName,
        cost: cheapest.inputPrice + cheapest.outputPrice
    });
    return cheapest;
}

export function compareProviders(
    inputTokens: number,
    outputTokens: number,
    providers?: string[]
): Array<{
    provider: string;
    model: string;
    cost: number;
    costBreakdown: { inputCost: number; outputCost: number };
    isLatest: boolean;
}> {
    let modelsToCompare = MODEL_PRICING;
    if (providers && providers.length > 0) {
        modelsToCompare = MODEL_PRICING.filter(p =>
            providers.some(provider =>
                normalizeProvider(p.provider) === normalizeProvider(provider)
            )
        );
    }
    const results = modelsToCompare.map(pricing => {
        const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice;
        const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice;
        return {
            provider: pricing.provider,
            model: pricing.modelName,
            cost: inputCost + outputCost,
            costBreakdown: { inputCost, outputCost },
            isLatest: pricing.isLatest || false
        };
    }).sort((a, b) => a.cost - b.cost);
    loggingService.info('Providers compared', {
        inputTokens,
        outputTokens,
        providers: providers || 'all',
        comparedCount: results.length
    });
    return results;
}

export const PRICING_METADATA = {
    lastUpdated: new Date().toISOString(),
    source: 'Modular Pricing System - July 2025',
    dataVersion: '2025.07',
    totalProviders: getAllProviders().length,
    totalModels: MODEL_PRICING.length,
    unit: PricingUnit.PER_1M_TOKENS,
    features: [
        'Modular pricing system with separate provider files',
        'Easy to maintain and update individual provider pricing',
        'Comprehensive model coverage across all major providers',
        'Latest pricing data for all providers'
    ]
};

export function estimateMonthlyCost(dailyCost: number): number {
    const monthly = dailyCost * 30;
    loggingService.info('Monthly cost estimated', { dailyCost, monthly });
    return monthly;
}

export function compareCosts(
    requests: Array<{
        provider: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
    }>
): Array<{
    provider: string;
    model: string;
    cost: number;
    savings?: number;
    percentage?: number;
}> {
    const costs = requests.map(req => ({
        provider: req.provider,
        model: req.model,
        cost: calculateCost(req.inputTokens, req.outputTokens, req.provider, req.model)
    }));
    const minCost = Math.min(...costs.map(c => c.cost));
    const result = costs.map(cost => ({
        ...cost,
        savings: cost.cost - minCost,
        percentage: minCost > 0 ? ((cost.cost - minCost) / minCost) * 100 : 0
    }));
    loggingService.info('Costs compared', {
        requestCount: requests.length,
        minCost,
        resultCount: result.length
    });
    return result;
}

export function calculateROI(
    originalCost: number,
    optimizedCost: number,
    implementationCost: number = 0
): {
    savings: number;
    roi: number;
    paybackPeriod: number;
} {
    const savings = originalCost - optimizedCost;
    const roi = implementationCost > 0 ? (savings / implementationCost) * 100 : Infinity;
    const paybackPeriod = implementationCost > 0 && savings > 0 ? implementationCost / savings : 0;
    loggingService.info('ROI calculated', {
        originalCost,
        optimizedCost,
        implementationCost,
        savings,
        roi,
        paybackPeriod
    });
    return {
        savings,
        roi,
        paybackPeriod
    };
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
    const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 4,
        maximumFractionDigits: 6
    }).format(amount);
    loggingService.debug('Currency formatted', { amount, currency, formatted });
    return formatted;
}

export function calculateBatchingEconomics(
    individualRequestCosts: number[],
    batchRequestCost: number,
    batchProcessingOverhead: number = 0.1
): {
    individualTotal: number;
    batchTotal: number;
    savings: number;
    savingsPercentage: number;
} {
    const individualTotal = individualRequestCosts.reduce((sum, cost) => sum + cost, 0);
    const batchTotal = batchRequestCost + (batchRequestCost * batchProcessingOverhead);
    const savings = individualTotal - batchTotal;
    const savingsPercentage = individualTotal > 0 ? (savings / individualTotal) * 100 : 0;
    loggingService.info('Batching economics calculated', {
        individualTotal,
        batchTotal,
        savings,
        savingsPercentage
    });
    return {
        individualTotal,
        batchTotal,
        savings,
        savingsPercentage
    };
}

export function getRegionalPricing(basePrice: number, region: string): number {
    const adjustment = REGIONAL_PRICING_ADJUSTMENTS[region] || REGIONAL_PRICING_ADJUSTMENTS.default;
    const adjusted = basePrice * adjustment;
    loggingService.debug('Regional pricing adjustment', { basePrice, region, adjustment, adjusted });
    return adjusted;
}

export function calculateVolumeDiscount(totalSpend: number, provider: string): number {
    const discounts = VOLUME_DISCOUNTS[provider] || [];
    let applicableDiscount = 0;
    for (const discount of discounts) {
        if (totalSpend >= discount.threshold) {
            applicableDiscount = discount.discount;
        }
    }
    loggingService.info('Volume discount calculated', {
        provider,
        totalSpend,
        applicableDiscount
    });
    return applicableDiscount;
} 