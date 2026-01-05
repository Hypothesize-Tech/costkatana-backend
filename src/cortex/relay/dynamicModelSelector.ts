/**
 * Dynamic Model Selector for AWS Bedrock
 * Queries AWS Bedrock for available models and selects the best one based on requirements
 */

import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import { loggingService } from '../../services/logging.service';
import { cacheService } from '../../services/cache.service';

export interface ModelInfo {
  modelId: string;
  modelName: string;
  provider: string;
  modelArn: string;
  inputModalities?: string[];
  outputModalities?: string[];
  customizationsSupported?: string[];
  inferenceTypesSupported?: string[];
  responseStreamingSupported?: boolean;
}

export interface ModelCapability {
  reasoning: number;  // 0-1 score
  speed: number;      // 0-1 score
  cost: number;       // 0-1 score (lower is better)
  contextWindow: number; // max tokens
}

export class DynamicModelSelector {
  private bedrockClient: BedrockClient;
  private modelCache: Map<string, ModelInfo> = new Map();
  private lastRefresh: number = 0;
  private refreshInterval = 3600000; // 1 hour
  
  // Model capability scores (based on known characteristics)
  private modelCapabilities: Record<string, ModelCapability> = {
    // Claude 3 Opus - Best reasoning
    'anthropic.claude-3-opus-20240229-v1:0': {
      reasoning: 1.0,
      speed: 0.3,
      cost: 0.1,
      contextWindow: 200000
    },
    // Claude 3.5 Sonnet (older version, accessible)
    'anthropic.claude-3-5-sonnet-20240620-v1:0': {
      reasoning: 0.92,
      speed: 0.6,
      cost: 0.3,
      contextWindow: 200000
    },
    // Claude 3.5 Sonnet v2 - Excellent reasoning (requires special access)
    'us.anthropic.claude-3-5-sonnet-20241022-v2:0': {
      reasoning: 0.95,
      speed: 0.6,
      cost: 0.3,
      contextWindow: 200000
    },
    // Claude 3 Sonnet - Good reasoning
    'anthropic.claude-3-sonnet-20240229-v1:0': {
      reasoning: 0.85,
      speed: 0.7,
      cost: 0.4,
      contextWindow: 200000
    },
    // Claude 3.5 Haiku - Fast with decent reasoning
    'anthropic.claude-3-5-haiku-20241022-v1:0': {
      reasoning: 0.7,
      speed: 0.95,
      cost: 0.9,
      contextWindow: 200000
    },
    // Claude 3 Haiku - Very fast, basic reasoning
    'anthropic.claude-3-haiku-20240307-v1:0': {
      reasoning: 0.6,
      speed: 0.95,
      cost: 0.95,
      contextWindow: 200000
    },
    // Amazon Nova Pro - Excellent balance (ACCESSIBLE & POWERFUL)
    'amazon.nova-pro-v1:0': {
      reasoning: 0.88,  // Very good reasoning, close to Claude Sonnet
      speed: 0.8,
      cost: 0.85,  // Much cheaper than Claude
      contextWindow: 300000  // Huge context window
    },
    // Amazon Nova Lite - Fast and cheap
    'amazon.nova-lite-v1:0': {
      reasoning: 0.5,
      speed: 0.9,
      cost: 0.95,
      contextWindow: 300000
    },
    // Amazon Nova Micro - Ultra fast, minimal reasoning
    'amazon.nova-micro-v1:0': {
      reasoning: 0.3,
      speed: 0.98,
      cost: 0.98,
      contextWindow: 128000
    },
    // Amazon Titan Text Express
    'amazon.titan-text-express-v1': {
      reasoning: 0.4,
      speed: 0.9,
      cost: 0.92,
      contextWindow: 8192
    },
    // Amazon Titan Text Premier
    'amazon.titan-text-premier-v1:0': {
      reasoning: 0.6,
      speed: 0.7,
      cost: 0.6,
      contextWindow: 32000
    },
    // Meta Llama 3.1 405B
    'meta.llama3-1-405b-instruct-v1:0': {
      reasoning: 0.9,
      speed: 0.4,
      cost: 0.2,
      contextWindow: 128000
    },
    // Meta Llama 3.1 70B
    'meta.llama3-1-70b-instruct-v1:0': {
      reasoning: 0.8,
      speed: 0.6,
      cost: 0.5,
      contextWindow: 128000
    },
    // Meta Llama 3.1 8B
    'meta.llama3-1-8b-instruct-v1:0': {
      reasoning: 0.6,
      speed: 0.85,
      cost: 0.85,
      contextWindow: 128000
    },
    // Meta Llama 3.2 90B Vision
    'meta.llama3-2-90b-instruct-v1:0': {
      reasoning: 0.85,
      speed: 0.5,
      cost: 0.3,
      contextWindow: 128000
    },
    // Meta Llama 3.2 11B Vision
    'meta.llama3-2-11b-instruct-v1:0': {
      reasoning: 0.65,
      speed: 0.8,
      cost: 0.75,
      contextWindow: 128000
    },
    // Meta Llama 3.2 3B
    'meta.llama3-2-3b-instruct-v1:0': {
      reasoning: 0.45,
      speed: 0.92,
      cost: 0.9,
      contextWindow: 128000
    },
    // Meta Llama 3.2 1B
    'meta.llama3-2-1b-instruct-v1:0': {
      reasoning: 0.3,
      speed: 0.98,
      cost: 0.98,
      contextWindow: 128000
    },
    // Mistral AI models
    'mistral.mistral-large-2407-v1:0': {
      reasoning: 0.85,
      speed: 0.6,
      cost: 0.4,
      contextWindow: 128000
    },
    'mistral.mistral-small-2402-v1:0': {
      reasoning: 0.65,
      speed: 0.85,
      cost: 0.8,
      contextWindow: 32000
    },
    'mistral.mixtral-8x7b-instruct-v0:1': {
      reasoning: 0.7,
      speed: 0.75,
      cost: 0.7,
      contextWindow: 32000
    },
    'mistral.mistral-7b-instruct-v0:2': {
      reasoning: 0.55,
      speed: 0.9,
      cost: 0.9,
      contextWindow: 32000
    },
    // Cohere models
    'cohere.command-r-plus-v1:0': {
      reasoning: 0.8,
      speed: 0.65,
      cost: 0.5,
      contextWindow: 128000
    },
    'cohere.command-r-v1:0': {
      reasoning: 0.7,
      speed: 0.75,
      cost: 0.7,
      contextWindow: 128000
    },
    'cohere.command-text-v14': {
      reasoning: 0.6,
      speed: 0.8,
      cost: 0.8,
      contextWindow: 4096
    },
    'cohere.command-light-text-v14': {
      reasoning: 0.45,
      speed: 0.9,
      cost: 0.92,
      contextWindow: 4096
    },
    // AI21 models
    'ai21.jamba-1-5-large-v1:0': {
      reasoning: 0.75,
      speed: 0.7,
      cost: 0.6,
      contextWindow: 256000
    },
    'ai21.jamba-1-5-mini-v1:0': {
      reasoning: 0.6,
      speed: 0.85,
      cost: 0.85,
      contextWindow: 256000
    },
    'ai21.jamba-instruct-v1:0': {
      reasoning: 0.7,
      speed: 0.75,
      cost: 0.7,
      contextWindow: 256000
    },
    'ai21.j2-ultra-v1': {
      reasoning: 0.65,
      speed: 0.7,
      cost: 0.6,
      contextWindow: 8192
    },
    'ai21.j2-mid-v1': {
      reasoning: 0.55,
      speed: 0.85,
      cost: 0.85,
      contextWindow: 8192
    }
  };
  
  constructor() {
    this.bedrockClient = new BedrockClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }
  
  /**
   * Get the best model for core reasoning tasks
   */
  public async getBestReasoningModel(): Promise<string> {
    const cacheKey = 'cortex:best_reasoning_model';
    
    // Check cache first
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      loggingService.info('Using cached best reasoning model', { modelId: cached });
      return cached;
    }
    
    // Refresh available models if needed
    await this.refreshAvailableModels();
    
    // Based on actual testing, these are the best accessible models
    // Priority order for reasoning tasks (updated with Nova Pro)
    const priorityModels = [
      'amazon.nova-pro-v1:0',                      // BEST VALUE: Powerful & accessible & cost-effective
      'anthropic.claude-3-5-sonnet-20240620-v1:0', // Claude alternative (if quota available)
      'anthropic.claude-3-sonnet-20240229-v1:0',   // Good balanced fallback
      'amazon.titan-text-premier-v1:0',            // Amazon fallback
    ];
    
    // Try to use the first available model from priority list
    for (const modelId of priorityModels) {
      if (this.modelCache.has(modelId) || this.modelCapabilities[modelId]) {
        await cacheService.set(cacheKey, modelId, 3600);
        loggingService.info('Selected best reasoning model', { modelId });
        return modelId;
      }
    }
    
    // Find the best model for reasoning from available models
    let bestModel = priorityModels[0]; // Use best known model as default
    let bestScore = 0;
    
    for (const [modelId, capabilities] of Object.entries(this.modelCapabilities)) {
      // Check if model is available
      if (!this.modelCache.has(modelId)) {
        continue;
      }
      
      // Calculate weighted score (prioritize reasoning)
      const score = (capabilities.reasoning * 0.7) + 
                   (capabilities.speed * 0.2) + 
                   (capabilities.cost * 0.1);
      
      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }
    
    // Cache the result for 1 hour
    await cacheService.set(cacheKey, bestModel, 3600);
    
    loggingService.info('Selected best reasoning model', { 
      modelId: bestModel, 
      score: bestScore,
      capabilities: this.modelCapabilities[bestModel]
    });
    
    return bestModel;
  }
  
  /**
   * Get the best model for encoding/decoding (fast and cheap)
   */
  public async getBestEncodingModel(): Promise<string> {
    const cacheKey = 'cortex:best_encoding_model';
    
    // Check cache first
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      loggingService.info('Using cached best encoding model', { modelId: cached });
      return cached;
    }
    
    // Refresh available models if needed
    await this.refreshAvailableModels();
    
    // Based on actual testing, these are the best accessible fast models
    // Priority order for encoding/decoding tasks
    const priorityModels = [
      'anthropic.claude-3-haiku-20240307-v1:0',    // Best accessible fast model
      'amazon.titan-text-express-v1',              // Amazon fast alternative
      'anthropic.claude-3-5-haiku-20241022-v1:0',  // Newer Haiku if available
      'amazon.nova-micro-v1:0',                    // Ultra-fast if available
    ];
    
    // Try to use the first available model from priority list
    for (const modelId of priorityModels) {
      if (this.modelCache.has(modelId) || this.modelCapabilities[modelId]) {
        await cacheService.set(cacheKey, modelId, 3600);
        loggingService.info('Selected best encoding model', { modelId });
        return modelId;
      }
    }
    
    // Find the best model for encoding (prioritize speed and cost)
    let bestModel = priorityModels[0]; // Use best known model as default
    let bestScore = 0;
    
    for (const [modelId, capabilities] of Object.entries(this.modelCapabilities)) {
      // Check if model is available
      if (!this.modelCache.has(modelId)) {
        continue;
      }
      
      // Calculate weighted score (prioritize speed and cost)
      const score = (capabilities.speed * 0.4) + 
                   (capabilities.cost * 0.4) + 
                   (capabilities.reasoning * 0.2);
      
      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }
    
    // Cache the result for 1 hour
    await cacheService.set(cacheKey, bestModel, 3600);
    
    loggingService.info('Selected best encoding model', { 
      modelId: bestModel, 
      score: bestScore,
      capabilities: this.modelCapabilities[bestModel]
    });
    
    return bestModel;
  }
  
  /**
   * Get the best model based on custom requirements
   */
  public async getBestModelForRequirements(requirements: {
    minReasoning?: number;
    minSpeed?: number;
    maxCost?: number;
    minContextWindow?: number;
  }): Promise<string> {
    await this.refreshAvailableModels();
    
    let bestModel = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'; // Default
    let bestScore = 0;
    
    for (const [modelId, capabilities] of Object.entries(this.modelCapabilities)) {
      // Check if model is available
      if (!this.modelCache.has(modelId)) {
        continue;
      }
      
      // Check requirements
      if (requirements.minReasoning && capabilities.reasoning < requirements.minReasoning) continue;
      if (requirements.minSpeed && capabilities.speed < requirements.minSpeed) continue;
      if (requirements.maxCost && (1 - capabilities.cost) > requirements.maxCost) continue;
      if (requirements.minContextWindow && capabilities.contextWindow < requirements.minContextWindow) continue;
      
      // Calculate score
      const score = (capabilities.reasoning + capabilities.speed + capabilities.cost) / 3;
      
      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }
    
    return bestModel;
  }
  
  /**
   * Refresh available models from AWS Bedrock
   */
  private async refreshAvailableModels(): Promise<void> {
    // Only refresh if cache is stale
    if (Date.now() - this.lastRefresh < this.refreshInterval) {
      return;
    }
    
    try {
      loggingService.info('Refreshing available Bedrock models');
      
      const command = new ListFoundationModelsCommand({});
      const response = await this.bedrockClient.send(command);
      
      if (response.modelSummaries) {
        this.modelCache.clear();
        
        for (const model of response.modelSummaries) {
          if (model.modelId) {
            this.modelCache.set(model.modelId, {
              modelId: model.modelId,
              modelName: model.modelName || model.modelId,
              provider: model.providerName || 'unknown',
              modelArn: model.modelArn || '',
              inputModalities: model.inputModalities,
              outputModalities: model.outputModalities,
              customizationsSupported: model.customizationsSupported,
              inferenceTypesSupported: model.inferenceTypesSupported,
              responseStreamingSupported: model.responseStreamingSupported
            });
          }
        }
        
        this.lastRefresh = Date.now();
        
        loggingService.info('Available Bedrock models refreshed', {
          modelCount: this.modelCache.size,
          models: Array.from(this.modelCache.keys())
        });
      }
    } catch (error) {
      loggingService.error('Failed to refresh Bedrock models', { error });
      
      // If refresh fails, populate with known models as fallback
      this.populateKnownModels();
    }
  }
  
  /**
   * Populate with known models as fallback
   */
  private populateKnownModels(): void {
    for (const modelId of Object.keys(this.modelCapabilities)) {
      this.modelCache.set(modelId, {
        modelId,
        modelName: modelId,
        provider: modelId.split('.')[0],
        modelArn: `arn:aws:bedrock:${process.env.AWS_REGION || 'us-east-1'}::foundation-model/${modelId}`
      });
    }
  }
  
  /**
   * Get all available models
   */
  public async getAvailableModels(): Promise<ModelInfo[]> {
    await this.refreshAvailableModels();
    return Array.from(this.modelCache.values());
  }
  
  /**
   * Get model capabilities
   */
  public getModelCapabilities(modelId: string): ModelCapability | undefined {
    return this.modelCapabilities[modelId];
  }
}

// Export singleton instance
export const dynamicModelSelector = new DynamicModelSelector();
