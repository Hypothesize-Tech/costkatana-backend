import { ModelPricing, PricingUnit } from '../pricing';

export const ANTHROPIC_PRICING: ModelPricing[] = [
    {
        modelId: 'claude-3-5-sonnet-20241022-v1:0',
        modelName: 'Claude 3.5 Sonnet',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Claude 3.5 Sonnet with enhanced reasoning capabilities'
    },
    {
        modelId: 'claude-3-5-haiku-20241022-v1:0',
        modelName: 'Claude 3.5 Haiku',
        provider: 'Anthropic',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Claude 3.5 Haiku - fast and efficient'
    },
    {
        modelId: 'claude-3-opus-20240229-v1:0',
        modelName: 'Claude 3 Opus',
        provider: 'Anthropic',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3 Opus - most capable model'
    },
    {
        modelId: 'claude-3-sonnet-20240229-v1:0',
        modelName: 'Claude 3 Sonnet',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3 Sonnet - balanced performance'
    },
    {
        modelId: 'claude-3-haiku-20240307-v1:0',
        modelName: 'Claude Haiku 3',
        provider: 'Anthropic',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Fast and compact, Aug 2023 cut-off'
    }
]; 