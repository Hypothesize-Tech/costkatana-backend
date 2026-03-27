/**
 * Cache Controller (NestJS)
 *
 * Production API for cache management: stats, clear, export, import, warmup.
 * Path: api/cache (per-controller prefix; no global api prefix).
 * Full parity with Express cache.controller and cache.routes.
 */

import {
  Controller,
  Get,
  Delete,
  Post,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CacheService } from '../../common/cache/cache.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { GatewayAnalyticsService } from '../gateway/services/gateway-analytics.service';
import { ClearCacheQueryDto } from './dto/clear-cache-query.dto';
import { ImportCacheDto } from './dto/import-cache.dto';
import { WarmupCacheDto } from './dto/warmup-cache.dto';
import { ConfigService } from '@nestjs/config';

@Controller('api/cache')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CacheController {
  constructor(
    private readonly cacheService: CacheService,
    private readonly businessLogging: BusinessEventLoggingService,
    private readonly configService: ConfigService,
    private readonly gatewayAnalyticsService: GatewayAnalyticsService,
  ) {}

  /**
   * Get cache statistics
   * GET api/cache/stats
   */
  @Get('stats')
  async getCacheStats(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const redisStats = await this.cacheService.getCacheStats();
    const gatewayUsage =
      await this.gatewayAnalyticsService.getGatewayUsageCacheSummary(userId);
    const duration = Date.now() - startTime;

    const totalCostSavedCombined =
      (redisStats.costSaved ?? 0) +
      (gatewayUsage.totalProviderCacheSavingsUsd ?? 0);

    this.businessLogging.logBusiness({
      event: 'cache_stats_retrieved',
      category: 'cache_management',
      value: duration,
      metadata: {
        userId,
        totalHits: redisStats.hits,
        totalMisses: redisStats.misses,
        totalRequests: redisStats.totalRequests,
        hitRate: (redisStats.hits / (redisStats.totalRequests || 1)) * 100,
        costSaved: redisStats.costSaved,
        tokensSaved: redisStats.tokensSaved ?? 0,
        gatewayAppCacheHits: gatewayUsage.appLevelCacheHits,
        providerCacheSavingsUsd: gatewayUsage.totalProviderCacheSavingsUsd,
      },
    });

    return {
      success: true,
      data: {
        redis: {
          ...redisStats,
          provider: 'AWS ElastiCache',
          features: {
            semanticCaching:
              this.configService.get('ENABLE_SEMANTIC_CACHE') === 'true',
            deduplication:
              this.configService.get('ENABLE_DEDUPLICATION') === 'true',
            userScoped: true,
            modelSpecific: true,
          },
        },
        gateway: gatewayUsage,
        combined: {
          totalHits: redisStats.hits,
          totalMisses: redisStats.misses,
          totalRequests: redisStats.totalRequests,
          overallHitRate:
            (redisStats.hits / (redisStats.totalRequests || 1)) * 100,
          totalCostSaved: redisStats.costSaved,
          totalTokensSaved: redisStats.tokensSaved ?? 0,
          gatewayAppCacheHits: gatewayUsage.appLevelCacheHits,
          gatewayProxyRequests: gatewayUsage.gatewayProxyRequests,
          providerCacheSavingsUsd: gatewayUsage.totalProviderCacheSavingsUsd,
          totalCostSavedIncludingProviderCache: totalCostSavedCombined,
        },
      },
    };
  }

  /**
   * Clear cache (optional filters: model, provider; userId from JWT)
   * DELETE api/cache/clear?model=&provider=
   */
  @Delete('clear')
  async clearCache(
    @CurrentUser('id') userId: string,
    @Query() query: ClearCacheQueryDto,
  ) {
    const startTime = Date.now();
    const clearedRedis = await this.cacheService.clearCache({
      userId,
      model: query.model,
      provider: query.provider,
    });
    const duration = Date.now() - startTime;

    this.businessLogging.logBusiness({
      event: 'cache_cleared',
      category: 'cache_management',
      value: duration,
      metadata: {
        userId,
        model: query.model ?? 'all',
        provider: query.provider ?? 'all',
        clearedEntries: clearedRedis ?? 0,
      },
    });

    return {
      success: true,
      message: 'Redis cache cleared successfully',
      details: {
        redis: clearedRedis,
      },
    };
  }

  /**
   * Export cache data for backup
   * GET api/cache/export
   */
  @Get('export')
  async exportCache(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const cacheData = await this.cacheService.exportCache();
    const exportedEntries = cacheData.entries?.length ?? 0;
    const duration = Date.now() - startTime;

    this.businessLogging.logBusiness({
      event: 'cache_exported',
      category: 'cache_management',
      value: duration,
      metadata: {
        userId,
        exportedEntries,
      },
    });

    return {
      success: true,
      data: cacheData,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Import cache data from backup
   * POST api/cache/import
   */
  @Post('import')
  async importCache(
    @CurrentUser('id') userId: string,
    @Body() body: ImportCacheDto,
  ) {
    const startTime = Date.now();
    const entries = body?.entries;
    if (!entries || !Array.isArray(entries)) {
      throw new BadRequestException('Invalid cache data format');
    }

    await this.cacheService.importCache({ entries });
    const duration = Date.now() - startTime;

    this.businessLogging.logBusiness({
      event: 'cache_imported',
      category: 'cache_management',
      value: duration,
      metadata: {
        userId,
        importedEntries: entries.length,
      },
    });

    return {
      success: true,
      message: `Imported ${entries.length} cache entries successfully`,
    };
  }

  /**
   * Warmup cache with predefined queries
   * POST api/cache/warmup
   */
  @Post('warmup')
  async warmupCache(
    @CurrentUser('id') userId: string,
    @Body() body: WarmupCacheDto,
  ) {
    const startTime = Date.now();
    const queries = body?.queries;
    if (!queries || !Array.isArray(queries)) {
      throw new BadRequestException('Invalid warmup data format');
    }

    await this.cacheService.warmupCache(
      queries.map((q) => ({
        prompt: q.prompt,
        response: q.response,
        metadata: q.metadata,
      })),
    );
    const duration = Date.now() - startTime;

    this.businessLogging.logBusiness({
      event: 'cache_warmed_up',
      category: 'cache_management',
      value: duration,
      metadata: {
        userId,
        warmedUpEntries: queries.length,
      },
    });

    return {
      success: true,
      message: `Warmed up cache with ${queries.length} entries`,
    };
  }
}
