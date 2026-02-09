import { ModelPricing, PricingUnit } from './types';

export const ANTHROPIC_PRICING: ModelPricing[] = [
    // === Claude 4.5 Series (Latest) ===
    {
        modelId: 'claude-sonnet-4-5-20250929',
        modelName: 'Claude Sonnet 4.5',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'coding', 'agents', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Claude Sonnet model with enhanced capabilities and 1M context window support (beta). Reliable knowledge cutoff: Jan 2025. Training data cutoff: Jul 2025. Max output: 64K tokens. Cached: $0.30. Batch: $1.50/$7.50',
    cachePricing: {
        cacheReadPrice: 0.30, // $0.30 per 1M cached tokens (90% discount)
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5 (Alias)',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'coding', 'agents', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for claude-sonnet-4-5-20250929 - automatically points to latest snapshot',
    cachePricing: {
        cacheReadPrice: 0.30,
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        modelName: 'Claude Sonnet 4.5 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Claude Sonnet 4.5 via AWS Bedrock - latest Claude Sonnet model with enhanced capabilities. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Jul 2025. Max output: 64K tokens',
    cachePricing: {
        cacheReadPrice: 0.30,
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'claude-haiku-4-5-20251001',
        modelName: 'Claude Haiku 4.5',
        provider: 'Anthropic',
        inputPrice: 1.00,
        outputPrice: 5.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'fast', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Claude Haiku model with improved performance and capabilities. Reliable knowledge cutoff: Feb 2025. Training data cutoff: Jul 2025. Max output: 64K tokens. Cached: $0.10. Batch: $0.50/$2.50',
    cachePricing: {
        cacheReadPrice: 0.10, // $0.10 per 1M cached tokens (90% discount)
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'claude-haiku-4-5',
        modelName: 'Claude Haiku 4.5 (Alias)',
        provider: 'Anthropic',
        inputPrice: 1.00,
        outputPrice: 5.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'fast', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for claude-haiku-4-5-20251001 - automatically points to latest snapshot',
    cachePricing: {
        cacheReadPrice: 0.10,
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
        modelName: 'Claude Haiku 4.5 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 1.00,
        outputPrice: 5.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Claude Haiku 4.5 via AWS Bedrock - latest Claude Haiku model. Reliable knowledge cutoff: Feb 2025. Training data cutoff: Jul 2025. Max output: 64K tokens'
    },
    {
        modelId: 'claude-opus-4-5-20251101',
        modelName: 'Claude Opus 4.5',
        provider: 'Anthropic',
        inputPrice: 5.00,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'premium', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Claude Opus model with enhanced capabilities. Reliable knowledge cutoff: May 2025. Training data cutoff: Aug 2025. Max output: 64K tokens. Cached: $0.50. Batch: $2.50/$12.50',
    cachePricing: {
        cacheReadPrice: 0.50, // $0.50 per 1M cached tokens (90% discount)
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'claude-opus-4-5',
        modelName: 'Claude Opus 4.5 (Alias)',
        provider: 'Anthropic',
        inputPrice: 5.00,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'premium', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for claude-opus-4-5-20251101 - automatically points to latest snapshot'
    },
    {
        modelId: 'anthropic.claude-opus-4-5-20251101-v1:0',
        modelName: 'Claude Opus 4.5 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 5.00,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Claude Opus 4.5 via AWS Bedrock - premium model combining maximum intelligence with practical performance. Reliable knowledge cutoff: May 2025. Training data cutoff: Aug 2025. Max output: 64K tokens'
    },
    {
        modelId: 'claude-opus-4-6-v1',
        modelName: 'Claude Opus 4.6',
        provider: 'Anthropic',
        inputPrice: 5.00,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Next-gen flagship for agents, coding, enterprise. Max 1M context (beta). Verify pricing on Bedrock.',
    cachePricing: {
        cacheReadPrice: 0.50,
        supportsCaching: true,
        minTokens: 1024,
        cacheType: 'explicit'
    }
    },
    {
        modelId: 'claude-opus-4-6',
        modelName: 'Claude Opus 4.6 (Alias)',
        provider: 'Anthropic',
        inputPrice: 5.00,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for claude-opus-4-6-v1'
    },
    {
        modelId: 'anthropic.claude-opus-4-6-v1',
        modelName: 'Claude Opus 4.6 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 5.00,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Claude Opus 4.6 on AWS Bedrock - next-gen flagship. Max 1M context (beta). Verify pricing on Bedrock.'
    },

    // === Claude 4 Series (Legacy) ===
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
        isLatest: false,
        notes: 'Legacy model - migrate to Claude Opus 4.5. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Mar 2025. Max output: 32K tokens. Cached: $1.50'
    },
    {
        modelId: 'anthropic.claude-opus-4-1-20250805-v1:0',
        modelName: 'Claude Opus 4.1 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Opus 4.1 via AWS Bedrock - legacy model, migrate to Claude Opus 4.5. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Mar 2025. Max output: 32K tokens'
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
        isLatest: false,
        notes: 'Legacy model - migrate to Claude Opus 4.5. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Mar 2025. Max output: 32K tokens. Cached: $1.50'
    },
    {
        modelId: 'anthropic.claude-opus-4-20250514-v1:0',
        modelName: 'Claude Opus 4 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Opus 4 via AWS Bedrock - legacy model, migrate to Claude Opus 4.5. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Mar 2025. Max output: 32K tokens'
    },
    {
        modelId: 'claude-sonnet-4-20250514',
        modelName: 'Claude Sonnet 4',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'coding', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Legacy model - migrate to Claude Sonnet 4.5. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Mar 2025. Max output: 64K tokens. 1M context beta available. Cached: $0.30'
    },
    {
        modelId: 'anthropic.claude-sonnet-4-20250514-v1:0',
        modelName: 'Claude Sonnet 4 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Sonnet 4 via AWS Bedrock - legacy model, migrate to Claude Sonnet 4.5. Reliable knowledge cutoff: Jan 2025. Training data cutoff: Mar 2025. Max output: 64K tokens. 1M context beta available'
    },

    // === Claude 3.7 Series (Deprecated) ===
    {
        modelId: 'claude-3-7-sonnet-20250219',
        modelName: 'Claude Sonnet 3.7',
        provider: 'Anthropic',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'coding', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'DEPRECATED - migrate to Claude Sonnet 4.5. Reliable knowledge cutoff: Oct 2024. Training data cutoff: Nov 2024. Max output: 64K tokens (128K tokens with beta header output-128k-2025-02-19). Cached: $0.30'
    },
    {
        modelId: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
        modelName: 'Claude Sonnet 3.7 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Sonnet 3.7 via AWS Bedrock - DEPRECATED, migrate to Claude Sonnet 4.5. Reliable knowledge cutoff: Oct 2024. Training data cutoff: Nov 2024. Max output: 64K tokens'
    },

    // === Claude 3.5 Series ===
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
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v1:0',
        modelName: 'Claude Sonnet 3.5 v2 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Sonnet 3.5 v2 via AWS Bedrock - upgraded version'
    },
    {
        modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        modelName: 'Claude Sonnet 3.5 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3.5 Sonnet via AWS Bedrock (previous version)'
    },
    {
        modelId: 'claude-3-5-haiku-20241022',
        modelName: 'Claude Haiku 3.5',
        provider: 'Anthropic',
        inputPrice: 0.80,
        outputPrice: 4.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'fast', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Legacy model - migrate to Claude Haiku 4.5. Training data cutoff: July 2024. Max output: 8K tokens. Cached: $0.08'
    },
    {
        modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
        modelName: 'Claude Haiku 3.5 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 0.80,
        outputPrice: 4.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Haiku 3.5 via AWS Bedrock - legacy model, migrate to Claude Haiku 4.5. Training data cutoff: July 2024. Max output: 8K tokens'
    },

    // === Claude 3 Series (Legacy) ===
    {
        modelId: 'anthropic.claude-3-opus-20240229-v1:0',
        modelName: 'Claude Opus 3 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Opus 3 via AWS Bedrock (legacy)'
    },
    {
        modelId: 'claude-3-haiku-20240307',
        modelName: 'Claude Haiku 3',
        provider: 'Anthropic',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'fast', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Legacy model - migrate to Claude Haiku 4.5. Training data cutoff: Aug 2023. Max output: 4K tokens. Cached: $0.03'
    },
    {
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        modelName: 'Claude Haiku 3 (Bedrock)',
        provider: 'AWS Bedrock',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Haiku 3 via AWS Bedrock - legacy model, migrate to Claude Haiku 4.5. Training data cutoff: Aug 2023. Max output: 4K tokens'
    }
]; 