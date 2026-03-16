import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AIModelPricing,
  AIModelPricingDocument,
} from '../../../schemas/ai/ai-model-pricing.schema';
import { WebScraperService } from './web-scraper.service';
import { BedrockService } from '@/services/bedrock.service';
import { ServiceHelper } from '@/utils/serviceHelper';

export interface ProviderPricing {
  provider: string;
  models: ModelPricing[];
  lastUpdated: Date;
  source: string;
}

export interface ModelPricing {
  modelId: string;
  modelName: string;
  inputPricePerMToken: number | null; // Price per million tokens for input
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

@Injectable()
export class RealtimePricingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimePricingService.name);
  private pricingCache = new Map<string, ProviderPricing>();
  private lastUpdateTime = new Map<string, Date>();
  private updateInterval = 24 * 60 * 60 * 1000; // 24 hours
  private isUpdating = false;

  // Background processing queue
  private backgroundQueue: Array<() => Promise<void>> = [];
  private backgroundProcessor?: NodeJS.Timeout;

  constructor(
    @InjectModel(AIModelPricing.name)
    private aiModelPricingModel: Model<AIModelPricingDocument>,
    private webScraperService: WebScraperService,
    private bedrockService: BedrockService,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing RealtimePricingService');

    // Start periodic updates
    setInterval(() => {
      this.updateAllPricing();
    }, this.updateInterval);

    // Start initial update in background (don't await to avoid blocking)
    this.updateAllPricing().catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Initial pricing update failed: ${errorMessage}`);
    });

    this.logger.log(
      'RealtimePricingService initialized with background updates',
    );
  }

  onModuleDestroy() {
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = undefined;
    }

    // Process remaining queue items
    while (this.backgroundQueue.length > 0) {
      const operation = this.backgroundQueue.shift();
      if (operation) {
        operation().catch((error) => {
          this.logger.error(
            'Cleanup operation failed:',
            error instanceof Error ? error.message : String(error),
          );
        });
      }
    }
  }

  private createModelPayload(prompt: string, modelId: string) {
    const lowerModelId = modelId.toLowerCase();

    // Check model type and create appropriate payload
    if (lowerModelId.includes('nova')) {
      // Nova models format
      return {
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: {
          max_new_tokens: 300,
          temperature: 0.1,
          top_p: 0.9,
        },
      };
    } else if (
      lowerModelId.includes('claude-3') ||
      lowerModelId.includes('claude-v3')
    ) {
      // Claude 3 models format
      return {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 300,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      };
    } else if (lowerModelId.includes('amazon.titan')) {
      // Titan models format
      return {
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: 300,
          temperature: 0.1,
        },
      };
    } else if (lowerModelId.includes('claude')) {
      // Older Claude models format
      return {
        prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
        max_tokens_to_sample: 300,
        temperature: 0.1,
        stop_sequences: ['\n\nHuman:'],
      };
    } else {
      // Default to Nova format for unknown models
      return {
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: {
          max_new_tokens: 300,
          temperature: 0.1,
          top_p: 0.9,
        },
      };
    }
  }

  /**
   * Try multiple strategies to extract a JSON object from model response text.
   * Handles markdown code blocks, extra text, and nested JSON.
   */
  private extractJsonFromText(
    text: string,
    fallbackProvider?: string,
  ): { provider: string; models: any[]; source?: string } | null {
    if (!text || typeof text !== 'string') return null;
    let cleaned = text.trim();
    if (!cleaned) return null;

    // Strip markdown code blocks: ```json ... ``` or ``` ... ```
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }

    // Try parsing the whole string as JSON first (model returned raw JSON)
    try {
      const direct = JSON.parse(cleaned);
      if (
        direct &&
        Array.isArray(direct.models) &&
        (typeof direct.provider === 'string' || fallbackProvider)
      ) {
        return {
          provider: direct.provider ?? fallbackProvider ?? 'unknown',
          models: direct.models,
          source: direct.source,
        };
      }
    } catch {
      // not valid JSON, continue
    }

    // Try to find JSON object (first { to matching closing })
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) return null;
    let depth = 0;
    let end = -1;
    for (let i = firstBrace; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return null;
    const jsonStr = cleaned.slice(firstBrace, end + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (
        parsed &&
        Array.isArray(parsed.models) &&
        (typeof parsed.provider === 'string' || fallbackProvider)
      ) {
        return {
          provider: parsed.provider ?? fallbackProvider ?? 'unknown',
          models: parsed.models,
          source: parsed.source,
        };
      }
    } catch {
      // ignore parse error
    }
    return null;
  }

  private extractResponseText(responseBody: any, modelId: string): string {
    const lowerModelId = modelId.toLowerCase();

    if (lowerModelId.includes('nova')) {
      return (
        responseBody.output?.message?.content?.[0]?.text ||
        responseBody.message?.content?.[0]?.text ||
        ''
      );
    } else if (
      lowerModelId.includes('claude-3') ||
      lowerModelId.includes('claude-v3')
    ) {
      return responseBody.content?.[0]?.text || '';
    } else if (lowerModelId.includes('amazon.titan')) {
      return responseBody.results?.[0]?.outputText || '';
    } else if (lowerModelId.includes('claude')) {
      return responseBody.completion || '';
    } else {
      // Default to Nova format
      return (
        responseBody.output?.message?.content?.[0]?.text ||
        responseBody.message?.content?.[0]?.text ||
        ''
      );
    }
  }

  private async getScrapedPricingData(provider: string): Promise<string> {
    try {
      const scrapedData =
        await this.webScraperService.scrapeProviderPricing(provider);

      if (!scrapedData.success || !scrapedData.content) {
        throw new Error(
          `Failed to scrape pricing data for ${provider}: ${scrapedData.error}`,
        );
      }

      this.logger.log(
        `Successfully scraped ${scrapedData.content.length} characters for ${provider}`,
      );
      return scrapedData.content;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error scraping pricing data for ${provider}: ${errorMessage}`,
      );
      throw error;
    }
  }

  private async extractPricingData(
    provider: string,
    scrapedContent: string,
  ): Promise<ProviderPricing> {
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
      const payload = this.createModelPayload(
        extractPrompt,
        'amazon.nova-lite-v1:0',
      );

      const response = await ServiceHelper.withRetry(
        () =>
          this.bedrockService.invokeModelDirectly(
            'amazon.nova-lite-v1:0',
            payload,
          ),
        {
          maxRetries: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
        },
      );
      const extractedText = this.extractResponseText(
        response,
        'amazon.nova-lite-v1:0',
      );

      if (!extractedText || !extractedText.trim()) {
        throw new Error(
          'Model returned empty or no text; cannot extract pricing JSON',
        );
      }

      // Use robust JSON extraction (handles markdown code blocks and extra text)
      const parsed = this.extractJsonFromText(extractedText, provider);
      if (!parsed) {
        throw new Error('No valid JSON found in response');
      }

      const pricingData: ProviderPricing = {
        provider: parsed.provider,
        models: parsed.models,
        lastUpdated: new Date(),
        source: parsed.source ?? `${provider} Official Pricing Page`,
      };
      return pricingData;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Error extracting pricing data for ${provider}: ${errorMessage}`,
      );
      throw error;
    }
  }

  private async updateProviderPricing(
    provider: string,
  ): Promise<ProviderPricing> {
    try {
      this.logger.log(`Updating pricing for ${provider}`);

      const scrapedContent = await this.getScrapedPricingData(provider);
      const pricingData = await this.extractPricingData(
        provider,
        scrapedContent,
      );

      this.pricingCache.set(provider, pricingData);
      this.lastUpdateTime.set(provider, new Date());

      this.logger.log(`Successfully updated pricing for ${provider}`);
      return pricingData;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Pricing update failed for ${provider} (will use cached/DB data): ${errorMessage}`,
      );
      throw error;
    }
  }

  async updateAllPricing(): Promise<void> {
    if (this.isUpdating) {
      this.logger.log('Pricing update already in progress, skipping');
      return;
    }

    this.isUpdating = true;
    const providers = [
      'OpenAI',
      'Anthropic',
      'Google AI',
      'AWS Bedrock',
      'Cohere',
      'Mistral',
      'Grok',
    ];

    try {
      this.logger.log('Starting pricing update for all providers');

      const updatePromises = providers.map((provider) =>
        this.updateProviderPricing(provider).catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Skipped pricing update for ${provider}: ${errorMessage}`,
          );
          return null;
        }),
      );

      await Promise.all(updatePromises);

      this.logger.log('Completed pricing update for all providers');
    } finally {
      this.isUpdating = false;
    }
  }

  async getPricingForProvider(
    provider: string,
  ): Promise<ProviderPricing | null> {
    try {
      // Query MongoDB for active models
      const models = await this.aiModelPricingModel
        .find({
          provider: this.normalizeProviderName(provider),
          isActive: true,
          isDeprecated: false,
          validationStatus: 'verified',
        })
        .sort({ isLatest: -1, lastUpdated: -1 });

      if (models.length === 0) {
        this.logger.warn(
          `No models found in MongoDB for ${provider}, using fallback`,
        );
        // Fall back to cache if MongoDB has no data
        const cached = this.pricingCache.get(provider);
        if (cached) {
          return cached;
        }
        return null;
      }

      const providerPricing: ProviderPricing = {
        provider,
        models: models.map((m) => ({
          modelId: m.modelId,
          modelName: m.modelName,
          inputPricePerMToken: m.inputPricePerMToken,
          outputPricePerMToken: m.outputPricePerMToken,
          contextWindow: m.contextWindow,
          capabilities: m.capabilities,
          category: m.category,
          isLatest: m.isLatest,
        })),
        source: `MongoDB (${models[0]?.discoverySource})`,
        lastUpdated: models[0]?.lastUpdated || new Date(),
      };

      // Update cache
      this.pricingCache.set(provider, providerPricing);
      this.lastUpdateTime.set(provider, new Date());

      return providerPricing;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error getting pricing from MongoDB for ${provider}: ${errorMessage}`,
      );

      // Fall back to cache
      const cached = this.pricingCache.get(provider);
      return cached || null;
    }
  }

  /**
   * Normalize provider names to match MongoDB schema
   */
  private normalizeProviderName(provider: string): string {
    const mapping: Record<string, string> = {
      OpenAI: 'openai',
      Anthropic: 'anthropic',
      'Google AI': 'google-ai',
      'AWS Bedrock': 'aws-bedrock',
      Cohere: 'cohere',
      Mistral: 'mistral',
      Grok: 'xai',
    };
    return mapping[provider] || provider.toLowerCase();
  }

  async getAllPricing(): Promise<ProviderPricing[]> {
    const providers = [
      'OpenAI',
      'Anthropic',
      'Google AI',
      'AWS Bedrock',
      'Cohere',
      'Mistral',
      'Grok',
    ];
    const results: ProviderPricing[] = [];

    // Fetch from MongoDB for all providers in parallel
    const providerPromises = providers.map((provider) =>
      this.getPricingForProvider(provider).catch((error) => {
        this.logger.error(
          `Error fetching pricing for ${provider}`,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }),
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
      this.logger.warn('No pricing data from MongoDB, using fallback');
      return await this.generateFallbackPricingData();
    }

    return results;
  }

  private async generateFallbackPricingData(): Promise<ProviderPricing[]> {
    // When no cache exists, generate basic fallback data from web scraper fallbacks
    const providers = [
      'OpenAI',
      'Anthropic',
      'Google AI',
      'AWS Bedrock',
      'Cohere',
      'Mistral',
    ];
    const fallbackData: ProviderPricing[] = [];

    for (const provider of providers) {
      try {
        // Use fallback content from web scraper service
        const scrapedData =
          await this.webScraperService.scrapeProviderPricing(provider);

        if (scrapedData.success && scrapedData.content) {
          // Try to extract pricing from fallback content
          const pricingData = await this.extractPricingData(
            provider,
            scrapedData.content,
          );
          fallbackData.push(pricingData);

          // Cache the fallback data
          this.pricingCache.set(provider, pricingData);
          this.lastUpdateTime.set(provider, new Date());
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to generate fallback data for ${provider}: ${errorMessage}`,
        );
      }
    }

    return fallbackData;
  }

  async comparePricing(
    task: string,
    estimatedTokens: number,
  ): Promise<PricingComparison> {
    const allPricing = await this.getAllPricing();
    const inputRatio = 0.6; // Assume 60% input, 40% output tokens
    const outputRatio = 0.4;

    const inputTokens = Math.round(estimatedTokens * inputRatio);
    const outputTokens = Math.round(estimatedTokens * outputRatio);

    const comparison: PricingComparison = {
      task,
      estimatedTokens,
      providers: [],
      lastUpdated: new Date(),
    };

    for (const providerData of allPricing) {
      for (const model of providerData.models) {
        // Skip models with null pricing data
        if (
          model.inputPricePerMToken === null ||
          model.outputPricePerMToken === null ||
          model.inputPricePerMToken === undefined ||
          model.outputPricePerMToken === undefined
        ) {
          continue;
        }

        const inputCost = (inputTokens / 1_000_000) * model.inputPricePerMToken;
        const outputCost =
          (outputTokens / 1_000_000) * model.outputPricePerMToken;
        const totalCost = inputCost + outputCost;

        comparison.providers.push({
          provider: providerData.provider,
          model: model.modelName,
          estimatedCost: totalCost,
          inputCost,
          outputCost,
          pricePerMToken:
            (model.inputPricePerMToken + model.outputPricePerMToken) / 2,
          features: model.capabilities,
        });
      }
    }

    // Sort by estimated cost
    comparison.providers.sort((a, b) => a.estimatedCost - b.estimatedCost);

    return comparison;
  }

  async forceUpdate(): Promise<void> {
    await this.updateAllPricing();
  }

  getLastUpdateTime(provider: string): Date | null {
    return this.lastUpdateTime.get(provider) || null;
  }

  getCacheStatus(): {
    provider: string;
    lastUpdate: Date | null;
    cached: boolean;
  }[] {
    const providers = [
      'OpenAI',
      'Anthropic',
      'Google AI',
      'AWS Bedrock',
      'Cohere',
      'Mistral',
    ];
    return providers.map((provider) => ({
      provider,
      lastUpdate: this.lastUpdateTime.get(provider) || null,
      cached: this.pricingCache.has(provider),
    }));
  }

  /**
   * Clear all pricing caches
   */
  clearCache(): void {
    this.logger.log('Clearing all pricing caches');
    this.pricingCache.clear();
    this.lastUpdateTime.clear();
    this.logger.log('All pricing caches cleared successfully');
  }
}
