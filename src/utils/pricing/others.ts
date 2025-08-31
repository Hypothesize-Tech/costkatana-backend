import { ModelPricing, PricingUnit } from './types';

export const OTHERS_PRICING: ModelPricing[] = [
    // DeepSeek Models
    {
        modelId: 'deepseek-chat',
        modelName: 'DeepSeek Chat',
        provider: 'DeepSeek',
        inputPrice: 0.14,
        outputPrice: 0.28,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'DeepSeek Chat model'
    },
    {
        modelId: 'deepseek-coder',
        modelName: 'DeepSeek Coder',
        provider: 'DeepSeek',
        inputPrice: 0.14,
        outputPrice: 0.28,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'code'],
        category: 'code',
        isLatest: true,
        notes: 'DeepSeek Coder model for code generation'
    },

    // Groq Models
    {
        modelId: 'llama-3-70b-8192',
        modelName: 'Llama 3 70B',
        provider: 'Groq',
        inputPrice: 0.59,
        outputPrice: 0.79,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Llama 3 70B on Groq - ultra-fast inference'
    },
    {
        modelId: 'llama-3-8b-8192',
        modelName: 'Llama 3 8B',
        provider: 'Groq',
        inputPrice: 0.05,
        outputPrice: 0.10,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Llama 3 8B on Groq - ultra-fast inference'
    },
    {
        modelId: 'mixtral-8x7b-32768',
        modelName: 'Mixtral 8x7B',
        provider: 'Groq',
        inputPrice: 0.14,
        outputPrice: 0.42,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text', 'instruct'],
        category: 'text',
        isLatest: true,
        notes: 'Mixtral 8x7B on Groq - ultra-fast inference'
    },

    // Hugging Face Models
    {
        modelId: 'meta-llama/Llama-2-70b-chat-hf',
        modelName: 'Llama 2 70B Chat',
        provider: 'Hugging Face',
        inputPrice: 0.70,
        outputPrice: 0.80,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Llama 2 70B Chat on Hugging Face'
    },
    {
        modelId: 'meta-llama/Llama-2-13b-chat-hf',
        modelName: 'Llama 2 13B Chat',
        provider: 'Hugging Face',
        inputPrice: 0.20,
        outputPrice: 0.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Llama 2 13B Chat on Hugging Face'
    },

    // Ollama Models
    {
        modelId: 'llama2',
        modelName: 'Llama 2',
        provider: 'Ollama',
        inputPrice: 0.00,
        outputPrice: 0.00,
        unit: PricingUnit.PER_REQUEST,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Llama 2 on Ollama - local deployment'
    },
    {
        modelId: 'llama2:13b',
        modelName: 'Llama 2 13B',
        provider: 'Ollama',
        inputPrice: 0.00,
        outputPrice: 0.00,
        unit: PricingUnit.PER_REQUEST,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Llama 2 13B on Ollama - local deployment'
    },

    // Replicate Models
    {
        modelId: 'meta/llama-2-70b-chat',
        modelName: 'Llama 2 70B Chat',
        provider: 'Replicate',
        inputPrice: 0.70,
        outputPrice: 0.80,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Llama 2 70B Chat on Replicate'
    },
    {
        modelId: 'meta/llama-2-13b-chat',
        modelName: 'Llama 2 13B Chat',
        provider: 'Replicate',
        inputPrice: 0.20,
        outputPrice: 0.25,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 4096,
        capabilities: ['text', 'chat'],
        category: 'text',
        isLatest: false,
        notes: 'Llama 2 13B Chat on Replicate'
    },

    // Azure OpenAI Models
    {
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        provider: 'Azure OpenAI',
        inputPrice: 30.00,
        outputPrice: 60.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 8192,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'GPT-4 on Azure OpenAI'
    },
    {
        modelId: 'gpt-4-turbo',
        modelName: 'GPT-4 Turbo',
        provider: 'Azure OpenAI',
        inputPrice: 10.00,
        outputPrice: 30.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'vision', 'multimodal'],
        category: 'text',
        isLatest: false,
        notes: 'GPT-4 Turbo on Azure OpenAI'
    },
    {
        modelId: 'gpt-3.5-turbo',
        modelName: 'GPT-3.5 Turbo',
        provider: 'Azure OpenAI',
        inputPrice: 0.50,
        outputPrice: 1.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 16385,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'GPT-3.5 Turbo on Azure OpenAI'
    }
]; 