import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelPricing } from '../../../schemas/pricing/model-pricing.schema';
import { RedisService } from '../../../common/services/redis.service';

/**
 * Pricing Sync Service
 *
 * Background service to sync AI model pricing from provider APIs.
 * Updates pricing cache in Redis with latest provider pricing data.
 * Runs as a scheduled background job.
 */

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
    inputPrice: number; // Per 1M tokens
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

@Injectable()
export class PricingSyncService {
  private readonly logger = new Logger(PricingSyncService.name);
  private syncInterval?: NodeJS.Timeout;

  // Configuration
  private readonly SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly PRICING_CACHE_PREFIX = 'pricing:cache:';
  private readonly SYNC_STATUS_KEY = 'pricing:sync:status';

  constructor(
    @InjectModel(ModelPricing.name)
    private modelPricingModel: Model<ModelPricing>,
    private redisService: RedisService,
  ) {
    this.logger.log('🔄 Pricing Sync Service initialized', {
      syncInterval: `${this.SYNC_INTERVAL_MS / (60 * 60 * 1000)} hours`,
    });
  }

  /**
   * Start the pricing sync scheduler
   */
  public startSync(): void {
    if (this.syncInterval) {
      this.logger.warn('Pricing sync already running');
      return;
    }

    // Run initial sync
    void this.syncProviderPricing().catch((error) => {
      this.logger.error('Initial pricing sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Schedule periodic sync
    this.syncInterval = setInterval(() => {
      void this.syncProviderPricing().catch((error) => {
        this.logger.error('Scheduled pricing sync failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.SYNC_INTERVAL_MS);

    this.logger.log('Pricing sync scheduler started', {
      interval: `${this.SYNC_INTERVAL_MS / (60 * 60 * 1000)} hours`,
    });
  }

  /**
   * Stop the pricing sync scheduler
   */
  public stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
      this.logger.log('Pricing sync scheduler stopped');
    }
  }

  /**
   * Manually trigger pricing sync
   */
  public async syncProviderPricing(): Promise<PricingSyncStatus> {
    this.logger.log('🔄 Starting pricing sync');

    const syncStatus: PricingSyncStatus = {
      lastSync: Date.now(),
      nextSync: Date.now() + this.SYNC_INTERVAL_MS,
      providers: [],
    };

    try {
      // Get unique providers from pricing data
      const providers = [
        ...new Set(await this.modelPricingModel.distinct('provider').exec()),
      ];

      // Sync each provider
      for (const provider of providers) {
        try {
          const result = await this.syncProvider(provider);
          syncStatus.providers.push(result);
        } catch (error) {
          this.logger.error(`Failed to sync ${provider}`, {
            error: error instanceof Error ? error.message : String(error),
          });

          syncStatus.providers.push({
            provider,
            status: 'failed',
            lastSync: Date.now(),
            modelCount: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Save sync status
      await this.saveSyncStatus(syncStatus);

      this.logger.log('✅ Pricing sync completed', {
        providersSuccess: syncStatus.providers.filter(
          (p) => p.status === 'success',
        ).length,
        providersFailed: syncStatus.providers.filter(
          (p) => p.status === 'failed',
        ).length,
      });

      return syncStatus;
    } catch (error) {
      this.logger.error('Pricing sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get last sync status
   */
  public async getPricingLastSync(): Promise<PricingSyncStatus | null> {
    try {
      const status = await this.redisService.get(this.SYNC_STATUS_KEY);
      if (!status) {
        return null;
      }
      return status as PricingSyncStatus;
    } catch (error) {
      this.logger.error('Failed to get sync status', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

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
      this.logger.log(`Syncing pricing for ${provider}`);

      // Filter models for this provider
      const providerModels = await this.modelPricingModel
        .find({
          provider: { $regex: new RegExp(`^${provider}$`, 'i') },
        })
        .exec();

      if (providerModels.length === 0) {
        this.logger.warn(`No models found for provider: ${provider}`);
        return {
          provider,
          status: 'success',
          lastSync: Date.now(),
          modelCount: 0,
        };
      }

      // Update cache for each model
      for (const model of providerModels) {
        await this.updatePricingCache(provider, model.modelId, {
          inputPrice: model.inputPricePerMToken,
          outputPrice: model.outputPricePerMToken,
          contextWindow: model.contextWindow || 0,
          lastUpdated: Date.now(),
        });
      }

      this.logger.log(
        `✅ Synced ${providerModels.length} models for ${provider}`,
      );

      return {
        provider,
        status: 'success',
        lastSync: Date.now(),
        modelCount: providerModels.length,
      };
    } catch (error) {
      this.logger.error(`Failed to sync ${provider}`, {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        provider,
        status: 'failed',
        lastSync: Date.now(),
        modelCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
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
    },
  ): Promise<void> {
    try {
      const cacheKey = `${this.PRICING_CACHE_PREFIX}${model}`;

      // Store with 25-hour TTL (slightly longer than sync interval)
      await this.redisService.set(cacheKey, pricing, 25 * 60 * 60);

      this.logger.debug('Pricing cached', {
        provider,
        model,
        inputPrice: pricing.inputPrice,
        outputPrice: pricing.outputPrice,
      });
    } catch (error) {
      this.logger.warn('Failed to cache pricing', {
        error: error instanceof Error ? error.message : String(error),
        provider,
        model,
      });
    }
  }

  /**
   * Save sync status to Redis
   */
  private async saveSyncStatus(status: PricingSyncStatus): Promise<void> {
    try {
      // Store with 48-hour TTL
      await this.redisService.set(this.SYNC_STATUS_KEY, status, 48 * 60 * 60);
    } catch (error) {
      this.logger.warn('Failed to save sync status', {
        error: error instanceof Error ? error.message : String(error),
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
      const cached = await this.redisService.get(cacheKey);

      if (!cached) {
        // Fallback to static data if not in cache
        const staticData = await this.modelPricingModel
          .findOne({ modelId: model })
          .exec();
        if (staticData) {
          return {
            inputPrice: staticData.inputPricePerMToken,
            outputPrice: staticData.outputPricePerMToken,
            contextWindow: staticData.contextWindow || 0,
            lastUpdated: Date.now(),
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
      this.logger.error('Failed to get cached pricing', {
        error: error instanceof Error ? error.message : String(error),
        model,
      });
      return null;
    }
  }
}
