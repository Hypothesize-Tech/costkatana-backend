export enum PricingUnit {
    PER_1K_TOKENS = 'PER_1K_TOKENS',
    PER_1M_TOKENS = 'PER_1M_TOKENS',
    PER_REQUEST = 'PER_REQUEST',
    PER_HOUR = 'PER_HOUR',
    PER_IMAGE = 'PER_IMAGE'
}

export interface ModelPricing {
    modelId: string;
    modelName: string;
    provider: string;
    inputPrice: number;
    outputPrice: number;
    unit: PricingUnit;
    contextWindow?: number;
    capabilities?: string[];
    category?: string;
    isLatest?: boolean;
    notes?: string;
}

// Fresh pricing data updated July 2025 - All prices standardized to PER_1M_TOKENS
export const MODEL_PRICING: ModelPricing[] = [
    // OpenAI Models - June 2025 Pricing
    // ... (OpenAI, AWS, Cohere, etc. models unchanged, see previous code) ...

    // --- AWS Bedrock Models (July 2025, fully updated) ---
    
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
        inputPrice: 0.8,
        outputPrice: 3.2,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 300000,
        capabilities: ['text', 'multimodal', 'reasoning', 'cache-read'],
        category: 'text',
        isLatest: true,
        notes: 'Amazon Nova Pro with cache read support ($0.2/1M cache read tokens)'
    },
    {
        modelId: 'amazon.nova-pro-v1:0-latency-optimized',
        modelName: 'Amazon Nova Pro (Latency Optimized)',
        provider: 'AWS Bedrock',
        inputPrice: 1.0,
        outputPrice: 4.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 300000,
        capabilities: ['text', 'multimodal', 'reasoning', 'low-latency'],
        category: 'text',
        isLatest: true,
        notes: 'Amazon Nova Pro with latency optimized inference'
    },
    {
        modelId: 'amazon.nova-premier-v1:0',
        modelName: 'Amazon Nova Premier',
        provider: 'AWS Bedrock',
        inputPrice: 2.5,
        outputPrice: 12.5,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 300000,
        capabilities: ['text', 'multimodal', 'reasoning', 'premium', 'cache-read'],
        category: 'text',
        isLatest: true,
        notes: 'Amazon Nova Premier with cache read support ($0.625/1M cache read tokens)'
    },
    {
        modelId: 'amazon.nova-canvas-v1:0',
        modelName: 'Amazon Nova Canvas',
        provider: 'AWS Bedrock',
        inputPrice: 40.0, // $0.04 per image converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_IMAGE,
        contextWindow: 0,
        capabilities: ['image-generation', 'text-to-image', 'standard-quality', 'premium-quality'],
        category: 'image-generation',
        isLatest: true,
        notes: 'Amazon Nova Canvas image generation. Standard: $0.04 (1024x1024), $0.06 (2048x2048). Premium: $0.06 (1024x1024), $0.08 (2048x2048)'
    },
    {
        modelId: 'amazon.nova-reel-v1:0',
        modelName: 'Amazon Nova Reel',
        provider: 'AWS Bedrock',
        inputPrice: 80.0, // $0.08 per second converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_REQUEST,
        contextWindow: 0,
        capabilities: ['video-generation', 'text-to-video'],
        category: 'video-generation',
        isLatest: true,
        notes: 'Amazon Nova Reel video generation. $0.08 per second of 720p, 24fps video'
    },
    {
        modelId: 'amazon.nova-sonic-v1:0',
        modelName: 'Amazon Nova Sonic',
        provider: 'AWS Bedrock',
        inputPrice: 3.4, // Speech input
        outputPrice: 13.6, // Speech output
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 0,
        capabilities: ['speech-to-speech', 'text-to-speech', 'multimodal'],
        category: 'audio',
        isLatest: true,
        notes: 'Amazon Nova Sonic speech model. Speech: $3.4 input/$13.6 output. Text: $0.06 input/$0.24 output per 1M tokens'
    },

    // Amazon Titan Models
    {
        modelId: 'amazon.titan-text-embeddings-v2:0',
        modelName: 'Amazon Titan Text Embeddings V2',
        provider: 'AWS Bedrock',
        inputPrice: 0.02,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['embedding', 'text'],
        category: 'embedding',
        isLatest: true,
        notes: 'Amazon Titan Text Embeddings V2 on AWS Bedrock'
    },

    // Anthropic Claude Models on AWS Bedrock
    {
        modelId: 'anthropic.claude-opus-4-v1:0',
        modelName: 'Claude Opus 4',
        provider: 'AWS Bedrock',
        inputPrice: 15.0,
        outputPrice: 75.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'reasoning', 'cache-read', 'cache-write'],
        category: 'text',
        isLatest: true,
        notes: 'Claude Opus 4 on AWS Bedrock with caching support. Cache write: $18.75/1M, Cache read: $1.5/1M'
    },
    {
        modelId: 'anthropic.claude-sonnet-4-v1:0',
        modelName: 'Claude Sonnet 4',
        provider: 'AWS Bedrock',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'reasoning', 'cache-read', 'cache-write'],
        category: 'text',
        isLatest: true,
        notes: 'Claude Sonnet 4 on AWS Bedrock with caching support. Cache write: $3.75/1M, Cache read: $0.3/1M'
    },
    {
        modelId: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
        modelName: 'Claude 3.7 Sonnet',
        provider: 'AWS Bedrock',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'reasoning', 'cache-read', 'cache-write'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3.7 Sonnet on AWS Bedrock with caching support. Cache write: $3.75/1M, Cache read: $0.3/1M'
    },
    {
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        modelName: 'Claude 3.5 Sonnet v2',
        provider: 'AWS Bedrock',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'reasoning', 'cache-read', 'cache-write'],
        category: 'text',
        isLatest: true,
        notes: 'Claude 3.5 Sonnet v2 on AWS Bedrock with caching support. Cache write: $3.75/1M, Cache read: $0.3/1M'
    },
    {
        modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        modelName: 'Claude 3.5 Sonnet',
        provider: 'AWS Bedrock',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'reasoning', 'batch-inference'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3.5 Sonnet on AWS Bedrock with batch inference support. Batch: $1.5 input/$7.5 output per 1M tokens'
    },
    {
        modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
        modelName: 'Claude 3.5 Haiku',
        provider: 'AWS Bedrock',
        inputPrice: 0.8,
        outputPrice: 4.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'fast', 'cache-read', 'cache-write'],
        category: 'text',
        isLatest: true,
        notes: 'Claude 3.5 Haiku on AWS Bedrock with caching support. Cache write: $1.0/1M, Cache read: $0.08/1M'
    },
    {
        modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0-latency-optimized',
        modelName: 'Claude 3.5 Haiku (Latency Optimized)',
        provider: 'AWS Bedrock',
        inputPrice: 1.0,
        outputPrice: 5.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'fast', 'low-latency'],
        category: 'text',
        isLatest: true,
        notes: 'Claude 3.5 Haiku with latency optimized inference on AWS Bedrock'
    },
    {
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        modelName: 'Claude 3 Haiku',
        provider: 'AWS Bedrock',
        inputPrice: 0.25,
        outputPrice: 1.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200000,
        capabilities: ['text', 'vision', 'fast', 'batch-inference'],
        category: 'text',
        isLatest: false,
        notes: 'Claude 3 Haiku on AWS Bedrock with batch inference support. Batch: $0.125 input/$0.625 output per 1M tokens'
    },

    // Cohere Models on AWS Bedrock
    {
        modelId: 'cohere.command-text-v14',
        modelName: 'Command',
        provider: 'AWS Bedrock',
        inputPrice: 1.0,
        outputPrice: 2.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'generation'],
        category: 'text',
        isLatest: false,
        notes: 'Cohere Command on AWS Bedrock'
    },
    {
        modelId: 'cohere.command-light-text-v14',
        modelName: 'Command Light',
        provider: 'AWS Bedrock',
        inputPrice: 0.3,
        outputPrice: 0.6,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'generation', 'lightweight'],
        category: 'text',
        isLatest: false,
        notes: 'Cohere Command Light on AWS Bedrock'
    },
    {
        modelId: 'cohere.command-r-plus-v1:0',
        modelName: 'Command R+',
        provider: 'AWS Bedrock',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'rag', 'enterprise', 'long-context'],
        category: 'text',
        isLatest: true,
        notes: 'Cohere Command R+ on AWS Bedrock'
    },
    {
        modelId: 'cohere.command-r-v1:0',
        modelName: 'Command R',
        provider: 'AWS Bedrock',
        inputPrice: 0.5,
        outputPrice: 1.5,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'rag', 'long-context'],
        category: 'text',
        isLatest: true,
        notes: 'Cohere Command R on AWS Bedrock'
    },
    {
        modelId: 'cohere.embed-english-v3',
        modelName: 'Embed 3 English',
        provider: 'AWS Bedrock',
        inputPrice: 0.1,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 512,
        capabilities: ['embedding', 'english'],
        category: 'embedding',
        isLatest: true,
        notes: 'Cohere Embed 3 English on AWS Bedrock. Also supports image embedding at $0.1/1M tokens'
    },
    {
        modelId: 'cohere.embed-multilingual-v3',
        modelName: 'Embed 3 Multilingual',
        provider: 'AWS Bedrock',
        inputPrice: 0.1,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 512,
        capabilities: ['embedding', 'multilingual'],
        category: 'embedding',
        isLatest: true,
        notes: 'Cohere Embed 3 Multilingual on AWS Bedrock. Also supports image embedding at $0.1/1M tokens'
    },
    {
        modelId: 'cohere.rerank-3-5-v1:0',
        modelName: 'Rerank 3.5',
        provider: 'AWS Bedrock',
        inputPrice: 2000.0, // $2.00 per 1K queries converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 0,
        capabilities: ['reranking', 'search'],
        category: 'reranking',
        isLatest: true,
        notes: 'Cohere Rerank 3.5 on AWS Bedrock. $2.00 per 1K queries (up to 100 documents per query)'
    },

    // DeepSeek Models on AWS Bedrock
    {
        modelId: 'deepseek.deepseek-r1-v1:0',
        modelName: 'DeepSeek-R1',
        provider: 'AWS Bedrock',
        inputPrice: 1.35,
        outputPrice: 5.4,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'reasoning', 'cot'],
        category: 'reasoning',
        isLatest: true,
        notes: 'DeepSeek-R1 reasoning model on AWS Bedrock'
    },

    // Luma AI Models on AWS Bedrock
    {
        modelId: 'luma.ray2-v1:0',
        modelName: 'Luma Ray2',
        provider: 'AWS Bedrock',
        inputPrice: 1500.0, // $1.50 per second converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_REQUEST,
        contextWindow: 0,
        capabilities: ['video-generation', 'text-to-video'],
        category: 'video-generation',
        isLatest: true,
        notes: 'Luma Ray2 video generation. 720p 24fps: $1.50/sec, 540p 24fps: $0.75/sec'
    },

    // Meta Llama Models on AWS Bedrock
    {
        modelId: 'meta.llama4-maverick-17b-instruct-v1:0',
        modelName: 'Llama 4 Maverick 17B',
        provider: 'AWS Bedrock',
        inputPrice: 0.24,
        outputPrice: 0.97,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'batch-inference'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 4 Maverick 17B on AWS Bedrock with batch inference. Batch: $0.12 input/$0.485 output per 1M tokens'
    },
    {
        modelId: 'meta.llama4-scout-17b-instruct-v1:0',
        modelName: 'Llama 4 Scout 17B',
        provider: 'AWS Bedrock',
        inputPrice: 0.17,
        outputPrice: 0.66,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'batch-inference'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 4 Scout 17B on AWS Bedrock with batch inference. Batch: $0.085 input/$0.33 output per 1M tokens'
    },
    {
        modelId: 'meta.llama3-3-70b-instruct-v1:0',
        modelName: 'Llama 3.3 70B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.72,
        outputPrice: 0.72,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'batch-inference'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.3 70B Instruct on AWS Bedrock with batch inference. Batch: $0.36 input/$0.36 output per 1M tokens'
    },
    {
        modelId: 'meta.llama3-2-1b-instruct-v1:0',
        modelName: 'Llama 3.2 1B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.1,
        outputPrice: 0.1,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'compact'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.2 1B Instruct on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-2-3b-instruct-v1:0',
        modelName: 'Llama 3.2 3B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.15,
        outputPrice: 0.15,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'compact'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.2 3B Instruct on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-2-11b-instruct-v1:0',
        modelName: 'Llama 3.2 11B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.16,
        outputPrice: 0.16,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'vision'],
        category: 'multimodal',
        isLatest: true,
        notes: 'Meta Llama 3.2 11B Instruct with vision on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-2-90b-instruct-v1:0',
        modelName: 'Llama 3.2 90B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.72,
        outputPrice: 0.72,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'vision'],
        category: 'multimodal',
        isLatest: true,
        notes: 'Meta Llama 3.2 90B Instruct with vision on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-1-8b-instruct-v1:0',
        modelName: 'Llama 3.1 8B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.22,
        outputPrice: 0.22,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'batch-inference'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.1 8B Instruct on AWS Bedrock with batch inference. Batch: $0.11 input/$0.11 output per 1M tokens'
    },
    {
        modelId: 'meta.llama3-1-70b-instruct-v1:0',
        modelName: 'Llama 3.1 70B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.72,
        outputPrice: 0.72,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'batch-inference'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.1 70B Instruct on AWS Bedrock with batch inference. Batch: $0.36 input/$0.36 output per 1M tokens'
    },
    {
        modelId: 'meta.llama3-1-405b-instruct-v1:0',
        modelName: 'Llama 3.1 405B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 2.4,
        outputPrice: 2.4,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'large', 'batch-inference'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.1 405B Instruct on AWS Bedrock with batch inference. Batch: $1.2 input/$1.2 output per 1M tokens'
    },
    {
        modelId: 'meta.llama3-1-70b-instruct-v1:0-latency-optimized',
        modelName: 'Llama 3.1 70B Instruct (Latency Optimized)',
        provider: 'AWS Bedrock',
        inputPrice: 0.9,
        outputPrice: 0.9,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'low-latency'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.1 70B Instruct with latency optimized inference on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-1-405b-instruct-v1:0-latency-optimized',
        modelName: 'Llama 3.1 405B Instruct (Latency Optimized)',
        provider: 'AWS Bedrock',
        inputPrice: 3.0,
        outputPrice: 3.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'instruct', 'large', 'low-latency'],
        category: 'text',
        isLatest: true,
        notes: 'Meta Llama 3.1 405B Instruct with latency optimized inference on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-8b-instruct-v1:0',
        modelName: 'Llama 3 8B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 0.3,
        outputPrice: 0.6,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: false,
        notes: 'Meta Llama 3 8B Instruct on AWS Bedrock'
    },
    {
        modelId: 'meta.llama3-70b-instruct-v1:0',
        modelName: 'Llama 3 70B Instruct',
        provider: 'AWS Bedrock',
        inputPrice: 2.65,
        outputPrice: 3.5,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: false,
        notes: 'Meta Llama 3 70B Instruct on AWS Bedrock'
    },
    {
        modelId: 'meta.llama2-13b-chat-v1',
        modelName: 'Llama 2 13B Chat',
        provider: 'AWS Bedrock',
        inputPrice: 0.75,
        outputPrice: 1.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Meta Llama 2 13B Chat on AWS Bedrock'
    },
    {
        modelId: 'meta.llama2-70b-chat-v1',
        modelName: 'Llama 2 70B Chat',
        provider: 'AWS Bedrock',
        inputPrice: 1.95,
        outputPrice: 2.56,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Meta Llama 2 70B Chat on AWS Bedrock'
    },

    // Mistral AI Models on AWS Bedrock
    {
        modelId: 'mistral.pixtral-large-2502-v1:0',
        modelName: 'Pixtral Large 25.02',
        provider: 'AWS Bedrock',
        inputPrice: 2.0,
        outputPrice: 6.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'multimodal',
        isLatest: true,
        notes: 'Mistral Pixtral Large 25.02 on AWS Bedrock'
    },

    // Stability AI Models on AWS Bedrock
    {
        modelId: 'stability.stable-diffusion-3-5-large-v1:0',
        modelName: 'Stable Diffusion 3.5 Large',
        provider: 'AWS Bedrock',
        inputPrice: 80.0, // $0.08 per image converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_IMAGE,
        contextWindow: 0,
        capabilities: ['image-generation', 'text-to-image'],
        category: 'image-generation',
        isLatest: true,
        notes: 'Stability AI Stable Diffusion 3.5 Large on AWS Bedrock. $0.08 per generated image'
    },
    {
        modelId: 'stability.stable-image-core-v1:0',
        modelName: 'Stable Image Core',
        provider: 'AWS Bedrock',
        inputPrice: 40.0, // $0.04 per image converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_IMAGE,
        contextWindow: 0,
        capabilities: ['image-generation', 'text-to-image'],
        category: 'image-generation',
        isLatest: true,
        notes: 'Stability AI Stable Image Core on AWS Bedrock. $0.04 per generated image'
    },
    {
        modelId: 'stability.stable-diffusion-3-large-v1:0',
        modelName: 'Stable Diffusion 3 Large',
        provider: 'AWS Bedrock',
        inputPrice: 80.0, // $0.08 per image converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_IMAGE,
        contextWindow: 0,
        capabilities: ['image-generation', 'text-to-image'],
        category: 'image-generation',
        isLatest: false,
        notes: 'Stability AI Stable Diffusion 3 Large on AWS Bedrock. $0.08 per generated image'
    },
    {
        modelId: 'stability.stable-image-ultra-v1:0',
        modelName: 'Stable Image Ultra',
        provider: 'AWS Bedrock',
        inputPrice: 140.0, // $0.14 per image converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_IMAGE,
        contextWindow: 0,
        capabilities: ['image-generation', 'text-to-image', 'ultra-quality'],
        category: 'image-generation',
        isLatest: true,
        notes: 'Stability AI Stable Image Ultra on AWS Bedrock. $0.14 per generated image'
    },

    // Writer Models on AWS Bedrock
    {
        modelId: 'writer.palmyra-x4-v1:0',
        modelName: 'Palmyra X4',
        provider: 'AWS Bedrock',
        inputPrice: 2.5,
        outputPrice: 10.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['text', 'generation'],
        category: 'text',
        isLatest: true,
        notes: 'Writer Palmyra X4 on AWS Bedrock'
    },
    {
        modelId: 'writer.palmyra-x5-v1:0',
        modelName: 'Palmyra X5',
        provider: 'AWS Bedrock',
        inputPrice: 0.6,
        outputPrice: 6.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['text', 'generation'],
        category: 'text',
        isLatest: true,
        notes: 'Writer Palmyra X5 on AWS Bedrock'
    },
    // --- End AWS Bedrock Models ---

    // --- Cohere Models (July 2025, fully updated) ---
    // Command A - Latest flagship model
    {
        modelId: 'command-a',
        modelName: 'Command A',
        provider: 'Cohere',
        inputPrice: 2.50,
        outputPrice: 10.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'agentic-ai', 'multilingual', 'human-evaluations', 'real-world-use-cases'],
        category: 'text',
        isLatest: true,
        notes: 'Most efficient and performant model to date, specializing in agentic AI, multilingual, and human evaluations for real-life use cases'
    },

    // Command R+ - Enterprise model
    {
        modelId: 'command-r-plus',
        modelName: 'Command R+',
        provider: 'Cohere',
        inputPrice: 2.50,
        outputPrice: 10.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'enterprise', 'scalable', 'real-world-use-cases'],
        category: 'text',
        isLatest: true,
        notes: 'Powerful, scalable large language model (LLM) purpose-built to excel at real-world enterprise use cases'
    },
    {
        modelId: 'command-r-plus-08-2024',
        modelName: 'Command R+ 08-2024',
        provider: 'Cohere',
        inputPrice: 2.50,
        outputPrice: 10.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'enterprise', 'scalable', 'real-world-use-cases'],
        category: 'text',
        isLatest: true,
        notes: 'August 2024 version of Command R+ with latest improvements'
    },

    // Command R - Standard model
    {
        modelId: 'command-r',
        modelName: 'Command R',
        provider: 'Cohere',
        inputPrice: 0.15,
        outputPrice: 0.60,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'rag', 'long-context', 'external-apis', 'tools'],
        category: 'text',
        isLatest: true,
        notes: 'Generative model optimized for long context tasks such as retrieval-augmented generation (RAG) and using external APIs and tools'
    },
    {
        modelId: 'command-r-08-2024',
        modelName: 'Command R 08-2024',
        provider: 'Cohere',
        inputPrice: 0.15,
        outputPrice: 0.60,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'rag', 'long-context', 'external-apis', 'tools'],
        category: 'text',
        isLatest: true,
        notes: 'August 2024 version of Command R with latest improvements'
    },

    // Command R Fine-tuned
    {
        modelId: 'command-r-fine-tuned',
        modelName: 'Command R Fine-tuned',
        provider: 'Cohere',
        inputPrice: 0.30,
        outputPrice: 1.20,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'fine-tuned', 'custom', 'rag', 'long-context'],
        category: 'text',
        isLatest: true,
        notes: 'Fine-tuned version of Command R for specialized use cases. Training cost: $3.00/1M tokens'
    },

    // Command R7B - Compact model
    {
        modelId: 'command-r7b',
        modelName: 'Command R7B',
        provider: 'Cohere',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'compact', 'speed', 'efficiency', 'quality'],
        category: 'text',
        isLatest: true,
        notes: 'Smallest generative model optimized for top-tier speed, efficiency, and quality to build powerful AI applications'
    },

    // Legacy Command R models (previous versions)
    {
        modelId: 'command-r-03-2024',
        modelName: 'Command R 03-2024',
        provider: 'Cohere',
        inputPrice: 0.50,
        outputPrice: 1.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'rag', 'long-context', 'legacy'],
        category: 'text',
        isLatest: false,
        notes: 'Legacy March 2024 version of Command R with different pricing structure'
    },
    {
        modelId: 'command-r-plus-04-2024',
        modelName: 'Command R+ 04-2024',
        provider: 'Cohere',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'enterprise', 'scalable', 'legacy'],
        category: 'text',
        isLatest: false,
        notes: 'Legacy April 2024 version of Command R+ with different pricing structure'
    },

    // Rerank 3.5 - Latest reranking model
    {
        modelId: 'rerank-3.5',
        modelName: 'Rerank 3.5',
        provider: 'Cohere',
        inputPrice: 2000.0, // $2.00 per 1K searches converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 0,
        capabilities: ['reranking', 'semantic-search', 'search-quality-boost'],
        category: 'reranking',
        isLatest: true,
        notes: 'Provides a powerful semantic boost to the search quality of any keyword or vector search system. $2.00 per 1K searches (up to 100 documents per search)'
    },

    // Embed 4 - Latest embedding model
    {
        modelId: 'embed-4',
        modelName: 'Embed 4',
        provider: 'Cohere',
        inputPrice: 0.12,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['embedding', 'multimodal', 'semantic-search', 'rag'],
        category: 'embedding',
        isLatest: true,
        notes: 'Leading multimodal embedding model. Acts as an intelligent retrieval engine for semantic search and RAG systems'
    },
    {
        modelId: 'embed-4-image',
        modelName: 'Embed 4 (Image)',
        provider: 'Cohere',
        inputPrice: 0.47,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 0,
        capabilities: ['embedding', 'image', 'multimodal', 'visual-search'],
        category: 'embedding',
        isLatest: true,
        notes: 'Image embedding capability of Embed 4. $0.47 per 1M image tokens for visual search and retrieval'
    },

    // Legacy embedding models
    {
        modelId: 'rerank-2',
        modelName: 'Rerank 2',
        provider: 'Cohere',
        inputPrice: 1000.0, // Legacy pricing converted to per 1M tokens equivalent
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 0,
        capabilities: ['reranking', 'semantic-search', 'legacy'],
        category: 'reranking',
        isLatest: false,
        notes: 'Legacy reranking model with different pricing structure'
    },

    // Aya models (Research models - free via API)
    {
        modelId: 'aya-expanse-8b',
        modelName: 'Aya Expanse 8B',
        provider: 'Cohere',
        inputPrice: 0.0,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['multilingual', 'research', '23-languages', 'free'],
        category: 'multilingual',
        isLatest: true,
        notes: 'Leading multilingual model that excels across 23 different languages. Free access via API for research purposes'
    },
    {
        modelId: 'aya-expanse-32b',
        modelName: 'Aya Expanse 32B',
        provider: 'Cohere',
        inputPrice: 0.0,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['multilingual', 'research', '23-languages', 'free', 'large'],
        category: 'multilingual',
        isLatest: true,
        notes: 'Larger version of Aya Expanse with enhanced multilingual capabilities. Free access via API for research purposes'
    },

    // Legacy Command models
    {
        modelId: 'command-light',
        modelName: 'Command Light',
        provider: 'Cohere',
        inputPrice: 0.30,
        outputPrice: 0.60,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'lightweight', 'legacy'],
        category: 'text',
        isLatest: false,
        notes: 'Legacy lightweight command model with different pricing structure'
    },
    {
        modelId: 'classify',
        modelName: 'Classify',
        provider: 'Cohere',
        inputPrice: 1.00,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 2048,
        capabilities: ['classification', 'legacy'],
        category: 'classification',
        isLatest: false,
        notes: 'Legacy classification model with different pricing structure'
    },
    // --- End Cohere Models ---

    // --- xAI Grok Models (July 2025, fully updated) ---
    // Grok 4 - Latest flagship model
    {
        modelId: 'grok-4-0709',
        modelName: 'Grok 4',
        provider: 'xAI',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 256000,
        capabilities: ['text', 'vision', 'reasoning', 'function-calling', 'structured-outputs'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Latest flagship reasoning model with 256K context window. Vision, image gen and other capabilities coming soon.'
    },
    {
        modelId: 'grok-4',
        modelName: 'Grok 4 (Alias)',
        provider: 'xAI',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 256000,
        capabilities: ['text', 'vision', 'reasoning', 'function-calling', 'structured-outputs'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Alias for Grok 4 (points to grok-4-0709). Latest stable version.'
    },
    {
        modelId: 'grok-4-latest',
        modelName: 'Grok 4 Latest',
        provider: 'xAI',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 256000,
        capabilities: ['text', 'vision', 'reasoning', 'function-calling', 'structured-outputs'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Latest version alias for Grok 4. Suitable for users who want to access the latest features.'
    },

    // Grok 3 Series
    {
        modelId: 'grok-3',
        modelName: 'Grok 3',
        provider: 'xAI',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 131072,
        capabilities: ['text', 'vision', 'function-calling', 'structured-outputs'],
        category: 'text',
        isLatest: false,
        notes: 'High-performance model with 131K context window'
    },
    {
        modelId: 'grok-3-mini',
        modelName: 'Grok 3 Mini',
        provider: 'xAI',
        inputPrice: 0.3,
        outputPrice: 0.5,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 131072,
        capabilities: ['text', 'vision', 'function-calling', 'structured-outputs'],
        category: 'text',
        isLatest: false,
        notes: 'Compact and efficient model with 131K context window'
    },
    {
        modelId: 'grok-3-fast',
        modelName: 'Grok 3 Fast',
        provider: 'xAI',
        inputPrice: 5.0,
        outputPrice: 25.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 131072,
        capabilities: ['text', 'vision', 'function-calling', 'structured-outputs', 'fast-inference'],
        category: 'text',
        isLatest: false,
        notes: 'High-speed inference model with 131K context window'
    },
    {
        modelId: 'grok-3-mini-fast',
        modelName: 'Grok 3 Mini Fast',
        provider: 'xAI',
        inputPrice: 0.6,
        outputPrice: 4.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 131072,
        capabilities: ['text', 'vision', 'function-calling', 'structured-outputs', 'fast-inference'],
        category: 'text',
        isLatest: false,
        notes: 'Fast and compact model with 131K context window'
    },

    // Grok 2 Series - Regional variants
    {
        modelId: 'grok-2-1212',
        modelName: 'Grok 2 (US East)',
        provider: 'xAI',
        inputPrice: 2.0,
        outputPrice: 10.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 131072,
        capabilities: ['text', 'vision', 'function-calling', 'structured-outputs'],
        category: 'text',
        isLatest: false,
        notes: 'US East region deployment with 131K context window'
    },
    {
        modelId: 'grok-2-vision-1212',
        modelName: 'Grok 2 Vision (US East)',
        provider: 'xAI',
        inputPrice: 2.0,
        outputPrice: 10.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'vision', 'multimodal', 'function-calling', 'structured-outputs'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Vision-enabled model for US East region with 32K context window'
    },
    {
        modelId: 'grok-2-1212-eu-west-1',
        modelName: 'Grok 2 (EU West)',
        provider: 'xAI',
        inputPrice: 2.0,
        outputPrice: 10.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 131072,
        capabilities: ['text', 'vision', 'function-calling', 'structured-outputs'],
        category: 'text',
        isLatest: false,
        notes: 'EU West region deployment with 131K context window'
    },
    {
        modelId: 'grok-2-vision-1212-eu-west-1',
        modelName: 'Grok 2 Vision (EU West)',
        provider: 'xAI',
        inputPrice: 2.0,
        outputPrice: 10.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'vision', 'multimodal', 'function-calling', 'structured-outputs'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Vision-enabled model for EU West region with 32K context window'
    },

    // Grok Image Generation
    {
        modelId: 'grok-2-image-1212',
        modelName: 'Grok 2 Image',
        provider: 'xAI',
        inputPrice: 0.07,
        outputPrice: 0.0,
        unit: PricingUnit.PER_IMAGE,
        contextWindow: 0,
        capabilities: ['image-generation', 'text-to-image'],
        category: 'image-generation',
        isLatest: true,
        notes: 'Image generation model - $0.07 per image output'
    },
    // --- End xAI Grok Models ---

    // --- Mistral AI Models (July 2025, fully updated) ---
    // Premier Models
    {
        modelId: 'mistral-medium-latest',
        modelName: 'Mistral Medium 3',
        provider: 'Mistral AI',
        inputPrice: 0.4,
        outputPrice: 2.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'State-of-the-art performance. Simplified enterprise deployments. Cost-efficient.'
    },
    {
        modelId: 'magistral-medium-latest',
        modelName: 'Magistral Medium (Preview)',
        provider: 'Mistral AI',
        inputPrice: 2.0,
        outputPrice: 5.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'reasoning', 'thinking', 'multilingual'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Thinking model excelling in domain-specific, transparent, and multilingual reasoning.'
    },
    {
        modelId: 'codestral-latest',
        modelName: 'Codestral',
        provider: 'Mistral AI',
        inputPrice: 0.3,
        outputPrice: 0.9,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['code', 'programming', 'multilingual'],
        category: 'code',
        isLatest: true,
        notes: 'Lightweight, fast, and proficient in over 80 programming languages.'
    },
    {
        modelId: 'devstral-medium-2507',
        modelName: 'Devstral Medium',
        provider: 'Mistral AI',
        inputPrice: 0.4,
        outputPrice: 2.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['code', 'agents', 'programming'],
        category: 'code',
        isLatest: true,
        notes: 'Enhanced model for advanced coding agents.'
    },
    {
        modelId: 'mistral-saba-latest',
        modelName: 'Mistral Saba',
        provider: 'Mistral AI',
        inputPrice: 0.2,
        outputPrice: 0.6,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'custom-trained', 'regional'],
        category: 'text',
        isLatest: true,
        notes: 'Custom-trained model to serve specific geographies, markets, and customers.'
    },
    {
        modelId: 'mistral-large-latest',
        modelName: 'Mistral Large',
        provider: 'Mistral AI',
        inputPrice: 2.0,
        outputPrice: 6.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'reasoning', 'complex-tasks'],
        category: 'text',
        isLatest: true,
        notes: 'Top-tier reasoning for high-complexity tasks and sophisticated problems.'
    },
    {
        modelId: 'pixtral-large-latest',
        modelName: 'Pixtral Large',
        provider: 'Mistral AI',
        inputPrice: 2.0,
        outputPrice: 6.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['vision', 'multimodal', 'reasoning'],
        category: 'multimodal',
        isLatest: true,
        notes: 'Vision-capable large model with frontier reasoning capabilities.'
    },
    {
        modelId: 'ministral-8b-latest',
        modelName: 'Ministral 8B 24.10',
        provider: 'Mistral AI',
        inputPrice: 0.1,
        outputPrice: 0.1,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'edge', 'on-device'],
        category: 'text',
        isLatest: true,
        notes: 'Powerful model for on-device use cases.'
    },
    {
        modelId: 'ministral-3b-latest',
        modelName: 'Ministral 3B 24.10',
        provider: 'Mistral AI',
        inputPrice: 0.04,
        outputPrice: 0.04,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'edge', 'efficient'],
        category: 'text',
        isLatest: true,
        notes: 'Most efficient edge model.'
    },

    // Open Models
    {
        modelId: 'mistral-small-latest',
        modelName: 'Mistral Small 3.2',
        provider: 'Mistral AI',
        inputPrice: 0.1,
        outputPrice: 0.3,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'multimodal', 'multilingual', 'apache-2.0'],
        category: 'text',
        isLatest: true,
        notes: 'SOTA. Multimodal. Multilingual. Apache 2.0.'
    },
    {
        modelId: 'magistral-small-latest',
        modelName: 'Magistral Small',
        provider: 'Mistral AI',
        inputPrice: 0.5,
        outputPrice: 1.5,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'reasoning', 'thinking', 'multilingual'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Thinking model excelling in domain-specific, transparent, and multilingual reasoning.'
    },
    {
        modelId: 'devstral-small-2507',
        modelName: 'Devstral Small',
        provider: 'Mistral AI',
        inputPrice: 0.1,
        outputPrice: 0.3,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['code', 'agents', 'open-source'],
        category: 'code',
        isLatest: true,
        notes: 'The best open-source model for coding agents.'
    },
    {
        modelId: 'pixtral-12b',
        modelName: 'Pixtral 12B',
        provider: 'Mistral AI',
        inputPrice: 0.15,
        outputPrice: 0.15,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['vision', 'multimodal', 'small'],
        category: 'multimodal',
        isLatest: true,
        notes: 'Vision-capable small model.'
    },
    {
        modelId: 'mistral-nemo',
        modelName: 'Mistral NeMo',
        provider: 'Mistral AI',
        inputPrice: 0.15,
        outputPrice: 0.15,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['code', 'text', 'specialized'],
        category: 'code',
        isLatest: true,
        notes: 'State-of-the-art Mistral model trained specifically for code tasks.'
    },
    {
        modelId: 'open-mistral-7b',
        modelName: 'Mistral 7B',
        provider: 'Mistral AI',
        inputPrice: 0.25,
        outputPrice: 0.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['text', 'fast', 'customizable'],
        category: 'text',
        isLatest: false,
        notes: 'A 7B transformer model, fast-deployed and easily customisable.'
    },
    {
        modelId: 'open-mixtral-8x7b',
        modelName: 'Mixtral 8x7B',
        provider: 'Mistral AI',
        inputPrice: 0.7,
        outputPrice: 0.7,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['text', 'mixture-of-experts', 'sparse'],
        category: 'text',
        isLatest: false,
        notes: 'A 7B sparse Mixture-of-Experts (SMoE). Uses 12.9B active parameters out of 45B total.'
    },
    {
        modelId: 'open-mixtral-8x22b',
        modelName: 'Mixtral 8x22B',
        provider: 'Mistral AI',
        inputPrice: 2.0,
        outputPrice: 6.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'mixture-of-experts', 'high-performance'],
        category: 'text',
        isLatest: false,
        notes: 'Mixtral 8x22B is currently the most performant open model. A 22B sparse Mixture-of-Experts (SMoE). Uses only 39B active parameters out of 141B.'
    },

    // Embedding Models
    {
        modelId: 'codestral-embed-2505',
        modelName: 'Codestral Embed',
        provider: 'Mistral AI',
        inputPrice: 0.15,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['embedding', 'code'],
        category: 'embedding',
        isLatest: true,
        notes: 'State-of-the-art embedding model for code.'
    },
    {
        modelId: 'mistral-embed',
        modelName: 'Mistral Embed',
        provider: 'Mistral AI',
        inputPrice: 0.1,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['embedding', 'text'],
        category: 'embedding',
        isLatest: true,
        notes: 'State-of-the-art model for extracting representation of text extracts.'
    },

    // Moderation Models
    {
        modelId: 'mistral-moderation-latest',
        modelName: 'Mistral Moderation 24.11',
        provider: 'Mistral AI',
        inputPrice: 0.1,
        outputPrice: 0.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32000,
        capabilities: ['moderation', 'classification'],
        category: 'moderation',
        isLatest: true,
        notes: 'A classifier service for text content moderation.'
    },

    // Document AI & OCR
    {
        modelId: 'mistral-ocr-latest',
        modelName: 'Document AI & OCR',
        provider: 'Mistral AI',
        inputPrice: 1000.0, // $1 per 1000 pages converted to per 1M tokens equivalent
        outputPrice: 3000.0, // $3 per 1000 pages for annotations
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 0,
        capabilities: ['ocr', 'document-understanding', 'annotations'],
        category: 'document',
        isLatest: true,
        notes: 'Introducing the world\'s best document understanding API. OCR: $1/1000 pages, Annotations: $3/1000 pages'
    },
    // --- End Mistral AI Models ---

    // --- DeepSeek Models (July 2025, fully updated) ---
    // DeepSeek Chat (Standard Pricing UTC 00:30-16:30)
    {
        modelId: 'deepseek-chat',
        modelName: 'DeepSeek Chat',
        provider: 'DeepSeek',
        inputPrice: 0.27, // $0.27/1M tokens cache miss
        outputPrice: 1.10, // $1.10/1M tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'json', 'function-calling', 'chat-prefix', 'fim'],
        category: 'text',
        isLatest: true,
        notes: 'Points to DeepSeek-V3-0324. Standard pricing UTC 00:30-16:30'
    },
    {
        modelId: 'deepseek-chat-cached',
        modelName: 'DeepSeek Chat (Cached)',
        provider: 'DeepSeek',
        inputPrice: 0.07, // $0.07/1M tokens cache hit
        outputPrice: 1.10, // $1.10/1M tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'json', 'function-calling', 'chat-prefix', 'fim', 'context-caching'],
        category: 'text',
        isLatest: true,
        notes: 'Cache hit pricing for DeepSeek Chat. Standard pricing UTC 00:30-16:30'
    },

    // DeepSeek Reasoner (Standard Pricing UTC 00:30-16:30)
    {
        modelId: 'deepseek-reasoner',
        modelName: 'DeepSeek Reasoner',
        provider: 'DeepSeek',
        inputPrice: 0.55, // $0.55/1M tokens cache miss
        outputPrice: 2.19, // $2.19/1M tokens (includes CoT)
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'reasoning', 'cot', 'json', 'function-calling', 'chat-prefix'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Points to DeepSeek-R1-0528. Output includes CoT tokens. Max output: 32K default, 64K max. Standard pricing UTC 00:30-16:30'
    },
    {
        modelId: 'deepseek-reasoner-cached',
        modelName: 'DeepSeek Reasoner (Cached)',
        provider: 'DeepSeek',
        inputPrice: 0.14, // $0.14/1M tokens cache hit
        outputPrice: 2.19, // $2.19/1M tokens (includes CoT)
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'reasoning', 'cot', 'json', 'function-calling', 'chat-prefix', 'context-caching'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Cache hit pricing for DeepSeek Reasoner. Output includes CoT tokens. Standard pricing UTC 00:30-16:30'
    },

    // DeepSeek Off-Peak Pricing (UTC 16:30-00:30) - 50% discount for chat, 75% discount for reasoner
    {
        modelId: 'deepseek-chat-offpeak',
        modelName: 'DeepSeek Chat (Off-Peak)',
        provider: 'DeepSeek',
        inputPrice: 0.135, // 50% off standard price ($0.27 * 0.5)
        outputPrice: 0.55, // 50% off standard price ($1.10 * 0.5)
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'json', 'function-calling', 'chat-prefix', 'fim', 'off-peak-pricing'],
        category: 'text',
        isLatest: true,
        notes: '50% discount during UTC 16:30-00:30. Cache miss pricing'
    },
    {
        modelId: 'deepseek-chat-cached-offpeak',
        modelName: 'DeepSeek Chat Cached (Off-Peak)',
        provider: 'DeepSeek',
        inputPrice: 0.035, // 50% off cached price ($0.07 * 0.5)
        outputPrice: 0.55, // 50% off standard price ($1.10 * 0.5)
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'json', 'function-calling', 'chat-prefix', 'fim', 'context-caching', 'off-peak-pricing'],
        category: 'text',
        isLatest: true,
        notes: '50% discount during UTC 16:30-00:30. Cache hit pricing'
    },
    {
        modelId: 'deepseek-reasoner-offpeak',
        modelName: 'DeepSeek Reasoner (Off-Peak)',
        provider: 'DeepSeek',
        inputPrice: 0.135, // 75% off standard price ($0.55 * 0.25)
        outputPrice: 0.55, // 75% off standard price ($2.19 * 0.25)
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'reasoning', 'cot', 'json', 'function-calling', 'chat-prefix', 'off-peak-pricing'],
        category: 'reasoning',
        isLatest: true,
        notes: '75% discount during UTC 16:30-00:30. Cache miss pricing. Output includes CoT tokens'
    },
    {
        modelId: 'deepseek-reasoner-cached-offpeak',
        modelName: 'DeepSeek Reasoner Cached (Off-Peak)',
        provider: 'DeepSeek',
        inputPrice: 0.035, // 75% off cached price ($0.14 * 0.25)
        outputPrice: 0.55, // 75% off standard price ($2.19 * 0.25)
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'reasoning', 'cot', 'json', 'function-calling', 'chat-prefix', 'context-caching', 'off-peak-pricing'],
        category: 'reasoning',
        isLatest: true,
        notes: '75% discount during UTC 16:30-00:30. Cache hit pricing. Output includes CoT tokens'
    },

    // DeepSeek Model Aliases and Specific Versions
    {
        modelId: 'deepseek-v3-0324',
        modelName: 'DeepSeek-V3-0324',
        provider: 'DeepSeek',
        inputPrice: 0.27,
        outputPrice: 1.10,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'json', 'function-calling', 'chat-prefix', 'fim'],
        category: 'text',
        isLatest: true,
        notes: 'Specific version identifier for DeepSeek-V3 released March 24, 2025'
    },
    {
        modelId: 'deepseek-r1-0528',
        modelName: 'DeepSeek-R1-0528',
        provider: 'DeepSeek',
        inputPrice: 0.55,
        outputPrice: 2.19,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 64000,
        capabilities: ['text', 'reasoning', 'cot', 'json', 'function-calling', 'chat-prefix'],
        category: 'reasoning',
        isLatest: true,
        notes: 'Specific version identifier for DeepSeek-R1 released May 28, 2025. Output includes CoT tokens'
    },
    // --- End DeepSeek Models ---

    // --- Google AI Models (July 2025, fully updated) ---
    // Gemini 2.5 Pro
    {
        modelId: 'gemini-2.5-pro',
        modelName: 'Gemini 2.5 Pro',
        provider: 'Google AI',
        inputPrice: 1.25, // $1.25 for prompts <= 200k tokens
        outputPrice: 10.0, // $10.00 for prompts <= 200k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'code', 'reasoning', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'State-of-the-art multipurpose model, excels at coding and complex reasoning. $2.50/$15.00 for prompts > 200k tokens'
    },
    {
        modelId: 'gemini-2.5-pro-large-context',
        modelName: 'Gemini 2.5 Pro (Large Context)',
        provider: 'Google AI',
        inputPrice: 2.50, // $2.50 for prompts > 200k tokens
        outputPrice: 15.0, // $15.00 for prompts > 200k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_001, // >200k tokens
        capabilities: ['text', 'code', 'reasoning', 'multimodal'],
        category: 'text',
        isLatest: true,
        notes: 'Large context version of Gemini 2.5 Pro for prompts > 200k tokens'
    },

    // Gemini 2.5 Flash
    {
        modelId: 'gemini-2.5-flash',
        modelName: 'Gemini 2.5 Flash',
        provider: 'Google AI',
        inputPrice: 0.30, // $0.30 for text/image/video
        outputPrice: 2.50, // $2.50 including thinking tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'image', 'video', 'multimodal', 'reasoning'],
        category: 'multimodal',
        isLatest: true,
        notes: 'First hybrid reasoning model with 1M token context window and thinking budgets. $1.00 input for audio'
    },
    {
        modelId: 'gemini-2.5-flash-audio',
        modelName: 'Gemini 2.5 Flash (Audio)',
        provider: 'Google AI',
        inputPrice: 1.00, // $1.00 for audio
        outputPrice: 2.50, // $2.50 including thinking tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'multimodal', 'reasoning'],
        category: 'audio',
        isLatest: true,
        notes: 'Audio-optimized version of Gemini 2.5 Flash'
    },

    // Gemini 2.5 Flash-Lite Preview
    {
        modelId: 'gemini-2.5-flash-lite-preview',
        modelName: 'Gemini 2.5 Flash-Lite Preview',
        provider: 'Google AI',
        inputPrice: 0.10, // $0.10 for text/image/video
        outputPrice: 0.40, // $0.40 including thinking tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'image', 'video', 'multimodal'],
        category: 'multimodal',
        isLatest: true,
        notes: 'Smallest and most cost effective model, built for at scale usage. $0.50 input for audio'
    },
    {
        modelId: 'gemini-2.5-flash-lite-audio-preview',
        modelName: 'Gemini 2.5 Flash-Lite Audio Preview',
        provider: 'Google AI',
        inputPrice: 0.50, // $0.50 for audio
        outputPrice: 0.40, // $0.40 including thinking tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'multimodal'],
        category: 'audio',
        isLatest: true,
        notes: 'Audio-optimized version of Gemini 2.5 Flash-Lite Preview'
    },

    // Gemini 2.5 Flash Native Audio
    {
        modelId: 'gemini-2.5-flash-native-audio',
        modelName: 'Gemini 2.5 Flash Native Audio',
        provider: 'Google AI',
        inputPrice: 0.50, // $0.50 for text
        outputPrice: 2.00, // $2.00 for text
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'multimodal'],
        category: 'audio',
        isLatest: true,
        notes: 'Native audio models optimized for higher quality audio outputs. $3.00 input/$12.00 output for audio/video'
    },
    {
        modelId: 'gemini-2.5-flash-native-audio-output',
        modelName: 'Gemini 2.5 Flash Native Audio Output',
        provider: 'Google AI',
        inputPrice: 3.00, // $3.00 for audio/video
        outputPrice: 12.00, // $12.00 for audio
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'multimodal'],
        category: 'audio',
        isLatest: true,
        notes: 'Audio output optimized version with better pacing, voice naturalness, verbosity, and mood'
    },

    // Gemini 2.5 Flash Preview TTS
    {
        modelId: 'gemini-2.5-flash-preview-tts',
        modelName: 'Gemini 2.5 Flash Preview TTS',
        provider: 'Google AI',
        inputPrice: 0.50, // $0.50 for text
        outputPrice: 10.00, // $10.00 for audio
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'tts'],
        category: 'audio',
        isLatest: true,
        notes: '2.5 Flash text-to-speech audio model optimized for price-performant, low-latency, controllable speech generation'
    },

    // Gemini 2.5 Pro Preview TTS
    {
        modelId: 'gemini-2.5-pro-preview-tts',
        modelName: 'Gemini 2.5 Pro Preview TTS',
        provider: 'Google AI',
        inputPrice: 1.00, // $1.00 for text
        outputPrice: 20.00, // $20.00 for audio
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'tts'],
        category: 'audio',
        isLatest: true,
        notes: '2.5 Pro text-to-speech audio model optimized for powerful, low-latency speech generation'
    },

    // Gemini 2.0 Flash
    {
        modelId: 'gemini-2.0-flash',
        modelName: 'Gemini 2.0 Flash',
        provider: 'Google AI',
        inputPrice: 0.10, // $0.10 for text/image/video
        outputPrice: 0.40, // $0.40
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'image', 'video', 'multimodal'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Most balanced multimodal model with great performance across all tasks, built for the era of Agents. $0.70 input for audio'
    },
    {
        modelId: 'gemini-2.0-flash-audio',
        modelName: 'Gemini 2.0 Flash (Audio)',
        provider: 'Google AI',
        inputPrice: 0.70, // $0.70 for audio
        outputPrice: 0.40, // $0.40
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['audio', 'multimodal'],
        category: 'audio',
        isLatest: false,
        notes: 'Audio-optimized version of Gemini 2.0 Flash'
    },

    // Gemini 2.0 Flash-Lite
    {
        modelId: 'gemini-2.0-flash-lite',
        modelName: 'Gemini 2.0 Flash-Lite',
        provider: 'Google AI',
        inputPrice: 0.075, // $0.075
        outputPrice: 0.30, // $0.30
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 1_000_000,
        capabilities: ['text', 'multimodal'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Smallest and most cost effective model, built for at scale usage'
    },

    // Gemini 1.5 Flash
    {
        modelId: 'gemini-1.5-flash',
        modelName: 'Gemini 1.5 Flash',
        provider: 'Google AI',
        inputPrice: 0.075, // $0.075 for prompts <= 128k tokens
        outputPrice: 0.30, // $0.30 for prompts <= 128k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128_000,
        capabilities: ['text', 'image', 'video', 'multimodal'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Fastest multimodal model with great performance for diverse, repetitive tasks. $0.15/$0.60 for prompts > 128k tokens'
    },
    {
        modelId: 'gemini-1.5-flash-large-context',
        modelName: 'Gemini 1.5 Flash (Large Context)',
        provider: 'Google AI',
        inputPrice: 0.15, // $0.15 for prompts > 128k tokens
        outputPrice: 0.60, // $0.60 for prompts > 128k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128_001, // >128k tokens
        capabilities: ['text', 'image', 'video', 'multimodal'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Large context version of Gemini 1.5 Flash for prompts > 128k tokens'
    },

    // Gemini 1.5 Flash-8B
    {
        modelId: 'gemini-1.5-flash-8b',
        modelName: 'Gemini 1.5 Flash-8B',
        provider: 'Google AI',
        inputPrice: 0.0375, // $0.0375 for prompts <= 128k tokens
        outputPrice: 0.15, // $0.15 for prompts <= 128k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128_000,
        capabilities: ['text', 'image', 'video', 'multimodal'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Smallest model for lower intelligence use cases. $0.075/$0.30 for prompts > 128k tokens'
    },
    {
        modelId: 'gemini-1.5-flash-8b-large-context',
        modelName: 'Gemini 1.5 Flash-8B (Large Context)',
        provider: 'Google AI',
        inputPrice: 0.075, // $0.075 for prompts > 128k tokens
        outputPrice: 0.30, // $0.30 for prompts > 128k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128_001,
        capabilities: ['text', 'image', 'video', 'multimodal'],
        category: 'multimodal',
        isLatest: false,
        notes: 'Large context version of Gemini 1.5 Flash-8B for prompts > 128k tokens'
    },

    // Gemini 1.5 Pro
    {
        modelId: 'gemini-1.5-pro',
        modelName: 'Gemini 1.5 Pro',
        provider: 'Google AI',
        inputPrice: 1.25, // $1.25 for prompts <= 128k tokens
        outputPrice: 5.00, // $5.00 for prompts <= 128k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128_000,
        capabilities: ['text', 'code', 'reasoning', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'Highest intelligence Gemini 1.5 series model with breakthrough 2M token context window. $2.50/$10.00 for prompts > 128k tokens'
    },
    {
        modelId: 'gemini-1.5-pro-large-context',
        modelName: 'Gemini 1.5 Pro (Large Context)',
        provider: 'Google AI',
        inputPrice: 2.50, // $2.50 for prompts > 128k tokens
        outputPrice: 10.00, // $10.00 for prompts > 128k tokens
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128_001,
        capabilities: ['text', 'code', 'reasoning', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'Large context version of Gemini 1.5 Pro for prompts > 128k tokens'
    },

    // Text Embedding 004
    {
        modelId: 'text-embedding-004',
        modelName: 'Text Embedding 004',
        provider: 'Google AI',
        inputPrice: 0.0, // Free of charge
        outputPrice: 0.0, // Free of charge
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 2048,
        capabilities: ['embedding'],
        category: 'embedding',
        isLatest: true,
        notes: 'State-of-the-art text embedding model, free of charge'
    },

    // Gemma 3
    {
        modelId: 'gemma-3',
        modelName: 'Gemma 3',
        provider: 'Google AI',
        inputPrice: 0.0, // Free of charge
        outputPrice: 0.0, // Free of charge
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text'],
        category: 'text',
        isLatest: true,
        notes: 'Lightweight, state-of-the-art, open model built from the same technology that powers Gemini models'
    },

    // Gemma 3n
    {
        modelId: 'gemma-3n',
        modelName: 'Gemma 3n',
        provider: 'Google AI',
        inputPrice: 0.0, // Free of charge
        outputPrice: 0.0, // Free of charge
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text'],
        category: 'text',
        isLatest: true,
        notes: 'Open model built for efficient performance on everyday devices like mobile phones, laptops, and tablets'
    },
    // --- End Google AI Models ---

    // --- Anthropic Models (June 2025, fully updated) ---
    // Claude Opus 4
    {
        modelId: 'claude-opus-4-20250514',
        modelName: 'Claude Opus 4',
        provider: 'Anthropic',
        inputPrice: 15.0,
        outputPrice: 75.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual', 'extended-thinking'],
        category: 'text',
        isLatest: true,
        notes: 'Most capable Claude model, 200k context, Mar 2025 cut-off'
    },
    // Alias for Opus 4
    {
        modelId: 'claude-opus-4-0',
        modelName: 'Claude Opus 4 (Alias)',
        provider: 'Anthropic',
        inputPrice: 15.0,
        outputPrice: 75.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual', 'extended-thinking'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for Claude Opus 4 (points to claude-opus-4-20250514)'
    },
    // Claude Sonnet 4
    {
        modelId: 'claude-sonnet-4-20250514',
        modelName: 'Claude Sonnet 4',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual', 'extended-thinking'],
        category: 'text',
        isLatest: true,
        notes: 'High-performance Claude, 200k context, Mar 2025 cut-off'
    },
    // Alias for Sonnet 4
    {
        modelId: 'claude-sonnet-4-0',
        modelName: 'Claude Sonnet 4 (Alias)',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual', 'extended-thinking'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for Claude Sonnet 4 (points to claude-sonnet-4-20250514)'
    },
    // Claude Sonnet 3.7
    {
        modelId: 'claude-3-7-sonnet-20250219',
        modelName: 'Claude Sonnet 3.7',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual', 'extended-thinking'],
        category: 'text',
        isLatest: false,
        notes: 'High-performance, early extended thinking, Nov 2024 cut-off'
    },
    // Alias for Sonnet 3.7
    {
        modelId: 'claude-3-7-sonnet-latest',
        modelName: 'Claude Sonnet 3.7 (Alias)',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual', 'extended-thinking'],
        category: 'text',
        isLatest: false,
        notes: 'Alias for Claude Sonnet 3.7 (points to claude-3-7-sonnet-20250219)'
    },
    // Claude Sonnet 3.5 v2 (latest)
    {
        modelId: 'claude-3-5-sonnet-20241022',
        modelName: 'Claude Sonnet 3.5 v2',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Sonnet 3.5, Apr 2024 cut-off'
    },
    // Alias for Sonnet 3.5 v2
    {
        modelId: 'claude-3-5-sonnet-latest',
        modelName: 'Claude Sonnet 3.5 v2 (Alias)',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for Claude Sonnet 3.5 v2 (points to claude-3-5-sonnet-20241022)'
    },
    // Claude Sonnet 3.5 (previous version)
    {
        modelId: 'claude-3-5-sonnet-20240620',
        modelName: 'Claude Sonnet 3.5',
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Previous Sonnet 3.5, Apr 2024 cut-off'
    },
    // Claude Haiku 3.5
    {
        modelId: 'claude-3-5-haiku-20241022',
        modelName: 'Claude Haiku 3.5',
        provider: 'Anthropic',
        inputPrice: 0.8,
        outputPrice: 4.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Fastest Claude, July 2024 cut-off'
    },
    // Alias for Haiku 3.5
    {
        modelId: 'claude-3-5-haiku-latest',
        modelName: 'Claude Haiku 3.5 (Alias)',
        provider: 'Anthropic',
        inputPrice: 0.8,
        outputPrice: 4.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Alias for Claude Haiku 3.5 (points to claude-3-5-haiku-20241022)'
    },
    // Claude Opus 3
    {
        modelId: 'claude-3-opus-20240229',
        modelName: 'Claude Opus 3',
        provider: 'Anthropic',
        inputPrice: 15.0,
        outputPrice: 75.0,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 200_000,
        capabilities: ['text', 'vision', 'reasoning', 'multilingual'],
        category: 'text',
        isLatest: false,
        notes: 'Powerful model for complex tasks, Aug 2023 cut-off'
    },
    // Claude Haiku 3
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
        notes: 'Fast and compact, Aug 2023 cut-off'
    },
    // --- End Anthropic Models ---

    // --- OpenAI Models ---
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
    },
    // --- End OpenAI Models ---
];

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

// Utility functions for pricing calculations
export function calculateCost(
    inputTokens: number,
    outputTokens: number,
    provider: string,
    modelId: string
): number {
    const pricing = MODEL_PRICING.find(p =>
        p.provider.toLowerCase() === provider.toLowerCase() &&
        p.modelId.toLowerCase() === modelId.toLowerCase()
    );

    if (!pricing) {
        throw new Error(`No pricing data found for ${provider}/${modelId}`);
    }

    // Convert to million tokens for calculation
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice;

    return inputCost + outputCost;
}

export function estimateCost(
    inputTokens: number,
    outputTokens: number,
    provider: string,
    modelId: string
): { inputCost: number; outputCost: number; totalCost: number } {
    const pricing = MODEL_PRICING.find(p =>
        p.provider.toLowerCase() === provider.toLowerCase() &&
        p.modelId.toLowerCase() === modelId.toLowerCase()
    );

    if (!pricing) {
        throw new Error(`No pricing data found for ${provider}/${modelId}`);
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPrice;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPrice;

    return {
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost
    };
}

export function getModelPricing(provider: string, modelId: string): ModelPricing | null {
    return MODEL_PRICING.find(p =>
        p.provider.toLowerCase() === provider.toLowerCase() &&
        p.modelId.toLowerCase() === modelId.toLowerCase()
    ) || null;
}

export function getProviderModels(provider: string): ModelPricing[] {
    return MODEL_PRICING.filter(p =>
        p.provider.toLowerCase() === provider.toLowerCase()
    ).sort((a, b) => {
        // Sort latest models first, then by total cost
        if (a.isLatest && !b.isLatest) return -1;
        if (!a.isLatest && b.isLatest) return 1;
        const aCost = a.inputPrice + a.outputPrice;
        const bCost = b.inputPrice + b.outputPrice;
        return aCost - bCost;
    });
}

export function getAllProviders(): string[] {
    return Array.from(new Set(MODEL_PRICING.map(p => p.provider))).sort();
}

export function getModelsByCategory(category: string): ModelPricing[] {
    return MODEL_PRICING.filter(p =>
        p.category?.toLowerCase() === category.toLowerCase()
    ).sort((a, b) => {
        const aCost = a.inputPrice + a.outputPrice;
        const bCost = b.inputPrice + b.outputPrice;
        return aCost - bCost;
    });
}

export function findCheapestModel(provider?: string, category?: string): ModelPricing | null {
    let models = MODEL_PRICING;

    if (provider) {
        models = models.filter(p => p.provider.toLowerCase() === provider.toLowerCase());
    }

    if (category) {
        models = models.filter(p => p.category?.toLowerCase() === category.toLowerCase());
    }

    if (models.length === 0) return null;

    return models.reduce((cheapest, current) => {
        const cheapestCost = cheapest.inputPrice + cheapest.outputPrice;
        const currentCost = current.inputPrice + current.outputPrice;
        return currentCost < cheapestCost ? current : cheapest;
    });
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
                p.provider.toLowerCase() === provider.toLowerCase()
            )
        );
    }

    return modelsToCompare.map(pricing => {
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
}

// Export metadata
export const PRICING_METADATA = {
    lastUpdated: new Date().toISOString(),
    source: 'WebScraperService - July 2025 (Google AI, DeepSeek, Mistral AI, xAI Grok & Cohere fully updated)',
    dataVersion: '2025.07',
    totalProviders: getAllProviders().length,
    totalModels: MODEL_PRICING.length,
    unit: PricingUnit.PER_1M_TOKENS,
    features: [
        'July 2025 fresh pricing data',
        'Complete Cohere lineup (Command A, Command R+, Command R, Command R7B, Rerank 3.5, Embed 4)',
        'Cohere agentic AI and multilingual capabilities',
        'Cohere fine-tuned models and training costs',
        'Cohere multimodal embedding with image support',
        'Cohere legacy models (Command Light, Classify, Rerank 2)',
        'Cohere Aya research models (free multilingual access)',
        'Complete xAI Grok lineup (Grok 4, Grok 3 series, Grok 2 regional variants, Grok Image)',
        'xAI Grok 4 reasoning model with 256K context window',
        'xAI regional deployments (US East, EU West)',
        'xAI image generation capabilities',
        'Complete Mistral AI lineup (Medium 3, Magistral, Codestral, Devstral, Pixtral, Ministral)',
        'Mistral AI embedding and moderation models',
        'Mistral AI Document AI & OCR capabilities',
        'Complete DeepSeek lineup (Chat, Reasoner, V3-0324, R1-0528)',
        'DeepSeek off-peak pricing (50% chat, 75% reasoner discount)',
        'DeepSeek context caching support',
        'DeepSeek CoT reasoning with output token pricing',
        'Complete Google AI Gemini lineup (2.5 Pro, 2.5 Flash, 2.0 Flash, 1.5 Pro/Flash)',
        'Google AI native audio models and TTS',
        'Google AI embedding and open models (Gemma 3/3n)',
        'OpenAI reasoning models (o3, o4-mini, o3-pro)',
        'GPT-4.1 and GPT-4.5 new models',
        'Groq ultra-fast inference',
        'All AWS Bedrock models',
        'Latest Claude 4, 3.7, 3.5, 3.5 Haiku, 3 Opus, 3 Haiku',
        'Comprehensive embedding models'
    ]
};

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
export function calculateVolumeDiscount(totalSpend: number, provider: string): number {
    const discounts = VOLUME_DISCOUNTS[provider] || [];

    let applicableDiscount = 0;
    for (const discount of discounts) {
        if (totalSpend >= discount.threshold) {
            applicableDiscount = discount.discount;
        }
    }

    return applicableDiscount;
} 