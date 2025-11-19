/**
 * AI Router Service
 * Intelligent routing to native SDKs (OpenAI, Gemini) or AWS Bedrock with fallback support
 */

import { OpenAIProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { BedrockService } from './bedrock.service';
import { ProviderUtils } from './providers/base.provider';
import { 
    AIProviderType, 
    AIInvokeOptions, 
    AIProviderError 
} from '../types/aiProvider.types';
import { loggingService } from './logging.service';

export class AIRouterService {
    private static openaiProvider: OpenAIProvider | null = null;
    private static geminiProvider: GeminiProvider | null = null;

    /**
     * Initialize providers (lazy loading)
     */
    private static initializeProviders(): void {
        // Initialize OpenAI if available and not already initialized
        if (!this.openaiProvider && OpenAIProvider.isAvailable()) {
            try {
                this.openaiProvider = new OpenAIProvider();
                loggingService.info('OpenAI provider initialized in router');
            } catch (error) {
                loggingService.warn('Failed to initialize OpenAI provider', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // Initialize Gemini if available and not already initialized
        if (!this.geminiProvider && GeminiProvider.isAvailable()) {
            try {
                this.geminiProvider = new GeminiProvider();
                loggingService.info('Gemini provider initialized in router');
            } catch (error) {
                loggingService.warn('Failed to initialize Gemini provider', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Main entry point: Route and invoke AI model
     * This replaces BedrockService.invokeModel() throughout the codebase
     */
    static async invokeModel(
        prompt: string,
        model: string,
        context?: {
            recentMessages?: Array<{ role: string; content: string }>;
            useSystemPrompt?: boolean;
            systemMessage?: string;
            temperature?: number;
            maxTokens?: number;
            topP?: number;
            stopSequences?: string[];
        }
    ): Promise<string> {
        // Initialize providers if needed
        this.initializeProviders();

        // Detect provider from model name
        const providerType = ProviderUtils.detectProvider(model);

        loggingService.debug('AI Router: Routing request', {
            model,
            detectedProvider: providerType,
            hasContext: !!context?.recentMessages
        });

        // Convert context to AIInvokeOptions
        const options: AIInvokeOptions | undefined = context ? {
            recentMessages: context.recentMessages?.map(msg => ({
                role: msg.role as 'user' | 'assistant' | 'system',
                content: msg.content
            })),
            useSystemPrompt: context.useSystemPrompt,
            systemMessage: context.systemMessage,
            temperature: context.temperature,
            maxTokens: context.maxTokens,
            topP: context.topP,
            stopSequences: context.stopSequences
        } : undefined;

        try {
            // Route to appropriate provider
            switch (providerType) {
                case AIProviderType.OpenAI:
                    return await this.invokeOpenAI(prompt, model, options);

                case AIProviderType.Google:
                    return await this.invokeGemini(prompt, model, options);

                case AIProviderType.Bedrock:
                default:
                    return await this.invokeBedrock(prompt, model, context);
            }
        } catch (error) {
            loggingService.error('AI Router: Primary invocation failed', {
                model,
                provider: providerType,
                error: error instanceof Error ? error.message : String(error)
            });

            // Attempt fallback to Bedrock if not already using it
            if (providerType !== AIProviderType.Bedrock) {
                loggingService.info('AI Router: Attempting Bedrock fallback', { model });
                try {
                    return await this.invokeBedrock(prompt, model, context);
                } catch (fallbackError) {
                    loggingService.error('AI Router: Bedrock fallback also failed', {
                        model,
                        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                    });
                }
            }

            // Re-throw the original error if fallback also failed
            throw error;
        }
    }

    /**
     * Invoke OpenAI via native SDK
     */
    private static async invokeOpenAI(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<string> {
        if (!this.openaiProvider) {
            throw new AIProviderError(
                'OpenAI provider not available (API key not configured)',
                AIProviderType.OpenAI
            );
        }

        loggingService.debug('AI Router: Using OpenAI native SDK', { model });

        const response = await this.openaiProvider.invokeModel(prompt, model, options);
        return response.text;
    }

    /**
     * Invoke Gemini via native SDK
     */
    private static async invokeGemini(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<string> {
        if (!this.geminiProvider) {
            throw new AIProviderError(
                'Gemini provider not available (API key not configured)',
                AIProviderType.Google
            );
        }

        loggingService.debug('AI Router: Using Gemini native SDK', { model });

        const response = await this.geminiProvider.invokeModel(prompt, model, options);
        return response.text;
    }

    /**
     * Invoke via AWS Bedrock (fallback or Bedrock-specific models)
     */
    private static async invokeBedrock(
        prompt: string,
        model: string,
        context?: {
            recentMessages?: Array<{ role: string; content: string }>;
            useSystemPrompt?: boolean;
        }
    ): Promise<string> {
        loggingService.debug('AI Router: Using AWS Bedrock', { model });

        // For Bedrock, we might need to map OpenAI/Gemini model names to Bedrock equivalents
        const bedrockModel = this.mapToBedrockModel(model);

        return await BedrockService.invokeModel(prompt, bedrockModel, context);
    }

    /**
     * Map model names to Bedrock equivalents for fallback
     */
    private static mapToBedrockModel(model: string): string {
        const modelLower = model.toLowerCase();

        // Map common OpenAI models to Bedrock Claude equivalents
        if (modelLower.includes('gpt-4') || modelLower.includes('gpt-5')) {
            return 'anthropic.claude-3-5-sonnet-20240620-v1:0';
        }
        if (modelLower.includes('gpt-3.5') || modelLower.includes('gpt-4o-mini')) {
            return 'anthropic.claude-3-5-haiku-20241022-v1:0';
        }

        // Map Gemini models to Bedrock equivalents
        if (modelLower.includes('gemini-pro') || modelLower.includes('gemini-1.5-pro')) {
            return 'anthropic.claude-3-5-sonnet-20240620-v1:0';
        }
        if (modelLower.includes('gemini-flash') || modelLower.includes('gemini-2.0')) {
            return 'anthropic.claude-3-5-haiku-20241022-v1:0';
        }

        // Return original model if no mapping found (assume it's already a Bedrock model)
        return model;
    }

    /**
     * Get provider status
     */
    static getProviderStatus(): {
        openai: boolean;
        gemini: boolean;
        bedrock: boolean;
    } {
        return {
            openai: OpenAIProvider.isAvailable(),
            gemini: GeminiProvider.isAvailable(),
            bedrock: true // Bedrock is always available as fallback
        };
    }

    /**
     * Get supported models for all providers
     */
    static getSupportedModels(): {
        openai: string[];
        gemini: string[];
        all: string[];
    } {
        const openaiModels = OpenAIProvider.isAvailable() ? OpenAIProvider.getSupportedModels() : [];
        const geminiModels = GeminiProvider.isAvailable() ? GeminiProvider.getSupportedModels() : [];

        return {
            openai: openaiModels,
            gemini: geminiModels,
            all: [...openaiModels, ...geminiModels]
        };
    }

    /**
     * Check if a specific model is supported by any provider
     */
    static isModelSupported(model: string): boolean {
        this.initializeProviders();

        if (this.openaiProvider?.isModelSupported(model)) {
            return true;
        }

        if (this.geminiProvider?.isModelSupported(model)) {
            return true;
        }

        // If not supported by native providers, assume Bedrock might support it
        return true;
    }

    /**
     * Detect which provider will be used for a given model
     */
    static detectProvider(model: string): AIProviderType {
        return ProviderUtils.detectProvider(model);
    }

    /**
     * Extract JSON from AI response text
     * Handles JSON in code blocks, plain JSON, and TOON format
     */
    static async extractJson(text: string): Promise<string> {
        // Delegate to BedrockService.extractJson which has robust extraction logic
        return await BedrockService.extractJson(text);
    }
}

