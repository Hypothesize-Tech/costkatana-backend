import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, AWS_CONFIG } from '../config/aws';
import { loggingService } from './logging.service';
import { retryBedrockOperation } from '../utils/bedrockRetry';
import { WebScraperService } from './web-scraper.service';

export interface ProviderPricing {
    provider: string;
    models: ModelPricing[];
    lastUpdated: Date;
    source: string;
}

export interface ModelPricing {
    modelId: string;
    modelName: string;
    inputPricePerMToken: number | null;  // Price per million tokens for input
    outputPricePerMToken: number | null; // Price per million tokens for output
    contextWindow: number | null;
    capabilities: string[];
    category: 'text' | 'multimodal' | 'embedding' | 'code';
    isLatest: boolean;
}

export interface PricingComparison {
    task: string;
    estimatedTokens: number;
    providers: Array<{
        provider: string;
        model: string;
        estimatedCost: number;
        inputCost: number;
        outputCost: number;
        pricePerMToken: number;
        features: string[];
    }>;
    lastUpdated: Date;
}

export class RealtimePricingService {
    private static pricingCache = new Map<string, ProviderPricing>();
    private static lastUpdateTime = new Map<string, Date>();
    private static updateInterval = 30 * 60 * 1000; // 30 minutes
    private static isUpdating = false;
    
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Content preprocessing optimization
    private static contentCache = new Map<string, string>();
    
    // Provider-specific optimization strategies
    private static providerStrategies = new Map<string, any>();
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
        this.initializeProviderStrategies();
    }

    static async initialize() {
        loggingService.info('Initializing RealtimePricingService');

        // Start periodic updates
        setInterval(() => {
            this.updateAllPricing();
        }, this.updateInterval);

        // Start initial update in background (don't await to avoid blocking)
        this.updateAllPricing().catch(error => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Initial pricing update failed: ${errorMessage}`);
        });

        loggingService.info('RealtimePricingService initialized with background updates');
    }

    private static createModelPayload(prompt: string, modelId: string) {
        const lowerModelId = modelId.toLowerCase();

        // Check model type and create appropriate payload
        if (lowerModelId.includes('nova')) {
            // Nova models format
            return {
                messages: [{ role: "user", content: [{ text: prompt }] }],
                inferenceConfig: {
                    max_new_tokens: AWS_CONFIG.bedrock.maxTokens,
                    temperature: AWS_CONFIG.bedrock.temperature,
                    top_p: 0.9,
                }
            };
        } else if (lowerModelId.includes('claude-3') || lowerModelId.includes('claude-v3')) {
            // Claude 3 models format
            return {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: AWS_CONFIG.bedrock.maxTokens,
                temperature: AWS_CONFIG.bedrock.temperature,
                messages: [{ role: "user", content: prompt }],
            };
        } else if (lowerModelId.includes('amazon.titan')) {
            // Titan models format
            return {
                inputText: prompt,
                textGenerationConfig: {
                    maxTokenCount: AWS_CONFIG.bedrock.maxTokens,
                    temperature: AWS_CONFIG.bedrock.temperature,
                },
            };
        } else if (lowerModelId.includes('claude')) {
            // Older Claude models format
            return {
                prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
                max_tokens_to_sample: AWS_CONFIG.bedrock.maxTokens,
                temperature: AWS_CONFIG.bedrock.temperature,
                stop_sequences: ["\n\nHuman:"],
            };
        } else {
            // Default to Nova format for unknown models
            return {
                messages: [{ role: "user", content: [{ text: prompt }] }],
                inferenceConfig: {
                    max_new_tokens: AWS_CONFIG.bedrock.maxTokens,
                    temperature: AWS_CONFIG.bedrock.temperature,
                    top_p: 0.9,
                }
            };
        }
    }

    private static extractResponseText(responseBody: any, modelId: string): string {
        const lowerModelId = modelId.toLowerCase();

        if (lowerModelId.includes('nova')) {
            return responseBody.output?.message?.content?.[0]?.text || responseBody.message?.content?.[0]?.text || '';
        } else if (lowerModelId.includes('claude-3') || lowerModelId.includes('claude-v3')) {
            return responseBody.content?.[0]?.text || '';
        } else if (lowerModelId.includes('amazon.titan')) {
            return responseBody.results?.[0]?.outputText || '';
        } else if (lowerModelId.includes('claude')) {
            return responseBody.completion || '';
        } else {
            // Default to Nova format
            return responseBody.output?.message?.content?.[0]?.text || responseBody.message?.content?.[0]?.text || '';
        }
    }

    private static async getScrapedPricingData(provider: string): Promise<string> {
        try {
            const scrapedData = await WebScraperService.scrapeProviderPricing(provider);

            if (!scrapedData.success || !scrapedData.content) {
                throw new Error(`Failed to scrape pricing data for ${provider}: ${scrapedData.error}`);
            }

            loggingService.info(`Successfully scraped ${scrapedData.content.length} characters for ${provider}`);
            return scrapedData.content;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Error scraping pricing data for ${provider}: ${errorMessage}`);
            throw error;
        }
    }

    private static async extractPricingData(provider: string, scrapedContent: string): Promise<ProviderPricing> {
        const extractPrompt = `Extract structured pricing data from the following official pricing page content for ${provider}.
        
        This is real content scraped from ${provider}'s official pricing page. Extract ALL models and their pricing information.
        
        Return a JSON object with this exact structure:
        {
            "provider": "${provider}",
            "models": [
                {
                    "modelId": "exact_model_identifier",
                    "modelName": "Human readable name", 
                    "inputPricePerMToken": 15.0,
                    "outputPricePerMToken": 75.0,
                    "contextWindow": 200000,
                    "capabilities": ["text", "reasoning", "analysis"],
                    "category": "text|multimodal|embedding|code",
                    "isLatest": true|false
                }
            ],
            "source": "${provider} Official Pricing Page"
        }

        Official Pricing Content:
        ${scrapedContent}

        Critical Instructions:
        - Convert ALL prices to per MILLION tokens format (e.g., if you see $0.50 per 1K tokens, convert to 500 per million tokens)
        - Extract ALL models mentioned, including different versions and sizes
        - Use exact model names/IDs as they appear on the pricing page
        - Mark the newest/latest models as isLatest: true
        - If price is "free" or not specified, use 0.0
        - Include context window in tokens (e.g., 32000, 128000, 200000)
        - For capabilities, include relevant tags like: text, multimodal, code, reasoning, analysis, embedding, image, vision
        - Category should be the primary use case: text, multimodal, embedding, or code
        - Ensure ALL numeric values are actual numbers, not strings
        
        Return ONLY valid JSON without markdown formatting or additional text.`;

        try {
            const payload = this.createModelPayload(extractPrompt, AWS_CONFIG.bedrock.modelId);

            const command = new InvokeModelCommand({
                modelId: AWS_CONFIG.bedrock.modelId,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(payload),
            });

            const response = await retryBedrockOperation(
                () => bedrockClient.send(command),
                {
                    maxRetries: 3,
                    baseDelay: 1000,
                    maxDelay: 15000,
                    backoffMultiplier: 2,
                    jitterFactor: 0.25
                },
                {
                    modelId: AWS_CONFIG.bedrock.modelId,
                    operation: 'extractPricingData'
                }
            );
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            const extractedText = this.extractResponseText(responseBody, AWS_CONFIG.bedrock.modelId);

            // Clean and parse JSON
            const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No valid JSON found in response');
            }

            const pricingData = JSON.parse(jsonMatch[0]);
            return {
                ...pricingData,
                lastUpdated: new Date()
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Error extracting pricing data for ${provider}: ${errorMessage}`);
            throw error;
        }
    }

    private static async updateProviderPricing(provider: string): Promise<ProviderPricing> {
        try {
            loggingService.info(`Updating pricing for ${provider}`);

            const scrapedContent = await this.getScrapedPricingData(provider);
            const pricingData = await this.extractPricingData(provider, scrapedContent);

            this.pricingCache.set(provider, pricingData);
            this.lastUpdateTime.set(provider, new Date());

            loggingService.info(`Successfully updated pricing for ${provider}`);
            return pricingData;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Failed to update pricing for ${provider}: ${errorMessage}`);
            throw error;
        }
    }

    static async updateAllPricing(): Promise<void> {
        if (this.isUpdating) {
            loggingService.info('Pricing update already in progress, skipping');
            return;
        }

        this.isUpdating = true;
        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral'];

        try {
            loggingService.info('Starting pricing update for all providers');

            const updatePromises = providers.map(provider =>
                this.updateProviderPricing(provider).catch(error => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.error(`Failed to update ${provider}: ${errorMessage}`);
                    return null;
                })
            );

            await Promise.all(updatePromises);

            loggingService.info('Completed pricing update for all providers');
        } finally {
            this.isUpdating = false;
        }
    }

    static async getPricingForProvider(provider: string): Promise<ProviderPricing | null> {
        const cached = this.pricingCache.get(provider);
        const lastUpdate = this.lastUpdateTime.get(provider);

        // If no cache or cache is older than 1 hour, update
        if (!cached || !lastUpdate || Date.now() - lastUpdate.getTime() > 60 * 60 * 1000) {
            try {
                return await this.updateProviderPricing(provider);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.error(`Failed to get updated pricing for ${provider}, returning cached: ${errorMessage}`);
                return cached || null;
            }
        }

        return cached;
    }

    static async getAllPricing(): Promise<ProviderPricing[]> {
        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral'];
        const results: ProviderPricing[] = [];
        const uncachedProviders: string[] = [];

        // First pass: collect all cached data immediately
        for (const provider of providers) {
            const cached = this.pricingCache.get(provider);
            const lastUpdate = this.lastUpdateTime.get(provider);

            // Use cache if available and not too old (6 hours)
            const cacheMaxAge = 6 * 60 * 60 * 1000; // 6 hours
            if (cached && lastUpdate && Date.now() - lastUpdate.getTime() < cacheMaxAge) {
                results.push(cached);
            } else {
                // Mark for background update but don't block
                uncachedProviders.push(provider);

                // If we have any cached data (even if stale), use it for immediate response
                if (cached) {
                    results.push(cached);
                }
            }
        }

        // Trigger background updates for uncached/stale providers (don't await)
        if (uncachedProviders.length > 0) {
            loggingService.info(`Triggering background updates for ${uncachedProviders.length} providers: ${uncachedProviders.join(', ')}`);

            // Start background updates without blocking the response
            this.updateProvidersInBackground(uncachedProviders).catch(error => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.error(`Background update failed: ${errorMessage}`);
            });
        }

        // If we have no cached data at all, return fallback data to avoid empty response
        if (results.length === 0) {
            loggingService.warn('No cached pricing data available, generating fallback data');
            return await this.generateFallbackPricingData();
        }

        loggingService.info(`Returning ${results.length} cached pricing providers`);
        return results;
    }

    private static async updateProvidersInBackground(providers: string[]): Promise<void> {
        loggingService.info(`Starting background update for providers: ${providers.join(', ')}`);

        // Update providers in parallel for faster completion
        const updatePromises = providers.map(async (provider) => {
            try {
                loggingService.info(`Background update starting for ${provider}`);
                const pricingData = await this.updateProviderPricing(provider);
                loggingService.info(`Background update completed for ${provider}`);
                return pricingData;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.error(`Background update failed for ${provider}: ${errorMessage}`);
                return null;
            }
        });

        await Promise.all(updatePromises);
        loggingService.info(`Background update completed for all providers`);
    }

    private static async generateFallbackPricingData(): Promise<ProviderPricing[]> {
        // When no cache exists, generate basic fallback data from web scraper fallbacks
        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral'];
        const fallbackData: ProviderPricing[] = [];

        for (const provider of providers) {
            try {
                // Use fallback content from web scraper service
                const { WebScraperService } = await import('./web-scraper.service');
                const scrapedData = await WebScraperService.scrapeProviderPricing(provider);

                if (scrapedData.success && scrapedData.content) {
                    // Try to extract pricing from fallback content
                    const pricingData = await this.extractPricingData(provider, scrapedData.content);
                    fallbackData.push(pricingData);

                    // Cache the fallback data
                    this.pricingCache.set(provider, pricingData);
                    this.lastUpdateTime.set(provider, new Date());
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.error(`Failed to generate fallback data for ${provider}: ${errorMessage}`);
            }
        }

        return fallbackData;
    }

    static async comparePricing(task: string, estimatedTokens: number): Promise<PricingComparison> {
        const allPricing = await this.getAllPricing();
        const inputRatio = 0.6; // Assume 60% input, 40% output tokens
        const outputRatio = 0.4;

        const inputTokens = Math.round(estimatedTokens * inputRatio);
        const outputTokens = Math.round(estimatedTokens * outputRatio);

        const comparison: PricingComparison = {
            task,
            estimatedTokens,
            providers: [],
            lastUpdated: new Date()
        };

        for (const providerData of allPricing) {
            for (const model of providerData.models) {
                // Skip models with null pricing data
                if (model.inputPricePerMToken === null || model.outputPricePerMToken === null ||
                    model.inputPricePerMToken === undefined || model.outputPricePerMToken === undefined) {
                    continue;
                }

                const inputCost = (inputTokens / 1_000_000) * model.inputPricePerMToken;
                const outputCost = (outputTokens / 1_000_000) * model.outputPricePerMToken;
                const totalCost = inputCost + outputCost;

                comparison.providers.push({
                    provider: providerData.provider,
                    model: model.modelName,
                    estimatedCost: totalCost,
                    inputCost,
                    outputCost,
                    pricePerMToken: (model.inputPricePerMToken + model.outputPricePerMToken) / 2,
                    features: model.capabilities
                });
            }
        }

        // Sort by estimated cost
        comparison.providers.sort((a, b) => a.estimatedCost - b.estimatedCost);

        return comparison;
    }

    static async forceUpdate(): Promise<void> {
        await this.updateAllPricing();
    }

    static getLastUpdateTime(provider: string): Date | null {
        return this.lastUpdateTime.get(provider) || null;
    }

    static getCacheStatus(): { provider: string; lastUpdate: Date | null; cached: boolean }[] {
        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral'];
        return providers.map(provider => ({
            provider,
            lastUpdate: this.lastUpdateTime.get(provider) || null,
            cached: this.pricingCache.has(provider)
        }));
    }

    /**
     * Initialize provider-specific optimization strategies
     */
    private static initializeProviderStrategies(): void {
        const strategies = [
            {
                provider: 'OpenAI',
                contentSelectors: ['pricing', 'models', 'gpt', 'api'],
                pricePatterns: [/\$[\d.]+\s*per\s*1[kK]\s*tokens?/gi, /\$[\d.]+\/1[kK]/gi],
                modelPatterns: [/gpt-[\w.-]+/gi, /text-[\w.-]+/gi, /code-[\w.-]+/gi]
            },
            {
                provider: 'Anthropic',
                contentSelectors: ['pricing', 'claude', 'models', 'api'],
                pricePatterns: [/\$[\d.]+\s*per\s*1[kK]\s*tokens?/gi, /\$[\d.]+\/1[kK]/gi],
                modelPatterns: [/claude-[\w.-]+/gi]
            },
            {
                provider: 'Google AI',
                contentSelectors: ['pricing', 'gemini', 'models', 'api'],
                pricePatterns: [/\$[\d.]+\s*per\s*1[kK]\s*tokens?/gi, /\$[\d.]+\/1[kK]/gi],
                modelPatterns: [/gemini-[\w.-]+/gi, /palm-[\w.-]+/gi]
            },
            {
                provider: 'AWS Bedrock',
                contentSelectors: ['pricing', 'bedrock', 'models', 'inference'],
                pricePatterns: [/\$[\d.]+\s*per\s*1[kK]\s*tokens?/gi, /\$[\d.]+\/1[kK]/gi],
                modelPatterns: [/amazon\.[\w.-]+/gi, /anthropic\.[\w.-]+/gi, /cohere\.[\w.-]+/gi]
            },
            {
                provider: 'Cohere',
                contentSelectors: ['pricing', 'models', 'api', 'command'],
                pricePatterns: [/\$[\d.]+\s*per\s*1[kK]\s*tokens?/gi, /\$[\d.]+\/1[kK]/gi],
                modelPatterns: [/command-[\w.-]+/gi, /embed-[\w.-]+/gi]
            },
            {
                provider: 'Mistral',
                contentSelectors: ['pricing', 'models', 'api', 'mistral'],
                pricePatterns: [/\$[\d.]+\s*per\s*1[kK]\s*tokens?/gi, /\$[\d.]+\/1[kK]/gi],
                modelPatterns: [/mistral-[\w.-]+/gi, /mixtral-[\w.-]+/gi]
            }
        ];

        strategies.forEach(strategy => {
            this.providerStrategies.set(strategy.provider, strategy);
        });
    }


    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
        
        // Clear caches
        this.contentCache.clear();
        this.providerStrategies.clear();
    }
} 