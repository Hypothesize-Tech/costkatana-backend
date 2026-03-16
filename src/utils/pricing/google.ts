import { ModelPricing, PricingUnit } from './types';

export const GOOGLE_PRICING: ModelPricing[] = [
  {
    modelId: 'gemini-1.5-flash',
    modelName: 'Gemini 1.5 Flash',
    provider: 'Google',
    inputPrice: 0.075,
    outputPrice: 0.3,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'long-context'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Gemini 1.5 Flash - fast multimodal model with 1M context',
  },
  {
    modelId: 'gemini-1.5-pro',
    modelName: 'Gemini 1.5 Pro',
    provider: 'Google',
    inputPrice: 1.25,
    outputPrice: 5.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 1000000,
    capabilities: ['text', 'vision', 'reasoning', 'long-context'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Gemini 1.5 Pro - advanced multimodal reasoning with 1M context',
  },
];
