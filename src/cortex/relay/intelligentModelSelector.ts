/**
 * Intelligent Model Selector with Opus Priority
 * Attempts to use Claude Opus for maximum reasoning power, with smart fallbacks
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { loggingService } from '../../services/logging.service';
import { cacheService } from '../../services/cache.service';
import { BedrockModelFormatter } from '../utils/bedrockModelFormatter';

export interface ModelTestResult {
  modelId: string;
  accessible: boolean;
  latency?: number;
  error?: string;
}

export class IntelligentModelSelector {
  private bedrockClient: BedrockRuntimeClient;
  private modelAccessCache: Map<string, ModelTestResult> = new Map();
  
  // Priority order for core reasoning (most powerful first)
  private readonly reasoningModelPriority = [
    'anthropic.claude-opus-4-6-v1',               // Claude Opus 4.6 - Next-gen flagship
    'anthropic.claude-sonnet-4-6-v1:0',            // Claude Sonnet 4.6 - Latest Sonnet
    'anthropic.claude-opus-4-1-20250805-v1:0',     // Claude Opus 4.1 - Most powerful
    'anthropic.claude-opus-4-20250514-v1:0',       // Claude Opus 4
    'anthropic.claude-3-opus-20240229-v1:0',       // Claude 3 Opus
    'anthropic.claude-3-7-sonnet-20250219-v1:0',   // Claude 3.7 Sonnet
    'us.anthropic.claude-3-5-sonnet-20241022-v2:0',   // Claude 3.5 Sonnet v2
    'anthropic.claude-3-5-sonnet-20240620-v1:0',   // Claude 3.5 Sonnet (older)
    'amazon.nova-pro-v1:0',                        // Nova Pro (fallback)
    'anthropic.claude-3-sonnet-20240229-v1:0',     // Claude 3 Sonnet (fallback)
  ];
  
  // For encoding/decoding (fast and efficient)
  private readonly encodingModelPriority = [
    'amazon.nova-pro-v1:0',                        // Nova Pro - as requested
    'amazon.nova-lite-v1:0',                       // Nova Lite - fallback
    'anthropic.claude-3-haiku-20240307-v1:0',      // Claude Haiku - fallback
    'amazon.titan-text-express-v1',                // Titan Express - fallback
  ];
  
  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }
  
  /**
   * Get the best available model for core reasoning
   * Tries Claude Opus first, then falls back to alternatives
   */
  public async getBestReasoningModel(): Promise<string> {
    const cacheKey = 'cortex:best_reasoning_model_with_opus';
    
    // Check cache
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      loggingService.info('Using cached best reasoning model', { modelId: cached });
      return cached;
    }
    
    // Test models in priority order
    for (const modelId of this.reasoningModelPriority) {
      const testResult = await this.testModelAccess(modelId);
      
      if (testResult.accessible) {
        // Cache for 1 hour
        await cacheService.set(cacheKey, modelId, 3600);
        
        if (modelId.includes('opus')) {
          loggingService.info('🎉 Claude Opus is accessible! Using most powerful reasoning model', { 
            modelId,
            note: 'This will provide the best possible reasoning quality'
          });
        } else {
          loggingService.info('Selected best available reasoning model', { 
            modelId,
            note: modelId.includes('nova') 
              ? 'Using Nova Pro - excellent value alternative to Claude Opus'
              : 'Using Claude model for reasoning'
          });
        }
        
        return modelId;
      } else {
        loggingService.debug('Model not accessible', { 
          modelId, 
          error: testResult.error 
        });
      }
    }
    
    // Default fallback
    const fallback = 'amazon.nova-pro-v1:0';
    loggingService.warn('No priority models accessible, using fallback', { fallback });
    return fallback;
  }
  
  /**
   * Get the best available model for encoding/decoding
   */
  public async getBestEncodingModel(): Promise<string> {
    // Respect environment variable override first
    const envModel = process.env.CORTEX_ENCODER_MODEL;
    if (envModel) {
      loggingService.info('Using encoder model from environment variable', { 
        modelId: envModel,
        source: 'CORTEX_ENCODER_MODEL'
      });
      return envModel;
    }
    
    const cacheKey = 'cortex:best_encoding_model';
    
    // Check cache
    const cached = await cacheService.get<string>(cacheKey);
    if (cached) {
      loggingService.info('Using cached best encoding model', { modelId: cached });
      return cached;
    }
    
    // Test models in priority order
    for (const modelId of this.encodingModelPriority) {
      const testResult = await this.testModelAccess(modelId);
      
      if (testResult.accessible) {
        // Cache for 1 hour
        await cacheService.set(cacheKey, modelId, 3600);
        
        loggingService.info('Selected best encoding model', { 
          modelId,
          latency: testResult.latency
        });
        
        return modelId;
      }
    }
    
    // Default fallback
    const fallback = 'amazon.nova-pro-v1:0';
    loggingService.warn('No priority encoding models accessible, using fallback', { fallback });
    return fallback;
  }
  
  /**
   * Test if a model is accessible
   */
  private async testModelAccess(modelId: string): Promise<ModelTestResult> {
    // Check cache
    if (this.modelAccessCache.has(modelId)) {
      return this.modelAccessCache.get(modelId)!;
    }
    
    const startTime = Date.now();
    
    try {
      // Format request based on model type
      const requestBody = BedrockModelFormatter.formatRequestBody({
        modelId,
        prompt: 'test',
        maxTokens: 1,
        temperature: 0.1
      });
      
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: requestBody
      });
      
      await this.bedrockClient.send(command);
      
      const result: ModelTestResult = {
        modelId,
        accessible: true,
        latency: Date.now() - startTime
      };
      
      this.modelAccessCache.set(modelId, result);
      return result;
      
    } catch (error: any) {
      const result: ModelTestResult = {
        modelId,
        accessible: false,
        error: error.message
      };
      
      // Check if it's a provisioned throughput issue
      if (error.message?.includes('on-demand throughput') || 
          error.message?.includes('Provisioned')) {
        result.error = 'Requires Provisioned Throughput ($8,640+/month)';
      }
      
      this.modelAccessCache.set(modelId, result);
      return result;
    }
  }
  
  /**
   * Attempt to use Claude Opus with automatic fallback
   */
  public async executeWithOpusFallback(
    prompt: string,
    fallbackModelId?: string
  ): Promise<{ 
    response: string; 
    modelUsed: string; 
    isOpus: boolean 
  }> {
    // Try Opus models first
    const opusModels = this.reasoningModelPriority.filter(m => m.includes('opus'));
    
    for (const modelId of opusModels) {
      try {
        const requestBody = BedrockModelFormatter.formatRequestBody({
          modelId,
          prompt,
          maxTokens: 4000,
          temperature: 0.5
        });
        
        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: requestBody
        });
        
        const response = await this.bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const responseText = BedrockModelFormatter.parseResponseBody(modelId, responseBody);
        
        loggingService.info('🎉 Successfully used Claude Opus for reasoning!', { modelId });
        
        return {
          response: responseText,
          modelUsed: modelId,
          isOpus: true
        };
      } catch (error) {
        loggingService.debug('Opus model not accessible, trying next', { modelId });
      }
    }
    
    // Fallback to best available model
    const bestModel = fallbackModelId || await this.getBestReasoningModel();
    
    try {
      const requestBody = BedrockModelFormatter.formatRequestBody({
        modelId: bestModel,
        prompt,
        maxTokens: 4000,
        temperature: 0.5
      });
      
      const command = new InvokeModelCommand({
        modelId: bestModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: requestBody
      });
      
      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const responseText = BedrockModelFormatter.parseResponseBody(bestModel, responseBody);
      
      loggingService.info('Used fallback model for reasoning', { 
        modelId: bestModel,
        note: 'Claude Opus not accessible - consider setting up Provisioned Throughput'
      });
      
      return {
        response: responseText,
        modelUsed: bestModel,
        isOpus: false
      };
    } catch (error) {
      loggingService.error('Failed to execute with any model', { error });
      throw error;
    }
  }
  
  /**
   * Get model access status for all priority models
   */
  public async getModelAccessStatus(): Promise<{
    reasoning: ModelTestResult[];
    encoding: ModelTestResult[];
    opusAvailable: boolean;
  }> {
    const reasoningResults = [];
    const encodingResults = [];
    
    // Test reasoning models
    for (const modelId of this.reasoningModelPriority) {
      const result = await this.testModelAccess(modelId);
      reasoningResults.push(result);
    }
    
    // Test encoding models
    for (const modelId of this.encodingModelPriority) {
      const result = await this.testModelAccess(modelId);
      encodingResults.push(result);
    }
    
    const opusAvailable = reasoningResults.some(r => 
      r.modelId.includes('opus') && r.accessible
    );
    
    return {
      reasoning: reasoningResults,
      encoding: encodingResults,
      opusAvailable
    };
  }
}

// Export singleton instance
export const intelligentModelSelector = new IntelligentModelSelector();



