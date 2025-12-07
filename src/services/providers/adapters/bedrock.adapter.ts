/**
 * AWS Bedrock Provider Adapter
 * 
 * Unified adapter implementing IProviderAdapter interface for AWS Bedrock models.
 * Supports Claude, Nova, Llama, Mistral models via AWS Bedrock.
 */

import {
    IProviderAdapter,
    UnifiedAIRequest,
    UnifiedAIResponse,
    UnifiedAIStreamChunk,
    ModelCapabilityDefinition,
    ModelCapability
} from '../../../types/modelCapability.types';
import { AIProviderType } from '../../../types/aiProvider.types';
import { BedrockService } from '../../bedrock.service';
import { loggingService } from '../../logging.service';

export class BedrockAdapter implements IProviderAdapter {
    readonly name = 'AWS Bedrock';
    readonly providerType = AIProviderType.Bedrock;
    
    constructor() {
        // BedrockService is a static service
    }
    
    /**
     * Invoke model with unified request
     */
    async invoke(request: UnifiedAIRequest): Promise<UnifiedAIResponse> {
        try {
            // Convert unified request to Bedrock invocation
            const context = {
                recentMessages: request.conversationHistory,
                useSystemPrompt: !!request.systemMessage,
                systemMessage: request.systemMessage,
                temperature: request.temperature,
                maxTokens: request.maxTokens,
                topP: request.topP,
                stopSequences: request.stopSequences,
            };
            
            // Invoke using existing BedrockService
            const response = await BedrockService.invokeModel(
                request.prompt,
                request.modelId,
                context
            );
            
            // Extract token counts from response
            const inputTokens = response.inputTokens || 0;
            const outputTokens = response.outputTokens || 0;
            
            // Convert to unified response
            return {
                text: response.text || response,
                usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                },
                modelId: request.modelId,
                provider: this.name,
                latencyMs: 0, // Calculated by caller if needed
                finishReason: 'stop',
                metadata: {}
            };
            
        } catch (error) {
            loggingService.error('Bedrock adapter invocation failed', {
                modelId: request.modelId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    /**
     * Stream invoke model with unified request
     * 
     * Note: This is a fallback implementation that calls the non-streaming API
     * and yields the complete response. Full streaming support requires updating
     * the BedrockService to use AWS SDK's streaming capabilities.
     */
    async *streamInvoke(request: UnifiedAIRequest): AsyncIterable<UnifiedAIStreamChunk> {
        try {
            loggingService.info('Bedrock streaming using fallback (non-streaming API)', {
                modelId: request.modelId
            });
            
            // Call non-streaming API as fallback
            const response = await this.invoke(request);
            
            // Yield the complete response as a single chunk
            yield {
                delta: response.text,
                usage: {
                    inputTokens: response.usage.inputTokens,
                    outputTokens: response.usage.outputTokens
                },
                finishReason: response.finishReason,
                metadata: {
                    ...response.metadata,
                    streamingFallback: true,
                    modelId: response.modelId,
                    provider: this.name
                }
            };
            
            loggingService.debug('Bedrock streaming completed (fallback mode)', {
                modelId: request.modelId,
                totalTokens: response.usage.totalTokens
            });
            
        } catch (error) {
            loggingService.error('Bedrock adapter streaming failed', {
                modelId: request.modelId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    /**
     * Estimate tokens for text
     */
    estimateTokens(text: string): number {
        // Rough estimate: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
    
    /**
     * Get supported models with their capabilities
     */
    getSupportedModels(): ModelCapabilityDefinition[] {
        return [
            // Claude 3.5 Sonnet
            {
                modelId: 'claude-3-5-sonnet-20241022',
                provider: 'anthropic-bedrock',
                providerType: AIProviderType.Bedrock,
                displayName: 'Claude 3.5 Sonnet',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING,
                    ModelCapability.MULTIMODAL
                ]),
                contextWindow: 200000,
                maxOutputTokens: 4096,
                pricing: {
                    inputPricePerMillion: 3.00,
                    outputPricePerMillion: 15.00,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 2500,
                    reliabilityScore: 0.96
                },
                metadata: { region: 'us-east-1' },
                isAvailable: true
            },
            // Claude 3.5 Haiku
            {
                modelId: 'claude-3-5-haiku-20241022',
                provider: 'anthropic-bedrock',
                providerType: AIProviderType.Bedrock,
                displayName: 'Claude 3.5 Haiku',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.STREAMING
                ]),
                contextWindow: 200000,
                maxOutputTokens: 4096,
                pricing: {
                    inputPricePerMillion: 0.80,
                    outputPricePerMillion: 4.00,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 1200,
                    reliabilityScore: 0.97
                },
                metadata: { region: 'us-east-1' },
                isAvailable: true
            },
            // Claude Opus 4
            {
                modelId: 'claude-opus-4-20250514',
                provider: 'anthropic-bedrock',
                providerType: AIProviderType.Bedrock,
                displayName: 'Claude Opus 4',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING,
                    ModelCapability.MULTIMODAL
                ]),
                contextWindow: 200000,
                maxOutputTokens: 4096,
                pricing: {
                    inputPricePerMillion: 15.00,
                    outputPricePerMillion: 75.00,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 3500,
                    reliabilityScore: 0.95
                },
                metadata: { region: 'us-east-1' },
                isAvailable: true
            },
            // AWS Nova Pro
            {
                modelId: 'nova-pro-v1',
                provider: 'aws-bedrock',
                providerType: AIProviderType.Bedrock,
                displayName: 'Amazon Nova Pro',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING
                ]),
                contextWindow: 300000,
                maxOutputTokens: 5000,
                pricing: {
                    inputPricePerMillion: 0.80,
                    outputPricePerMillion: 3.20,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 1800,
                    reliabilityScore: 0.95
                },
                metadata: { region: 'us-east-1' },
                isAvailable: true
            },
            // AWS Nova Lite
            {
                modelId: 'nova-lite-v1',
                provider: 'aws-bedrock',
                providerType: AIProviderType.Bedrock,
                displayName: 'Amazon Nova Lite',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.STREAMING
                ]),
                contextWindow: 300000,
                maxOutputTokens: 5000,
                pricing: {
                    inputPricePerMillion: 0.06,
                    outputPricePerMillion: 0.24,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 900,
                    reliabilityScore: 0.96
                },
                metadata: {},
                isAvailable: true
            }
        ];
    }
    
    /**
     * Check if a specific model is supported
     */
    supportsModel(modelId: string): boolean {
        const supportedModels = [
            // Claude models
            'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-opus-4',
            'anthropic.claude-3-5-sonnet', 'anthropic.claude-3-5-haiku',
            'anthropic.claude-opus-4',
            // Nova models
            'nova-pro', 'nova-lite', 'nova-micro',
            'amazon.nova-pro', 'amazon.nova-lite', 'amazon.nova-micro',
            // Llama models
            'llama', 'meta.llama',
            // Mistral models
            'mistral'
        ];
        
        return supportedModels.some(supported => modelId.toLowerCase().includes(supported.toLowerCase()));
    }
    
    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            // Simple test invocation with Nova Lite (cheapest)
            await BedrockService.invokeModel(
                'test',
                'amazon.nova-lite-v1:0'
            );
            return true;
        } catch {
            return false;
        }
    }
}

