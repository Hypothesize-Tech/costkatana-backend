/**
 * OpenAI Provider
 * Native OpenAI SDK integration
 */

import OpenAI from 'openai';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { BaseAIProvider } from './base.provider';
import { 
    AIInvokeOptions, 
    AIInvokeResponse, 
    AIProviderType,
} from '../../types/aiProvider.types';
import { loggingService } from '../logging.service';
import { calculateCost } from '../../utils/pricing';
import { recordGenAIUsage } from '../../utils/genaiTelemetry';
import { AICostTrackingService } from '../aiCostTracking.service';

export class OpenAIProvider extends BaseAIProvider {
    private client: OpenAI;
    private static supportedModels = [
        // GPT-5 models
        'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-pro', 'gpt-5-codex', 'gpt-5-chat-latest',
        // GPT-4.1 models
        'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
        // GPT-4o models
        'gpt-4o', 'gpt-4o-mini', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview',
        'gpt-4o-2024-08-06', 'gpt-4o-2024-05-13', 'gpt-4o-mini-2024-07-18',
        // GPT-4 models
        'gpt-4', 'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-4-vision-preview',
        'gpt-4-32k', 'gpt-4-0613', 'gpt-4-0314',
        // GPT-3.5 models
        'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-0125',
        // O1 models
        'o1-preview', 'o1-mini', 'o1-preview-2024-09-12', 'o1-mini-2024-09-12',
        // Chat models
        'chatgpt-4o-latest',
        // Image models
        'gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2',
        // Other
        'gpt-realtime', 'gpt-realtime-mini', 'gpt-audio', 'gpt-audio-mini'
    ];

    constructor(apiKey?: string) {
        super(AIProviderType.OpenAI, apiKey || process.env.OPENAI_API_KEY);
        
        this.validateApiKey();
        
        this.client = new OpenAI({
            apiKey: this.apiKey,
            maxRetries: 3,
            timeout: 60000, // 60 seconds
        });

        loggingService.info('OpenAI provider initialized');
    }

    /**
     * Invoke OpenAI model
     */
    async invokeModel(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<AIInvokeResponse> {
        const startTime = Date.now();

        try {
            this.logInvocation(model, prompt.length, options);

            // Build messages from context
            const messages = this.buildMessagesFromContext(prompt, options);

            // Prepare request parameters
            const temperature = this.normalizeTemperature(options?.temperature);
            const maxTokens = this.normalizeMaxTokens(options?.maxTokens);

            // Make API call
            const completion = await this.client.chat.completions.create({
                model,
                messages: messages as any,
                temperature,
                max_tokens: maxTokens,
                top_p: options?.topP || 1.0,
                stop: options?.stopSequences,
            });

            const latency = Date.now() - startTime;

            // Extract response
            const responseText = completion.choices[0]?.message?.content || '';
            const finishReason = completion.choices[0]?.finish_reason || 'stop';

            // Get usage information
            const usage = {
                inputTokens: completion.usage?.prompt_tokens || this.estimateTokens(prompt),
                outputTokens: completion.usage?.completion_tokens || this.estimateTokens(responseText),
                totalTokens: completion.usage?.total_tokens || 0
            };

            if (!usage.totalTokens) {
                usage.totalTokens = usage.inputTokens + usage.outputTokens;
            }

            const response: AIInvokeResponse = {
                text: responseText,
                usage,
                model,
                provider: AIProviderType.OpenAI,
                finishReason,
                cached: false
            };

            // Calculate cost
            const costUSD = calculateCost(usage.inputTokens, usage.outputTokens, 'openai', model);

            // Record telemetry
            recordGenAIUsage({
                provider: 'openai',
                operationName: 'chat.completions',
                model,
                promptTokens: usage.inputTokens,
                completionTokens: usage.outputTokens,
                costUSD,
                prompt,
                completion: responseText,
                temperature,
                maxTokens,
                latencyMs: latency,
            });

            // Track AI cost
            AICostTrackingService.trackCall({
                service: 'openai',
                operation: 'chat_completion',
                model,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                estimatedCost: costUSD,
                latency,
                success: true,
                metadata: {
                    finishReason,
                    hasContext: !!options?.recentMessages,
                    messageCount: messages.length
                }
            });

            this.logResponse(model, response, latency);

            return response;

        } catch (error: any) {
            const latency = Date.now() - startTime;

            // Track failed call
            AICostTrackingService.trackCall({
                service: 'openai',
                operation: 'chat_completion',
                model,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latency,
                success: false,
                error: error.message || String(error),
                metadata: {
                    errorType: error.name || 'UnknownError',
                    statusCode: error.status
                }
            });

            this.handleError(error, model);
        }
    }

    /**
     * Estimate tokens using tiktoken
     */
    estimateTokens(text: string): number {
        try {
            // Try to get encoding for specific model
            const encoding = encoding_for_model('gpt-4' as TiktokenModel);
            const tokens = encoding.encode(text);
            encoding.free();
            return tokens.length;
        } catch (error) {
            // Fallback to simple estimation
            loggingService.debug('Tiktoken estimation failed, using simple estimate', { error });
            return this.simpleTokenEstimate(text);
        }
    }

    /**
     * Check if model is supported
     */
    isModelSupported(model: string): boolean {
        const normalized = model.toLowerCase().trim();
        return OpenAIProvider.supportedModels.some(m => 
            normalized === m.toLowerCase() || normalized.startsWith(m.toLowerCase())
        );
    }

    /**
     * Check if OpenAI is available (API key configured)
     */
    static isAvailable(): boolean {
        return !!process.env.OPENAI_API_KEY;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): string[] {
        return [...OpenAIProvider.supportedModels];
    }
}

