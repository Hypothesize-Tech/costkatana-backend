import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AIModelPricing,
  AIModelPricingDocument,
} from '../../../schemas/ai/ai-model-pricing.schema';
import { WebScraperService } from '../../../modules/pricing/services/web-scraper.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import { BusinessEventLoggingService } from '../../../common/services/business-event-logging.service';
import { RawPricingData } from '../types/model-discovery.types';

@Injectable()
export class ModelDiscoveryFallbackService {
  private readonly logger = new Logger(ModelDiscoveryFallbackService.name);

  constructor(
    @InjectModel(AIModelPricing.name)
    private readonly aiModelPricingModel: Model<AIModelPricingDocument>,
    private readonly webScraperService: WebScraperService,
    private readonly businessEventLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Attempt to discover models using direct web scraping
   */
  async fallbackToScraping(provider: string): Promise<RawPricingData[]> {
    this.logger.log(`Attempting fallback scraping for ${provider}`);

    try {
      // Use existing web scraper service
      const scrapedData =
        await this.webScraperService.scrapeProviderPricing(provider);

      if (!scrapedData.success || !scrapedData.content) {
        this.logger.warn(
          `Fallback scraping failed for ${provider}: ${scrapedData.error}`,
        );
        return [];
      }

      // Extract pricing using Bedrock
      const pricingResults: RawPricingData[] = [];

      // Try to extract multiple models from the scraped content
      const modelExtractionResult = await BedrockService.extractModelsFromText(
        provider,
        scrapedData.content,
      );

      if (
        !modelExtractionResult.success ||
        !Array.isArray(modelExtractionResult.data)
      ) {
        this.logger.error(
          `Failed to extract models from scraped content for ${provider}`,
        );
        return [];
      }

      const modelNames = modelExtractionResult.data;
      this.logger.log(
        `Extracted ${modelNames.length} models from scraped content for ${provider}`,
      );

      // Extract pricing for each model
      for (const modelName of modelNames.slice(0, 10)) {
        // Limit to 10 models to avoid overwhelming
        try {
          const pricingResult = await BedrockService.extractPricingFromText(
            provider,
            modelName,
            scrapedData.content ?? '',
          );

          // extractPricingFromText returns single RawPricingData when successful
          if (
            pricingResult.success &&
            pricingResult.data &&
            !Array.isArray(pricingResult.data)
          ) {
            const data = pricingResult.data as RawPricingData;
            if (
              data.modelName?.toLowerCase().includes(modelName.toLowerCase()) ||
              data.modelId?.toLowerCase().includes(modelName.toLowerCase())
            ) {
              pricingResults.push(data);
            }
          }
        } catch (error) {
          this.logger.error(`Error extracting pricing for ${modelName}`, {
            provider,
            modelName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.log(
        `Fallback scraping extracted ${pricingResults.length} models for ${provider}`,
      );
      return pricingResults;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Fallback scraping error for ${provider}`, {
        error: errorMessage,
      });
      return [];
    }
  }

  /**
   * Keep existing data when all discovery methods fail
   */
  async keepExistingData(provider: string): Promise<void> {
    this.logger.warn(
      `All discovery methods failed for ${provider}, keeping existing data`,
    );

    const existingModels = await this.aiModelPricingModel.find({
      provider,
      isActive: true,
    });

    if (existingModels.length === 0) {
      this.logger.error(`No existing data found for ${provider}`, {
        provider,
        action: 'manual_intervention_required',
      });
    } else {
      this.logger.log(
        `Keeping ${existingModels.length} existing models for ${provider}`,
        {
          provider,
          modelsCount: existingModels.length,
        },
      );
    }
  }

  /**
   * Log failure for admin review
   */
  async logDiscoveryFailure(
    provider: string,
    error: string,
    context?: Record<string, any>,
  ): Promise<void> {
    this.logger.error(`Model discovery failure for ${provider}`, {
      provider,
      error,
      context,
      timestamp: new Date(),
      severity: 'high',
      actionRequired: 'admin_review',
    });

    this.businessEventLogging.logBusiness({
      event: 'model_discovery_failure',
      category: 'model_discovery',
      value: 0,
      metadata: {
        provider,
        error,
        context,
        timestamp: new Date().toISOString(),
        severity: 'high',
        actionRequired: 'admin_review',
      },
    });

    // Store failure metadata in the database
    try {
      // Update all models for this provider with a note about the failed update
      await this.aiModelPricingModel.updateMany(
        { provider },
        {
          $set: {
            lastValidated: new Date(),
          },
          $push: {
            validationErrors: {
              $each: [`Discovery failed: ${error}`],
              $slice: -5, // Keep only last 5 errors
            },
          },
        },
      );
    } catch (dbError) {
      this.logger.error(`Failed to store discovery failure metadata`, {
        provider,
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }
  }

  /**
   * Complete fallback workflow
   */
  async executeFullFallback(
    provider: string,
    originalError: string,
  ): Promise<boolean> {
    this.logger.log(`Executing full fallback workflow for ${provider}`);

    // Step 1: Try direct web scraping
    const scrapedModels = await this.fallbackToScraping(provider);

    if (scrapedModels.length > 0) {
      this.logger.log(
        `Fallback scraping successful for ${provider}, found ${scrapedModels.length} models`,
      );
      return true;
    }

    // Step 2: Keep existing data
    await this.keepExistingData(provider);

    // Step 3: Log failure for admin
    await this.logDiscoveryFailure(provider, originalError, {
      scrapingAttempted: true,
      scrapingSucceeded: false,
      existingDataKept: true,
    });

    return false;
  }
}
