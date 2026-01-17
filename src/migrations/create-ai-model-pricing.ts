import { AIModelPricing } from '../models/AIModelPricing';
import { WebScraperService } from '../services/web-scraper.service';
import { BedrockService } from '../services/bedrock.service';
import { loggingService } from '../services/logging.service';

/**
 * Migration: Seed AIModelPricing collection with fallback data
 * 
 * This migration extracts pricing data from the existing fallback data
 * in WebScraperService and populates the MongoDB collection.
 */
export async function seedAIModelPricing(): Promise<void> {
    try {
        loggingService.info('Starting AIModelPricing seed migration');

        // Check if collection already has data
        const existingCount = await AIModelPricing.countDocuments();
        if (existingCount > 0) {
            loggingService.info(`AIModelPricing collection already has ${existingCount} documents, skipping seed`);
            return;
        }

        const providers = ['OpenAI', 'Anthropic', 'Google AI', 'Cohere', 'Mistral', 'Grok'];
        let totalSeeded = 0;

        for (const provider of providers) {
            try {
                loggingService.info(`Seeding models for ${provider}`);

                // Get fallback content from WebScraperService
                const scrapedData = await WebScraperService.scrapeProviderPricing(provider);

                if (!scrapedData.success || !scrapedData.content) {
                    loggingService.warn(`No fallback data for ${provider}`);
                    continue;
                }

                // Extract model names using Bedrock
                const modelExtractionResult = await BedrockService.extractModelsFromText(
                    provider,
                    scrapedData.content
                );

                if (!modelExtractionResult.success || !Array.isArray(modelExtractionResult.data)) {
                    loggingService.error(`Failed to extract models for ${provider}`);
                    continue;
                }

                const modelNames = modelExtractionResult.data as string[];
                loggingService.info(`Extracted ${modelNames.length} models for ${provider}`);

                // Extract pricing for each model
                for (const modelName of modelNames.slice(0, 15)) { // Limit to 15 models per provider
                    try {
                        const pricingResult = await BedrockService.extractPricingFromText(
                            provider,
                            modelName,
                            scrapedData.content
                        );

                        if (pricingResult.success && pricingResult.data) {
                            const pricing = pricingResult.data as any;

                            // Create model document
                            const model = new AIModelPricing({
                                modelId: pricing.modelId,
                                modelName: pricing.modelName,
                                provider: provider.toLowerCase().replace(/\s+/g, '-'),
                                inputPricePerMToken: pricing.inputPricePerMToken,
                                outputPricePerMToken: pricing.outputPricePerMToken,
                                cachedInputPricePerMToken: pricing.cachedInputPricePerMToken,
                                contextWindow: pricing.contextWindow,
                                capabilities: pricing.capabilities || [],
                                category: pricing.category || 'text',
                                isLatest: pricing.isLatest || false,
                                isActive: true,
                                discoverySource: 'manual',
                                discoveryDate: new Date(),
                                lastValidated: new Date(),
                                lastUpdated: new Date(),
                                isDeprecated: false,
                                validationStatus: 'verified'
                            });

                            await model.save();
                            totalSeeded++;
                            loggingService.info(`Seeded model: ${pricing.modelId}`);
                        }
                    } catch (error) {
                        loggingService.error(`Error seeding model ${modelName}`, {
                            provider,
                            modelName,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }

            } catch (error) {
                loggingService.error(`Error seeding provider ${provider}`, {
                    provider,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        loggingService.info(`AIModelPricing seed migration completed`, {
            totalSeeded,
            providers: providers.length
        });

    } catch (error) {
        loggingService.error('AIModelPricing seed migration failed', {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

/**
 * Run this migration
 * Usage: ts-node -r tsconfig-paths/register src/migrations/create-ai-model-pricing.ts
 */
if (require.main === module) {
    (async () => {
        try {
            // Import mongoose connection
            const mongoose = await import('mongoose');
            
            // Connect to MongoDB
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/costkatana';
            await mongoose.default.connect(mongoUri);
            
            loggingService.info('Connected to MongoDB');

            // Run migration
            await seedAIModelPricing();

            // Disconnect
            await mongoose.default.disconnect();
            loggingService.info('Migration completed successfully');
            process.exit(0);
        } catch (error) {
            loggingService.error('Migration failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            process.exit(1);
        }
    })();
}
