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

// Mock model pricing data
const modelPricingData: ModelPricing[] = [
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
    inputCostPer1K: 0.0015,
    outputCostPer1K: 0.002,
    maxTokens: 4096,
    capabilities: ['text-generation', 'analysis', 'summarization'],
    inputPrice: 0.0015,
    outputPrice: 0.002,
    contextWindow: 4096,
    category: 'fast',
    features: ['text-generation', 'analysis', 'summarization']
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
