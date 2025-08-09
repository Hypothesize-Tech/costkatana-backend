import { ModelPricing, PricingUnit } from '../pricing';

export const MISTRAL_PRICING: ModelPricing[] = [
    {
        modelId: 'mistral.mistral-large-2402-v1:0',
        modelName: 'Mistral Large',
        provider: 'Mistral AI',
        inputPrice: 6.50,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Mistral Large model - most capable'
    },
    {
        modelId: 'mistral.mistral-small-2402-v1:0',
        modelName: 'Mistral Small',
        provider: 'Mistral AI',
        inputPrice: 2.00,
        outputPrice: 6.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Mistral Small model - fast and efficient'
    },
    {
        modelId: 'mistral.mixtral-8x7b-instruct-v0:1',
        modelName: 'Mixtral 8x7B Instruct',
        provider: 'Mistral AI',
        inputPrice: 0.14,
        outputPrice: 0.42,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: false,
        notes: 'Mixtral 8x7B Instruct model'
    },
    {
        modelId: 'mistral.mistral-7b-instruct-v0:2',
        modelName: 'Mistral 7B Instruct',
        provider: 'Mistral AI',
        inputPrice: 0.14,
        outputPrice: 0.42,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: false,
        notes: 'Mistral 7B Instruct model'
    }
]; 