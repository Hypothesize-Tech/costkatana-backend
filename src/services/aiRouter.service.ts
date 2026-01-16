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
import { SubscriptionService } from './subscription.service';
import { ObjectId } from 'mongoose';
import { calculateCost } from '../utils/pricing';
import { AIInvokeResponse } from '../types/aiProvider.types';
import { LLMSecurityService } from './llmSecurity.service';
import { v4 as uuidv4 } from 'uuid';
import { IntelligentRouterService } from './intelligentRouter.service';
import { ModelRegistryService } from './modelRegistry.service';
import { PricingRegistryService } from './pricingRegistry.service';

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
     * Validate subscription before AI invocation
     */
    static async validateSubscriptionBeforeInvoke(
        userId: string | ObjectId,
        estimatedTokens: number,
        model: string
    ): Promise<{ valid: boolean; availableQuota?: { tokens: number; requests: number } }> {
        // Convert userId to string early for consistent use
        const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
        
        try {
            // Check subscription status and limits
            // SubscriptionService.getSubscriptionByUserId accepts string | ObjectId
            const subscription = await SubscriptionService.getSubscriptionByUserId(userIdStr as string | ObjectId);
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            // Check subscription status
            if (subscription.status !== 'active' && subscription.status !== 'trialing') {
                throw new Error(`Subscription is ${subscription.status}. Please activate your subscription.`);
            }

            // Check model access
            const allowedModels = subscription.allowedModels;
            if (!allowedModels.includes('*') && !allowedModels.includes(model)) {
                throw new Error(`Model ${model} is not available on your plan. Please upgrade.`);
            }

            // Check token quota
            await SubscriptionService.validateAndReserveTokens(userIdStr, estimatedTokens);

            // Check request quota
            await SubscriptionService.checkRequestQuota(userIdStr as string | ObjectId);

            const limit = subscription.limits.tokensPerMonth;
            const used = subscription.usage.tokensUsed;
            const availableTokens = limit === -1 ? Infinity : limit - used;

            const requestLimit = subscription.limits.requestsPerMonth;
            const usedRequests = subscription.usage.requestsUsed;
            const availableRequests = requestLimit === -1 ? Infinity : requestLimit - usedRequests;

            return {
                valid: true,
                availableQuota: {
                    tokens: availableTokens,
                    requests: availableRequests,
                },
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Subscription validation failed', {
                userId: userIdStr,
                model,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Track consumption after AI invocation
     */
    static async trackConsumptionAfterInvoke(
        userId: string | ObjectId,
        tokens: number,
        cost: number
    ): Promise<void> {
        // Convert userId to string early for consistent use
        const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
        
        try {
            // Consume tokens
            await SubscriptionService.consumeTokens(userIdStr, tokens);

            // Consume request
            await SubscriptionService.consumeRequest(userIdStr);

            loggingService.debug('Consumption tracked', {
                userId: userIdStr,
                tokens,
                cost,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error tracking consumption', {
                userId: userIdStr,
                tokens,
                cost,
                error: errorMessage,
            });
            // Don't throw - consumption tracking failure shouldn't break the request
        }
    }

    /**
     * Main entry point: Route and invoke AI model
     * This replaces BedrockService.invokeModel() throughout the codebase
     * Now includes comprehensive security checks for all threat categories
     */
    static async invokeModel(
        prompt: string,
        model: string,
        userId?: string | ObjectId,
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

        // Generate request ID for security tracking
        const requestId = `airouter_${Date.now()}_${uuidv4()}`;

        // SECURITY CHECK: Comprehensive threat detection before processing
        // This checks for all 15 threat categories including HTML content
        try {
            const userIdStr = userId ? (typeof userId === 'string' ? userId : String(userId)) : undefined;
            
            // Estimate cost for security analytics
            const estimatedTokens = Math.ceil(prompt.length / 4) + (context?.maxTokens ?? 1000);
            const estimatedCost = this.estimateRequestCost(model, estimatedTokens);

            // Perform comprehensive security check
            // Note: IP and user agent not available in service context, but source is tracked
            const securityCheck = await LLMSecurityService.performSecurityCheck(
                prompt,
                requestId,
                userIdStr,
                {
                    estimatedCost,
                    provenanceSource: 'ai-router',
                    source: 'ai-router'
                }
            );

            // If threat detected, block the request
            if (securityCheck.result.isBlocked) {
                const errorMessage = `Request blocked by security system: ${securityCheck.result.reason}`;
                loggingService.warn('AI Router: Request blocked by security', {
                    requestId,
                    userId: userIdStr,
                    model,
                    threatCategory: securityCheck.result.threatCategory,
                    confidence: securityCheck.result.confidence,
                    stage: securityCheck.result.stage
                });

                // Throw error with threat details
                const securityError: any = new Error(errorMessage);
                securityError.isSecurityBlock = true;
                securityError.threatCategory = securityCheck.result.threatCategory;
                securityError.confidence = securityCheck.result.confidence;
                securityError.stage = securityCheck.result.stage;
                throw securityError;
            }

            loggingService.debug('AI Router: Security check passed', {
                requestId,
                userId: userIdStr,
                model,
                promptLength: prompt.length
            });

        } catch (error: any) {
            // Re-throw security blocks
            if (error.isSecurityBlock) {
                throw error;
            }

            // Log security check failures but allow request to proceed (fail-open)
            loggingService.error('AI Router: Security check failed, allowing request', {
                error: error instanceof Error ? error.message : String(error),
                requestId,
                userId: userId ? String(userId) : undefined,
                model
            });
        }

        // Estimate tokens (rough estimate: 1 token ≈ 4 characters)
        const estimatedTokens = Math.ceil(prompt.length / 4) + (context?.maxTokens ?? 1000);

        // Validate subscription if userId is provided
        if (userId) {
            await this.validateSubscriptionBeforeInvoke(userId, estimatedTokens, model);
        }

        // Detect provider from model name
        const providerType = ProviderUtils.detectProvider(model);

        loggingService.debug('AI Router: Routing request', {
            model,
            detectedProvider: providerType,
            hasContext: !!context?.recentMessages,
            userId: userId?.toString(),
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

        let response: string;
        let actualTokens = estimatedTokens;
        let cost = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        try {
            // Route to appropriate provider
            switch (providerType) {
                case AIProviderType.OpenAI: {
                    const aiResponse: AIInvokeResponse = await this.invokeOpenAI(prompt, model, options);
                    response = aiResponse.text;
                    // Extract actual token usage from OpenAI response
                    inputTokens = aiResponse.usage.inputTokens;
                    outputTokens = aiResponse.usage.outputTokens;
                    actualTokens = aiResponse.usage.totalTokens;
                    // Calculate actual cost based on model pricing
                    cost = calculateCost(inputTokens, outputTokens, 'openai', model);
                    break;
                }

                case AIProviderType.Google: {
                    const aiResponse: AIInvokeResponse = await this.invokeGemini(prompt, model, options);
                    response = aiResponse.text;
                    // Extract actual token usage from Gemini response
                    inputTokens = aiResponse.usage.inputTokens;
                    outputTokens = aiResponse.usage.outputTokens;
                    actualTokens = aiResponse.usage.totalTokens;
                    // Calculate actual cost based on model pricing
                    cost = calculateCost(inputTokens, outputTokens, 'google', model);
                    break;
                }

                case AIProviderType.Bedrock:
                default: {
                    response = await this.invokeBedrock(prompt, model, context);
                    // BedrockService doesn't return token usage directly, so we estimate
                    // The actual tokens are tracked internally in BedrockService
                    inputTokens = Math.ceil(prompt.length / 4);
                    outputTokens = Math.ceil(response.length / 4);
                    actualTokens = inputTokens + outputTokens;
                    // Calculate actual cost based on model pricing
                    cost = calculateCost(inputTokens, outputTokens, 'aws-bedrock', model);
                    break;
                }
            }

            // Track consumption after successful invocation
            if (userId) {
                await this.trackConsumptionAfterInvoke(userId, actualTokens, cost);
            }

            loggingService.debug('AI Router: Consumption tracked', {
                userId: userId?.toString(),
                model,
                provider: providerType,
                inputTokens,
                outputTokens,
                totalTokens: actualTokens,
                cost,
            });

            return response;
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
                    response = await this.invokeBedrock(prompt, model, context);
                    
                    // Track consumption for fallback
                    if (userId) {
                        // Estimate tokens for Bedrock fallback
                        inputTokens = Math.ceil(prompt.length / 4);
                        outputTokens = Math.ceil(response.length / 4);
                        actualTokens = inputTokens + outputTokens;
                        // Calculate actual cost based on model pricing
                        cost = calculateCost(inputTokens, outputTokens, 'aws-bedrock', model);
                        await this.trackConsumptionAfterInvoke(userId, actualTokens, cost);
                    }

                    return response;
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
    ): Promise<AIInvokeResponse> {
        if (!this.openaiProvider) {
            throw new AIProviderError(
                'OpenAI provider not available (API key not configured)',
                AIProviderType.OpenAI
            );
        }

        loggingService.debug('AI Router: Using OpenAI native SDK', { model });

        const response = await this.openaiProvider.invokeModel(prompt, model, options);
        return response;
    }

    /**
     * Invoke Gemini via native SDK
     */
    private static async invokeGemini(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<AIInvokeResponse> {
        if (!this.geminiProvider) {
            throw new AIProviderError(
                'Gemini provider not available (API key not configured)',
                AIProviderType.Google
            );
        }

        loggingService.debug('AI Router: Using Gemini native SDK', { model });

        const response = await this.geminiProvider.invokeModel(prompt, model, options);
        return response;
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

        const result: string = await BedrockService.invokeModel(prompt, bedrockModel, context) as string;
        return result;
    }

    /**
     * Map model names to Bedrock equivalents for fallback
     */
    private static mapToBedrockModel(model: string): string {
        const modelLower = model.toLowerCase();

        // Map common OpenAI models to Bedrock Claude equivalents (using inference profiles)
        if (modelLower.includes('gpt-4') || modelLower.includes('gpt-5')) {
            return 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';
        }
        if (modelLower.includes('gpt-3.5') || modelLower.includes('gpt-4o-mini')) {
            return 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
        }

        // Map Gemini models to Bedrock equivalents (using inference profiles)
        if (modelLower.includes('gemini-pro') || modelLower.includes('gemini-1.5-pro')) {
            return 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';
        }
        if (modelLower.includes('gemini-flash') || modelLower.includes('gemini-2.0')) {
            return 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
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
     * Estimate request cost for security analytics
     */
    private static estimateRequestCost(model: string, tokens: number): number {
        // Rough cost estimates per 1M tokens
        const modelPricing: Record<string, { input: number; output: number }> = {
            'gpt-4': { input: 30, output: 60 },
            'gpt-3.5': { input: 0.5, output: 1.5 },
            'claude': { input: 3, output: 15 },
            'gemini': { input: 0.25, output: 0.5 },
            'nova': { input: 0.8, output: 3.2 },
            'default': { input: 1, output: 3 }
        };

        const modelLower = model.toLowerCase();
        let pricing = modelPricing.default;

        if (modelLower.includes('gpt-4')) {
            pricing = modelPricing['gpt-4'];
        } else if (modelLower.includes('gpt-3.5') || modelLower.includes('gpt-4o-mini')) {
            pricing = modelPricing['gpt-3.5'];
        } else if (modelLower.includes('claude')) {
            pricing = modelPricing.claude;
        } else if (modelLower.includes('gemini')) {
            pricing = modelPricing.gemini;
        } else if (modelLower.includes('nova')) {
            pricing = modelPricing.nova;
        }

        // Estimate 80% input, 20% output tokens
        const inputTokens = Math.ceil(tokens * 0.8);
        const outputTokens = Math.ceil(tokens * 0.2);

        return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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

    /**
     * Get optimal model using intelligent routing
     * Returns the best model based on requirements and strategy
     */
    static async getOptimalModel(options: {
        strategy?: 'cost_optimized' | 'quality_optimized' | 'balanced' | 'latency_optimized';
        capabilities?: string[];
        estimatedInputTokens?: number;
        estimatedOutputTokens?: number;
        maxCostPerRequest?: number;
        maxLatencyMs?: number;
    }): Promise<string | null> {
        try {
            const intelligentRouter = IntelligentRouterService.getInstance();
            
            const result = await intelligentRouter.route({
                strategy: options.strategy || 'balanced',
                requirements: {
                    requiredCapabilities: options.capabilities as any[]
                },
                estimatedInputTokens: options.estimatedInputTokens,
                estimatedOutputTokens: options.estimatedOutputTokens,
                constraints: {
                    maxCostPerRequest: options.maxCostPerRequest,
                    maxLatencyMs: options.maxLatencyMs
                }
            });

            if (!result) {
                loggingService.warn('No optimal model found', options);
                return null;
            }

            loggingService.info('Optimal model selected', {
                modelId: result.modelId,
                strategy: options.strategy,
                estimatedCost: result.estimatedCost,
                score: result.score
            });

            return result.modelId;
        } catch (error) {
            loggingService.error('Error getting optimal model', {
                error: error instanceof Error ? error.message : String(error),
                options
            });
            return null;
        }
    }

    /**
     * Get cheapest model for given capabilities
     */
    static async getCheapestModel(
        capabilities: string[],
        estimatedTokens: number = 1500
    ): Promise<string | null> {
        return this.getOptimalModel({
            strategy: 'cost_optimized',
            capabilities,
            estimatedInputTokens: Math.floor(estimatedTokens * 0.7),
            estimatedOutputTokens: Math.floor(estimatedTokens * 0.3)
        });
    }

    /**
     * Get highest quality model for given capabilities
     */
    static async getHighestQualityModel(
        capabilities: string[],
        estimatedTokens: number = 1500
    ): Promise<string | null> {
        return this.getOptimalModel({
            strategy: 'quality_optimized',
            capabilities,
            estimatedInputTokens: Math.floor(estimatedTokens * 0.7),
            estimatedOutputTokens: Math.floor(estimatedTokens * 0.3)
        });
    }

    /**
     * Get registry-based model information
     */
    static getModelInfo(modelId: string): any {
        const modelRegistry = ModelRegistryService.getInstance();
        return modelRegistry.getModel(modelId);
    }

    /**
     * Get registry-based pricing information
     */
    static getModelPricing(modelId: string): any {
        const pricingRegistry = PricingRegistryService.getInstance();
        return pricingRegistry.getPricing(modelId);
    }

    /**
     * Calculate cost using pricing registry
     */
    static calculateCostWithRegistry(
        modelId: string,
        inputTokens: number,
        outputTokens: number
    ): number {
        const pricingRegistry = PricingRegistryService.getInstance();
        const result = pricingRegistry.calculateCost({
            modelId,
            inputTokens,
            outputTokens
        });
        return result?.totalCost || 0;
    }
}

