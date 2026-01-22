import { Request, Response } from 'express';
import { RealtimePricingService } from '../services/realtime-pricing.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper } from '@utils/controllerHelper';

/**
 * Pricing Realtime Controller
 * 
 * Handles real-time pricing updates and cache management including:
 * - Polling for pricing updates
 * - Getting all pricing data
 * - Getting provider-specific pricing
 * - Force updating pricing data
 * - Cache status and management
 * 
 * @remarks
 * This controller provides efficient real-time pricing data access
 * with built-in caching and polling support for live updates.
 */
export class PricingRealtimeController {

    /**
     * Get pricing updates (polling endpoint)
     * Supports incremental updates based on lastUpdate timestamp
     */
    static async getPricingUpdates(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
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

            loggingService.info('Pricing updates retrieved successfully', {
                duration: Date.now() - startTime,
                hasUpdates
            });

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
            ControllerHelper.handleError('getPricingUpdates', error, req as any, res, startTime);
        }
    }

    /**
     * Get all pricing data
     * Returns complete pricing information for all providers and models
     */
    static async getAllPricing(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const pricing = await RealtimePricingService.getAllPricing();
            const cacheStatus = RealtimePricingService.getCacheStatus();

            loggingService.info('All pricing retrieved successfully', {
                duration: Date.now() - startTime,
                pricingCount: pricing.length
            });

            res.json({
                success: true,
                data: {
                    pricing,
                    cacheStatus,
                    lastUpdate: new Date()
                }
            });
        } catch (error) {
            ControllerHelper.handleError('getAllPricing', error, _req as any, res, startTime);
        }
    }

    /**
     * Get pricing for specific provider
     * Returns pricing data filtered by provider name
     */
    static async getProviderPricing(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
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

            loggingService.info('Provider pricing retrieved successfully', {
                duration: Date.now() - startTime,
                provider
            });

            res.json({
                success: true,
                data: pricing
            });
        } catch (error) {
            ControllerHelper.handleError('getProviderPricing', error, req as any, res, startTime);
        }
    }

    /**
     * Compare pricing across providers for a specific task
     * Returns cost comparisons for all providers given token estimates
     */
    static async comparePricing(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
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

            loggingService.info('Pricing comparison completed', {
                duration: Date.now() - startTime,
                task,
                estimatedTokens
            });

            res.json({
                success: true,
                data: comparison
            });
        } catch (error) {
            ControllerHelper.handleError('comparePricing', error, req as any, res, startTime);
        }
    }

    /**
     * Force update all pricing data
     * Triggers background update of all pricing information
     */
    static async forceUpdate(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            // Start force update in background (don't await to avoid timeout)
            RealtimePricingService.forceUpdate().catch(error => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.error(`Force update failed: ${errorMessage}`);
            });

            loggingService.info('Pricing force update initiated', {
                duration: Date.now() - startTime
            });

            res.json({
                success: true,
                message: 'Pricing update initiated in background. Updates will be available shortly.'
            });
        } catch (error) {
            ControllerHelper.handleError('forceUpdate', error, _req as any, res, startTime);
        }
    }

    /**
     * Get cache status and last update times
     * Returns cache metadata and status for all providers
     */
    static async getCacheStatus(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const cacheStatus = RealtimePricingService.getCacheStatus();

            loggingService.info('Cache status retrieved successfully', {
                duration: Date.now() - startTime
            });

            res.json({
                success: true,
                data: {
                    cacheStatus,
                    currentTime: new Date()
                }
            });
        } catch (error) {
            ControllerHelper.handleError('getCacheStatus', error, _req as any, res, startTime);
        }
    }

    /**
     * Clear all pricing caches
     * Clears all cached pricing data forcing fresh retrieval
     */
    static async clearCache(_req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            RealtimePricingService.clearCache();

            loggingService.info('Cache cleared successfully', {
                duration: Date.now() - startTime
            });

            res.json({
                success: true,
                message: 'All pricing caches cleared successfully'
            });
        } catch (error) {
            ControllerHelper.handleError('clearCache', error, _req as any, res, startTime);
        }
    }
}
