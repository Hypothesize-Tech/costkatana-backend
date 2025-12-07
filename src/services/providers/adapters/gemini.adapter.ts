/**
 * Gemini Provider Adapter
 * 
 * Unified adapter implementing IProviderAdapter interface for Google Gemini models.
 * Wraps the existing Gemini provider with capability-based abstractions.
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
import { GeminiProvider } from '../gemini.provider';
import { loggingService } from '../../logging.service';

export class GeminiAdapter implements IProviderAdapter {
    readonly name = 'Google';
    readonly providerType = AIProviderType.Google;
    
    private provider: GeminiProvider;
    
    constructor(apiKey?: string) {
        this.provider = new GeminiProvider(apiKey);
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
                topK: request.topK,
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
            loggingService.error('Gemini adapter invocation failed', {
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
     * the underlying GeminiProvider to support streaming.
     */
    async *streamInvoke(request: UnifiedAIRequest): AsyncIterable<UnifiedAIStreamChunk> {
        try {
            loggingService.info('Gemini streaming using fallback (non-streaming API)', {
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
            
            loggingService.debug('Gemini streaming completed (fallback mode)', {
                modelId: request.modelId,
                totalTokens: response.usage.totalTokens
            });
            
        } catch (error) {
            loggingService.error('Gemini adapter streaming failed', {
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
                modelId: 'gemini-2.0-flash-exp',
                provider: 'google',
                providerType: AIProviderType.Google,
                displayName: 'Gemini 2.0 Flash',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.AUDIO,
                    ModelCapability.STREAMING,
                    ModelCapability.MULTIMODAL
                ]),
                contextWindow: 1000000,
                maxOutputTokens: 8192,
                pricing: {
                    inputPricePerMillion: 0.075,
                    outputPricePerMillion: 0.30,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 1500,
                    reliabilityScore: 0.94
                },
                metadata: { experimental: true },
                isAvailable: true,
                isExperimental: true
            },
            {
                modelId: 'gemini-1.5-pro',
                provider: 'google',
                providerType: AIProviderType.Google,
                displayName: 'Gemini 1.5 Pro',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING,
                    ModelCapability.MULTIMODAL
                ]),
                contextWindow: 2000000,
                maxOutputTokens: 8192,
                pricing: {
                    inputPricePerMillion: 1.25,
                    outputPricePerMillion: 5.00,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 2200,
                    reliabilityScore: 0.96
                },
                metadata: {},
                isAvailable: true
            },
            {
                modelId: 'gemini-1.5-flash',
                provider: 'google',
                providerType: AIProviderType.Google,
                displayName: 'Gemini 1.5 Flash',
                capabilities: new Set([
                    ModelCapability.TEXT,
                    ModelCapability.VISION,
                    ModelCapability.STREAMING
                ]),
                contextWindow: 1000000,
                maxOutputTokens: 8192,
                pricing: {
                    inputPricePerMillion: 0.075,
                    outputPricePerMillion: 0.30,
                    currency: 'USD',
                    lastUpdated: new Date()
                },
                performance: {
                    avgLatencyMs: 1000,
                    reliabilityScore: 0.95
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
            await this.provider.invokeModel('test', 'gemini-1.5-flash', { maxTokens: 5 });
            return true;
        } catch {
            return false;
        }
    }
}

