import { ModelPricing, PricingUnit } from '../pricing';

export const ANTHROPIC_PRICING: ModelPricing[] = [
    {
        modelId: 'claude-opus-4-1-20250805',
        modelName: 'Claude Opus 4.1',
        provider: 'Anthropic',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Most capable and intelligent Claude model yet - superior reasoning and advanced coding'
    },
    {
        modelId: 'claude-opus-4-20250514',
        modelName: 'Claude Opus 4',
        provider: 'Anthropic',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Previous flagship model with very high intelligence and capability'
    },
    {
        modelId: 'claude-sonnet-4-20250514',
        modelName: 'Claude Sonnet 4',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'High-performance model with exceptional reasoning and efficiency (1M context beta available)'
    },
    {
        modelId: 'claude-3-7-sonnet-20250219',
        modelName: 'Claude Sonnet 3.7',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'High-performance model with early extended thinking (Oct 2024 cutoff, 64k output)'
    },
    {
        modelId: 'claude-3-5-sonnet-20241022',
        modelName: 'Claude Sonnet 3.5 v2',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Upgraded Claude 3.5 Sonnet (Apr 2024 cutoff, 8k output)'
    },
    {
        modelId: 'claude-3-5-haiku-20241022',
        modelName: 'Claude Haiku 3.5',
        provider: 'Anthropic',
        inputPrice: 0.80,
        outputPrice: 4.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Fastest Claude model (July 2024 cutoff, 8k output)'
    },
    {
        modelId: 'claude-3-haiku-20240307',
        modelName: 'Claude Haiku 3',
        provider: 'Anthropic',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Fast and compact model (Aug 2023 cutoff, 4k output)'
    }
]; 