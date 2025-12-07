/**
 * OpenAI Provider Adapter
 * 
 * Unified adapter implementing IProviderAdapter interface for OpenAI models.
 * Wraps the existing OpenAI provider with capability-based abstractions.
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
import { OpenAIProvider } from '../openai.provider';
import { loggingService } from '../../logging.service';

export class OpenAIAdapter implements IProviderAdapter {
    readonly name = 'OpenAI';
    readonly providerType = AIProviderType.OpenAI;
    
    private provider: OpenAIProvider;
    
    constructor(apiKey?: string) {
        this.provider = new OpenAIProvider(apiKey);
    }
    
    /**
     * Invoke model with unified request
     */
    async invoke(request: UnifiedAIRequest): Promise<UnifiedAIResponse> {
        try {
            // Convert unified request to provider-specific options
            const options = {
                systemMessage: request.systemMessage,
                recentMessages: request.conversationHistory?.map(m => ({
                    role: m.role as 'user' | 'assistant' | 'system',
                    content: m.content
                })),
                temperature: request.temperature,
                maxTokens: request.maxTokens,
                topP: request.topP,
                stopSequences: request.stopSequences,
            };
            
            // Invoke using existing provider
            const response = await this.provider.invokeModel(
                request.prompt,
                request.modelId,
                options
            );
            
            // Convert to unified response
            return {
                text: response.text,
                usage: {
                    inputTokens: response.usage.inputTokens,
                    outputTokens: response.usage.outputTokens,
                    totalTokens: response.usage.totalTokens,
                },
                modelId: request.modelId,
                provider: this.name,
                latencyMs: 0, // Calculated by caller if needed
                finishReason: response.finishReason,
                metadata: {
                    cached: response.cached
                }
            };
            
        } catch (error) {
            loggingService.error('OpenAI adapter invocation failed', {
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
     * the underlying OpenAIProvider to expose streaming capabilities.
     */
    async *streamInvoke(request: UnifiedAIRequest): AsyncIterable<UnifiedAIStreamChunk> {
        try {
            loggingService.info('OpenAI streaming using fallback (non-streaming API)', {
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
            
            loggingService.debug('OpenAI streaming completed (fallback mode)', {
                modelId: request.modelId,
                totalTokens: response.usage.totalTokens
            });
            
        } catch (error) {
            loggingService.error('OpenAI adapter streaming failed', {
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
        return this.provider.estimateTokens(text);
    }
    
    /**
     * Get supported models with their capabilities
     */
    getSupportedModels(): ModelCapabilityDefinition[] {
        return [
            {
                modelId: 'gpt-4o',
                provider: 'openai',
                providerType: AIProviderType.OpenAI,
                displayName: 'GPT-4o',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING,
                    ModelCapability.JSON_MODE,
                    ModelCapability.FUNCTION_CALLING,
                    ModelCapability.MULTIMODAL
                ]),
                contextWindow: 128000,
                maxOutputTokens: 4096,
                pricing: {
                    inputPricePerMillion: 2.50,
                    outputPricePerMillion: 10.00,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 2000,
                    reliabilityScore: 0.98
                },
                metadata: {},
                isAvailable: true
            },
            {
                modelId: 'gpt-4o-mini',
                provider: 'openai',
                providerType: AIProviderType.OpenAI,
                displayName: 'GPT-4o Mini',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING,
                    ModelCapability.JSON_MODE,
                    ModelCapability.FUNCTION_CALLING
                ]),
                contextWindow: 128000,
                maxOutputTokens: 4096,
                pricing: {
                    inputPricePerMillion: 0.15,
                    outputPricePerMillion: 0.60,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 800,
                    reliabilityScore: 0.97
                },
                metadata: {},
                isAvailable: true
            },
            {
                modelId: 'gpt-3.5-turbo',
                provider: 'openai',
                providerType: AIProviderType.OpenAI,
                displayName: 'GPT-3.5 Turbo',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.STREAMING,
                    ModelCapability.FUNCTION_CALLING
                ]),
                contextWindow: 16385,
                maxOutputTokens: 4096,
                pricing: {
                    inputPricePerMillion: 0.50,
                    outputPricePerMillion: 1.50,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 1200,
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
        return this.provider.isModelSupported(modelId);
    }
    
    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            // Simple test invocation
            await this.provider.invokeModel('test', 'gpt-3.5-turbo', { maxTokens: 5 });
            return true;
        } catch {
            return false;
        }
    }
}

