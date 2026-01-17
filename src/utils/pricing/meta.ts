import { ModelPricing, PricingUnit } from './types';

export const META_PRICING: ModelPricing[] = [
  // === Llama 4 Series (Latest) ===
  {
    modelId: 'llama-4-scout',
    modelName: 'Llama 4 Scout',
    provider: 'Meta',
    inputPrice: 0.15,
    outputPrice: 0.45,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 10000000, // 10M context window
    capabilities: ['text', 'vision', 'coding', 'reasoning'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Class-leading natively multimodal model with superior text and visual intelligence. 17B active params x 16 experts, 109B total params. Includes Llama Guard 4 12B, Llama Prompt Guard 2 22M and 86M. Features 10M context window and improved multimodal capabilities. Pricing varies by provider: ~$0.08-$0.18 per 1M input tokens, ~$0.30-$0.59 per 1M output tokens. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 4 Community License Agreement'
  },
  {
    modelId: 'llama-4-maverick',
    modelName: 'Llama 4 Maverick',
    provider: 'Meta',
    inputPrice: 0.25,
    outputPrice: 0.75,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 10000000, // 10M context window
    capabilities: ['text', 'vision', 'coding', 'reasoning', 'multilingual', 'long-context'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Industry-leading natively multimodal model with groundbreaking intelligence and fast responses at a low cost. 17B active params x 128 experts, 400B total params. Includes Llama Guard 4 12B, Llama Prompt Guard 2 22M and 86M. Features 10M context window and improved multimodal capabilities. Pricing varies by provider: ~$0.15-$0.27 per 1M input tokens, ~$0.60-$0.85 per 1M output tokens. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 4 Community License Agreement'
  },
  {
    modelId: 'llama-4-behemoth-preview',
    modelName: 'Llama 4 Behemoth Preview',
    provider: 'Meta',
    inputPrice: 0.30,
    outputPrice: 0.30,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 10000000, // 10M context window
    capabilities: ['text', 'vision', 'coding', 'reasoning', 'multilingual'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Early preview of the Llama 4 teacher model used to distill Llama 4 Scout and Llama 4 Maverick. Still in training phase. Licensed under Llama 4 Community License Agreement'
  },

  // === Llama 3.3 Series ===
  {
    modelId: 'llama-3.3-70b',
    modelName: 'Llama 3.3 70B',
    provider: 'Meta',
    inputPrice: 0.10,
    outputPrice: 0.10,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'coding'],
    category: 'text',
    isLatest: true,
    notes: 'Multilingual open source large language model. Experience 405B performance and quality at a fraction of the cost. Highly cost-efficient model delivering performance comparable to larger models at significantly lower cost. Pricing varies by provider: ~$0.07-$0.88 per 1M tokens (input/output). Available on Azure AI Foundry (~$0.70/1M tokens), AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.3 Community License Agreement'
  },

  // === Llama 3.2 Series ===
  {
    modelId: 'llama-3.2-11b',
    modelName: 'Llama 3.2 11B',
    provider: 'Meta',
    inputPrice: 0.08,
    outputPrice: 0.08,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 128000,
    capabilities: ['text', 'vision'],
    category: 'multimodal',
    isLatest: true,
    notes: 'Open multimodal model that is flexible and can reason on high resolution images and output text. Includes Llama Guard 3 11B Vision. Pricing varies by provider: ~$0.02-$0.18 per 1M tokens (input/output). Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.2 Community License Agreement'
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
    notes: 'Open multimodal model that is flexible and can reason on high resolution images and output text. Includes Llama Guard 3 11B Vision. Pricing varies by provider. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.2 Community License Agreement'
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
    notes: 'Lightweight and most cost-efficient model you can run anywhere on mobile and on edge devices. Includes Llama Guard 3 1B. Quantized models available. Pricing varies by provider: ~$0.02-$0.18 per 1M tokens (input/output). Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.2 Community License Agreement'
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
    notes: 'Lightweight and most cost-efficient model you can run anywhere on mobile and on edge devices. Includes Llama Guard 3 1B. Quantized models available. Pricing varies by provider: ~$0.02-$0.18 per 1M tokens (input/output). Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.2 Community License Agreement'
  },

  // === Llama 3.1 Series ===
  {
    modelId: 'llama-3.1-405b',
    modelName: 'Llama 3.1 405B',
    provider: 'Meta',
    inputPrice: 2.25,
    outputPrice: 2.25,
    unit: PricingUnit.PER_1M_TOKENS,
    contextWindow: 131072,
    capabilities: ['text', 'reasoning'],
    category: 'text',
    isLatest: false,
    notes: 'Multilingual open source large language model. Includes Llama Guard 3 8B and Llama Prompt Guard 2. Pricing varies by provider: ~$1.00-$3.50 per 1M tokens (input/output). Together AI offers at $3.50/1M tokens. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.1 Community License Agreement'
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
    notes: 'Multilingual open source large language model. Includes Llama Guard 3 8B and Llama Prompt Guard 2. Pricing varies by provider: ~$0.02-$0.18 per 1M tokens (input/output). Together AI offers at $0.18/1M tokens. DeepInfra provides Llama-3.1-8B-Instruct-Turbo at $0.02/$0.03 (input/output) per million tokens. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Licensed under Llama 3.1 Community License Agreement'
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
    notes: 'Legacy Llama 3 70B model. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Self-hosting requires substantial GPU resources (e.g., H100s). Licensed under Llama 3 Community License Agreement'
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
    notes: 'Legacy Llama 3 8B model. Available on Azure, AWS Bedrock, Together AI, and DeepInfra. Models are open-source and can be run for free if you have your own hardware. Licensed under Llama 3 Community License Agreement'
  }
];
