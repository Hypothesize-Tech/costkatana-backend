import { ModelPricing, PricingUnit } from '../pricing';

export const GOOGLE_PRICING: ModelPricing[] = [
    {
        modelId: 'gemini-1.5-flash',
        modelName: 'Gemini 1.5 Flash',
        provider: 'Google AI',
        inputPrice: 0.075,
        outputPrice: 0.30,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1000000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Gemini 1.5 Flash - fast and efficient'
    },
    {
        modelId: 'gemini-1.5-pro',
        modelName: 'Gemini 1.5 Pro',
        provider: 'Google AI',
        inputPrice: 3.50,
        outputPrice: 10.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1000000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Gemini 1.5 Pro - most capable model'
    },
    {
        modelId: 'gemini-1.5-flash-001',
        modelName: 'Gemini 1.5 Flash',
        provider: 'Google AI',
        inputPrice: 0.075,
        outputPrice: 0.30,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1000000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Gemini 1.5 Flash with 1M context window'
    },
    {
        modelId: 'gemini-1.5-pro-001',
        modelName: 'Gemini 1.5 Pro',
        provider: 'Google AI',
        inputPrice: 3.50,
        outputPrice: 10.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1000000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Gemini 1.5 Pro with 1M context window'
    },
    {
        modelId: 'gemini-1.0-pro',
        modelName: 'Gemini 1.0 Pro',
        provider: 'Google AI',
        inputPrice: 1.00,
        outputPrice: 2.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'Gemini 1.0 Pro model'
    },
    {
        modelId: 'gemini-1.0-pro-vision',
        modelName: 'Gemini 1.0 Pro Vision',
        provider: 'Google AI',
        inputPrice: 1.00,
        outputPrice: 2.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'Gemini 1.0 Pro Vision model'
    }
]; 