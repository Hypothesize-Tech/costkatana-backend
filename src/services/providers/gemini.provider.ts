/**
 * Gemini Provider
 * Native Google Generative AI SDK integration
 */

import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
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

export class GeminiProvider extends BaseAIProvider {
    private client: GoogleGenerativeAI;
    private static supportedModels = [
        // Gemini 2.5 models
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
        'gemini-2.5-flash-audio', 'gemini-2.5-flash-lite-audio-preview',
        'gemini-2.5-flash-native-audio-output',
        // Gemini 2.0 models
        'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-audio',
        // Gemini 1.5 models
        'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-large-context',
        'gemini-1.5-flash-8b-large-context', 'gemini-1.5-pro-large-context',
        'gemini-1.5-flash-8b',
        // Gemini 1.0 models
        'gemini-1.0-pro', 'gemini-1.0-pro-vision',
        // Legacy
        'gemini-pro', 'gemini-pro-vision'
    ];

    constructor(apiKey?: string) {
        super(AIProviderType.Google, apiKey || process.env.GEMINI_API_KEY);
        
        this.validateApiKey();
        
        this.client = new GoogleGenerativeAI(this.apiKey!);

        loggingService.info('Gemini provider initialized');
    }

    /**
     * Invoke Gemini model
     */
    async invokeModel(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<AIInvokeResponse> {
        const startTime = Date.now();

        try {
            this.logInvocation(model, prompt.length, options);

            // Get generative model instance
            const generativeModel = this.getModel(model, options);

            // Handle context/history
            let result;
            if (options?.recentMessages && options.recentMessages.length > 0) {
                // Use chat session for context
                result = await this.invokeWithContext(generativeModel, prompt, options);
            } else {
                // Simple generation without context
                result = await generativeModel.generateContent(prompt);
            }

            const latency = Date.now() - startTime;

            // Extract response
            const response = result.response;
            const responseText = response.text();
            
            // Get usage information
            const usage = {
                inputTokens: response.usageMetadata?.promptTokenCount || this.estimateTokens(prompt),
                outputTokens: response.usageMetadata?.candidatesTokenCount || this.estimateTokens(responseText),
                totalTokens: response.usageMetadata?.totalTokenCount || 0
            };

            if (!usage.totalTokens) {
                usage.totalTokens = usage.inputTokens + usage.outputTokens;
            }

            const finishReason = response.candidates?.[0]?.finishReason || 'STOP';
            const safetyRatings = response.candidates?.[0]?.safetyRatings;

            const aiResponse: AIInvokeResponse = {
                text: responseText,
                usage,
                model,
                provider: AIProviderType.Google,
                finishReason,
                cached: response.usageMetadata?.cachedContentTokenCount ? true : false
            };

            // Calculate cost
            const costUSD = calculateCost(usage.inputTokens, usage.outputTokens, 'google', model);

            // Record telemetry
            recordGenAIUsage({
                provider: 'google',
                operationName: 'generateContent',
                model,
                promptTokens: usage.inputTokens,
                completionTokens: usage.outputTokens,
                costUSD,
                prompt,
                completion: responseText,
                temperature: options?.temperature || 0.7,
                maxTokens: options?.maxTokens || 4096,
                latencyMs: latency,
            });

            // Track AI cost
            AICostTrackingService.trackCall({
                service: 'google',
                operation: 'generate_content',
                model,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                estimatedCost: costUSD,
                latency,
                success: true,
                metadata: {
                    finishReason,
                    hasContext: !!options?.recentMessages,
                    safetyRatings: safetyRatings ? JSON.stringify(safetyRatings) : undefined,
                    cached: aiResponse.cached
                }
            });

            this.logResponse(model, aiResponse, latency);

            return aiResponse;

        } catch (error: any) {
            const latency = Date.now() - startTime;

            // Track failed call
            AICostTrackingService.trackCall({
                service: 'google',
                operation: 'generate_content',
                model,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCost: 0,
                latency,
                success: false,
                error: error.message || String(error),
                metadata: {
                    errorType: error.name || 'UnknownError'
                }
            });

            this.handleError(error, model);
        }
    }

    /**
     * Get configured model instance
     */
    private getModel(model: string, options?: AIInvokeOptions): GenerativeModel {
        const temperature = this.normalizeTemperature(options?.temperature);
        const maxTokens = this.normalizeMaxTokens(options?.maxTokens, 8192);

        return this.client.getGenerativeModel({
            model,
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
                topP: options?.topP || 0.95,
                stopSequences: options?.stopSequences,
            },
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
            ],
        });
    }

    /**
     * Invoke with conversation context
     */
    private async invokeWithContext(
        model: GenerativeModel,
        prompt: string,
        options: AIInvokeOptions
    ) {
        // Convert messages to Gemini chat history format
        const history = options.recentMessages!
            .filter(msg => msg.role !== 'system') // Gemini doesn't have system role in history
            .map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

        // Start chat session with history
        const chat = model.startChat({
            history
        });

        // Add system message to prompt if provided
        let finalPrompt = prompt;
        if (options.systemMessage) {
            finalPrompt = `${options.systemMessage}\n\n${prompt}`;
        }

        // Send message
        return await chat.sendMessage(finalPrompt);
    }

    /**
     * Estimate tokens (rough estimate for Gemini)
     */
    estimateTokens(text: string): number {
        // Gemini token estimation (similar to GPT, roughly 4 chars per token)
        return this.simpleTokenEstimate(text);
    }

    /**
     * Check if model is supported
     */
    isModelSupported(model: string): boolean {
        const normalized = model.toLowerCase().trim();
        return GeminiProvider.supportedModels.some(m => 
            normalized === m.toLowerCase() || normalized.startsWith(m.toLowerCase())
        );
    }

    /**
     * Check if Gemini is available (API key configured)
     */
    static isAvailable(): boolean {
        return !!process.env.GEMINI_API_KEY;
    }

    /**
     * Get list of supported models
     */
    static getSupportedModels(): string[] {
        return [...GeminiProvider.supportedModels];
    }
}

