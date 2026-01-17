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
    notes: 'Latest cost-efficient reasoning model with 2M context window. Lightning fast, low cost. Priced at $0.20 per 1M input tokens and $0.50 per 1M output tokens. Rate limits: 4M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Latest cost-efficient non-reasoning model with 2M context window. Lightning fast, low cost. Priced at $0.20 per 1M input tokens and $0.50 per 1M output tokens. Rate limits: 4M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Cost-efficient reasoning model with 2M context window. Lightning fast, low cost. Priced at $0.20 per 1M input tokens and $0.50 per 1M output tokens. Rate limits: 4M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Cost-efficient non-reasoning model with 2M context window. Lightning fast, low cost. Priced at $0.20 per 1M input tokens and $0.50 per 1M output tokens. Rate limits: 4M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Cost-efficient coding model optimized for code generation and programming tasks. Priced at $0.20 per 1M input tokens and $1.50 per 1M output tokens. Context window: 256K tokens. Rate limits: 2M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Latest Grok 4 reasoning model. Note: Grok 4 is always a reasoning model with no non-reasoning mode. Priced at $3.00 per 1M input tokens and $15.00 per 1M output tokens. Context window: 256K tokens. Rate limits: 2M TPM (tokens per minute), 480 RPM (requests per minute). Knowledge cutoff: November 2024'
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
    notes: 'Alias for latest stable Grok 4 version. Points to grok-4-0709. Priced at $3.00 per 1M input tokens and $15.00 per 1M output tokens. Context window: 256K tokens. Rate limits: 2M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Alias for latest Grok 4 version (may include preview features). Auto-updates with new releases. Priced at $3.00 per 1M input tokens and $15.00 per 1M output tokens. Context window: 256K tokens. Rate limits: 2M TPM (tokens per minute), 480 RPM (requests per minute)'
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
    notes: 'Standard Grok 3 model. Priced at $3.00 per 1M input tokens and $15.00 per 1M output tokens. Context window: 131K tokens. Rate limits: 600 RPM (requests per minute). Knowledge cutoff: November 2024'
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
    notes: 'Cost-effective Grok 3 Mini model. Priced at $0.30 per 1M input tokens and $0.50 per 1M output tokens. Context window: 131K tokens. Rate limits: 480 RPM (requests per minute). Knowledge cutoff: November 2024'
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
    notes: 'Grok 2 Vision model for image understanding. Priced at $2.00 per 1M input tokens and $10.00 per 1M output tokens. Context window: 32K tokens. Rate limits: 600 RPM (requests per minute) for us-east-1 region, 50 RPS (requests per second) for eu-west-1 region'
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
    notes: 'Grok 2 Vision model for us-east-1 region. Priced at $2.00 per 1M input tokens and $10.00 per 1M output tokens. Context window: 32K tokens. Rate limits: 600 RPM (requests per minute)'
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
    notes: 'Grok 2 Vision model for eu-west-1 region. Priced at $2.00 per 1M input tokens and $10.00 per 1M output tokens. Context window: 32K tokens. Rate limits: 50 RPS (requests per second)'
  },

  // === Grok 2 Image Generation ===
  {
    modelId: 'grok-2-image-1212',
    modelName: 'Grok 2 Image',
    provider: 'xAI',
    inputPrice: 0.07,
    outputPrice: 0.0,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image'],
    category: 'image',
    isLatest: true,
    notes: 'Grok 2 image generation model. Priced at $0.07 per image output. Rate limits: 300 RPM (requests per minute)'
  },
  {
    modelId: 'grok-2-image',
    modelName: 'Grok 2 Image (Alias)',
    provider: 'xAI',
    inputPrice: 0.07,
    outputPrice: 0.0,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image'],
    category: 'image',
    isLatest: true,
    notes: 'Alias for latest stable Grok 2 Image version. Points to grok-2-image-1212. Priced at $0.07 per image output. Rate limits: 300 RPM (requests per minute)'
  },
  {
    modelId: 'grok-2-image-latest',
    modelName: 'Grok 2 Image Latest',
    provider: 'xAI',
    inputPrice: 0.07,
    outputPrice: 0.0,
    unit: PricingUnit.PER_REQUEST,
    contextWindow: 0,
    capabilities: ['image-generation', 'text-to-image'],
    category: 'image',
    isLatest: true,
    notes: 'Alias for latest Grok 2 Image version. Auto-updates with new releases. Priced at $0.07 per image output. Rate limits: 300 RPM (requests per minute)'
  }
];
