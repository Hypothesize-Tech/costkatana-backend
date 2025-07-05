import { AIProvider, PricingUnit, ModelPricing } from '../types/aiCostTracker.types';

// Pricing data for different models and providers
export const PRICING_DATA: Record<string, ModelPricing> = {
    // OpenAI Models
    'gpt-4': {
        prompt: 0.03,
        completion: 0.06,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'GPT-4 standard pricing'
    },
    'gpt-4-turbo': {
        prompt: 0.01,
        completion: 0.03,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'GPT-4 Turbo pricing'
    },
    'gpt-4-turbo-preview': {
        prompt: 0.01,
        completion: 0.03,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'GPT-4 Turbo Preview pricing'
    },
    'gpt-3.5-turbo': {
        prompt: 0.0005,
        completion: 0.0015,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'GPT-3.5 Turbo pricing'
    },
    'gpt-3.5-turbo-16k': {
        prompt: 0.003,
        completion: 0.004,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'GPT-3.5 Turbo 16K pricing'
    },
    'text-davinci-003': {
        prompt: 0.02,
        completion: 0.02,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Legacy Davinci model'
    },
    'text-embedding-ada-002': {
        prompt: 0.0001,
        completion: 0,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Ada embeddings'
    },

    // AWS Bedrock Models
    'anthropic.claude-3-5-sonnet-20240620-v1:0': {
        prompt: 0.003,
        completion: 0.015,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude 3.5 Sonnet on Bedrock'
    },
    'anthropic.claude-3-sonnet-20240229-v1:0': {
        prompt: 0.003,
        completion: 0.015,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude 3 Sonnet on Bedrock'
    },
    'anthropic.claude-3-haiku-20240307-v1:0': {
        prompt: 0.00025,
        completion: 0.00125,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude 3 Haiku on Bedrock'
    },
    'anthropic.claude-instant-v1': {
        prompt: 0.0008,
        completion: 0.0024,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude Instant on Bedrock'
    },
    'anthropic.claude-v2:1': {
        prompt: 0.008,
        completion: 0.024,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude v2.1 on Bedrock'
    },
    'amazon.titan-text-express-v1': {
        prompt: 0.0008,
        completion: 0.0016,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Titan Text Express'
    },
    'amazon.titan-text-lite-v1': {
        prompt: 0.0003,
        completion: 0.0004,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Titan Text Lite'
    },

    // Anthropic Direct Models
    'claude-3-5-sonnet-20240620': {
        prompt: 0.003,
        completion: 0.015,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude 3.5 Sonnet direct'
    },
    'claude-3-sonnet-20240229': {
        prompt: 0.003,
        completion: 0.015,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude 3 Sonnet direct'
    },
    'claude-3-haiku-20240307': {
        prompt: 0.00025,
        completion: 0.00125,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Claude 3 Haiku direct'
    },

    // Google Models
    'gemini-pro': {
        prompt: 0.0005,
        completion: 0.0015,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Gemini Pro pricing'
    },
    'gemini-1.5-pro': {
        prompt: 0.0035,
        completion: 0.0105,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Gemini 1.5 Pro pricing'
    },
    'gemini-1.5-flash': {
        prompt: 0.000075,
        completion: 0.0003,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Gemini 1.5 Flash pricing'
    },

    // Cohere Models
    'command': {
        prompt: 0.0015,
        completion: 0.002,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Cohere Command pricing'
    },
    'command-light': {
        prompt: 0.0003,
        completion: 0.0006,
        unit: PricingUnit.PER_1K_TOKENS,
        notes: 'Cohere Command Light pricing'
    }
};

// Regional pricing adjustments
export const REGIONAL_PRICING_ADJUSTMENTS: Record<string, number> = {
    'us-east-1': 1.0,
    'us-west-2': 1.0,
    'eu-west-1': 1.1,
    'eu-central-1': 1.1,
    'ap-southeast-1': 1.15,
    'ap-northeast-1': 1.15,
    'default': 1.0
};

// Volume discounts (placeholder - would need actual provider-specific logic)
export const VOLUME_DISCOUNTS: Record<AIProvider, Array<{ threshold: number; discount: number }>> = {
    [AIProvider.OpenAI]: [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    [AIProvider.AWSBedrock]: [
        { threshold: 1000, discount: 0.03 },
        { threshold: 10000, discount: 0.08 },
        { threshold: 100000, discount: 0.12 }
    ],
    [AIProvider.Anthropic]: [
        { threshold: 1000, discount: 0.04 },
        { threshold: 10000, discount: 0.09 },
        { threshold: 100000, discount: 0.14 }
    ],
    [AIProvider.Google]: [
        { threshold: 1000, discount: 0.03 },
        { threshold: 10000, discount: 0.07 },
        { threshold: 100000, discount: 0.12 }
    ],
    [AIProvider.Cohere]: [
        { threshold: 1000, discount: 0.05 },
        { threshold: 10000, discount: 0.1 },
        { threshold: 100000, discount: 0.15 }
    ],
    [AIProvider.Gemini]: [],
    [AIProvider.DeepSeek]: [],
    [AIProvider.Groq]: [],
    [AIProvider.HuggingFace]: [],
    [AIProvider.Ollama]: [],
    [AIProvider.Replicate]: [],
    [AIProvider.Azure]: []
};

/**
 * Get pricing information for a specific model
 */
export function getPricingForModel(provider: AIProvider, modelId: string): ModelPricing | undefined {
    // First try exact match
    if (PRICING_DATA[modelId]) {
        return PRICING_DATA[modelId];
    }

    // Try provider-specific fallbacks
    const fallbackPricing: Record<AIProvider, ModelPricing> = {
        [AIProvider.OpenAI]: {
            prompt: 0.002,
            completion: 0.002,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default OpenAI pricing'
        },
        [AIProvider.AWSBedrock]: {
            prompt: 0.003,
            completion: 0.015,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Bedrock pricing'
        },
        [AIProvider.Anthropic]: {
            prompt: 0.008,
            completion: 0.024,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Anthropic pricing'
        },
        [AIProvider.Google]: {
            prompt: 0.0005,
            completion: 0.0015,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Google pricing'
        },
        [AIProvider.Cohere]: {
            prompt: 0.0015,
            completion: 0.002,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Cohere pricing'
        },
        [AIProvider.Gemini]: {
            prompt: 0.0005,
            completion: 0.0015,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Gemini pricing'
        },
        [AIProvider.DeepSeek]: {
            prompt: 0.0001,
            completion: 0.0002,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default DeepSeek pricing'
        },
        [AIProvider.Groq]: {
            prompt: 0.0001,
            completion: 0.0002,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Groq pricing'
        },
        [AIProvider.HuggingFace]: {
            prompt: 0.0005,
            completion: 0.001,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default HuggingFace pricing'
        },
        [AIProvider.Ollama]: {
            prompt: 0,
            completion: 0,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Local Ollama - no cost'
        },
        [AIProvider.Replicate]: {
            prompt: 0.001,
            completion: 0.002,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Replicate pricing'
        },
        [AIProvider.Azure]: {
            prompt: 0.002,
            completion: 0.002,
            unit: PricingUnit.PER_1K_TOKENS,
            notes: 'Default Azure OpenAI pricing'
        }
    };

    return fallbackPricing[provider];
}

/**
 * Calculate cost for a given number of tokens
 */
export function calculateCost(
    provider: AIProvider,
    model: string,
    promptTokens: number,
    completionTokens: number,
    region?: string
): number {
    const pricing = getPricingForModel(provider, model);
    if (!pricing) {
        return 0;
    }

    let promptCost = 0;
    let completionCost = 0;

    switch (pricing.unit) {
        case PricingUnit.PER_TOKEN:
            promptCost = promptTokens * pricing.prompt;
            completionCost = completionTokens * pricing.completion;
            break;
        case PricingUnit.PER_1K_TOKENS:
            promptCost = (promptTokens / 1000) * pricing.prompt;
            completionCost = (completionTokens / 1000) * pricing.completion;
            break;
        case PricingUnit.PER_1M_TOKENS:
            promptCost = (promptTokens / 1000000) * pricing.prompt;
            completionCost = (completionTokens / 1000000) * pricing.completion;
            break;
    }

    let totalCost = promptCost + completionCost;

    // Apply regional pricing adjustments
    if (region && REGIONAL_PRICING_ADJUSTMENTS[region]) {
        totalCost *= REGIONAL_PRICING_ADJUSTMENTS[region];
    } else if (region) {
        totalCost *= REGIONAL_PRICING_ADJUSTMENTS.default;
    }

    return totalCost;
}

/**
 * Estimate cost before making a request
 */
export function estimateCost(
    provider: AIProvider,
    model: string,
    promptTokens: number,
    expectedCompletionTokens: number = 150,
    region?: string
): {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    currency: string;
    breakdown: {
        promptTokens: number;
        completionTokens: number;
        pricePerPromptToken: number;
        pricePerCompletionToken: number;
    };
} {
    const pricing = getPricingForModel(provider, model);
    if (!pricing) {
        return {
            promptCost: 0,
            completionCost: 0,
            totalCost: 0,
            currency: 'USD',
            breakdown: {
                promptTokens,
                completionTokens: expectedCompletionTokens,
                pricePerPromptToken: 0,
                pricePerCompletionToken: 0
            }
        };
    }

    let pricePerPromptToken = pricing.prompt;
    let pricePerCompletionToken = pricing.completion;

    // Adjust for pricing unit
    switch (pricing.unit) {
        case PricingUnit.PER_1K_TOKENS:
            pricePerPromptToken = pricing.prompt / 1000;
            pricePerCompletionToken = pricing.completion / 1000;
            break;
        case PricingUnit.PER_1M_TOKENS:
            pricePerPromptToken = pricing.prompt / 1000000;
            pricePerCompletionToken = pricing.completion / 1000000;
            break;
    }

    const promptCost = promptTokens * pricePerPromptToken;
    const completionCost = expectedCompletionTokens * pricePerCompletionToken;
    let totalCost = promptCost + completionCost;

    // Apply regional pricing adjustments
    if (region && REGIONAL_PRICING_ADJUSTMENTS[region]) {
        totalCost *= REGIONAL_PRICING_ADJUSTMENTS[region];
    } else if (region) {
        totalCost *= REGIONAL_PRICING_ADJUSTMENTS.default;
    }

    return {
        promptCost,
        completionCost,
        totalCost,
        currency: 'USD',
        breakdown: {
            promptTokens,
            completionTokens: expectedCompletionTokens,
            pricePerPromptToken,
            pricePerCompletionToken
        }
    };
}

/**
 * Calculate monthly cost projection based on current usage
 */
export function estimateMonthlyCost(dailyCost: number): number {
    return dailyCost * 30;
}

/**
 * Compare costs between different models
 */
export function compareCosts(
    requests: Array<{
        provider: AIProvider;
        model: string;
        promptTokens: number;
        completionTokens: number;
    }>
): Array<{
    provider: AIProvider;
    model: string;
    cost: number;
    savings?: number;
    percentage?: number;
}> {
    const costs = requests.map(req => ({
        provider: req.provider,
        model: req.model,
        cost: calculateCost(req.provider, req.model, req.promptTokens, req.completionTokens)
    }));

    const minCost = Math.min(...costs.map(c => c.cost));

    return costs.map(cost => ({
        ...cost,
        savings: cost.cost - minCost,
        percentage: minCost > 0 ? ((cost.cost - minCost) / minCost) * 100 : 0
    }));
}

/**
 * Calculate ROI for optimization efforts
 */
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

    return {
        savings,
        roi,
        paybackPeriod
    };
}

/**
 * Format currency values
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 4,
        maximumFractionDigits: 6
    }).format(amount);
}

/**
 * Calculate economics of request batching
 */
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

    return {
        individualTotal,
        batchTotal,
        savings,
        savingsPercentage
    };
}

/**
 * Get regional pricing adjustment
 */
export function getRegionalPricing(basePrice: number, region: string): number {
    const adjustment = REGIONAL_PRICING_ADJUSTMENTS[region] || REGIONAL_PRICING_ADJUSTMENTS.default;
    return basePrice * adjustment;
}

/**
 * Calculate volume discount
 */
export function calculateVolumeDiscount(totalSpend: number, provider: AIProvider): number {
    const discounts = VOLUME_DISCOUNTS[provider] || [];

    let applicableDiscount = 0;
    for (const discount of discounts) {
        if (totalSpend >= discount.threshold) {
            applicableDiscount = discount.discount;
        }
    }

    return applicableDiscount;
} 