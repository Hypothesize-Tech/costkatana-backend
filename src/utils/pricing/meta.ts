import { ModelPricing, PricingUnit } from './types';

export const META_PRICING: ModelPricing[] = [
  // === Llama 4 Series (Latest) ===
  {
    modelId: 'llama-4-scout',
    modelName: 'Llama 4 Scout',
    provider: 'Meta',
    inputPrice: 0.19,
    outputPrice: 0.49,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 10000000, // 10M context window
    capabilities: ['text', 'vision', 'multimodal', 'long-context', 'multilingual', 'image-grounding'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Class-leading natively multimodal model with superior text and visual intelligence. 17B active params x 16 experts, 109B total params. Includes Llama Guard 4 12B, Llama Prompt Guard 2 22M and 86M. Licensed under Llama 4 Community License Agreement'
  },
  {
    modelId: 'llama-4-maverick',
    modelName: 'Llama 4 Maverick',
    provider: 'Meta',
    inputPrice: 0.19,
    outputPrice: 0.49,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 10000000, // 10M context window
    capabilities: ['text', 'vision', 'multimodal', 'long-context', 'multilingual', 'image-grounding', 'fast-responses'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Industry-leading natively multimodal model with groundbreaking intelligence and fast responses at a low cost. 17B active params x 128 experts, 400B total params. Includes Llama Guard 4 12B, Llama Prompt Guard 2 22M and 86M. Licensed under Llama 4 Community License Agreement'
  },
  {
    modelId: 'llama-4-behemoth-preview',
    modelName: 'Llama 4 Behemoth Preview',
    provider: 'Meta',
    inputPrice: 0.19,
    outputPrice: 0.49,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 10000000, // 10M context window
    capabilities: ['text', 'vision', 'multimodal', 'long-context', 'multilingual', 'image-grounding', 'teacher-model'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Early preview of the Llama 4 teacher model used to distill Llama 4 Scout and Llama 4 Maverick. Still in training phase. Licensed under Llama 4 Community License Agreement'
  },

  // === Llama 3.3 Series ===
  {
    modelId: 'llama-3.3-70b',
    modelName: 'Llama 3.3 70B',
    provider: 'Meta',
    inputPrice: 0.59,
    outputPrice: 0.79,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'multilingual', 'open-source'],
    category: 'text',
    isLatest: true,
    notes: 'Multilingual open source large language model. Experience 405B performance and quality at a fraction of the cost. Licensed under Llama 3.3 Community License Agreement'
  },

  // === Llama 3.2 Series ===
  {
    modelId: 'llama-3.2-11b',
    modelName: 'Llama 3.2 11B',
    provider: 'Meta',
    inputPrice: 0.16,
    outputPrice: 0.16,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 128000,
    capabilities: ['text', 'vision', 'multimodal', 'open-source'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Open multimodal model that is flexible and can reason on high resolution images and output text. Includes Llama Guard 3 11B Vision. Licensed under Llama 3.2 Community License Agreement'
  },
  {
    modelId: 'llama-3.2-90b',
    modelName: 'Llama 3.2 90B',
    provider: 'Meta',
    inputPrice: 0.72,
    outputPrice: 0.72,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 128000,
    capabilities: ['text', 'vision', 'multimodal', 'open-source'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Open multimodal model that is flexible and can reason on high resolution images and output text. Includes Llama Guard 3 11B Vision. Licensed under Llama 3.2 Community License Agreement'
  },
  {
    modelId: 'llama-3.2-3b',
    modelName: 'Llama 3.2 3B',
    provider: 'Meta',
    inputPrice: 0.05,
    outputPrice: 0.10,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 128000,
    capabilities: ['text', 'lightweight', 'mobile', 'edge', 'open-source'],
    category: 'text',
    isLatest: true,
    notes: 'Lightweight and most cost-efficient model you can run anywhere on mobile and on edge devices. Includes Llama Guard 3 1B. Quantized models available. Licensed under Llama 3.2 Community License Agreement'
  },
  {
    modelId: 'llama-3.2-1b',
    modelName: 'Llama 3.2 1B',
    provider: 'Meta',
    inputPrice: 0.05,
    outputPrice: 0.10,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 128000,
    capabilities: ['text', 'lightweight', 'mobile', 'edge', 'open-source'],
    category: 'text',
    isLatest: true,
    notes: 'Lightweight and most cost-efficient model you can run anywhere on mobile and on edge devices. Includes Llama Guard 3 1B. Quantized models available. Licensed under Llama 3.2 Community License Agreement'
  },

  // === Llama 3.1 Series ===
  {
    modelId: 'llama-3.1-405b',
    modelName: 'Llama 3.1 405B',
    provider: 'Meta',
    inputPrice: 0.0, // Open source - pricing varies by provider
    outputPrice: 0.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'multilingual', 'open-source'],
    category: 'text',
    isLatest: false,
    notes: 'Multilingual open source large language model. Includes Llama Guard 3 8B and Llama Prompt Guard 2. Licensed under Llama 3.1 Community License Agreement'
  },
  {
    modelId: 'llama-3.1-8b',
    modelName: 'Llama 3.1 8B',
    provider: 'Meta',
    inputPrice: 0.05,
    outputPrice: 0.10,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'multilingual', 'open-source'],
    category: 'text',
    isLatest: false,
    notes: 'Multilingual open source large language model. Includes Llama Guard 3 8B and Llama Prompt Guard 2. Licensed under Llama 3.1 Community License Agreement'
  },

  // === Llama 3 Series (Legacy) ===
  {
    modelId: 'llama-3-70b',
    modelName: 'Llama 3 70B',
    provider: 'Meta',
    inputPrice: 0.59,
    outputPrice: 0.79,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source'],
    category: 'text',
    isLatest: false,
    notes: 'Legacy Llama 3 70B model. Licensed under Llama 3 Community License Agreement'
  },
  {
    modelId: 'llama-3-8b',
    modelName: 'Llama 3 8B',
    provider: 'Meta',
    inputPrice: 0.05,
    outputPrice: 0.10,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 8192,
    capabilities: ['text', 'open-source'],
    category: 'text',
    isLatest: false,
    notes: 'Legacy Llama 3 8B model. Licensed under Llama 3 Community License Agreement'
  }
];
