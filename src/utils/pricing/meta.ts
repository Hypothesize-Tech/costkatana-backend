import { ModelPricing, PricingUnit } from '../pricing';

export const META_PRICING: ModelPricing[] = [
  // Llama 4 Scout - Class-leading natively multimodal model
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
    notes: 'Class-leading natively multimodal model with superior text and visual intelligence, single H100 GPU efficiency, and 10M context window for seamless long document analysis'
  },
  // Llama 4 Maverick - Industry-leading natively multimodal model
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
    notes: 'Industry-leading natively multimodal model for image and text understanding with groundbreaking intelligence and fast responses at a low cost'
  },
  // Llama 4 Behemoth Preview - Early preview of teacher model
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
    notes: 'Early preview of the Llama 4 teacher model used to distill Llama 4 Scout and Llama 4 Maverick. Still in training phase'
  }
];
