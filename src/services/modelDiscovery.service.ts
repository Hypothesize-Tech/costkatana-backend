import { GoogleSearchService } from './googleSearch.service';
import { BedrockService } from './bedrock.service';
import { WebScraperService } from './web-scraper.service';
import { loggingService } from './logging.service';
import { AIModelPricing, IAIModelPricing } from '../models/AIModelPricing';
import {
    RawPricingData,
    ModelDiscoveryResult,
    ValidationResult,
    ProviderDiscoveryConfig
} from '../types/modelDiscovery.types';

/**
 * Model Discovery Service
 * Implements hybrid Google Search + LLM approach for AI model discovery
 */
export class ModelDiscoveryService {
    private static googleSearch = GoogleSearchService.getInstance();

    // Provider-specific discovery configurations
    private static readonly PROVIDER_CONFIGS: Record<string, ProviderDiscoveryConfig> = {
        'openai': {
            provider: 'openai',
            discoveryQuery: 'site:platform.openai.com/docs/pricing',
            pricingQueryTemplate: 'OpenAI {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'https://platform.openai.com/docs/pricing',
            expectedModelPatterns: [/gpt-\d+/, /o\d+/, /dall-e/, /whisper/, /tts/]
        },
        'anthropic': {
            provider: 'anthropic',
            discoveryQuery: 'site:platform.claude.com/docs/en/about-claude/pricing "Model pricing" Claude Opus Sonnet Haiku MTok',
            pricingQueryTemplate: 'Anthropic {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'docs.anthropic.com/claude/docs/models-overview',
            expectedModelPatterns: [/claude-/, /opus/, /sonnet/, /haiku/]
        },
        'google-ai': {
            provider: 'google-ai',
            discoveryQuery: 'site:ai.google.dev/gemini-api/docs/pricing "Gemini" "Pro" "Flash" pricing',
            pricingQueryTemplate: 'Google {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'ai.google.dev/gemini-api/docs/models',
            expectedModelPatterns: [/gemini-/, /palm-/]
        },
        'aws-bedrock': {
            provider: 'aws-bedrock',
            discoveryQuery: 'site:aws.amazon.com/bedrock/pricing "Amazon Titan" "Amazon Nova" pricing',
            pricingQueryTemplate: 'AWS Bedrock {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html',
            expectedModelPatterns: [/anthropic\./, /amazon\./, /meta\./, /cohere\./]
        },
        'cohere': {
            provider: 'cohere',
            discoveryQuery: 'site:cohere.com "Command A" "Command R" "Embed" "Rerank" pricing API 2026',
            pricingQueryTemplate: 'Cohere {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'docs.cohere.com/docs/models',
            expectedModelPatterns: [/command/, /embed/, /rerank/]
        },
        'mistral': {
            provider: 'mistral',
            discoveryQuery: 'site:mistral.ai/pricing#api-pricing',
            pricingQueryTemplate: 'Mistral {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'docs.mistral.ai/getting-started/models',
            expectedModelPatterns: [/mistral-/, /mixtral-/]
        },
        'xai': {
            provider: 'xai',
            discoveryQuery: 'site:docs.x.ai/docs/models API',
            pricingQueryTemplate: 'xAI {modelName} pricing per token API 2026 cost input output',
            officialDocsUrl: 'docs.x.ai/docs/overview',
            expectedModelPatterns: [/grok-/]
        }
    };

    // Hardcoded fallback model lists from official documentation
    private static readonly FALLBACK_MODELS: Record<string, string[]> = {
        'anthropic': [
            'Claude Opus 4.5', 'Claude Opus 4.1', 'Claude Opus 4',
            'Claude Sonnet 4.5', 'Claude Sonnet 4', 'Claude Sonnet 3.7',
            'Claude Haiku 4.5', 'Claude Haiku 3.5', 'Claude Opus 3', 'Claude Haiku 3'
        ],
        'google-ai': [
            'Gemini 3 Pro Preview', 'Gemini 3 Flash Preview', 'Gemini 3 Pro Image Preview',
            'Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.5 Flash-Lite',
            'Gemini 2.0 Flash', 'Imagen 4', 'Imagen 3', 'Veo 3.1', 'Veo 3', 'Veo 2',
            'Gemini Embedding'
        ],
        'aws-bedrock': [
            'AI21 Jamba 1.5 Large', 'AI21 Jamba 1.5 Mini',
            'Amazon Titan Text Express', 'Amazon Titan Text Lite', 'Amazon Nova Pro', 'Amazon Nova Standard',
            'Anthropic Claude Opus 4.5', 'Anthropic Claude Opus 4.1', 'Anthropic Claude Opus 4',
            'Anthropic Claude Sonnet 4.5', 'Anthropic Claude Sonnet 4', 'Anthropic Claude Sonnet 3.7',
            'Anthropic Claude Haiku 4.5', 'Anthropic Claude Haiku 3.5', 'Anthropic Claude Opus 3', 'Anthropic Claude Haiku 3',
            'Cohere Command Large', 'Cohere Command Light',
            'Meta Llama 3', 'Meta Llama 2',
            'Mistral Large', 'Mistral Medium', 'Mistral Small',
            'NVIDIA Nemotron-3 8B', 'NVIDIA Nemotron-2 8B'
        ],
        'cohere': [
            'Command A', 'Command R+', 'Command R', 'Command R7B',
            'Command (Legacy)', 'Rerank 3.5', 'Embed 4'
        ],
        'xai': [
            'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning',
            'grok-code-fast-1', 'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning',
            'grok-4-0709', 'grok-3-mini', 'grok-3',
            'grok-2-vision-1212', 'grok-2-image-1212'
        ]
    };

    /**
     * Normalize model name for DB comparison (lowercase, trim, collapse spaces).
     */
    private static normalizeModelNameForComparison(name: string): string {
        return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/\s*[-–—]\s*/g, '-');
    }

    /**
     * Get set of normalized model identifiers (modelId + modelName) already in DB for a provider.
     */
    private static async getExistingModelIdentifiers(provider: string): Promise<Set<string>> {
        const docs = await AIModelPricing.find(
            { provider, isActive: true },
            { modelId: 1, modelName: 1 }
        ).lean();
        const set = new Set<string>();
        for (const doc of docs) {
            set.add(this.normalizeModelNameForComparison(doc.modelId));
            set.add(this.normalizeModelNameForComparison(doc.modelName));
        }
        return set;
    }

    /**
     * Main discovery method - discovers models for a single provider.
     * Only runs Google Search + LLM for models not already in the DB.
     */
    static async discoverModelsForProvider(provider: string): Promise<ModelDiscoveryResult> {
        const startTime = Date.now();
        const config = this.PROVIDER_CONFIGS[provider];
        
        if (!config) {
            throw new Error(`Unknown provider: ${provider}`);
        }

        loggingService.info(`Starting model discovery for ${provider}`, { provider });

        const result: ModelDiscoveryResult = {
            provider,
            modelsDiscovered: 0,
            modelsValidated: 0,
            modelsFailed: 0,
            errors: [],
            discoveryDate: new Date(),
            duration: 0
        };

        try {
            // Phase 1: Discover model names (Google Search + LLM)
            const modelNames = await this.searchModelList(config);
            
            if (modelNames.length === 0) {
                result.errors.push('No models found in search results');
                loggingService.warn(`No models discovered for ${provider}`);
                result.duration = Date.now() - startTime;
                return result;
            }

            result.modelsDiscovered = modelNames.length;
            loggingService.info(`Discovered ${modelNames.length} models for ${provider}`, {
                provider,
                models: modelNames
            });

            // Filter to only models not already in DB
            const existingSet = await this.getExistingModelIdentifiers(provider);
            const newModels = modelNames.filter(
                name => !existingSet.has(this.normalizeModelNameForComparison(name))
            );
            const modelsSkipped = modelNames.length - newModels.length;
            result.modelsSkipped = modelsSkipped;

            if (modelsSkipped > 0) {
                loggingService.info(`Skipping ${modelsSkipped} models already in DB for ${provider}`, {
                    provider,
                    modelsSkipped,
                    newModelsCount: newModels.length
                });
            }

            if (newModels.length === 0) {
                result.duration = Date.now() - startTime;
                loggingService.info(`All ${modelNames.length} models already in DB for ${provider}, no pricing search needed`, {
                    provider,
                    duration: result.duration
                });
                return result;
            }

            // Phase 2: Get pricing only for new models (Google Search + LLM per model)
            const pricingResults = await Promise.allSettled(
                newModels.map(modelName => this.searchModelPricing(config, modelName))
            );

            // Phase 3: Validate and store
            for (let i = 0; i < pricingResults.length; i++) {
                const pricingResult = pricingResults[i];
                const modelName = newModels[i];

                if (pricingResult.status === 'fulfilled' && pricingResult.value) {
                    const validationResult = this.validateAndNormalize(pricingResult.value, provider);
                    
                    if (validationResult.isValid && validationResult.normalizedData) {
                        try {
                            await this.storeModelPricing(
                                validationResult.normalizedData,
                                provider,
                                'google_search'
                            );
                            result.modelsValidated++;
                        } catch (storeError) {
                            result.modelsFailed++;
                            const errorMsg = storeError instanceof Error ? storeError.message : String(storeError);
                            result.errors.push(`Failed to store ${modelName}: ${errorMsg}`);
                        }
                    } else {
                        result.modelsFailed++;
                        result.errors.push(`Validation failed for ${modelName}: ${validationResult.errors.join(', ')}`);
                    }
                } else {
                    result.modelsFailed++;
                    const errorMsg = pricingResult.status === 'rejected' 
                        ? pricingResult.reason?.message ?? 'Unknown error'
                        : 'No pricing data returned';
                    result.errors.push(`Failed to get pricing for ${modelName}: ${errorMsg}`);
                }
            }

            result.duration = Date.now() - startTime;
            loggingService.info(`Model discovery completed for ${provider}`, {
                provider,
                discovered: result.modelsDiscovered,
                skipped: result.modelsSkipped,
                validated: result.modelsValidated,
                failed: result.modelsFailed,
                duration: result.duration
            });

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.errors.push(`Discovery failed: ${errorMessage}`);
            result.duration = Date.now() - startTime;
            loggingService.error(`Model discovery failed for ${provider}`, {
                provider,
                error: errorMessage
            });
            return result;
        }
    }

    /**
     * Phase 1: Search for list of models
     */
    private static async searchModelList(config: ProviderDiscoveryConfig): Promise<string[]> {
        try {
            // Search using Google Custom Search API
            const searchResults = await this.googleSearch.search(config.discoveryQuery, {
                maxResults: 10
            });

            if (searchResults.length === 0) {
                loggingService.warn(`No search results for ${config.provider} model list, using fallback`);
                return this.FALLBACK_MODELS[config.provider] || [];
            }

            // Combine all search result snippets
            const combinedText = searchResults
                .map(result => `${result.title}\n${result.snippet}`)
                .join('\n\n');

            // Build provider-specific extraction prompt
            const providerSpecificInstructions = config.provider === 'aws-bedrock' 
                ? `\n**SPECIAL INSTRUCTIONS FOR AWS BEDROCK:**
- AWS Bedrock is a MARKETPLACE hosting models from multiple providers
- Extract ALL available models with their provider prefix
- ✅ INCLUDE: "AI21 Jamba 1.5 Large", "Amazon Titan Text Express", "Anthropic Claude Opus", "Cohere Command", "Meta Llama", "Mistral Large"
- Format: "[Provider] [Model Name]" (e.g., "Amazon Nova Pro", "AI21 Jamba 1.5 Large")
- Include models from: AI21 Labs, Amazon, Anthropic, Cohere, DeepSeek, Google, Meta, Mistral, NVIDIA, etc.`
                : '';

            const extractionPrompt = `You are an AI model extraction expert analyzing ${config.provider} search results from 2026.

CRITICAL INSTRUCTIONS:
1. Extract ONLY **API MODEL NAMES** (like GPT-4, Claude 3.5, Gemini Pro), NOT subscription plans
2. IGNORE subscription plan names like "Free", "Pro", "Max", "Team", "Enterprise", "Plus"
3. Extract ALL versions/variants of models (e.g., Claude Opus 4.5, 4.1, 4, Sonnet 4.5, 4, 3.7, Haiku 4.5, 3.5, 3)
4. INCLUDE both current AND deprecated models if they have pricing information
5. Return ONLY a valid JSON array of strings (no markdown, no explanations)
${providerSpecificInstructions}

IMPORTANT FILTERING RULES:
- ❌ SKIP: "Free", "Pro", "Max", "Team", "Enterprise", "Plus" (these are subscription tiers, NOT models)
- ✅ INCLUDE: "GPT-5.2", "Claude 4.5 Opus", "Claude 3.5 Sonnet", "Gemini 1.5 Pro" (these are actual AI models)
- ✅ INCLUDE: Different versions like "Claude Opus 4.5", "Claude Opus 4.1", "Claude Opus 4"
- ✅ INCLUDE: Deprecated models if they still have pricing (e.g., "Claude Sonnet 3.7", "Claude Opus 3")
- ❌ SKIP: Generic terms like "API", "models", "pricing", "documentation"

Provider: ${config.provider}
Current Year: 2026

Search results to analyze:
${combinedText}

Extract ONLY the CURRENT, AVAILABLE **API MODELS** (including all versions) as a JSON array:
Return ONLY the JSON array:`;

            // Use Bedrock Nova Pro to extract model names
            const llmResponse = await BedrockService.invokeModel(
                extractionPrompt,
                process.env.MODEL_DISCOVERY_LLM_MODEL || 'us.amazon.nova-pro-v1:0'
            );

            // Clean up response - remove markdown code blocks
            let cleanedResponse = llmResponse.trim();
            if (cleanedResponse.startsWith('```json')) {
                cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanedResponse.startsWith('```')) {
                cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            const extractedModels = JSON.parse(cleanedResponse);

            if (!Array.isArray(extractedModels) || extractedModels.length === 0) {
                loggingService.warn(`LLM returned empty array for ${config.provider}, using fallback`);
                return this.FALLBACK_MODELS[config.provider] || [];
            }

            // Filter out generic/invalid terms
            const validModels = extractedModels.filter((model: string) => {
                const lower = model.toLowerCase();
                const invalid = ['model', 'api', 'pricing', 'documentation', 'latest', 'new', 'version', 'free', 'pro', 'max', 'team', 'enterprise', 'plus'];
                return !invalid.some(term => lower === term);
            });

            // FALLBACK: If we got too few models, use the hardcoded complete list
            const minModelThreshold: Record<string, number> = {
                'anthropic': 8,
                'google-ai': 10,
                'aws-bedrock': 15,
                'cohere': 5,
                'xai': 5
            };

            const minModels = minModelThreshold[config.provider] || 3;
            if (validModels.length < minModels && this.FALLBACK_MODELS[config.provider]) {
                loggingService.warn(`Only found ${validModels.length} models for ${config.provider}, using complete fallback list`);
                return this.FALLBACK_MODELS[config.provider];
            }

            // For xAI, always use fallback because LLM tends to extract generic names
            if (config.provider === 'xai' && this.FALLBACK_MODELS[config.provider]) {
                loggingService.info(`Using complete xAI model list from official docs`);
                return this.FALLBACK_MODELS[config.provider];
            }

            return validModels;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Failed to search model list for ${config.provider}`, {
                error: errorMessage
            });
            
            // FALLBACK: Return hardcoded list if available
            if (this.FALLBACK_MODELS[config.provider]) {
                loggingService.info(`Using fallback model list for ${config.provider}`);
                return this.FALLBACK_MODELS[config.provider];
            }
            
            return [];
        }
    }

      

    /**
     * Phase 2: Search for specific model pricing
     */
    private static async searchModelPricing(
        config: ProviderDiscoveryConfig,
        modelName: string
    ): Promise<RawPricingData | null> {
        try {
            const query = config.pricingQueryTemplate.replace('{modelName}', modelName);
            
            // Search for model pricing
            const searchResults = await this.googleSearch.search(query, {
                maxResults: 5
            });

            if (searchResults.length === 0) {
                loggingService.warn(`No pricing results for ${config.provider} ${modelName}`);
                return null;
            }

            // Combine search results
            const combinedText = searchResults
                .map(result => `${result.title}\n${result.snippet}`)
                .join('\n\n');

            // Extract pricing using Bedrock Nova Pro
            const extractionResult = await BedrockService.extractPricingFromText(
                config.provider,
                modelName,
                combinedText
            );

            if (!extractionResult.success || !extractionResult.data) {
                loggingService.error(`Failed to extract pricing for ${config.provider} ${modelName}`, {
                    error: extractionResult.error
                });
                return null;
            }

            return extractionResult.data as RawPricingData;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Error searching pricing for ${config.provider} ${modelName}`, {
                error: errorMessage
            });
            return null;
        }
    }

    /**
     * Validate and normalize pricing data
     */
    private static validateAndNormalize(
        data: RawPricingData,
        provider: string
    ): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate required fields
        if (!data.modelId) errors.push('Missing modelId');
        if (!data.modelName) errors.push('Missing modelName');
        if (typeof data.inputPricePerMToken !== 'number') errors.push('Invalid input price');
        if (typeof data.outputPricePerMToken !== 'number') errors.push('Invalid output price');
        if (typeof data.contextWindow !== 'number') errors.push('Invalid context window');

        // Validate price ranges (should be between 0 and 1000 dollars per million tokens)
        if (data.inputPricePerMToken < 0 || data.inputPricePerMToken > 1000) {
            errors.push(`Input price out of range for ${provider}: ${data.inputPricePerMToken}`);
        }
        if (data.outputPricePerMToken < 0 || data.outputPricePerMToken > 1000) {
            errors.push(`Output price out of range for ${provider}: ${data.outputPricePerMToken}`);
        }

        // Validate context window (should be between 1K and 10M tokens)
        if (data.contextWindow < 1000 || data.contextWindow > 10000000) {
            warnings.push(`Context window seems unusual for ${provider}: ${data.contextWindow}`);
        }

        // Validate category
        const validCategories = ['text', 'multimodal', 'embedding', 'code'];
        if (!validCategories.includes(data.category)) {
            errors.push(`Invalid category for ${provider}: ${data.category}`);
        }

        if (errors.length > 0) {
            return {
                isValid: false,
                errors,
                warnings
            };
        }

        // Normalize the data
        const normalizedData: RawPricingData = {
            ...data,
            modelId: data.modelId.trim(),
            modelName: data.modelName.trim(),
            inputPricePerMToken: Number(data.inputPricePerMToken.toFixed(4)),
            outputPricePerMToken: Number(data.outputPricePerMToken.toFixed(4)),
            contextWindow: Math.round(data.contextWindow),
            capabilities: data.capabilities.map(c => c.toLowerCase().trim()),
            category: data.category.toLowerCase() as 'text' | 'multimodal' | 'embedding' | 'code'
        };

        return {
            isValid: true,
            errors: [],
            warnings,
            normalizedData
        };
    }

    /**
     * Store model pricing in MongoDB
     */
    private static async storeModelPricing(
        data: RawPricingData,
        provider: string,
        discoverySource: 'google_search' | 'manual' | 'fallback_scraping'
    ): Promise<IAIModelPricing> {
        const now = new Date();

        // Check if model already exists
        const existing = await AIModelPricing.findOne({ modelId: data.modelId });

        if (existing) {
            // Update existing model
            existing.modelName = data.modelName;
            existing.provider = provider as any;
            existing.inputPricePerMToken = data.inputPricePerMToken;
            existing.outputPricePerMToken = data.outputPricePerMToken;
            existing.cachedInputPricePerMToken = data.cachedInputPricePerMToken;
            existing.contextWindow = data.contextWindow;
            existing.capabilities = data.capabilities;
            existing.category = data.category;
            existing.isLatest = data.isLatest;
            existing.discoverySource = discoverySource;
            existing.lastValidated = now;
            existing.lastUpdated = now;
            existing.validationStatus = 'verified';

            await existing.save();
            loggingService.info(`Updated existing model: ${data.modelId}`);
            return existing;
        } else {
            // Create new model
            const newModel = new AIModelPricing({
                modelId: data.modelId,
                modelName: data.modelName,
                provider,
                inputPricePerMToken: data.inputPricePerMToken,
                outputPricePerMToken: data.outputPricePerMToken,
                cachedInputPricePerMToken: data.cachedInputPricePerMToken,
                contextWindow: data.contextWindow,
                capabilities: data.capabilities,
                category: data.category,
                isLatest: data.isLatest,
                isActive: true,
                discoverySource,
                discoveryDate: now,
                lastValidated: now,
                lastUpdated: now,
                isDeprecated: false,
                validationStatus: 'verified'
            });

            await newModel.save();
            loggingService.info(`Created new model: ${data.modelId}`);
            return newModel;
        }
    }

    /**
     * Get discovery status for all providers
     */
    static async getDiscoveryStatus() {
        const providers = Object.keys(this.PROVIDER_CONFIGS);
        const providerStats: Record<string, any> = {};

        for (const provider of providers) {
            const stats = await AIModelPricing.aggregate([
                { $match: { provider } },
                {
                    $group: {
                        _id: '$validationStatus',
                        count: { $sum: 1 }
                    }
                }
            ]);

            const latest = await AIModelPricing.findOne({ provider })
                .sort({ lastUpdated: -1 })
                .select('lastUpdated');

            providerStats[provider] = {
                total: stats.reduce((sum, s) => sum + s.count, 0),
                verified: stats.find(s => s._id === 'verified')?.count || 0,
                pending: stats.find(s => s._id === 'pending')?.count || 0,
                failed: stats.find(s => s._id === 'failed')?.count || 0,
                lastUpdated: latest?.lastUpdated || null
            };
        }

        const totalModels = await AIModelPricing.countDocuments({ isActive: true });

        return {
            isRunning: false, // Will be updated by cron job
            totalModels,
            providerStats
        };
    }
}
