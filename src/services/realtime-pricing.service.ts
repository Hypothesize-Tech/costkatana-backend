import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, AWS_CONFIG } from '../config/aws';
import { loggingService } from './logging.service';
import { retryBedrockOperation } from '../utils/bedrockRetry';
import { WebScraperService } from './web-scraper.service';
import { AIModelPricing } from '../models/AIModelPricing';

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
    private static updateInterval = 24 * 60 * 60 * 1000; // 24 hours
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
        const extractPrompt = `Extract structured pricing data from the following content for ${provider}.
        
        IMPORTANT: Extract pricing information from the provided content. If specific pricing is not found, use these reference prices:
        
        OpenAI Reference Prices (2025):
        - GPT-4o: $2.50/$10.00 per 1M tokens (input/output)
        - GPT-4o mini: $0.15/$0.60 per 1M tokens  
        - GPT-4.1: $10.00/$30.00 per 1M tokens
        - GPT-4.1 mini: $0.30/$1.20 per 1M tokens
        - GPT-3.5 Turbo: $0.50/$1.50 per 1M tokens
        - o3: $15.00/$60.00 per 1M tokens
        - o3-mini: $1.20/$4.80 per 1M tokens
        
        Grok/xAI Reference Prices (2025):
        - Grok 2 (grok-2-1212): $2.00/$10.00 per 1M tokens
        - Grok 2 Vision (grok-2-vision-1212): $2.00/$10.00 per 1M tokens  
        - Grok Beta (grok-beta): $5.00/$15.00 per 1M tokens
        
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
        - If provider is "Grok", make sure to use Grok model names (grok-2-1212, grok-2-vision-1212, grok-beta), NOT OpenAI model names
        - IMPORTANT: Prices should be in DOLLARS per MILLION tokens. 
          * If you see "$2.50 per 1M tokens" or "$2.50 per million tokens", use 2.50
          * If you see "$0.50 per 1K tokens" or "$0.50 per thousand tokens", convert to 500 per million tokens
          * If you see "$15 per 1M tokens", use 15.0
          * DO NOT multiply prices that are already per million tokens!
        - Extract ALL models mentioned, including different versions and sizes
        - Use exact model names/IDs as they appear on the pricing page
        - Mark the newest/latest models as isLatest: true
        - If price is "free" or not specified, use 0.0
        - Include context window in tokens (e.g., 32000, 128000, 200000)
        - For capabilities, include relevant tags like: text, multimodal, code, reasoning, analysis, embedding, image, vision
        - Category should be the primary use case: text, multimodal, embedding, or code
        - Ensure ALL numeric values are actual numbers, not strings
        
        Example pricing conversions:
        - "$2.50 per 1M tokens" → inputPricePerMToken: 2.5
        - "$10.00 per million tokens" → outputPricePerMToken: 10.0
        - "$0.15 per 1M tokens" → inputPricePerMToken: 0.15
        - "$0.50 per 1K tokens" → inputPricePerMToken: 500.0
        - "$30 per million tokens" → outputPricePerMToken: 30.0
        
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
        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral', 'Grok'];

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
        try {
            // Query MongoDB for active models
            const models = await AIModelPricing.find({
                provider: this.normalizeProviderName(provider),
                isActive: true,
                isDeprecated: false,
                validationStatus: 'verified'
            }).sort({ isLatest: -1, lastUpdated: -1 });

            if (models.length === 0) {
                loggingService.warn(`No models found in MongoDB for ${provider}, using fallback`);
                // Fall back to cache if MongoDB has no data
                const cached = this.pricingCache.get(provider);
                if (cached) {
                    return cached;
                }
                return null;
            }

            const providerPricing: ProviderPricing = {
                provider,
                models: models.map(m => ({
                    modelId: m.modelId,
                    modelName: m.modelName,
                    inputPricePerMToken: m.inputPricePerMToken,
                    outputPricePerMToken: m.outputPricePerMToken,
                    contextWindow: m.contextWindow,
                    capabilities: m.capabilities,
                    category: m.category,
                    isLatest: m.isLatest
                })),
                source: `MongoDB (${models[0]?.discoverySource})`,
                lastUpdated: models[0]?.lastUpdated || new Date()
            };

            // Update cache
            this.pricingCache.set(provider, providerPricing);
            this.lastUpdateTime.set(provider, new Date());

            return providerPricing;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Error getting pricing from MongoDB for ${provider}: ${errorMessage}`);
            
            // Fall back to cache
            const cached = this.pricingCache.get(provider);
            return cached || null;
        }
    }

    /**
     * Normalize provider names to match MongoDB schema
     */
    private static normalizeProviderName(provider: string): string {
        const mapping: Record<string, string> = {
            'OpenAI': 'openai',
            'Anthropic': 'anthropic',
            'Google AI': 'google-ai',
            'AWS Bedrock': 'aws-bedrock',
            'Cohere': 'cohere',
            'Mistral': 'mistral',
            'Grok': 'xai'
        };
        return mapping[provider] || provider.toLowerCase();
    }

    static async getAllPricing(): Promise<ProviderPricing[]> {
        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral', 'Grok'];
        const results: ProviderPricing[] = [];

        // Fetch from MongoDB for all providers in parallel
        const providerPromises = providers.map(provider => 
            this.getPricingForProvider(provider).catch(error => {
                loggingService.error(`Error fetching pricing for ${provider}`, {
                    error: error instanceof Error ? error.message : String(error)
                });
                return null;
            })
        );

        const providerResults = await Promise.all(providerPromises);

        // Collect non-null results
        for (const result of providerResults) {
            if (result) {
                results.push(result);
            }
        }

        // If we got no results from MongoDB, try fallback
        if (results.length === 0) {
            loggingService.warn('No pricing data from MongoDB, using fallback');
            return await this.generateFallbackPricingData();
        }

        return results;
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

    /**
     * Clear all pricing caches
     */
    static clearCache(): void {
        loggingService.info('Clearing all pricing caches');
        this.pricingCache.clear();
        this.lastUpdateTime.clear();
        this.contentCache.clear();
        loggingService.info('All pricing caches cleared successfully');
    }
} 