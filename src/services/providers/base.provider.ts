/**
 * Base Provider
 * Common utilities and base class for all AI providers
 */

import { loggingService } from '../logging.service';
import { 
    AIProviderInterface, 
    AIInvokeOptions, 
    AIInvokeResponse, 
    AIProviderError,
    AIProviderType
} from '../../types/aiProvider.types';

export abstract class BaseAIProvider implements AIProviderInterface {
    protected providerType: AIProviderType;
    protected apiKey?: string;

    constructor(providerType: AIProviderType, apiKey?: string) {
        this.providerType = providerType;
        this.apiKey = apiKey;
    }

    /**
     * Abstract methods that must be implemented by each provider
     */
    abstract invokeModel(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<AIInvokeResponse>;

    abstract estimateTokens(text: string): number;

    abstract isModelSupported(model: string): boolean;

    /**
     * Common utility: Validate API key
     */
    protected validateApiKey(): void {
        if (!this.apiKey) {
            throw new AIProviderError(
                `API key not configured for ${this.providerType}`,
                this.providerType
            );
        }
    }

    /**
     * Common utility: Log invocation
     */
    protected logInvocation(model: string, promptLength: number, metadata?: any): void {
        loggingService.debug(`${this.providerType} invocation`, {
            provider: this.providerType,
            model,
            promptLength,
            ...metadata
        });
    }

    /**
     * Common utility: Log response
     */
    protected logResponse(model: string, response: AIInvokeResponse, latency: number): void {
        loggingService.info(`${this.providerType} response received`, {
            provider: this.providerType,
            model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            latency,
            cached: response.cached
        });
    }

    /**
     * Common utility: Handle errors
     */
    protected handleError(error: any, model: string): never {
        const message = error?.message || String(error);
        const statusCode = error?.status || error?.statusCode;
        
        loggingService.error(`${this.providerType} error`, {
            provider: this.providerType,
            model,
            error: message,
            statusCode
        });

        throw new AIProviderError(
            `${this.providerType} invocation failed: ${message}`,
            this.providerType,
            error,
            statusCode
        );
    }

    /**
     * Common utility: Simple token estimation fallback
     */
    protected simpleTokenEstimate(text: string): number {
        // Rough estimate: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    /**
     * Common utility: Build messages array from prompt and context
     */
    protected buildMessagesFromContext(
        prompt: string,
        options?: AIInvokeOptions
    ): Array<{ role: string; content: string }> {
        const messages: Array<{ role: string; content: string }> = [];

        // Add system message if provided
        if (options?.systemMessage) {
            messages.push({
                role: 'system',
                content: options.systemMessage
            });
        }

        // Add recent messages if provided
        if (options?.recentMessages && options.recentMessages.length > 0) {
            messages.push(...options.recentMessages);
        }

        // Add current prompt
        messages.push({
            role: 'user',
            content: prompt
        });

        return messages;
    }

    /**
     * Common utility: Normalize temperature
     */
    protected normalizeTemperature(temperature?: number): number {
        if (temperature === undefined || temperature === null) {
            return 0.7; // Default
        }
        return Math.max(0, Math.min(2, temperature)); // Clamp between 0 and 2
    }

    /**
     * Common utility: Normalize max tokens
     */
    protected normalizeMaxTokens(maxTokens?: number, defaultValue: number = 4096): number {
        if (maxTokens === undefined || maxTokens === null) {
            return defaultValue;
        }
        return Math.max(1, maxTokens);
    }
}

/**
 * Provider utility functions
 */
export class ProviderUtils {
    /**
     * Detect provider from model name
     */
    static detectProvider(model: string): AIProviderType {
        const modelLower = model.toLowerCase();

        // OpenAI models
        if (
            modelLower.includes('gpt') ||
            modelLower.includes('o1-') ||
            modelLower.includes('text-') ||
            modelLower.includes('dall-e') ||
            modelLower.includes('whisper')
        ) {
            return AIProviderType.OpenAI;
        }

        // Google/Gemini models
        if (
            modelLower.includes('gemini') ||
            modelLower.includes('palm')
        ) {
            return AIProviderType.Google;
        }

        // Claude models or AWS-specific models
        if (
            modelLower.includes('claude') ||
            modelLower.includes('nova') ||
            modelLower.includes('titan') ||
            modelLower.includes('llama') ||
            modelLower.includes('mistral') ||
            modelLower.includes('anthropic.')
        ) {
            return AIProviderType.Bedrock;
        }

        // Default to Bedrock for unknown models
        return AIProviderType.Bedrock;
    }

    /**
     * Normalize model name (remove provider prefixes, handle aliases)
     */
    static normalizeModelName(model: string): string {
        let normalized = model.trim();

        // Remove common prefixes
        normalized = normalized.replace(/^(openai\.|anthropic\.|google\.|amazon\.)/, '');

        // Handle common aliases
        const aliases: Record<string, string> = {
            'gpt-3.5': 'gpt-3.5-turbo',
            'gpt-4': 'gpt-4-turbo',
            'gemini-pro': 'gemini-1.5-pro',
            'gemini-flash': 'gemini-1.5-flash',
        };

        return aliases[normalized] || normalized;
    }

    /**
     * Check if model requires vision capabilities
     */
    static isVisionModel(model: string): boolean {
        const modelLower = model.toLowerCase();
        return (
            modelLower.includes('vision') ||
            modelLower.includes('gpt-4') ||
            modelLower.includes('gemini') ||
            modelLower.includes('claude-3')
        );
    }
}

