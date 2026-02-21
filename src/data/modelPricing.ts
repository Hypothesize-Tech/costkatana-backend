/**
 * Model Pricing Data
 * 
 * This file provides model pricing information and utility functions
 * for cost optimization and model selection.
 */

export interface ModelPricing {
  model: string;
  provider: string;
  inputCostPer1K: number;
  outputCostPer1K: number;
  maxTokens: number;
  capabilities: string[];
  inputPrice: number;
  outputPrice: number;
  contextWindow: number;
  category: string;
  features: string[];
}

export interface UseCase {
  type: string;
  volume: 'low' | 'medium' | 'high';
  complexity: 'simple' | 'moderate' | 'complex';
  priority: 'cost' | 'quality' | 'speed' | 'balanced';
}

// Comprehensive model pricing data (updated with latest models)
// Prices are per 1K tokens (converted from per 1M tokens)
const modelPricingData: ModelPricing[] = [
  // === OpenAI Models ===
  {
    model: 'gpt-5',
    provider: 'openai',
    inputCostPer1K: 0.00125,
    outputCostPer1K: 0.01,
    maxTokens: 128000,
    capabilities: ['text-generation', 'reasoning', 'analysis', 'advanced-intelligence'],
    inputPrice: 0.00125,
    outputPrice: 0.01,
    contextWindow: 128000,
    category: 'premium',
    features: ['text-generation', 'reasoning', 'analysis', 'advanced-intelligence']
  },
  {
    model: 'gpt-5-mini',
    provider: 'openai',
    inputCostPer1K: 0.00025,
    outputCostPer1K: 0.002,
    maxTokens: 128000,
    capabilities: ['text-generation', 'reasoning', 'analysis', 'efficient'],
    inputPrice: 0.00025,
    outputPrice: 0.002,
    contextWindow: 128000,
    category: 'balanced',
    features: ['text-generation', 'reasoning', 'analysis', 'efficient']
  },
  {
    model: 'gpt-4.1-2025-04-14',
    provider: 'openai',
    inputCostPer1K: 0.002,
    outputCostPer1K: 0.008,
    maxTokens: 128000,
    capabilities: ['text-generation', 'analysis', 'reasoning', 'enhanced'],
    inputPrice: 0.002,
    outputPrice: 0.008,
    contextWindow: 128000,
    category: 'premium',
    features: ['text-generation', 'analysis', 'reasoning', 'enhanced']
  },
  {
    model: 'gpt-4o-2024-08-06',
    provider: 'openai',
    inputCostPer1K: 0.0025,
    outputCostPer1K: 0.01,
    maxTokens: 128000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'analysis'],
    inputPrice: 0.0025,
    outputPrice: 0.01,
    contextWindow: 128000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'analysis']
  },
  {
    model: 'gpt-4o-mini-2024-07-18',
    provider: 'openai',
    inputCostPer1K: 0.00015,
    outputCostPer1K: 0.0006,
    maxTokens: 128000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'efficient'],
    inputPrice: 0.00015,
    outputPrice: 0.0006,
    contextWindow: 128000,
    category: 'fast',
    features: ['text-generation', 'vision', 'multimodal', 'efficient']
  },
  {
    model: 'o3-2025-04-16',
    provider: 'openai',
    inputCostPer1K: 0.002,
    outputCostPer1K: 0.008,
    maxTokens: 128000,
    capabilities: ['text-generation', 'reasoning', 'analysis'],
    inputPrice: 0.002,
    outputPrice: 0.008,
    contextWindow: 128000,
    category: 'reasoning',
    features: ['text-generation', 'reasoning', 'analysis']
  },
  {
    model: 'o3-mini-2025-01-31',
    provider: 'openai',
    inputCostPer1K: 0.0011,
    outputCostPer1K: 0.0044,
    maxTokens: 128000,
    capabilities: ['text-generation', 'reasoning', 'efficient'],
    inputPrice: 0.0011,
    outputPrice: 0.0044,
    contextWindow: 128000,
    category: 'reasoning',
    features: ['text-generation', 'reasoning', 'efficient']
  },
  {
    model: 'gpt-4-turbo',
    provider: 'openai',
    inputCostPer1K: 0.01,
    outputCostPer1K: 0.03,
    maxTokens: 128000,
    capabilities: ['text-generation', 'vision', 'multimodal'],
    inputPrice: 0.01,
    outputPrice: 0.03,
    contextWindow: 128000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal']
  },
  {
    model: 'gpt-4',
    provider: 'openai',
    inputCostPer1K: 0.03,
    outputCostPer1K: 0.06,
    maxTokens: 8192,
    capabilities: ['text-generation', 'analysis', 'summarization', 'reasoning'],
    inputPrice: 0.03,
    outputPrice: 0.06,
    contextWindow: 8192,
    category: 'premium',
    features: ['text-generation', 'analysis', 'summarization', 'reasoning']
  },
  {
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    inputCostPer1K: 0.0005,
    outputCostPer1K: 0.0015,
    maxTokens: 16385,
    capabilities: ['text-generation', 'analysis', 'summarization'],
    inputPrice: 0.0005,
    outputPrice: 0.0015,
    contextWindow: 16385,
    category: 'fast',
    features: ['text-generation', 'analysis', 'summarization']
  },

  // === Anthropic Models ===
  {
    model: 'claude-opus-4-6-v1',
    provider: 'anthropic',
    inputCostPer1K: 0.005,
    outputCostPer1K: 0.025,
    maxTokens: 1000000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual'],
    inputPrice: 0.005,
    outputPrice: 0.025,
    contextWindow: 1000000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual']
  },
  {
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'extended-thinking', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'extended-thinking', 'multilingual']
  },
  {
    model: 'claude-opus-4-1-20250805',
    provider: 'anthropic',
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
    inputPrice: 0.015,
    outputPrice: 0.075,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual']
  },
  {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual']
  },
  {
    model: 'claude-3-7-sonnet-20250219',
    provider: 'anthropic',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual']
  },
  {
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'multilingual']
  },
  {
    model: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.004,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'multilingual'],
    inputPrice: 0.0008,
    outputPrice: 0.004,
    contextWindow: 200000,
    category: 'balanced',
    features: ['text-generation', 'vision', 'multimodal', 'multilingual']
  },
  {
    model: 'claude-3-opus-20240229',
    provider: 'anthropic',
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning'],
    inputPrice: 0.015,
    outputPrice: 0.075,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning']
  },
  {
    model: 'claude-3-sonnet-20240229',
    provider: 'anthropic',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning']
  },
  {
    model: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    inputCostPer1K: 0.00025,
    outputCostPer1K: 0.00125,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multilingual'],
    inputPrice: 0.00025,
    outputPrice: 0.00125,
    contextWindow: 200000,
    category: 'fast',
    features: ['text-generation', 'vision', 'multilingual']
  },
  {
    model: 'claude-3-haiku',
    provider: 'anthropic',
    inputCostPer1K: 0.00025,
    outputCostPer1K: 0.00125,
    maxTokens: 200000,
    capabilities: ['text-generation', 'analysis', 'summarization'],
    inputPrice: 0.00025,
    outputPrice: 0.00125,
    contextWindow: 200000,
    category: 'balanced',
    features: ['text-generation', 'analysis', 'summarization']
  },
  {
    model: 'claude-3-sonnet',
    provider: 'anthropic',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'analysis', 'summarization', 'reasoning'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'analysis', 'summarization', 'reasoning']
  },
  {
    model: 'claude-3-opus',
    provider: 'anthropic',
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    maxTokens: 200000,
    capabilities: ['text-generation', 'analysis', 'summarization', 'reasoning', 'complex-tasks'],
    inputPrice: 0.015,
    outputPrice: 0.075,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'analysis', 'summarization', 'reasoning', 'complex-tasks']
  },

  // === AWS Bedrock Models ===
  {
    model: 'amazon.nova-pro-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.0032,
    maxTokens: 300000,
    capabilities: ['text-generation', 'multimodal', 'reasoning'],
    inputPrice: 0.0008,
    outputPrice: 0.0032,
    contextWindow: 300000,
    category: 'premium',
    features: ['text-generation', 'multimodal', 'reasoning']
  },
  {
    model: 'amazon.nova-lite-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.0006,
    outputCostPer1K: 0.0024,
    maxTokens: 300000,
    capabilities: ['text-generation', 'multimodal', 'fast'],
    inputPrice: 0.0006,
    outputPrice: 0.0024,
    contextWindow: 300000,
    category: 'balanced',
    features: ['text-generation', 'multimodal', 'fast']
  },
  {
    model: 'amazon.nova-micro-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.00035,
    outputCostPer1K: 0.0014,
    maxTokens: 128000,
    capabilities: ['text-generation', 'fast', 'efficient'],
    inputPrice: 0.00035,
    outputPrice: 0.0014,
    contextWindow: 128000,
    category: 'fast',
    features: ['text-generation', 'fast', 'efficient']
  },
  {
    model: 'anthropic.claude-opus-4-6-v1',
    provider: 'aws',
    inputCostPer1K: 0.005,
    outputCostPer1K: 0.025,
    maxTokens: 1000000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual'],
    inputPrice: 0.005,
    outputPrice: 0.025,
    contextWindow: 1000000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'tool-use', 'extended-thinking', 'multilingual']
  },
  {
    model: 'anthropic.claude-sonnet-4-6-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'extended-thinking', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'agents', 'coding', 'computer-use', 'extended-thinking', 'multilingual']
  },
  {
    model: 'anthropic.claude-opus-4-1-20250805-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
    inputPrice: 0.015,
    outputPrice: 0.075,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual']
  },
  {
    model: 'anthropic.claude-sonnet-4-20250514-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'extended-thinking', 'multilingual']
  },
  {
    model: 'anthropic.claude-3-5-sonnet-20241022-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'reasoning', 'multilingual'],
    inputPrice: 0.003,
    outputPrice: 0.015,
    contextWindow: 200000,
    category: 'premium',
    features: ['text-generation', 'vision', 'multimodal', 'reasoning', 'multilingual']
  },
  {
    model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.0008,
    outputCostPer1K: 0.004,
    maxTokens: 200000,
    capabilities: ['text-generation', 'vision', 'multimodal', 'multilingual'],
    inputPrice: 0.0008,
    outputPrice: 0.004,
    contextWindow: 200000,
    category: 'balanced',
    features: ['text-generation', 'vision', 'multimodal', 'multilingual']
  },
  {
    model: 'meta.llama3-70b-instruct-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.00059,
    outputCostPer1K: 0.00079,
    maxTokens: 8192,
    capabilities: ['text-generation', 'instruct'],
    inputPrice: 0.00059,
    outputPrice: 0.00079,
    contextWindow: 8192,
    category: 'balanced',
    features: ['text-generation', 'instruct']
  },
  {
    model: 'meta.llama3-8b-instruct-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.00005,
    outputCostPer1K: 0.0001,
    maxTokens: 8192,
    capabilities: ['text-generation', 'instruct'],
    inputPrice: 0.00005,
    outputPrice: 0.0001,
    contextWindow: 8192,
    category: 'fast',
    features: ['text-generation', 'instruct']
  },
  {
    model: 'meta.llama3-2-11b-instruct-v1:0',
    provider: 'aws',
    inputCostPer1K: 0.00016,
    outputCostPer1K: 0.00016,
    maxTokens: 128000,
    capabilities: ['text-generation', 'instruct', 'vision'],
    inputPrice: 0.00016,
    outputPrice: 0.00016,
    contextWindow: 128000,
    category: 'multimodal',
    features: ['text-generation', 'instruct', 'vision']
  },

  // === Google AI Models ===
  {
    model: 'gemini-2.5-pro',
    provider: 'google',
    inputCostPer1K: 0.00125,
    outputCostPer1K: 0.01,
    maxTokens: 2000000,
    capabilities: ['text-generation', 'multimodal', 'reasoning', 'coding', 'complex-problems'],
    inputPrice: 0.00125,
    outputPrice: 0.01,
    contextWindow: 2000000,
    category: 'premium',
    features: ['text-generation', 'multimodal', 'reasoning', 'coding', 'complex-problems']
  },
  {
    model: 'gemini-2.5-flash',
    provider: 'google',
    inputCostPer1K: 0.0003,
    outputCostPer1K: 0.0025,
    maxTokens: 1000000,
    capabilities: ['text-generation', 'image', 'video', 'multimodal', 'reasoning', 'thinking', 'live-api'],
    inputPrice: 0.0003,
    outputPrice: 0.0025,
    contextWindow: 1000000,
    category: 'balanced',
    features: ['text-generation', 'image', 'video', 'multimodal', 'reasoning', 'thinking', 'live-api']
  },
  {
    model: 'gemini-2.5-flash-lite-preview',
    provider: 'google',
    inputCostPer1K: 0.0001,
    outputCostPer1K: 0.0004,
    maxTokens: 1000000,
    capabilities: ['text-generation', 'image', 'video', 'multimodal', 'reasoning', 'thinking', 'high-throughput'],
    inputPrice: 0.0001,
    outputPrice: 0.0004,
    contextWindow: 1000000,
    category: 'fast',
    features: ['text-generation', 'image', 'video', 'multimodal', 'reasoning', 'thinking', 'high-throughput']
  },
  {
    model: 'gemini-2.0-flash',
    provider: 'google',
    inputCostPer1K: 0.0001,
    outputCostPer1K: 0.0004,
    maxTokens: 1000000,
    capabilities: ['text-generation', 'image', 'video', 'multimodal', 'agents', 'next-generation'],
    inputPrice: 0.0001,
    outputPrice: 0.0004,
    contextWindow: 1000000,
    category: 'balanced',
    features: ['text-generation', 'image', 'video', 'multimodal', 'agents', 'next-generation']
  },
  {
    model: 'gemini-1.5-pro',
    provider: 'google',
    inputCostPer1K: 0.00125,
    outputCostPer1K: 0.005,
    maxTokens: 2000000,
    capabilities: ['text-generation', 'image', 'video', 'multimodal', 'long-context'],
    inputPrice: 0.00125,
    outputPrice: 0.005,
    contextWindow: 2000000,
    category: 'premium',
    features: ['text-generation', 'image', 'video', 'multimodal', 'long-context']
  },
  {
    model: 'gemini-1.5-flash',
    provider: 'google',
    inputCostPer1K: 0.000075,
    outputCostPer1K: 0.0003,
    maxTokens: 1000000,
    capabilities: ['text-generation', 'image', 'video', 'multimodal'],
    inputPrice: 0.000075,
    outputPrice: 0.0003,
    contextWindow: 1000000,
    category: 'fast',
    features: ['text-generation', 'image', 'video', 'multimodal']
  },

  // === Cohere Models ===
  {
    model: 'cohere.command-r-plus-v1:0',
    provider: 'cohere',
    inputCostPer1K: 0.0025,
    outputCostPer1K: 0.01,
    maxTokens: 128000,
    capabilities: ['text-generation', 'multilingual', 'enterprise'],
    inputPrice: 0.0025,
    outputPrice: 0.01,
    contextWindow: 128000,
    category: 'premium',
    features: ['text-generation', 'multilingual', 'enterprise']
  },
  {
    model: 'cohere.command-r-v1:0',
    provider: 'cohere',
    inputCostPer1K: 0.00015,
    outputCostPer1K: 0.0006,
    maxTokens: 128000,
    capabilities: ['text-generation', 'multilingual', 'rag', 'tools'],
    inputPrice: 0.00015,
    outputPrice: 0.0006,
    contextWindow: 128000,
    category: 'balanced',
    features: ['text-generation', 'multilingual', 'rag', 'tools']
  },

  // === Mistral Models ===
  {
    model: 'mistral.mistral-large-2402-v1:0',
    provider: 'mistral',
    inputCostPer1K: 0.0065,
    outputCostPer1K: 0.025,
    maxTokens: 32768,
    capabilities: ['text-generation', 'instruct'],
    inputPrice: 0.0065,
    outputPrice: 0.025,
    contextWindow: 32768,
    category: 'premium',
    features: ['text-generation', 'instruct']
  },
  {
    model: 'mistral.mistral-small-2402-v1:0',
    provider: 'mistral',
    inputCostPer1K: 0.002,
    outputCostPer1K: 0.006,
    maxTokens: 32768,
    capabilities: ['text-generation', 'instruct'],
    inputPrice: 0.002,
    outputPrice: 0.006,
    contextWindow: 32768,
    category: 'balanced',
    features: ['text-generation', 'instruct']
  }
];

/**
 * Get model pricing information
 */
export function getModelPricing(model?: string): ModelPricing[] {
  if (model) {
    return modelPricingData.filter(m => m.model === model);
  }
  return modelPricingData;
}

/**
 * Find the cheapest model for a given use case
 */
export function findCheapestModel(useCase: UseCase): ModelPricing | null {
  if (!useCase) return null;
  
  // Filter models based on use case requirements
  let suitableModels = modelPricingData;
  
  // Filter by complexity
  if (useCase.complexity === 'simple') {
    suitableModels = suitableModels.filter(m => 
      m.capabilities.includes('text-generation') && 
      m.capabilities.includes('analysis')
    );
  } else if (useCase.complexity === 'moderate') {
    suitableModels = suitableModels.filter(m => 
      m.capabilities.includes('reasoning')
    );
  }
  
  // Filter by priority
  if (useCase.priority === 'cost') {
    suitableModels = suitableModels.filter(m => 
      m.inputCostPer1K <= 0.003 && m.outputCostPer1K <= 0.015
    );
  }
  
  if (suitableModels.length === 0) return null;
  
  // Return the cheapest model
  return suitableModels.reduce((cheapest, current) => 
    (current.inputCostPer1K + current.outputCostPer1K) < (cheapest.inputCostPer1K + cheapest.outputCostPer1K) 
      ? current 
      : cheapest
  );
}

/**
 * Get available Bedrock models
 */
export function getAvailableBedrickModels(): string[] {
  return modelPricingData
    .filter(m => m.provider === 'aws')
    .map(m => m.model);
}

/**
 * Get models by use case
 */
export function getModelsByUseCase(useCase: UseCase): ModelPricing[] {
  if (!useCase) return [];
  
  let suitableModels = modelPricingData;
  
  // Filter by type
  switch (useCase.type) {
    case 'api-calls':
      suitableModels = suitableModels.filter(m => m.maxTokens >= 4000);
      break;
    case 'chatbot':
      suitableModels = suitableModels.filter(m => 
        m.capabilities.includes('text-generation') && 
        m.capabilities.includes('analysis')
      );
      break;
    case 'content-generation':
      suitableModels = suitableModels.filter(m => 
        m.capabilities.includes('text-generation') && 
        m.maxTokens >= 8000
      );
      break;
    case 'data-analysis':
      suitableModels = suitableModels.filter(m => 
        m.capabilities.includes('analysis') && 
        m.capabilities.includes('reasoning')
      );
      break;
    case 'code-generation':
      suitableModels = suitableModels.filter(m => 
        m.capabilities.includes('reasoning') && 
        m.maxTokens >= 8000
      );
      break;
    case 'summarization':
      suitableModels = suitableModels.filter(m => 
        m.capabilities.includes('summarization') && 
        m.maxTokens >= 4000
      );
      break;
  }
  
  // Filter by volume
  if (useCase.volume === 'high') {
    suitableModels = suitableModels.filter(m => m.inputCostPer1K <= 0.003);
  }
  
  // Filter by complexity
  if (useCase.complexity === 'simple') {
    suitableModels = suitableModels.filter(m => 
      m.capabilities.includes('text-generation') && 
      m.capabilities.includes('analysis')
    );
  } else if (useCase.complexity === 'moderate') {
    suitableModels = suitableModels.filter(m => 
      m.capabilities.includes('reasoning')
    );
  }
  
  // Filter by priority
  if (useCase.priority === 'cost') {
    suitableModels = suitableModels.filter(m => 
      m.inputCostPer1K <= 0.003 && m.outputCostPer1K <= 0.015
    );
  } else if (useCase.priority === 'quality') {
    suitableModels = suitableModels.filter(m => 
      m.capabilities.includes('reasoning') || 
      m.capabilities.includes('complex-tasks')
    );
  } else if (useCase.priority === 'speed') {
    suitableModels = suitableModels.filter(m => m.maxTokens <= 8000);
  }
  
  return suitableModels;
}

/**
 * Calculate estimated cost for a model
 */
export function calculateModelCost(
  model: string, 
  inputTokens: number, 
  outputTokens: number
): number {
  const pricing = modelPricingData.find(m => m.model === model);
  if (!pricing) return 0;
  
  const inputCost = (inputTokens / 1000) * pricing.inputCostPer1K;
  const outputCost = (outputTokens / 1000) * pricing.outputCostPer1K;
  
  return inputCost + outputCost;
}

/**
 * Get cost comparison between models
 */
export function compareModelCosts(
  models: string[], 
  inputTokens: number, 
  outputTokens: number
): Record<string, number> {
  const comparison: Record<string, number> = {};
  
  models.forEach(model => {
    comparison[model] = calculateModelCost(model, inputTokens, outputTokens);
  });
  
  return comparison;
}

// Export the pricing data for use in other modules
export { modelPricingData };
