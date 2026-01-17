import { WebScraperService } from './web-scraper.service';
import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';
import { RawPricingData } from '../types/modelDiscovery.types';
import { AIModelPricing } from '../models/AIModelPricing';

/**
 * Model Discovery Fallback Service
 * Handles fallback strategies when Google Search fails
 */
export class ModelDiscoveryFallbackService {
    /**
     * Attempt to discover models using direct web scraping
     */
    static async fallbackToScraping(provider: string): Promise<RawPricingData[]> {
        loggingService.info(`Attempting fallback scraping for ${provider}`);

        try {
            // Use existing web scraper service
            const scrapedData = await WebScraperService.scrapeProviderPricing(provider);

            if (!scrapedData.success || !scrapedData.content) {
                loggingService.warn(`Fallback scraping failed for ${provider}: ${scrapedData.error}`);
                return [];
            }

            // Extract pricing using Bedrock Nova Pro
            const pricingResults: RawPricingData[] = [];

            // Try to extract multiple models from the scraped content
            const modelExtractionResult = await BedrockService.extractModelsFromText(
                provider,
                scrapedData.content
            );

            if (!modelExtractionResult.success || !Array.isArray(modelExtractionResult.data)) {
                loggingService.error(`Failed to extract models from scraped content for ${provider}`);
                return [];
            }

            const modelNames = modelExtractionResult.data as string[];
            loggingService.info(`Extracted ${modelNames.length} models from scraped content for ${provider}`);

            // Extract pricing for each model
            for (const modelName of modelNames.slice(0, 10)) { // Limit to 10 models to avoid overwhelming
                try {
                    const pricingResult = await BedrockService.extractPricingFromText(
                        provider,
                        modelName,
                        scrapedData.content
                    );

                    if (pricingResult.success && pricingResult.data) {
                        pricingResults.push(pricingResult.data as RawPricingData);
                    }
                } catch (error) {
                    loggingService.error(`Error extracting pricing for ${modelName}`, {
                        provider,
                        modelName,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            loggingService.info(`Fallback scraping extracted ${pricingResults.length} models for ${provider}`);
            return pricingResults;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error(`Fallback scraping error for ${provider}`, {
                error: errorMessage
            });
            return [];
        }
    }

    /**
     * Keep existing data when all discovery methods fail
     */
    static async keepExistingData(provider: string): Promise<void> {
        loggingService.warn(`All discovery methods failed for ${provider}, keeping existing data`);

        const existingModels = await AIModelPricing.find({
            provider,
            isActive: true
        });

        if (existingModels.length === 0) {
            loggingService.error(`No existing data found for ${provider}`, {
                provider,
                action: 'manual_intervention_required'
            });
        } else {
            loggingService.info(`Keeping ${existingModels.length} existing models for ${provider}`, {
                provider,
                modelsCount: existingModels.length
            });
        }
    }

    /**
     * Log failure for admin review
     */
    static async logDiscoveryFailure(
        provider: string,
        error: string,
        context?: Record<string, any>
    ): Promise<void> {
        loggingService.error(`Model discovery failure for ${provider}`, {
            provider,
            error,
            context,
            timestamp: new Date(),
            severity: 'high',
            actionRequired: 'admin_review'
        });

        // Store failure metadata in the database
        try {
            // Update all models for this provider with a note about the failed update
            await AIModelPricing.updateMany(
                { provider },
                {
                    $set: {
                        lastValidated: new Date()
                    },
                    $push: {
                        validationErrors: {
                            $each: [`Discovery failed: ${error}`],
                            $slice: -5 // Keep only last 5 errors
                        }
                    }
                }
            );
        } catch (dbError) {
            loggingService.error(`Failed to store discovery failure metadata`, {
                provider,
                error: dbError instanceof Error ? dbError.message : String(dbError)
            });
        }
    }

    /**
     * Complete fallback workflow
     */
    static async executeFullFallback(provider: string, originalError: string): Promise<boolean> {
        loggingService.info(`Executing full fallback workflow for ${provider}`);

        // Step 1: Try direct web scraping
        const scrapedModels = await this.fallbackToScraping(provider);

        if (scrapedModels.length > 0) {
            loggingService.info(`Fallback scraping successful for ${provider}, found ${scrapedModels.length} models`);
            return true;
        }

        // Step 2: Keep existing data
        await this.keepExistingData(provider);

        // Step 3: Log failure for admin
        await this.logDiscoveryFailure(provider, originalError, {
            scrapingAttempted: true,
            scrapingSucceeded: false,
            existingDataKept: true
        });

        return false;
    }
}
