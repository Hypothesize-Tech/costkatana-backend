import { ModelPricing, PricingUnit } from './types';

export const GROK_PRICING: ModelPricing[] = [
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
    category: 'multimodal',
    isLatest: true,
    notes: 'Latest Grok 4 with reasoning, vision support coming soon. 2M TPM, 480 RPM rate limits'
  },
  // Grok 3 - Standard model
  {
    modelId: 'grok-3',
    modelName: 'Grok 3',
    provider: 'xAI',
    inputPrice: 3.0,
    outputPrice: 15.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'vision', 'function-calling', 'structured-outputs'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Standard Grok 3 model. 600 RPM rate limits'
  },
  // Grok 3 Mini - Cost-effective
  {
    modelId: 'grok-3-mini',
    modelName: 'Grok 3 Mini',
    provider: 'xAI',
    inputPrice: 0.3,
    outputPrice: 0.5,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'vision', 'function-calling', 'structured-outputs'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Cost-effective Grok 3 Mini. 480 RPM rate limits'
  },
  // Grok 2 Image Generation
  {
    modelId: 'grok-2-image-1212',
    modelName: 'Grok 2 Image',
    provider: 'xAI',
    inputPrice: 0.07,
    outputPrice: 0.07,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation'],
    category: 'image',
    isLatest: true,
    notes: 'Grok 2 image generation model. $0.07 per image, 300 RPM rate limits'
  }
];
