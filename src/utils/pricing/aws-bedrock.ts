import { ModelPricing, PricingUnit } from '../pricing';

export const AWS_BEDROCK_PRICING: ModelPricing[] = [
    // AI21 Labs Models
    {
        modelId: 'ai21.jamba-1-5-large-v1:0',
        modelName: 'Jamba 1.5 Large',
        provider: 'AWS Bedrock',
        inputPrice: 2.0,
        outputPrice: 8.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 256000,
        capabilities: ['text', 'long-context'],
        category: 'text',
        isLatest: true,
        notes: 'AI21 Labs Jamba 1.5 Large on AWS Bedrock'
    },
    {
        modelId: 'ai21.jamba-1-5-mini-v1:0',
        modelName: 'Jamba 1.5 Mini',
        provider: 'AWS Bedrock',
        inputPrice: 0.2,
        outputPrice: 0.4,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 256000,
        capabilities: ['text', 'long-context', 'efficient'],
        category: 'text',
        isLatest: true,
        notes: 'AI21 Labs Jamba 1.5 Mini on AWS Bedrock'
    },
    {
        modelId: 'ai21.j2-mid-v1',
        modelName: 'Jurassic-2 Mid',
        provider: 'AWS Bedrock',
        inputPrice: 12.5,
        outputPrice: 12.5,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'AI21 Labs Jurassic-2 Mid on AWS Bedrock'
    },
    {
        modelId: 'ai21.j2-ultra-v1',
        modelName: 'Jurassic-2 Ultra',
        provider: 'AWS Bedrock',
        inputPrice: 18.8,
        outputPrice: 18.8,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'AI21 Labs Jurassic-2 Ultra on AWS Bedrock'
    },
    {
        modelId: 'ai21.jamba-instruct-v1:0',
        modelName: 'Jamba-Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.5,
        outputPrice: 0.7,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 256000,
        capabilities: ['text', 'instruct', 'long-context'],
        category: 'text',
        isLatest: true,
        notes: 'AI21 Labs Jamba-Instruct on AWS Bedrock'
    },

    // Amazon Nova Models
    {
        modelId: 'amazon.nova-micro-v1:0',
        modelName: 'Amazon Nova Micro',
        provider: 'AWS Bedrock',
        inputPrice: 0.035,
        outputPrice: 0.14,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'efficient', 'cache-read'],
        category: 'text',
        isLatest: true,
        notes: 'Amazon Nova Micro with cache read support ($0.00875/1M cache read tokens)'
    },
    {
        modelId: 'amazon.nova-lite-v1:0',
        modelName: 'Amazon Nova Lite',
        provider: 'AWS Bedrock',
        inputPrice: 0.06,
        outputPrice: 0.24,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 300000,
        capabilities: ['text', 'multimodal', 'cache-read'],
        category: 'text',
        isLatest: true,
        notes: 'Amazon Nova Lite with cache read support ($0.015/1M cache read tokens)'
    },
    {
        modelId: 'amazon.nova-pro-v1:0',
        modelName: 'Amazon Nova Pro',
        provider: 'AWS Bedrock',
        inputPrice: 0.15,
        outputPrice: 0.60,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 300000,
        capabilities: ['text', 'multimodal', 'cache-read'],
        category: 'text',
        isLatest: true,
        notes: 'Amazon Nova Pro with cache read support ($0.0375/1M cache read tokens)'
    },

    // Anthropic Models on AWS Bedrock
    {
        modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        modelName: 'Claude 3.5 Sonnet',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning'],
        category: 'text',
        isLatest: true,
        notes: 'Claude 3.5 Sonnet on AWS Bedrock'
    },
    {
        modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
        modelName: 'Claude 3.5 Haiku',
        provider: 'AWS Bedrock',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Claude 3.5 Haiku on AWS Bedrock'
    },
    {
        modelId: 'anthropic.claude-3-opus-20240229-v1:0',
        modelName: 'Claude 3 Opus',
        provider: 'AWS Bedrock',
        inputPrice: 15.00,
        outputPrice: 75.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal', 'reasoning'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3 Opus on AWS Bedrock'
    },
    {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        modelName: 'Claude 3 Sonnet',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3 Sonnet on AWS Bedrock'
    },
    {
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        modelName: 'Claude Haiku 3',
        provider: 'AWS Bedrock',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Claude Haiku 3 on AWS Bedrock'
    },

    // Cohere Models on AWS Bedrock
    {
        modelId: 'cohere.command-r-plus-v1:0',
        modelName: 'Command R+',
        provider: 'AWS Bedrock',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Cohere Command R+ on AWS Bedrock'
    },
    {
        modelId: 'cohere.command-r-v1:0',
        modelName: 'Command R',
        provider: 'AWS Bedrock',
        inputPrice: 0.50,
        outputPrice: 1.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Cohere Command R on AWS Bedrock'
    },
    {
        modelId: 'cohere.embed-english-v3',
        modelName: 'Embed English v3',
        provider: 'AWS Bedrock',
        inputPrice: 0.10,
        outputPrice: 0.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 512,
        capabilities: ['embedding'],
        category: 'embedding',
        isLatest: true,
        notes: 'Cohere Embed English v3 on AWS Bedrock'
    },
    {
        modelId: 'cohere.embed-multilingual-v3',
        modelName: 'Embed Multilingual v3',
        provider: 'AWS Bedrock',
        inputPrice: 0.10,
        outputPrice: 0.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 512,
        capabilities: ['embedding', 'multilingual'],
        category: 'embedding',
        isLatest: true,
        notes: 'Cohere Embed Multilingual v3 on AWS Bedrock'
    },

    // Meta Models on AWS Bedrock
    {
        modelId: 'meta.llama-3-70b-instruct-v1:0',
        modelName: 'Llama 3 70B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.59,
        outputPrice: 0.79,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3 70B Instruct on AWS Bedrock'
    },
    {
        modelId: 'meta.llama-3-8b-instruct-v1:0',
        modelName: 'Llama 3 8B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.05,
        outputPrice: 0.10,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3 8B Instruct on AWS Bedrock'
    },

    // Mistral AI Models on AWS Bedrock
    {
        modelId: 'mistral.mistral-7b-instruct-v0:2',
        modelName: 'Mistral 7B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.14,
        outputPrice: 0.42,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: false,
        notes: 'Mistral 7B Instruct on AWS Bedrock'
    },
    {
        modelId: 'mistral.mixtral-8x7b-instruct-v0:1',
        modelName: 'Mixtral 8x7B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.14,
        outputPrice: 0.42,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: false,
        notes: 'Mistral Mixtral 8x7B Instruct on AWS Bedrock'
    },
    {
        modelId: 'mistral.mistral-large-latest',
        modelName: 'Mistral Large',
        provider: 'AWS Bedrock',
        inputPrice: 6.50,
        outputPrice: 25.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Mistral Large on AWS Bedrock'
    },
    {
        modelId: 'mistral.mistral-small-latest',
        modelName: 'Mistral Small',
        provider: 'AWS Bedrock',
        inputPrice: 2.00,
        outputPrice: 6.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Mistral Small on AWS Bedrock'
    }
]; 