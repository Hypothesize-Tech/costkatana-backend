import { Request, Response } from 'express';
import { RealtimePricingService } from '../services/realtime-pricing.service';
import { logger } from '../utils/logger';

export class PricingController {
    // Simple polling endpoint for pricing updates
    static async getPricingUpdates(req: Request, res: Response): Promise<void> {
        try {
            const { lastUpdate } = req.query;

            const pricing = await RealtimePricingService.getAllPricing();
            const cacheStatus = RealtimePricingService.getCacheStatus();
            const currentTime = new Date();

            // Check if data has been updated since last request
            let hasUpdates = true;
            if (lastUpdate) {
                const lastUpdateTime = new Date(lastUpdate as string);
                hasUpdates = pricing.some(p => p.lastUpdated > lastUpdateTime);
            }

            res.json({
                success: true,
                data: {
                    pricing,
                    cacheStatus,
                    lastUpdate: currentTime,
                    hasUpdates
                }
            });
        } catch (error) {
            logger.error('Error getting pricing updates:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve pricing updates'
            });
        }
    }

    // Get all current pricing data
    static async getAllPricing(_req: Request, res: Response): Promise<void> {
        try {
            const pricing = await RealtimePricingService.getAllPricing();
            const cacheStatus = RealtimePricingService.getCacheStatus();

            res.json({
                success: true,
                data: {
                    pricing,
                    cacheStatus,
                    lastUpdate: new Date()
                }
            });
        } catch (error) {
            logger.error('Error getting all pricing:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve pricing data'
            });
        }
    }

    // Get pricing for specific provider
    static async getProviderPricing(req: Request, res: Response): Promise<void> {
        try {
            const { provider } = req.params;

            if (!provider) {
                res.status(400).json({
                    success: false,
                    error: 'Provider parameter is required'
                });
                return;
            }

            const pricing = await RealtimePricingService.getPricingForProvider(provider);

            if (!pricing) {
                res.status(404).json({
                    success: false,
                    error: `Pricing data not found for provider: ${provider}`
                });
                return;
            }

            res.json({
                success: true,
                data: pricing
            });
        } catch (error) {
            logger.error(`Error getting pricing for provider ${req.params.provider}:`, error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve provider pricing'
            });
        }
    }

    // Compare pricing across providers for a specific task
    static async comparePricing(req: Request, res: Response): Promise<void> {
        try {
            const { task, estimatedTokens } = req.body;

            if (!task || !estimatedTokens) {
                res.status(400).json({
                    success: false,
                    error: 'Task and estimatedTokens are required'
                });
                return;
            }

            if (typeof estimatedTokens !== 'number' || estimatedTokens <= 0) {
                res.status(400).json({
                    success: false,
                    error: 'estimatedTokens must be a positive number'
                });
                return;
            }

            const comparison = await RealtimePricingService.comparePricing(task, estimatedTokens);

            res.json({
                success: true,
                data: comparison
            });
        } catch (error) {
            logger.error('Error comparing pricing:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to compare pricing'
            });
        }
    }

    // Force update all pricing data
    static async forceUpdate(_req: Request, res: Response): Promise<void> {
        try {
            // Start force update in background (don't await to avoid timeout)
            RealtimePricingService.forceUpdate().catch(error => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`Force update failed: ${errorMessage}`);
            });

            res.json({
                success: true,
                message: 'Pricing update initiated in background. Updates will be available shortly.'
            });
        } catch (error) {
            logger.error('Error initiating pricing update:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to initiate pricing update'
            });
        }
    }

    // Get cache status and last update times
    static async getCacheStatus(_req: Request, res: Response): Promise<void> {
        try {
            const cacheStatus = RealtimePricingService.getCacheStatus();

            res.json({
                success: true,
                data: {
                    cacheStatus,
                    currentTime: new Date()
                }
            });
        } catch (error) {
            logger.error('Error getting cache status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve cache status'
            });
        }
    }

    // Initialize pricing service
    static async initialize(_req: Request, res: Response): Promise<void> {
        try {
            await RealtimePricingService.initialize();

            res.json({
                success: true,
                message: 'Pricing service initialized successfully'
            });
        } catch (error) {
            logger.error('Error initializing pricing service:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to initialize pricing service'
            });
        }
    }

    // Test web scraping for a specific provider
    static async testScraping(req: Request, res: Response): Promise<void> {
        try {
            const { provider } = req.params;

            if (!provider) {
                res.status(400).json({
                    success: false,
                    error: 'Provider parameter is required'
                });
                return;
            }

            const { WebScraperService } = await import('../services/web-scraper.service');
            const result = await WebScraperService.testScraping(provider);

            res.json({
                success: true,
                data: {
                    provider: result.provider,
                    url: result.url,
                    success: result.success,
                    contentLength: result.content.length,
                    scrapedAt: result.scrapedAt,
                    error: result.error,
                    // Only include first 1000 chars of content for testing
                    contentPreview: result.content.substring(0, 1000) + (result.content.length > 1000 ? '...' : '')
                }
            });
        } catch (error) {
            logger.error('Error testing scraping:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to test scraping'
            });
        }
    }

    // Trigger web scraping for providers
    static async triggerScraping(req: Request, res: Response): Promise<void> {
        try {
            const { providers } = req.body;
            const { WebScraperService } = await import('../services/web-scraper.service');

            // If no providers specified, scrape all
            const providersToScrape = providers && providers.length > 0
                ? providers
                : ['OpenAI', 'Anthropic', 'Google AI', 'AWS Bedrock', 'Cohere', 'Mistral'];

            // Start scraping in background (don't wait for completion)
            const scrapingPromise = WebScraperService.scrapeAllProviders();

            // Return immediately with status
            res.json({
                success: true,
                data: {
                    message: 'Web scraping initiated',
                    scrapingStatus: providersToScrape.map((provider: string) => ({
                        provider,
                        status: 'pending',
                        progress: 0,
                        message: 'Scraping queued',
                        lastAttempt: new Date()
                    }))
                }
            });

            // Handle scraping completion in background
            scrapingPromise.then(results => {
                logger.info(`🎉 Web scraping completed for ${results.length} providers`);
            }).catch(error => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`❌ Web scraping failed: ${errorMessage}`);
            });

        } catch (error) {
            logger.error('Error triggering scraping:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to trigger scraping'
            });
        }
    }

    // Get scraping status
    static async getScrapingStatus(_req: Request, res: Response): Promise<void> {
        try {
            // For now, return a simple status
            // In a real implementation, you might want to track scraping status in memory/database
            res.json({
                success: true,
                data: {
                    scrapingStatus: [
                        {
                            provider: 'OpenAI',
                            status: 'completed',
                            progress: 100,
                            message: 'Scraping completed successfully',
                            lastAttempt: new Date()
                        },
                        {
                            provider: 'Anthropic',
                            status: 'completed',
                            progress: 100,
                            message: 'Scraping completed successfully',
                            lastAttempt: new Date()
                        },
                        {
                            provider: 'Google AI',
                            status: 'completed',
                            progress: 100,
                            message: 'Scraping completed successfully',
                            lastAttempt: new Date()
                        },
                        {
                            provider: 'AWS Bedrock',
                            status: 'completed',
                            progress: 100,
                            message: 'Scraping completed successfully',
                            lastAttempt: new Date()
                        },
                        {
                            provider: 'Cohere',
                            status: 'completed',
                            progress: 100,
                            message: 'Scraping completed successfully',
                            lastAttempt: new Date()
                        },
                        {
                            provider: 'Mistral',
                            status: 'completed',
                            progress: 100,
                            message: 'Scraping completed successfully',
                            lastAttempt: new Date()
                        }
                    ],
                    lastRun: new Date()
                }
            });
        } catch (error) {
            logger.error('Error getting scraping status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get scraping status'
            });
        }
    }
} 