import { ModelPricing, PricingUnit } from './types';

export const GROK_PRICING: ModelPricing[] = [
  // === Grok 4.1 Fast Series (Latest) ===
  {
    modelId: 'grok-4-1-fast-reasoning',
    modelName: 'Grok 4.1 Fast Reasoning',
    provider: 'xAI',
    inputPrice: 0.20,
    outputPrice: 0.50,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'reasoning', 'agents', 'tools'],
    category: 'text',
    isLatest: true,
    notes: 'Latest cost-efficient reasoning model with 2M context window. Lightning fast, low cost. 4M TPM, 480 RPM rate limits'
  },
  {
    modelId: 'grok-4-1-fast-non-reasoning',
    modelName: 'Grok 4.1 Fast Non-Reasoning',
    provider: 'xAI',
    inputPrice: 0.20,
    outputPrice: 0.50,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'fast'],
    category: 'text',
    isLatest: true,
    notes: 'Latest cost-efficient non-reasoning model with 2M context window. Lightning fast, low cost. 4M TPM, 480 RPM rate limits'
  },
  // === Grok 4 Fast Series ===
  {
    modelId: 'grok-4-fast-reasoning',
    modelName: 'Grok 4 Fast Reasoning',
    provider: 'xAI',
    inputPrice: 0.20,
    outputPrice: 0.50,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'reasoning', 'agents'],
    category: 'text',
    isLatest: true,
    notes: 'Cost-efficient reasoning model with 2M context window. Lightning fast, low cost. 4M TPM, 480 RPM rate limits'
  },
  {
    modelId: 'grok-4-fast-non-reasoning',
    modelName: 'Grok 4 Fast Non-Reasoning',
    provider: 'xAI',
    inputPrice: 0.20,
    outputPrice: 0.50,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 2000000,
    capabilities: ['text', 'vision', 'fast'],
    category: 'text',
    isLatest: true,
    notes: 'Cost-efficient non-reasoning model with 2M context window. Lightning fast, low cost. 4M TPM, 480 RPM rate limits'
  },
  {
    modelId: 'grok-code-fast-1',
    modelName: 'Grok Code Fast 1',
    provider: 'xAI',
    inputPrice: 0.20,
    outputPrice: 1.50,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 256000,
    capabilities: ['text', 'coding', 'function-calling', 'structured-outputs'],
    category: 'code',
    isLatest: true,
    notes: 'Cost-efficient coding model optimized for code generation and programming tasks. 2M TPM, 480 RPM rate limits'
  },

  // === Grok 4 Series ===
  {
    modelId: 'grok-4-0709',
    modelName: 'Grok 4',
    provider: 'xAI',
    inputPrice: 3.0,
    outputPrice: 15.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 256000,
    capabilities: ['text', 'reasoning', 'function-calling', 'structured-outputs'],
    category: 'text',
    isLatest: true,
    notes: 'Latest Grok 4 reasoning model. Note: Grok 4 is always a reasoning model with no non-reasoning mode. 2M TPM, 480 RPM rate limits. Knowledge cutoff: November 2024'
  },
  {
    modelId: 'grok-4',
    modelName: 'Grok 4 (Alias)',
    provider: 'xAI',
    inputPrice: 3.0,
    outputPrice: 15.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 256000,
    capabilities: ['text', 'reasoning', 'function-calling', 'structured-outputs'],
    category: 'text',
    isLatest: true,
    notes: 'Alias for latest stable Grok 4 version. Points to grok-4-0709. 2M TPM, 480 RPM rate limits'
  },
  {
    modelId: 'grok-4-latest',
    modelName: 'Grok 4 Latest',
    provider: 'xAI',
    inputPrice: 3.0,
    outputPrice: 15.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 256000,
    capabilities: ['text', 'reasoning', 'function-calling', 'structured-outputs'],
    category: 'text',
    isLatest: true,
    notes: 'Alias for latest Grok 4 version (may include preview features). Auto-updates with new releases. 2M TPM, 480 RPM rate limits'
  },

  // === Grok 3 Series ===
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
    notes: 'Standard Grok 3 model. 600 RPM rate limits. Knowledge cutoff: November 2024'
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
    category: 'multimodal',
    isLatest: false,
    notes: 'Cost-effective Grok 3 Mini model. 480 RPM rate limits. Knowledge cutoff: November 2024'
  },

  // === Grok 2 Vision Series ===
  {
    modelId: 'grok-2-vision-1212',
    modelName: 'Grok 2 Vision',
    provider: 'xAI',
    inputPrice: 2.0,
    outputPrice: 10.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 32768,
    capabilities: ['text', 'vision', 'image-understanding'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Grok 2 Vision model for image understanding. 600 RPM rate limits (us-east-1) or 50 RPS (eu-west-1)'
  },
  {
    modelId: 'grok-2-vision-1212-us-east-1',
    modelName: 'Grok 2 Vision (US East)',
    provider: 'xAI',
    inputPrice: 2.0,
    outputPrice: 10.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 32768,
    capabilities: ['text', 'vision', 'image-understanding'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Grok 2 Vision model for us-east-1 region. 600 RPM rate limits'
  },
  {
    modelId: 'grok-2-vision-1212-eu-west-1',
    modelName: 'Grok 2 Vision (EU West)',
    provider: 'xAI',
    inputPrice: 2.0,
    outputPrice: 10.0,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 32768,
    capabilities: ['text', 'vision', 'image-understanding'],
    category: 'multimodal',
    isLatest: false,
    notes: 'Grok 2 Vision model for eu-west-1 region. 50 RPS rate limits'
  },

  // === Grok 2 Image Generation ===
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
    notes: 'Grok 2 image generation model. $0.07 per image output, 300 RPM rate limits'
  },
  {
    modelId: 'grok-2-image',
    modelName: 'Grok 2 Image (Alias)',
    provider: 'xAI',
    inputPrice: 0.07,
    outputPrice: 0.07,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation'],
    category: 'image',
    isLatest: true,
    notes: 'Alias for latest stable Grok 2 Image version. Points to grok-2-image-1212. $0.07 per image, 300 RPM rate limits'
  },
  {
    modelId: 'grok-2-image-latest',
    modelName: 'Grok 2 Image Latest',
    provider: 'xAI',
    inputPrice: 0.07,
    outputPrice: 0.07,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation'],
    category: 'image',
    isLatest: true,
    notes: 'Alias for latest Grok 2 Image version. Auto-updates with new releases. $0.07 per image, 300 RPM rate limits'
  }
];
