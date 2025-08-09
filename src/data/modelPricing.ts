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
    'gemini-1.5-pro': {
        provider: 'Google',
        inputPrice: 3.5,
        outputPrice: 10.5,
        contextWindow: 2097152,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning', 'vision']
    },
    'gemini-1.5-flash': {
        provider: 'Google',
        inputPrice: 0.075,
        outputPrice: 0.3,
        contextWindow: 1048576,
        category: 'fast',
        features: ['chat', 'text-generation', 'analysis']
    },
    'gemini-pro': {
        provider: 'Google',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 32768,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis']
    },

    // Cohere Models
    'command-r-plus': {
        provider: 'Cohere',
        inputPrice: 3.0,
        outputPrice: 15.0,
        contextWindow: 128000,
        category: 'premium',
        features: ['chat', 'text-generation', 'analysis', 'reasoning']
    },
    'command-r': {
        provider: 'Cohere',
        inputPrice: 0.5,
        outputPrice: 1.5,
        contextWindow: 128000,
        category: 'balanced',
        features: ['chat', 'text-generation', 'analysis']
    },
    'command': {
        provider: 'Cohere',
        inputPrice: 1.0,
        outputPrice: 2.0,
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

    // Mistral Models
    'mistral-large-latest': {
        provider: 'Mistral',
        inputPrice: 4.0,
        outputPrice: 12.0,
        contextWindow: 32768,
        category: 'premium',
        features: ['chat', 'text-generation', 'reasoning', 'code-generation']
    },
    'mistral-medium-latest': {
        provider: 'Mistral',
        inputPrice: 2.7,
        outputPrice: 8.1,
        contextWindow: 32768,
        category: 'balanced',
        features: ['chat', 'text-generation', 'reasoning']
    },
    'mistral-small-latest': {
        provider: 'Mistral',
        inputPrice: 1.0,
        outputPrice: 3.0,
        contextWindow: 32768,
        category: 'balanced',
        features: ['chat', 'text-generation']
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
    'gpt-4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-4-turbo-preview': 'gpt-4-turbo-preview',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    
    // Gemini variations
    'gemini-pro': 'gemini-pro',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash',
    
    // Cohere variations
    'command-r': 'cohere.command-r-v1:0',
    'command-r-plus': 'cohere.command-r-plus-v1:0',
    'cohere.command-r-v1:0': 'command-r',
    'cohere.command-r-plus-v1:0': 'command-r-plus',
    
    // Mistral variations
    'mistral-7b': 'mistral.mistral-7b-instruct-v0:2',
    'mistral-large': 'mistral.mistral-large-2402-v1:0',
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
    'meta.llama3-70b-instruct-v1:0': 'llama3-70b-instruct'
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