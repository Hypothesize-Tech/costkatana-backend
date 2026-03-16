import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../../../common/cache/cache.service';
import { RateLimitCheckResult } from '../interfaces/gateway.interfaces';

@Injectable()
export class GatewayRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GatewayRateLimitMiddleware.name);

  constructor(private cacheService: CacheService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || 'unknown';

    try {
      this.logger.log('=== GATEWAY RATE LIMIT MIDDLEWARE STARTED ===', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'use',
        type: 'gateway_rate_limit',
        requestId,
        path: req.originalUrl,
        method: req.method,
      });

      const rateLimitResult = await this.checkGatewayRateLimit(req);

      if (!rateLimitResult.allowed) {
        this.logger.warn('Gateway rate limit exceeded', {
          component: 'GatewayRateLimitMiddleware',
          operation: 'use',
          type: 'gateway_rate_limit_exceeded',
          requestId,
          retryAfter: rateLimitResult.retryAfter,
        });

        res.setHeader(
          'Retry-After',
          rateLimitResult.retryAfter?.toString() || '60',
        );
        res.status(429).json({
          error: 'Gateway rate limit exceeded',
          message: 'Too many requests to gateway, please try again later.',
          retryAfter: rateLimitResult.retryAfter,
        });

        this.logger.log(
          '=== GATEWAY RATE LIMIT MIDDLEWARE COMPLETED (LIMIT EXCEEDED) ===',
          {
            component: 'GatewayRateLimitMiddleware',
            operation: 'use',
            type: 'gateway_rate_limit_completed_exceeded',
            requestId,
            processingTime: `${Date.now() - startTime}ms`,
          },
        );

        return;
      }

      this.logger.log('Gateway rate limit check passed', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'use',
        type: 'gateway_rate_limit_passed',
        requestId,
        processingTime: `${Date.now() - startTime}ms`,
      });

      this.logger.log('=== GATEWAY RATE LIMIT MIDDLEWARE COMPLETED ===', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'use',
        type: 'gateway_rate_limit_completed',
        requestId,
        processingTime: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      this.logger.error('Gateway rate limit middleware error', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'use',
        type: 'gateway_rate_limit_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: `${Date.now() - startTime}ms`,
      });

      // Don't block on rate limit errors
      next();
    }
  }

  private async checkGatewayRateLimit(
    req: Request,
  ): Promise<RateLimitCheckResult> {
    const startTime = Date.now();

    this.logger.log('=== GATEWAY RATE LIMIT CHECK STARTED ===', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      path: req.path,
      method: req.method,
    });

    this.logger.log('Step 1: Generating rate limit key for gateway request', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'generate_key',
    });

    // Generate rate limit key based on user or IP
    const key = (req as any).user?.id || req.ip || 'anonymous';
    const cacheKey = `gateway_rate_limit:${key}`;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;

    this.logger.log('Gateway rate limit key generated', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'key_generated',
      key,
      cacheKey,
      hasUser: !!(req as any).user?.id,
      hasIP: !!req.ip,
      maxRequests,
      windowMs,
    });

    this.logger.log('Step 2: Retrieving gateway rate limit record from cache', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'retrieve_record',
    });

    // Get rate limit record from Redis/in-memory cache
    let record: { count: number; resetTime: number } | null = null;
    try {
      record = await this.cacheService.get<{
        count: number;
        resetTime: number;
      }>(cacheKey);
      if (record) {
        this.logger.log('Gateway rate limit record retrieved from cache', {
          component: 'GatewayRateLimitMiddleware',
          operation: 'checkGatewayRateLimit',
          type: 'gateway_rate_limit',
          step: 'record_retrieved',
          key,
          cacheKey,
          currentCount: record.count,
          resetTime: new Date(record.resetTime).toISOString(),
          timeUntilReset: record.resetTime - now,
        });
      }
    } catch (error) {
      this.logger.warn(
        'Failed to retrieve gateway rate limit record from cache',
        {
          component: 'GatewayRateLimitMiddleware',
          operation: 'checkGatewayRateLimit',
          type: 'gateway_rate_limit',
          step: 'cache_retrieve_failed',
          key,
          cacheKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }

    this.logger.log('Step 3: Processing gateway rate limit record', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'process_record',
    });

    // Check if record exists and is still valid
    if (!record || record.resetTime < now) {
      // Create new record
      record = {
        count: 1,
        resetTime: now + windowMs,
      };

      this.logger.log('New gateway rate limit record created', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit',
        step: 'record_created',
        key,
        cacheKey,
        resetTime: new Date(record.resetTime).toISOString(),
        windowMs,
      });
    } else {
      // Increment existing record
      record.count++;

      this.logger.log('Existing gateway rate limit record incremented', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit',
        step: 'record_incremented',
        key,
        cacheKey,
        newCount: record.count,
        maxRequests,
        remaining: maxRequests - record.count,
      });
    }

    this.logger.log('Step 4: Checking gateway rate limit status', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'check_limit',
    });

    // Check if limit exceeded
    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      this.logger.warn('Gateway rate limit exceeded', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit',
        step: 'limit_exceeded',
        key,
        cacheKey,
        count: record.count,
        maxRequests,
        retryAfter,
        resetTime: new Date(record.resetTime).toISOString(),
      });

      this.logger.log('Gateway rate limit check completed - limit exceeded', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit',
        step: 'check_complete_exceeded',
        key,
        allowed: false,
        retryAfter,
        totalTime: `${Date.now() - startTime}ms`,
      });

      this.logger.log(
        '=== GATEWAY RATE LIMIT CHECK COMPLETED (LIMIT EXCEEDED) ===',
        {
          component: 'GatewayRateLimitMiddleware',
          operation: 'checkGatewayRateLimit',
          type: 'gateway_rate_limit',
          step: 'completed_limit_exceeded',
          totalTime: `${Date.now() - startTime}ms`,
        },
      );

      return { allowed: false, retryAfter };
    }

    this.logger.log(
      'Step 5: Storing updated gateway rate limit record in cache',
      {
        component: 'GatewayRateLimitMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit',
        step: 'store_record',
      },
    );

    // Store updated record in cache
    try {
      const ttl = Math.ceil((record.resetTime - now) / 1000);
      await this.cacheService.set(cacheKey, record, ttl, {
        type: 'gateway_rate_limit',
        key,
        maxRequests,
        windowMs,
      });

      this.logger.log(
        'Gateway rate limit record stored in cache successfully',
        {
          component: 'GatewayRateLimitMiddleware',
          operation: 'checkGatewayRateLimit',
          type: 'gateway_rate_limit',
          step: 'record_stored',
          key,
          cacheKey,
          ttl,
          count: record.count,
          resetTime: new Date(record.resetTime).toISOString(),
        },
      );
    } catch (error) {
      this.logger.warn('Failed to store gateway rate limit record in cache', {
        component: 'GatewayRateLimitMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit',
        step: 'cache_store_failed',
        key,
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    this.logger.log('Gateway rate limit check completed successfully', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'check_complete_allowed',
      key,
      allowed: true,
      currentCount: record.count,
      maxRequests,
      remaining: maxRequests - record.count,
      totalTime: `${Date.now() - startTime}ms`,
    });

    this.logger.log('=== GATEWAY RATE LIMIT CHECK COMPLETED ===', {
      component: 'GatewayRateLimitMiddleware',
      operation: 'checkGatewayRateLimit',
      type: 'gateway_rate_limit',
      step: 'completed',
      key,
      totalTime: `${Date.now() - startTime}ms`,
    });

    return { allowed: true };
  }
}
