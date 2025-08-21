// Local model pricing data for the backend
// This replaces the dependency on ai-cost-optimizer-core

export interface ModelPricing {
    provider: string;
    inputPrice: number; // per 1M tokens
    outputPrice: number; // per 1M tokens
    contextWindow: number;
    category: string;
    features: string[];
}

export const MODEL_PRICING_DATA: Record<string, ModelPricing> = {
    // Anthropic Claude Models
    'claude-3-haiku-20240307-v1:0': {
        provider: 'Anthropic',
        inputPrice: 0.25,
        outputPrice: 1.25,
        contextWindow: 200000,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis']
    },
    'claude-3-sonnet-20240229-v1:0': {
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 200000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'reasoning']
    },
    'claude-3-opus-20240229-v1:0': {
        provider: 'Anthropic',
        inputPrice: 15.0,
        outputPrice: 75.0,
        contextWindow: 200000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'creative-writing']
    },

    // OpenAI Models
    // === GPT-5 Models (Latest) ===
    'gpt-5': {
        provider: 'OpenAI',
        inputPrice: 1.25,
        outputPrice: 10.0,
        contextWindow: 128000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'advanced-intelligence']
    },
    'gpt-5-mini': {
        provider: 'OpenAI',
        inputPrice: 0.25,
        outputPrice: 2.0,
        contextWindow: 128000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'efficient']
    },
    'gpt-5-nano': {
        provider: 'OpenAI',
        inputPrice: 0.05,
        outputPrice: 0.4,
        contextWindow: 128000,
        category: 'fast',
        features: ['chat', 'text-generation', 'fast', 'cost-effective']
    },
    'gpt-5-chat-latest': {
        provider: 'OpenAI',
        inputPrice: 1.25,
        outputPrice: 10.0,
        contextWindow: 128000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'advanced']
    },

    // === GPT-4o Models ===
    'gpt-3.5-turbo': {
        provider: 'OpenAI',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 16385,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis']
    },
    'gpt-3.5-turbo-16k': {
        provider: 'OpenAI',
        inputPrice: 3.0,
        outputPrice: 4.0,
        contextWindow: 16385,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis']
    },
    'gpt-4': {
        provider: 'OpenAI',
        inputPrice: 30.0,
        outputPrice: 60.0,
        contextWindow: 8192,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'code-generation']
    },
    'gpt-4-turbo': {
        provider: 'OpenAI',
        inputPrice: 10.0,
        outputPrice: 30.0,
        contextWindow: 128000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'code-generation']
    },
    'gpt-4o': {
        provider: 'OpenAI',
        inputPrice: 5.0,
        outputPrice: 15.0,
        contextWindow: 128000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'vision']
    },
    'gpt-4o-mini': {
        provider: 'OpenAI',
        inputPrice: 0.15,
        outputPrice: 0.6,
        contextWindow: 128000,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis']
    },

    // Google Models
    // Gemini 2.5 Models
    'gemini-2.5-pro': {
        provider: 'Google',
        inputPrice: 1.25,
        outputPrice: 10.0,
        contextWindow: 2000000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'coding', 'complex-problems', 'multimodal']
    },
    'gemini-2.5-flash': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1000000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'multimodal', 'live-api']
    },
    'gemini-2.5-flash-lite': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 1000000,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'high-throughput', 'multimodal']
    },
    'gemini-2.5-flash-audio': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1000000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'audio', 'multimodal']
    },
    'gemini-2.5-flash-lite-audio-preview': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 1000000,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'audio', 'multimodal', 'preview']
    },
    'gemini-2.5-flash-native-audio-output': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1000000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'audio-output', 'multimodal']
    },

    // Gemini 2.0 Models
    'gemini-2.0-flash': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1000000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'multimodal', 'next-generation']
    },
    'gemini-2.0-flash-lite': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 1000000,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'cost-efficient', 'low-latency']
    },
    'gemini-2.0-flash-audio': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1000000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'audio', 'multimodal']
    },

    // Gemini 1.5 Models
    'gemini-1.5-pro': {
        provider: 'Google',
        inputPrice: 3.5,
        outputPrice: 10.5,
        contextWindow: 2097152,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'vision', 'long-context']
    },
    'gemini-1.5-flash': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1048576,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'multimodal']
    },
    'gemini-1.5-flash-large-context': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 2097152,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'multimodal', 'long-context']
    },
    'gemini-1.5-flash-8b-large-context': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 2097152,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'multimodal', 'long-context', '8b-parameter']
    },
    'gemini-1.5-pro-large-context': {
        provider: 'Google',
        inputPrice: 3.5,
        outputPrice: 10.5,
        contextWindow: 2097152,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'vision', 'long-context']
    },

    // Gemini 1.0 Models (Legacy)
    'gemini-1.0-pro': {
        provider: 'Google',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 32768,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis']
    },
    'gemini-1.0-pro-vision': {
        provider: 'Google',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 32768,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'vision', 'multimodal']
    },

    // Gemma Models (Open Source)
    'gemma-2': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'summarization', 'extraction', 'open-source']
    },
    'gemma': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'summarization', 'extraction', 'open-source']
    },

    // Gemma Specialized Models
    'shieldgemma-2': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'safety-evaluation', 'instruction-tuned', 'open-source']
    },
    'paligemma': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'vision-language', 'multimodal', 'open-source']
    },
    'codegemma': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'code-generation', 'coding-tasks', 'open-source']
    },
    'txgemma': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'therapeutic-predictions', 'medical-ai', 'open-source']
    },
    'medgemma': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'medical-text', 'medical-image', 'healthcare-ai', 'open-source']
    },
    'medsiglip': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'medical-embeddings', 'medical-ai', 'open-source']
    },
    't5gemma': {
        provider: 'Google',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'encoder-decoder', 'research', 'open-source']
    },

    // Embeddings Models
    'multimodal-embeddings': {
        provider: 'Google',
        inputPrice: 0.0001,
        outputPrice: 0.0001,
        contextWindow: 128000,
        category: 'embeddings',
        features: ['embeddings', 'text', 'images', 'semantic-search', 'classification']
    },

    // Imagen Models (Image Generation)
    'imagen-4-generation': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-generation',
        features: ['image-generation', 'high-quality', 'text-to-image']
    },
    'imagen-4-fast-generation': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-generation',
        features: ['image-generation', 'fast', 'text-to-image', 'lower-latency']
    },
    'imagen-4-ultra-generation': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-generation',
        features: ['image-generation', 'ultra-quality', 'text-to-image', 'best-prompt-adherence']
    },
    'imagen-3-generation': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-generation',
        features: ['image-generation', 'text-to-image']
    },
    'imagen-3-editing-customization': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-generation',
        features: ['image-editing', 'image-customization', 'mask-editing', 'reference-based']
    },
    'imagen-3-fast-generation': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-generation',
        features: ['image-generation', 'fast', 'text-to-image', 'lower-latency']
    },
    'imagen-captioning-vqa': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'image-analysis',
        features: ['image-captioning', 'visual-question-answering', 'image-understanding']
    },

    // Veo Models (Video Generation)
    'veo-3': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'video-generation',
        features: ['video-generation', 'high-quality', 'text-to-video', 'image-to-video']
    },
    'veo-3-fast': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'video-generation',
        features: ['video-generation', 'fast', 'text-to-video', 'image-to-video', 'lower-latency']
    },
    'virtual-try-on': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'video-generation',
        features: ['virtual-try-on', 'clothing', 'fashion', 'product-visualization']
    },
    'veo-3-preview': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'video-generation',
        features: ['video-generation', 'preview', 'text-to-video', 'image-to-video']
    },
    'veo-3-fast-preview': {
        provider: 'Google',
        inputPrice: 0.02,
        outputPrice: 0.02,
        contextWindow: 128000,
        category: 'video-generation',
        features: ['video-generation', 'fast', 'preview', 'text-to-video', 'image-to-video', 'lower-latency']
    },

    // Cohere Models
    'command-a-03-2025': {
        provider: 'Cohere',
        inputPrice: 2.5,
        outputPrice: 10.0,
        contextWindow: 256000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'agentic', 'multilingual']
    },
    'command-r7b-12-2024': {
        provider: 'Cohere',
        inputPrice: 0.0375,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis', 'rag', 'tool-use']
    },
    'command-a-reasoning-08-2025': {
        provider: 'Cohere',
        inputPrice: 2.5,
        outputPrice: 10.0,
        contextWindow: 256000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'agentic', 'multilingual']
    },
    'command-a-vision-07-2025': {
        provider: 'Cohere',
        inputPrice: 2.5,
        outputPrice: 10.0,
        contextWindow: 128000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'vision', 'multimodal', 'enterprise']
    },
    'command-r-plus-04-2024': {
        provider: 'Cohere',
        inputPrice: 2.5,
        outputPrice: 10.0,
        contextWindow: 128000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'enterprise']
    },
    'command-r-08-2024': {
        provider: 'Cohere',
        inputPrice: 0.15,
        outputPrice: 0.6,
        contextWindow: 128000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'rag', 'tools']
    },
    'command-r-03-2024': {
        provider: 'Cohere',
        inputPrice: 0.15,
        outputPrice: 0.6,
        contextWindow: 128000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis', 'rag', 'tools']
    },
    'command': {
        provider: 'Cohere',
        inputPrice: 0.15,
        outputPrice: 0.6,
        contextWindow: 4096,
        category: 'balanced',
        features: ['chat', 'text-generation']
    },

    // AWS Bedrock Additional Models
    'amazon.titan-text-express-v1': {
        provider: 'AWS',
        inputPrice: 0.8,
        outputPrice: 1.6,
        contextWindow: 8000,
        category: 'balanced',
        features: ['text-generation', 'summarization']
    },
    'amazon.titan-text-lite-v1': {
        provider: 'AWS',
        inputPrice: 0.3,
        outputPrice: 0.4,
        contextWindow: 4000,
        category: 'fast',
        features: ['text-generation', 'summarization']
    },

    // Amazon Nova Models
    'amazon-nova-micro': {
        provider: 'AWS',
        inputPrice: 0.035,
        outputPrice: 0.14,
        contextWindow: 128000,
        category: 'fast',
        features: ['text-generation', 'cost-effective', 'ultra-fast']
    },
    'amazon-nova-lite': {
        provider: 'AWS',
        inputPrice: 0.06,
        outputPrice: 0.24,
        contextWindow: 300000,
        category: 'multimodal',
        features: ['text-generation', 'multimodal', 'fast']
    },
    'amazon-nova-pro': {
        provider: 'AWS',
        inputPrice: 0.8,
        outputPrice: 3.2,
        contextWindow: 300000,
        category: 'balanced',
        features: ['text-generation', 'multimodal', 'reasoning', 'complex-tasks']
    },
    'amazon-nova-pro-latency-optimized': {
        provider: 'AWS',
        inputPrice: 1.0,
        outputPrice: 4.0,
        contextWindow: 300000,
        category: 'balanced',
        features: ['text-generation', 'multimodal', 'reasoning', 'low-latency']
    },
    'amazon-nova-premier': {
        provider: 'AWS',
        inputPrice: 2.5,
        outputPrice: 10.0,
        contextWindow: 300000,
        category: 'premium',
        features: ['text-generation', 'multimodal', 'reasoning', 'premium']
    },

    // Claude Models (frontend format)  
    'claude-3-haiku': {
        provider: 'Anthropic',
        inputPrice: 0.25,
        outputPrice: 1.25,
        contextWindow: 200000,
        category: 'fast',
        features: ['text-generation', 'vision', 'fast']
    },
    'claude-3-5-haiku': {
        provider: 'Anthropic', 
        inputPrice: 0.8,
        outputPrice: 4.0,
        contextWindow: 200000,
        category: 'fast',
        features: ['text-generation', 'vision', 'fast']
    },
    'claude-3-sonnet': {
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 200000,
        category: 'balanced',
        features: ['text-generation', 'vision', 'reasoning']
    },
    'claude-3-5-sonnet': {
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 200000,
        category: 'balanced',
        features: ['text-generation', 'vision', 'reasoning']
    },
    'claude-3-opus': {
        provider: 'Anthropic',
        inputPrice: 15.0,
        outputPrice: 75.0,
        contextWindow: 200000,
        category: 'premium',
        features: ['text-generation', 'vision', 'reasoning', 'premium']
    },
    'claude-3-7-sonnet': {
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 200000,
        category: 'balanced',
        features: ['text-generation', 'vision', 'reasoning', 'extended-thinking']
    },
    'claude-opus-4': {
        provider: 'Anthropic',
        inputPrice: 15.0,
        outputPrice: 75.0,
        contextWindow: 200000,
        category: 'premium',
        features: ['text-generation', 'vision', 'reasoning', 'premium']
    },
    'claude-sonnet-4': {
        provider: 'Anthropic',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 200000,
        category: 'balanced',
        features: ['text-generation', 'vision', 'reasoning']
    },

    // Llama Models (frontend format)
    'llama-3-70b-instruct': {
        provider: 'AWS',
        inputPrice: 0.8,
        outputPrice: 0.8,
        contextWindow: 8192,
        category: 'balanced',
        features: ['text-generation', 'instruction-following']
    },
    'llama-3-8b-instruct': {
        provider: 'AWS',
        inputPrice: 0.2,
        outputPrice: 0.2,
        contextWindow: 8192,
        category: 'fast',
        features: ['text-generation', 'instruction-following', 'fast']
    },
    'llama-2-70b-chat': {
        provider: 'AWS',
        inputPrice: 0.8,
        outputPrice: 0.8,
        contextWindow: 4096,
        category: 'balanced',
        features: ['text-generation', 'chat']
    },
    'llama-2-7b-chat': {
        provider: 'AWS',
        inputPrice: 0.15,
        outputPrice: 0.2,
        contextWindow: 4096,
        category: 'fast',
        features: ['text-generation', 'chat', 'cost-effective']
    },
    'llama-2-13b-chat': {
        provider: 'AWS',
        inputPrice: 0.25,
        outputPrice: 0.25,
        contextWindow: 4096,
        category: 'fast',
        features: ['text-generation', 'chat']
    },

    // Mistral Models
    'mistral-7b-instruct': {
        provider: 'AWS',
        inputPrice: 0.15,
        outputPrice: 0.2,
        contextWindow: 8192,
        category: 'fast',
        features: ['text-generation', 'instruction-following', 'cost-effective']
    },
    'mistral-8x7b-instruct': {
        provider: 'AWS',
        inputPrice: 0.45,
        outputPrice: 0.7,
        contextWindow: 32768,
        category: 'balanced',
        features: ['text-generation', 'instruction-following', 'mixture-of-experts']
    },
    'meta.llama2-70b-chat-v1': {
        provider: 'AWS',
        inputPrice: 1.95,
        outputPrice: 2.56,
        contextWindow: 4096,
        category: 'balanced',
        features: ['chat', 'text-generation', 'code-generation']
    },

    // Mistral AI Models
    // Premier Models
    'mistral-medium-2508': {
        provider: 'Mistral',
        inputPrice: 0.4,
        outputPrice: 2.0,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'analysis', 'reasoning', 'enterprise']
    },
    'mistral-medium-latest': {
        provider: 'Mistral',
        inputPrice: 0.4,
        outputPrice: 2.0,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'analysis', 'reasoning', 'enterprise']
    },
    'magistral-medium-2507': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 5.0,
        contextWindow: 40000,
        category: 'reasoning',
        features: ['chat', 'text-generation', 'reasoning', 'thinking', 'domain-specific', 'multilingual']
    },
    'magistral-medium-latest': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 5.0,
        contextWindow: 40000,
        category: 'reasoning',
        features: ['chat', 'text-generation', 'reasoning', 'thinking', 'domain-specific', 'multilingual']
    },
    'codestral-2508': {
        provider: 'Mistral',
        inputPrice: 0.3,
        outputPrice: 0.9,
        contextWindow: 256000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'programming', 'multilingual-code', 'fill-in-middle', 'code-correction', 'test-generation']
    },
    'codestral-latest': {
        provider: 'Mistral',
        inputPrice: 0.3,
        outputPrice: 0.9,
        contextWindow: 256000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'programming', 'multilingual-code', 'fill-in-middle', 'code-correction', 'test-generation']
    },
    'voxtral-mini-2507': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 0,
        category: 'audio',
        features: ['audio', 'transcription', 'efficient']
    },
    'voxtral-mini-latest': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 0,
        category: 'audio',
        features: ['audio', 'transcription', 'efficient']
    },
    'devstral-medium-2507': {
        provider: 'Mistral',
        inputPrice: 0.4,
        outputPrice: 2.0,
        contextWindow: 128000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'agents', 'advanced-coding', 'codebase-exploration', 'multi-file-editing']
    },
    'devstral-medium-latest': {
        provider: 'Mistral',
        inputPrice: 0.4,
        outputPrice: 2.0,
        contextWindow: 128000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'agents', 'advanced-coding', 'codebase-exploration', 'multi-file-editing']
    },
    'mistral-ocr-2505': {
        provider: 'Mistral',
        inputPrice: 1.0,
        outputPrice: 3.0,
        contextWindow: 0,
        category: 'document',
        features: ['ocr', 'document-understanding', 'annotations', 'text-extraction']
    },
    'mistral-ocr-latest': {
        provider: 'Mistral',
        inputPrice: 1.0,
        outputPrice: 3.0,
        contextWindow: 0,
        category: 'document',
        features: ['ocr', 'document-understanding', 'annotations', 'text-extraction']
    },
    'mistral-large-2411': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 6.0,
        contextWindow: 128000,
        category: 'text',
        features: ['chat', 'text-generation', 'reasoning', 'complex-tasks', 'high-complexity']
    },
    'mistral-large-latest': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 6.0,
        contextWindow: 128000,
        category: 'text',
        features: ['chat', 'text-generation', 'reasoning', 'complex-tasks', 'high-complexity']
    },
    'pixtral-large-2411': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 6.0,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'vision', 'multimodal', 'reasoning', 'frontier-class']
    },
    'pixtral-large-latest': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 6.0,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'vision', 'multimodal', 'reasoning', 'frontier-class']
    },
    'mistral-small-2407': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 32000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'multilingual', 'open-source']
    },
    'mistral-embed': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 8192,
        category: 'embedding',
        features: ['embedding', 'text', 'semantic']
    },
    'codestral-embed-2505': {
        provider: 'Mistral',
        inputPrice: 0.15,
        outputPrice: 0.15,
        contextWindow: 8192,
        category: 'embedding',
        features: ['embedding', 'code', 'semantic']
    },
    'mistral-moderation-2411': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 32000,
        category: 'moderation',
        features: ['moderation', 'classification', 'harmful-content-detection']
    },
    'mistral-moderation-latest': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 32000,
        category: 'moderation',
        features: ['moderation', 'classification', 'harmful-content-detection']
    },
    
    // Open Models
    'magistral-small-2507': {
        provider: 'Mistral',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 40000,
        category: 'reasoning',
        features: ['chat', 'text-generation', 'reasoning', 'thinking', 'domain-specific', 'multilingual']
    },
    'magistral-small-latest': {
        provider: 'Mistral',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 40000,
        category: 'reasoning',
        features: ['chat', 'text-generation', 'reasoning', 'thinking', 'domain-specific', 'multilingual']
    },
    'voxtral-small-2507': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 32000,
        category: 'audio',
        features: ['chat', 'text-generation', 'audio', 'instruct', 'multimodal']
    },
    'voxtral-small-latest': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.1,
        contextWindow: 32000,
        category: 'audio',
        features: ['chat', 'text-generation', 'audio', 'instruct', 'multimodal']
    },
    'mistral-small-2506': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'multilingual', 'open-source']
    },
    'devstral-small-2507': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 128000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'agents', 'open-source', 'codebase-exploration', 'multi-file-editing']
    },
    'devstral-small-latest': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 128000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'agents', 'open-source', 'codebase-exploration', 'multi-file-editing']
    },
    'mistral-small-2503': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'multilingual', 'open-source', 'image-understanding']
    },
    'mistral-small-2501': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 32000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'multilingual', 'open-source']
    },
    'devstral-small-2505': {
        provider: 'Mistral',
        inputPrice: 0.1,
        outputPrice: 0.3,
        contextWindow: 128000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'agents', 'open-source', '24b-parameter']
    },
    'pixtral-12b-2409': {
        provider: 'Mistral',
        inputPrice: 0.15,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'vision', 'multimodal', 'small', 'image-understanding']
    },
    'pixtral-12b': {
        provider: 'Mistral',
        inputPrice: 0.15,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'vision', 'multimodal', 'small', 'image-understanding']
    },
    'open-mistral-nemo-2407': {
        provider: 'Mistral',
        inputPrice: 0.15,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'text',
        features: ['chat', 'text-generation', 'multilingual', 'open-source', 'best-multilingual']
    },
    'open-mistral-nemo': {
        provider: 'Mistral',
        inputPrice: 0.15,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'text',
        features: ['chat', 'text-generation', 'multilingual', 'open-source', 'best-multilingual']
    },
    'mistral-nemo': {
        provider: 'Mistral',
        inputPrice: 0.15,
        outputPrice: 0.15,
        contextWindow: 128000,
        category: 'code',
        features: ['chat', 'text-generation', 'code', 'specialized']
    },
    'open-mistral-7b': {
        provider: 'Mistral',
        inputPrice: 0.25,
        outputPrice: 0.25,
        contextWindow: 32000,
        category: 'text',
        features: ['chat', 'text-generation', 'open-source', 'fast']
    },
    'open-mixtral-8x7b': {
        provider: 'Mistral',
        inputPrice: 0.7,
        outputPrice: 0.7,
        contextWindow: 32000,
        category: 'text',
        features: ['chat', 'text-generation', 'mixture-of-experts', 'open-source']
    },
    'open-mixtral-8x22b': {
        provider: 'Mistral',
        inputPrice: 2.0,
        outputPrice: 6.0,
        contextWindow: 65000,
        category: 'text',
        features: ['chat', 'text-generation', 'mixture-of-experts', 'open-source', 'high-performance']
    },

    // Grok AI Models
    'grok-4-0709': {
        provider: 'xAI',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 256000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'reasoning', 'function-calling', 'structured-outputs']
    },
    'grok-3': {
        provider: 'xAI',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 131072,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'function-calling', 'structured-outputs']
    },
    'grok-3-mini': {
        provider: 'xAI',
        inputPrice: 0.3,
        outputPrice: 0.5,
        contextWindow: 131072,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'function-calling', 'structured-outputs']
    },
    'grok-2-image-1212': {
        provider: 'xAI',
        inputPrice: 0.07,
        outputPrice: 0.07,
        contextWindow: 0,
        category: 'image',
        features: ['image-generation']
    },

    // Meta Llama 4 Models
    'llama-4-scout': {
        provider: 'Meta',
        inputPrice: 0.19,
        outputPrice: 0.49,
        contextWindow: 10000000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'long-context', 'multilingual', 'image-grounding']
    },
    'llama-4-maverick': {
        provider: 'Meta',
        inputPrice: 0.19,
        outputPrice: 0.49,
        contextWindow: 10000000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'long-context', 'multilingual', 'image-grounding', 'fast-responses']
    },
    'llama-4-behemoth-preview': {
        provider: 'Meta',
        inputPrice: 0.19,
        outputPrice: 0.49,
        contextWindow: 10000000,
        category: 'multimodal',
        features: ['chat', 'text-generation', 'multimodal', 'vision', 'long-context', 'multilingual', 'image-grounding', 'teacher-model']
    }
};

export const PROVIDER_INFO = {
    'Anthropic': {
        name: 'Anthropic',
        website: 'https://anthropic.com',
        strengths: ['Safety', 'Reasoning', 'Long context'],
        pricing_unit: 'per_million_tokens'
    },
    'OpenAI': {
        name: 'OpenAI',
        website: 'https://openai.com',
        strengths: ['General purpose', 'Code generation', 'Wide adoption'],
        pricing_unit: 'per_million_tokens'
    },
    'Google': {
        name: 'Google',
        website: 'https://ai.google.dev',
        strengths: ['Multimodal', 'Long context', 'Fast processing'],
        pricing_unit: 'per_million_tokens'
    },
    'Cohere': {
        name: 'Cohere',
        website: 'https://cohere.ai',
        strengths: ['Enterprise focus', 'RAG optimization', 'Multilingual'],
        pricing_unit: 'per_million_tokens'
    },
    'AWS': {
        name: 'Amazon Web Services',
        website: 'https://aws.amazon.com/bedrock',
        strengths: ['Enterprise integration', 'Security', 'Scalability'],
        pricing_unit: 'per_million_tokens'
    },
    'Mistral': {
        name: 'Mistral AI',
        website: 'https://mistral.ai',
        strengths: ['European AI', 'Open source', 'Efficiency'],
        pricing_unit: 'per_million_tokens'
    }
};

// Model ID mapping for common aliases and variations
const MODEL_ID_MAPPING: Record<string, string> = {
    // Nova Pro variations
    'nova-pro': 'amazon-nova-pro',
    'amazon.nova-pro-v1:0': 'amazon-nova-pro',
    'amazon.nova-pro-v1': 'amazon-nova-pro',
    
    // Nova Lite variations
    'nova-lite': 'amazon-nova-lite',
    'amazon.nova-lite-v1:0': 'amazon-nova-lite',
    'amazon.nova-lite-v1': 'amazon-nova-lite',
    
    // Nova Micro variations
    'nova-micro': 'amazon-nova-micro',
    'amazon.nova-micro-v1:0': 'amazon-nova-micro',
    'amazon.nova-micro-v1': 'amazon-nova-micro',
    
    // Claude variations
    'claude-3-haiku': 'claude-3-haiku-20240307-v1:0',
    'claude-3-sonnet': 'claude-3-sonnet-20240229-v1:0',
    'claude-3-opus': 'claude-3-opus-20240229-v1:0',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022-v2:0',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022-v1:0',
    'anthropic.claude-3-haiku-20240307-v1:0': 'claude-3-haiku-20240307-v1:0',
    'anthropic.claude-3-sonnet-20240229-v1:0': 'claude-3-sonnet-20240229-v1:0',
    'anthropic.claude-3-opus-20240229-v1:0': 'claude-3-opus-20240229-v1:0',
    'anthropic.claude-3-5-sonnet-20241022-v2:0': 'claude-3-5-sonnet-20241022-v2:0',
    'anthropic.claude-3-5-haiku-20241022-v1:0': 'claude-3-5-haiku-20241022-v1:0',
    
    // GPT variations
    // === GPT-5 Models (Latest) ===
    'gpt-5': 'gpt-5',
    'gpt-5-mini': 'gpt-5-mini',
    'gpt-5-nano': 'gpt-5-nano',
    'gpt-5-chat-latest': 'gpt-5-chat-latest',
    'gpt-5-chat': 'gpt-5-chat-latest',
    
    // === GPT-4 Models ===
    'gpt-4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-4-turbo-preview': 'gpt-4-turbo-preview',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    
    // Gemini variations
    'gemini-pro': 'gemini-1.0-pro',
    'gemini-1.0-pro': 'gemini-1.0-pro',
    'gemini-1.0-pro-vision': 'gemini-1.0-pro-vision',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
    'gemini-1.5-flash-large-context': 'gemini-1.5-flash-large-context',
    'gemini-1.5-flash-8b-large-context': 'gemini-1.5-flash-8b-large-context',
    'gemini-1.5-pro-large-context': 'gemini-1.5-pro-large-context',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
    'gemini-2.5-flash-audio': 'gemini-2.5-flash-audio',
    'gemini-2.5-flash-lite-audio-preview': 'gemini-2.5-flash-lite-audio-preview',
    'gemini-2.5-flash-native-audio-output': 'gemini-2.5-flash-native-audio-output',
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
    'gemini-2.0-flash-audio': 'gemini-2.0-flash-audio',
    
    // Gemma variations
    'gemma-2': 'gemma-2',
    'gemma': 'gemma',
    'shieldgemma-2': 'shieldgemma-2',
    'paligemma': 'paligemma',
    'codegemma': 'codegemma',
    'txgemma': 'txgemma',
    'medgemma': 'medgemma',
    'medsiglip': 'medsiglip',
    't5gemma': 't5gemma',
    
    // Google Embeddings variations
    'multimodal-embeddings': 'multimodal-embeddings',
    
    // Google Imagen variations
    'imagen-4-generation': 'imagen-4-generation',
    'imagen-4-fast-generation': 'imagen-4-fast-generation',
    'imagen-4-ultra-generation': 'imagen-4-ultra-generation',
    'imagen-3-generation': 'imagen-3-generation',
    'imagen-3-editing-customization': 'imagen-3-editing-customization',
    'imagen-3-fast-generation': 'imagen-3-fast-generation',
    'imagen-captioning-vqa': 'imagen-captioning-vqa',
    
    // Google Veo variations
    'veo-3': 'veo-3',
    'veo-3-fast': 'veo-3-fast',
    'virtual-try-on': 'virtual-try-on',
    'veo-3-preview': 'veo-3-preview',
    'veo-3-fast-preview': 'veo-3-fast-preview',
    
    // Cohere variations
    'command-a': 'command-a-03-2025',
    'command-a-03-2025': 'command-a-03-2025',
    'command-r7b': 'command-r7b-12-2024',
    'command-r7b-12-2024': 'command-r7b-12-2024',
    'command-a-reasoning': 'command-a-reasoning-08-2025',
    'command-a-reasoning-08-2025': 'command-a-reasoning-08-2025',
    'command-a-vision': 'command-a-vision-07-2025',
    'command-a-vision-07-2025': 'command-a-vision-07-2025',
    'command-r-plus': 'command-r-plus-04-2024',
    'command-r-plus-04-2024': 'command-r-plus-04-2024',
    'command-r': 'command-r-08-2024',
    'command-r-08-2024': 'command-r-08-2024',
    'command-r-03-2024': 'command-r-03-2024',
    'command': 'command',
    'command-nightly': 'command-nightly',
    'command-light': 'command-light',
    'command-light-nightly': 'command-light-nightly',
    
    // Mistral AI variations
    // Premier Models
    'mistral-medium': 'mistral-medium-2508',
    'mistral-medium-2508': 'mistral-medium-2508',
    'mistral-medium-latest': 'mistral-medium-2508',
    'magistral-medium': 'magistral-medium-2507',
    'magistral-medium-2507': 'magistral-medium-2507',
    'magistral-medium-latest': 'magistral-medium-2507',
    'codestral': 'codestral-2508',
    'codestral-2508': 'codestral-2508',
    'codestral-latest': 'codestral-2508',
    'voxtral-mini': 'voxtral-mini-2507',
    'voxtral-mini-2507': 'voxtral-mini-2507',
    'voxtral-mini-latest': 'voxtral-mini-2507',
    'devstral-medium': 'devstral-medium-2507',
    'devstral-medium-2507': 'devstral-medium-2507',
    'devstral-medium-latest': 'devstral-medium-2507',
    'mistral-ocr': 'mistral-ocr-2505',
    'mistral-ocr-2505': 'mistral-ocr-2505',
    'mistral-ocr-latest': 'mistral-ocr-2505',
    'mistral-large-2411': 'mistral-large-2411',
    'mistral-large-latest': 'mistral-large-2411',
    'pixtral-large': 'pixtral-large-2411',
    'pixtral-large-2411': 'pixtral-large-2411',
    'pixtral-large-latest': 'pixtral-large-2411',
    'mistral-small-2407': 'mistral-small-2407',
    'mistral-small-2506': 'mistral-small-2506',
    'mistral-small-2503': 'mistral-small-2503',
    'mistral-small-2501': 'mistral-small-2501',
    'mistral-embed': 'mistral-embed',
    'codestral-embed': 'codestral-embed-2505',
    'codestral-embed-2505': 'codestral-embed-2505',
    'mistral-moderation': 'mistral-moderation-2411',
    'mistral-moderation-2411': 'mistral-moderation-2411',
    'mistral-moderation-latest': 'mistral-moderation-2411',
    
    // Open Models
    'magistral-small': 'magistral-small-2507',
    'magistral-small-2507': 'magistral-small-2507',
    'magistral-small-latest': 'magistral-small-2507',
    'voxtral-small': 'voxtral-small-2507',
    'voxtral-small-2507': 'voxtral-small-2507',
    'voxtral-small-latest': 'voxtral-small-2507',
    'devstral-small': 'devstral-small-2507',
    'devstral-small-2507': 'devstral-small-2507',
    'devstral-small-latest': 'devstral-small-2507',
    'devstral-small-2505': 'devstral-small-2505',
    'pixtral-12b': 'pixtral-12b-2409',
    'pixtral-12b-2409': 'pixtral-12b-2409',
    'open-mistral-nemo': 'open-mistral-nemo-2407',
    'open-mistral-nemo-2407': 'open-mistral-nemo-2407',
    'mistral-nemo': 'mistral-nemo',
    'open-mistral-7b': 'open-mistral-7b',
    'open-mixtral-8x7b': 'open-mixtral-8x7b',
    'open-mixtral-8x22b': 'open-mixtral-8x22b',
    
    // Legacy AWS Bedrock Mistral models (using different keys to avoid conflicts)
    'mistral-7b-legacy': 'mistral.mistral-7b-instruct-v0:2',
    'mistral-large-legacy': 'mistral.mistral-large-2402-v1:0',
    'mistral.mistral-7b-instruct-v0:2': 'mistral-7b-instruct',
    'mistral.mistral-large-2402-v1:0': 'mistral-large-2402',
    
    // Llama variations
    'llama2-13b': 'meta.llama2-13b-chat-v1:0',
    'llama2-70b': 'meta.llama2-70b-chat-v1:0',
    'llama3-8b': 'meta.llama3-8b-instruct-v1:0',
    'llama3-70b': 'meta.llama3-70b-instruct-v1:0',
    'meta.llama2-13b-chat-v1:0': 'llama2-13b-chat',
    'meta.llama2-70b-chat-v1:0': 'llama2-70b-chat',
    'meta.llama3-8b-instruct-v1:0': 'llama3-8b-instruct',
    'meta.llama3-70b-instruct-v1:0': 'llama3-70b-instruct',
    
    // Grok AI variations
    'grok-4': 'grok-4-0709',
    'grok-4-latest': 'grok-4-0709',
    'grok-3-latest': 'grok-3',
    'grok-3-mini-latest': 'grok-3-mini',
    'grok-2-image': 'grok-2-image-1212',
    'grok-2-image-latest': 'grok-2-image-1212',
    
    // Meta Llama 4 variations
    'llama-4-scout': 'llama-4-scout',
    'llama-4-maverick': 'llama-4-maverick',
    'llama-4-behemoth': 'llama-4-behemoth-preview',
    'llama-4-behemoth-preview': 'llama-4-behemoth-preview'
};

// Utility functions
export function getModelPricing(modelId: string): ModelPricing | null {
    // First try the original model ID
    let pricing = MODEL_PRICING_DATA[modelId];
    if (pricing) {
        return pricing;
    }
    
    // Then try mapped model ID
    const mappedModelId = MODEL_ID_MAPPING[modelId];
    if (mappedModelId) {
        pricing = MODEL_PRICING_DATA[mappedModelId];
        if (pricing) {
            return pricing;
        }
    }
    
    // Finally try case-insensitive search for Nova models
    if (modelId.toLowerCase().includes('nova')) {
        const lowerModelId = modelId.toLowerCase();
        if (lowerModelId.includes('pro')) {
            return MODEL_PRICING_DATA['amazon-nova-pro'];
        } else if (lowerModelId.includes('lite')) {
            return MODEL_PRICING_DATA['amazon-nova-lite'];
        } else if (lowerModelId.includes('micro')) {
            return MODEL_PRICING_DATA['amazon-nova-micro'];
        }
    }
    
    return null;
}

export function getProviderModels(provider: string): Array<{model: string, pricing: ModelPricing}> {
    return Object.entries(MODEL_PRICING_DATA)
        .filter(([_, pricing]) => pricing.provider === provider)
        .map(([model, pricing]) => ({ model, pricing }));
}

export function getAllProviders(): string[] {
    return Object.keys(PROVIDER_INFO);
}

export function compareModelCosts(
    inputTokens: number,
    outputTokens: number,
    models: string[]
): Array<{
    model: string;
    provider: string;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    costBreakdown: string;
}> {
    return models.map(model => {
        const pricing = getModelPricing(model);
        if (!pricing) {
            return {
                model,
                provider: 'Unknown',
                inputCost: 0,
                outputCost: 0,
                totalCost: 0,
                costBreakdown: 'Model not found'
            };
        }

        const inputCost = (inputTokens * pricing.inputPrice) / 1000000;
        const outputCost = (outputTokens * pricing.outputPrice) / 1000000;
        const totalCost = inputCost + outputCost;

        return {
            model,
            provider: pricing.provider,
            inputCost,
            outputCost,
            totalCost,
            costBreakdown: `Input: $${inputCost.toFixed(4)}, Output: $${outputCost.toFixed(4)}`
        };
    }).sort((a, b) => a.totalCost - b.totalCost);
}

export function findCheapestModel(
    inputTokens: number,
    outputTokens: number,
    category?: string,
    features?: string[],
    excludeModel?: string
): Array<{model: string, pricing: ModelPricing, totalCost: number}> {
    let models = Object.entries(MODEL_PRICING_DATA);

    // Skip excluded model
    if (excludeModel) {
        models = models.filter(([modelId, _]) => modelId !== excludeModel);
    }

    // Filter by category if specified
    if (category) {
        models = models.filter(([_, pricing]) => pricing.category === category);
    }

    // Filter by features if specified
    if (features && features.length > 0) {
        models = models.filter(([_, pricing]) => 
            features.every(feature => pricing.features.includes(feature))
        );
    }

    return models.map(([model, pricing]) => {
        const inputCost = (inputTokens * pricing.inputPrice) / 1000000;
        const outputCost = (outputTokens * pricing.outputPrice) / 1000000;
        const totalCost = inputCost + outputCost;

        return { model, pricing, totalCost };
    }).sort((a, b) => a.totalCost - b.totalCost);
}

export function getAvailableBedrickModels(): string[] {
    return Object.keys(MODEL_PRICING_DATA).filter(modelId => {
        const pricing = MODEL_PRICING_DATA[modelId];
        return pricing.provider === 'AWS' || pricing.provider === 'Anthropic';
    });
}

export function getModelsByUseCase(useCase: string): string[] {
    const useCaseModelMap: Record<string, string[]> = {
        'chatbot': [
            'claude-3-sonnet-20240229-v1:0',
            'gpt-4o',
            'claude-3-haiku-20240307-v1:0',
            'gpt-3.5-turbo',
            'command-r'
        ],
        'content-generation': [
            'claude-3-opus-20240229-v1:0',
            'gpt-4-turbo',
            'claude-3-sonnet-20240229-v1:0',
            'command-r-plus',
            'mistral-large-latest'
        ],
        'api-integration': [
            'claude-3-haiku-20240307-v1:0',
            'gpt-4o-mini',
            'gpt-3.5-turbo',
            'gemini-1.5-flash',
            'mistral-small-latest'
        ],
        'data-analysis': [
            'claude-3-sonnet-20240229-v1:0',
            'gpt-4',
            'claude-3-opus-20240229-v1:0',
            'command-r-plus',
            'gemini-1.5-pro'
        ],
        'code-generation': [
            'gpt-4',
            'claude-3-sonnet-20240229-v1:0',
            'gpt-4-turbo',
            'mistral-large-latest',
            'meta.llama2-70b-chat-v1'
        ],
        'summarization': [
            'claude-3-haiku-20240307-v1:0',
            'gpt-4o-mini',
            'gpt-3.5-turbo',
            'amazon.titan-text-express-v1',
            'gemini-1.5-flash'
        ]
    };

    return useCaseModelMap[useCase] || Object.keys(MODEL_PRICING_DATA);
} 