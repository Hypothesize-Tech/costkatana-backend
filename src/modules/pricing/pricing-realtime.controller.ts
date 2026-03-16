import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RealtimePricingService } from './services/realtime-pricing.service';
import { ComparePricingDto } from './dto/compare-pricing.dto';

/**
 * Pricing Realtime Controller
 *
 * Handles real-time pricing updates and cache management including:
 * - Polling for pricing updates
 * - Getting all pricing data
 * - Getting provider-specific pricing
 * - Force updating pricing data
 * - Cache status and management
 */
@Controller('api/pricing')
export class PricingRealtimeController {
  private readonly logger = new Logger(PricingRealtimeController.name);

  constructor(
    private readonly realtimePricingService: RealtimePricingService,
  ) {}

  /**
   * Get pricing updates (polling endpoint)
   * Supports incremental updates based on lastUpdate timestamp
   */
  @Get('updates')
  async getPricingUpdates(@Query('lastUpdate') lastUpdate?: string) {
    const startTime = Date.now();
    try {
      const pricing = await this.realtimePricingService.getAllPricing();
      const cacheStatus = this.realtimePricingService.getCacheStatus();
      const currentTime = new Date();

      // Check if data has been updated since last request
      let hasUpdates = true;
      if (lastUpdate) {
        const lastUpdateTime = new Date(lastUpdate);
        hasUpdates = pricing.some((p) => p.lastUpdated > lastUpdateTime);
      }

      this.logger.log('Pricing updates retrieved successfully', {
        duration: Date.now() - startTime,
        hasUpdates,
        pricingCount: pricing.length,
      });

      return {
        success: true,
        data: {
          pricing,
          cacheStatus,
          lastUpdate: currentTime,
          hasUpdates,
        },
      };
    } catch (error) {
      this.logger.error(`Error getting pricing updates: ${error.message}`, {
        lastUpdate,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to get pricing updates',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all pricing data
   * Returns complete pricing information for all providers and models
   */
  @Get('all')
  async getAllPricing() {
    const startTime = Date.now();
    try {
      const pricing = await this.realtimePricingService.getAllPricing();
      const cacheStatus = this.realtimePricingService.getCacheStatus();

      this.logger.log('All pricing retrieved successfully', {
        duration: Date.now() - startTime,
        pricingCount: pricing.length,
      });

      return {
        success: true,
        data: {
          pricing,
          cacheStatus,
          lastUpdate: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Error getting all pricing: ${error.message}`, {
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to get all pricing',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get pricing for specific provider
   * Returns pricing data filtered by provider name
   */
  @Get('provider/:provider')
  async getProviderPricing(@Param('provider') provider: string) {
    const startTime = Date.now();
    try {
      if (!provider) {
        throw new HttpException(
          'Provider parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const pricing =
        await this.realtimePricingService.getPricingForProvider(provider);

      if (!pricing) {
        throw new HttpException(
          `Pricing data not found for provider: ${provider}`,
          HttpStatus.NOT_FOUND,
        );
      }

      this.logger.log('Provider pricing retrieved successfully', {
        duration: Date.now() - startTime,
        provider,
      });

      return {
        success: true,
        data: pricing,
      };
    } catch (error) {
      this.logger.error(`Error getting provider pricing: ${error.message}`, {
        provider,
        duration: Date.now() - startTime,
      });
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to get provider pricing',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Compare pricing across providers for a specific task
   * Returns cost comparisons for all providers given token estimates
   */
  @Post('compare')
  async comparePricing(@Body() dto: ComparePricingDto) {
    const startTime = Date.now();
    try {
      const { task, estimatedTokens, providers } = dto;

      if (!task || !estimatedTokens) {
        throw new HttpException(
          'Task and estimatedTokens are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (typeof estimatedTokens !== 'number' || estimatedTokens <= 0) {
        throw new HttpException(
          'estimatedTokens must be a positive number',
          HttpStatus.BAD_REQUEST,
        );
      }

      const comparison = await this.realtimePricingService.comparePricing(
        task,
        estimatedTokens,
      );

      this.logger.log('Pricing comparison completed', {
        duration: Date.now() - startTime,
        task,
        estimatedTokens,
      });

      return {
        success: true,
        data: comparison,
      };
    } catch (error) {
      this.logger.error(`Error comparing pricing: ${error.message}`, {
        dto,
        duration: Date.now() - startTime,
      });
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to compare pricing',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Force update all pricing data
   * Triggers background update of all pricing information
   */
  @Post('update')
  async forceUpdate() {
    const startTime = Date.now();
    try {
      // Start force update in background (don't await to avoid timeout)
      this.realtimePricingService.forceUpdate().catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Force update failed: ${errorMessage}`);
      });

      this.logger.log('Pricing force update initiated', {
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message:
          'Pricing update initiated in background. Updates will be available shortly.',
      };
    } catch (error) {
      this.logger.error(`Error initiating force update: ${error.message}`, {
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to initiate pricing update',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get cache status and last update times
   * Returns cache metadata and status for all providers
   */
  @Get('cache-status')
  async getCacheStatus() {
    const startTime = Date.now();
    try {
      const cacheStatus = this.realtimePricingService.getCacheStatus();

      this.logger.log('Cache status retrieved successfully', {
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: {
          cacheStatus,
          currentTime: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Error getting cache status: ${error.message}`, {
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to get cache status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Clear all pricing caches
   * Clears all cached pricing data forcing fresh retrieval
   */
  @Delete('cache')
  async clearCache() {
    const startTime = Date.now();
    try {
      this.realtimePricingService.clearCache();

      this.logger.log('Cache cleared successfully', {
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'All pricing caches cleared successfully',
      };
    } catch (error) {
      this.logger.error(`Error clearing cache: ${error.message}`, {
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to clear cache',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
