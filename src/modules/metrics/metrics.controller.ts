import {
  Controller,
  Get,
  Req,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { CacheService, CacheStats } from '../../common/cache/cache.service';
import { LoggerService } from '../../common/logger/logger.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';

/**
 * Metrics API: cache and other operational metrics.
 * Mirrors Express GET /metrics/cache with production logging and business events.
 */
@Controller('api/metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggerService: LoggerService,
    private readonly businessEventLoggingService: BusinessEventLoggingService,
  ) {}

  /**
   * GET /metrics/cache
   * Returns Redis/cache statistics (hits, misses, hit rate, top models/users, etc.).
   */
  @Get('cache')
  async getCacheMetrics(@Req() req: Request): Promise<CacheStats> {
    const startTime = Date.now();
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Cache metrics retrieval initiated', {
      requestId,
    });
    this.loggerService.info('Cache metrics retrieval processing started', {
      requestId,
    });

    try {
      const stats = await this.cacheService.getCacheStats();
      const duration = Date.now() - startTime;

      this.loggerService.info('Cache metrics retrieved successfully', {
        duration,
        hasStats: !!stats,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'cache_metrics_retrieved',
        category: 'metrics_operations',
        value: duration,
        metadata: { hasStats: !!stats },
      });

      return stats;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Cache metrics retrieval failed', {
        error: err.message,
        stack: err.stack,
        duration,
        requestId,
      });
      this.loggerService.error('Cache metrics retrieval failed', {
        error: err.message,
        stack: err.stack,
        duration,
        requestId,
      });

      throw new InternalServerErrorException('Failed to fetch cache stats');
    }
  }
}
