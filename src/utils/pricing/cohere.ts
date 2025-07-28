import { ModelPricing, PricingUnit } from '../pricing';

export const COHERE_PRICING: ModelPricing[] = [
    {
        modelId: 'command-r-plus',
        modelName: 'Command R+',
        provider: 'Cohere',
        inputPrice: 3.00,
        outputPrice: 15.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Latest Command R+ model with multilingual support'
    },
    {
        modelId: 'command-r',
        modelName: 'Command R',
        provider: 'Cohere',
        inputPrice: 0.50,
        outputPrice: 1.50,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 128000,
        capabilities: ['text', 'multilingual'],
        category: 'text',
        isLatest: true,
        notes: 'Command R model with multilingual support'
    },
    {
        modelId: 'command-light',
        modelName: 'Command Light',
        provider: 'Cohere',
        inputPrice: 0.10,
        outputPrice: 0.30,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 32768,
        capabilities: ['text'],
        category: 'text',
        isLatest: false,
        notes: 'Command Light model - fast and efficient'
    },
    {
        modelId: 'embed-english-v3',
        modelName: 'Embed English v3',
        provider: 'Cohere',
        inputPrice: 0.10,
        outputPrice: 0.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 512,
        capabilities: ['embedding'],
        category: 'embedding',
        isLatest: true,
        notes: 'Cohere Embed English v3'
    },
    {
        modelId: 'embed-multilingual-v3',
        modelName: 'Embed Multilingual v3',
        provider: 'Cohere',
        inputPrice: 0.10,
        outputPrice: 0.00,
        unit: PricingUnit.PER_1M_TOKENS,
        contextWindow: 512,
        capabilities: ['embedding', 'multilingual'],
        category: 'embedding',
        isLatest: true,
        notes: 'Cohere Embed Multilingual v3'
    }
]; 