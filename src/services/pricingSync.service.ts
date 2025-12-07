/**
 * Pricing Sync Service
 * 
 * Background service to sync AI model pricing from provider APIs.
 * Updates pricing cache in Redis with latest provider pricing data.
 * Runs as a scheduled background job.
 */

import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { modelPricingData } from '../data/modelPricing';
import type { ModelPricing } from '../data/modelPricing';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface ModelPricingData {
    provider: string;
    model: string;
    inputPrice: number;
    outputPrice: number;
    contextWindow?: number;
}

export interface ProviderPricing {
    provider: string;
    models: Array<{
        modelId: string;
        modelName: string;
        inputPrice: number;  // Per 1M tokens
        outputPrice: number; // Per 1M tokens
        contextWindow: number;
        lastUpdated: number;
    }>;
    syncedAt: number;
}

export interface PricingSyncStatus {
    lastSync: number;
    nextSync: number;
    providers: Array<{
        provider: string;
        status: 'success' | 'failed' | 'pending';
        lastSync: number;
        modelCount: number;
        error?: string;
    }>;
}

// ============================================================================
// PRICING SYNC SERVICE
// ============================================================================

export class PricingSyncService {
    private static instance: PricingSyncService;
    private syncInterval?: NodeJS.Timeout;
    
    // Configuration
    private readonly SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
    private readonly PRICING_CACHE_PREFIX = 'pricing:cache:';
    private readonly SYNC_STATUS_KEY = 'pricing:sync:status';
    
    private constructor() {
        loggingService.info('🔄 Pricing Sync Service initialized', {
            syncInterval: `${this.SYNC_INTERVAL_MS / (60 * 60 * 1000)} hours`
        });
    }
    
    public static getInstance(): PricingSyncService {
        if (!PricingSyncService.instance) {
            PricingSyncService.instance = new PricingSyncService();
        }
        return PricingSyncService.instance;
    }
    
    /**
     * Start the pricing sync scheduler
     */
    public startSync(): void {
        if (this.syncInterval) {
            loggingService.warn('Pricing sync already running');
            return;
        }
        
        // Run initial sync
        void this.syncProviderPricing().catch(error => {
            loggingService.error('Initial pricing sync failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        });
        
        // Schedule periodic sync
        this.syncInterval = setInterval(() => {
            void this.syncProviderPricing().catch(error => {
                loggingService.error('Scheduled pricing sync failed', {
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }, this.SYNC_INTERVAL_MS);
        
        loggingService.info('Pricing sync scheduler started', {
            interval: `${this.SYNC_INTERVAL_MS / (60 * 60 * 1000)} hours`
        });
    }
    
    /**
     * Stop the pricing sync scheduler
     */
    public stopSync(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = undefined;
            loggingService.info('Pricing sync scheduler stopped');
        }
    }
    
    /**
     * Manually trigger pricing sync
     */
    public async syncProviderPricing(): Promise<PricingSyncStatus> {
        loggingService.info('🔄 Starting pricing sync');
        
        const syncStatus: PricingSyncStatus = {
            lastSync: Date.now(),
            nextSync: Date.now() + this.SYNC_INTERVAL_MS,
            providers: []
        };
        
            // Get unique providers from pricing data
            const providers = [...new Set(modelPricingData.map((m: ModelPricing) => m.provider))];
        
        // Sync each provider
        for (const provider of providers) {
            try {
                const result = await this.syncProvider(provider);
                syncStatus.providers.push(result);
            } catch (error) {
                loggingService.error(`Failed to sync ${provider}`, {
                    error: error instanceof Error ? error.message : String(error)
                });
                
                syncStatus.providers.push({
                    provider,
                    status: 'failed',
                    lastSync: Date.now(),
                    modelCount: 0,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
        
        // Save sync status
        await this.saveSyncStatus(syncStatus);
        
        loggingService.info('✅ Pricing sync completed', {
            providersSuccess: syncStatus.providers.filter(p => p.status === 'success').length,
            providersFailed: syncStatus.providers.filter(p => p.status === 'failed').length
        });
        
        return syncStatus;
    }
    
    /**
     * Get last sync status
     */
    public async getPricingLastSync(): Promise<PricingSyncStatus | null> {
        try {
            const status = await redisService.get(this.SYNC_STATUS_KEY);
            if (!status) {
                return null;
            }
            return status as PricingSyncStatus;
        } catch (error) {
            loggingService.error('Failed to get sync status', {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    
    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================
    
    /**
     * Sync pricing for a specific provider
     */
    private async syncProvider(provider: string): Promise<{
        provider: string;
        status: 'success' | 'failed';
        lastSync: number;
        modelCount: number;
        error?: string;
    }> {
        try {
            loggingService.info(`Syncing pricing for ${provider}`);
            
            // Filter models for this provider
            const providerModels = modelPricingData.filter(
                (m: ModelPricing) => m.provider.toLowerCase() === provider.toLowerCase()
            );
            
            if (providerModels.length === 0) {
                loggingService.warn(`No models found for provider: ${provider}`);
                return {
                    provider,
                    status: 'success',
                    lastSync: Date.now(),
                    modelCount: 0
                };
            }
            
            // Update cache for each model
            for (const model of providerModels) {
                await this.updatePricingCache(provider, model.model, {
                    inputPrice: model.inputPrice,
                    outputPrice: model.outputPrice,
                    contextWindow: model.contextWindow || 0,
                    lastUpdated: Date.now()
                });
            }
            
            loggingService.info(`✅ Synced ${providerModels.length} models for ${provider}`);
            
            return {
                provider,
                status: 'success',
                lastSync: Date.now(),
                modelCount: providerModels.length
            };
            
        } catch (error) {
            loggingService.error(`Failed to sync ${provider}`, {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                provider,
                status: 'failed',
                lastSync: Date.now(),
                modelCount: 0,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    /**
     * Update pricing cache in Redis
     */
    private async updatePricingCache(
        provider: string,
        model: string,
        pricing: {
            inputPrice: number;
            outputPrice: number;
            contextWindow: number;
            lastUpdated: number;
        }
    ): Promise<void> {
        try {
            const cacheKey = `${this.PRICING_CACHE_PREFIX}${model}`;
            
            // Store with 25-hour TTL (slightly longer than sync interval)
            await redisService.set(cacheKey, pricing, 25 * 60 * 60);
            
            loggingService.debug('Pricing cached', {
                provider,
                model,
                inputPrice: pricing.inputPrice,
                outputPrice: pricing.outputPrice
            });
            
        } catch (error) {
            loggingService.warn('Failed to cache pricing', {
                error: error instanceof Error ? error.message : String(error),
                provider,
                model
            });
        }
    }
    
    /**
     * Save sync status to Redis
     */
    private async saveSyncStatus(status: PricingSyncStatus): Promise<void> {
        try {
            // Store with 48-hour TTL
            await redisService.set(this.SYNC_STATUS_KEY, status, 48 * 60 * 60);
        } catch (error) {
            loggingService.warn('Failed to save sync status', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * Get cached pricing for a specific model
     */
    public async getCachedPricing(model: string): Promise<{
        inputPrice: number;
        outputPrice: number;
        contextWindow: number;
        lastUpdated: number;
    } | null> {
        try {
            const cacheKey = `${this.PRICING_CACHE_PREFIX}${model}`;
            const cached = await redisService.get(cacheKey);
            
            if (!cached) {
                // Fallback to static data if not in cache
                const staticData = modelPricingData.find((m: ModelPricing) => m.model === model);
                if (staticData) {
                    return {
                        inputPrice: staticData.inputPrice,
                        outputPrice: staticData.outputPrice,
                        contextWindow: staticData.contextWindow || 0,
                        lastUpdated: Date.now()
                    };
                }
                return null;
            }
            
            return cached as {
                inputPrice: number;
                outputPrice: number;
                contextWindow: number;
                lastUpdated: number;
            };
        } catch (error) {
            loggingService.error('Failed to get cached pricing', {
                error: error instanceof Error ? error.message : String(error),
                model
            });
            return null;
        }
    }
}

// Export singleton instance
export const pricingSyncService = PricingSyncService.getInstance();

// Auto-start sync if not in test environment
if (process.env.NODE_ENV !== 'test') {
    // Start sync after 1 minute delay (to allow server startup)
    setTimeout(() => {
        pricingSyncService.startSync();
    }, 60000);
}
