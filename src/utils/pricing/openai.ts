import { ModelPricing, PricingUnit } from '../pricing';

export const OPENAI_PRICING: ModelPricing[] = [
    {
        modelId: 'gpt-4o-mini-2024-07-18',
        modelName: 'GPT-4o Mini',
        provider: 'OpenAI',
        inputPrice: 0.15,
        outputPrice: 0.60,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Latest GPT-4o Mini model with vision capabilities'
    },
    {
        modelId: 'gpt-4o',
        modelName: 'GPT-4o',
        provider: 'OpenAI',
        inputPrice: 2.50,
        outputPrice: 10.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Latest GPT-4o model with enhanced capabilities'
    },
    {
        modelId: 'gpt-4o-mini',
        modelName: 'GPT-4o Mini',
        provider: 'OpenAI',
        inputPrice: 0.15,
        outputPrice: 0.60,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'GPT-4o Mini model with vision capabilities'
    },
    {
        modelId: 'gpt-4-turbo',
        modelName: 'GPT-4 Turbo',
        provider: 'OpenAI',
        inputPrice: 10.00,
        outputPrice: 30.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'GPT-4 Turbo with vision capabilities'
    },
    {
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        provider: 'OpenAI',
        inputPrice: 30.00,
        outputPrice: 60.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'GPT-4 base model'
    },
    {
        modelId: 'gpt-3.5-turbo',
        modelName: 'GPT-3.5 Turbo',
        provider: 'OpenAI',
        inputPrice: 0.50,
        outputPrice: 1.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 16385,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'GPT-3.5 Turbo model'
    },
    {
        modelId: 'gpt-4.1-2025-04-14',
        modelName: 'GPT-4.1',
        provider: 'OpenAI',
        inputPrice: 2.00,
        outputPrice: 8.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'analysis', 'reasoning'],
        category: 'text',
        isLatest: true,
        notes: 'Latest GPT-4.1 model with enhanced capabilities'
    }
]; 