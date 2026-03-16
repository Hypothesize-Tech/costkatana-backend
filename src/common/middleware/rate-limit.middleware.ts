import {
  Injectable,
  NestMiddleware,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../cache/cache.service';

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: Request) => string; // Function to generate rate limit key
  skipSuccessfulRequests?: boolean; // Skip rate limiting for successful requests
  skipFailedRequests?: boolean; // Skip rate limiting for failed requests
}

/**
 * Rate limit middleware using shared CacheService (Redis with in-memory fallback).
 * When Redis is unavailable or slow, rate limit check is skipped after a short timeout (fail open).
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);

  /** Max wait for rate limit check; if exceeded, allow request (fail open). */
  private static readonly RATE_LIMIT_CHECK_TIMEOUT_MS = 2500;

  /** Timeout for header helpers (remaining, resetTime) so we don't block the response. */
  private static readonly HEADER_HELPER_TIMEOUT_MS = 1500;

  constructor(private readonly cacheService: CacheService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      this.logger.log('Rate limit check initiated', {
        component: 'RateLimitMiddleware',
        operation: 'use',
        type: 'rate_limit_check',
        requestId,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
      });

      const options = this.getRateLimitOptions(req);
      const key = options.keyGenerator
        ? options.keyGenerator(req)
        : this.getDefaultKey(req);

      this.logger.debug('Rate limit key generated', {
        component: 'RateLimitMiddleware',
        operation: 'use',
        type: 'rate_limit_key',
        requestId,
        key,
        windowMs: options.windowMs,
        maxRequests: options.maxRequests,
      });

      const isAllowed = await this.checkRateLimitWithTimeout(key, options);

      if (isAllowed === 'timeout') {
        this.logger.warn('Rate limit check timed out, allowing request', {
          component: 'RateLimitMiddleware',
          operation: 'use',
          type: 'rate_limit_timeout',
          requestId,
          key,
          duration: `${Date.now() - startTime}ms`,
        });
        return next();
      }

      if (isAllowed === false) {
        const resetTime = await this.getResetTimeWithTimeout(
          key,
          options.windowMs,
        );

        this.logger.warn('Rate limit exceeded', {
          component: 'RateLimitMiddleware',
          operation: 'use',
          type: 'rate_limit_exceeded',
          requestId,
          key,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          resetTime,
          windowMs: options.windowMs,
          maxRequests: options.maxRequests,
        });

        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', options.maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', resetTime.toString());
        res.setHeader(
          'Retry-After',
          Math.ceil((resetTime - Date.now()) / 1000).toString(),
        );

        throw new HttpException(
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Add rate limit headers for successful checks (with timeout so we don't hang)
      const [remaining, resetTime] = await Promise.all([
        this.getRemainingRequestsWithTimeout(key, options),
        this.getResetTimeWithTimeout(key, options.windowMs),
      ]);

      res.setHeader('X-RateLimit-Limit', options.maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', resetTime.toString());

      this.logger.log('Rate limit check passed', {
        component: 'RateLimitMiddleware',
        operation: 'use',
        type: 'rate_limit_passed',
        requestId,
        key,
        remaining,
        resetTime,
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.warn('Rate limit check failed, allowing request', {
        component: 'RateLimitMiddleware',
        operation: 'use',
        type: 'rate_limit_fallback',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    }
  }

  /**
   * Run rate limit check with a timeout. Returns true = allowed, false = exceeded, 'timeout' = fail open.
   */
  private async checkRateLimitWithTimeout(
    key: string,
    options: RateLimitOptions,
  ): Promise<boolean | 'timeout'> {
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(
        () => resolve('timeout'),
        RateLimitMiddleware.RATE_LIMIT_CHECK_TIMEOUT_MS,
      );
    });
    const checkPromise = this.checkRateLimit(key, options).then(
      (allowed) => allowed as boolean | 'timeout',
    );
    return Promise.race([checkPromise, timeoutPromise]);
  }

  private async getRemainingRequestsWithTimeout(
    key: string,
    options: RateLimitOptions,
  ): Promise<number> {
    const timeout = new Promise<number>((resolve) =>
      setTimeout(
        () => resolve(options.maxRequests - 1),
        RateLimitMiddleware.HEADER_HELPER_TIMEOUT_MS,
      ),
    );
    return Promise.race([this.getRemainingRequests(key, options), timeout]);
  }

  private async getResetTimeWithTimeout(
    key: string,
    windowMs: number,
  ): Promise<number> {
    const fallback = Date.now() + windowMs;
    const timeout = new Promise<number>((resolve) =>
      setTimeout(
        () => resolve(fallback),
        RateLimitMiddleware.HEADER_HELPER_TIMEOUT_MS,
      ),
    );
    return Promise.race([this.getResetTime(key, windowMs), timeout]);
  }

  private getRateLimitOptions(req: Request): RateLimitOptions {
    const { method, originalUrl } = req;

    // Default rate limit options
    let options: RateLimitOptions = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100, // 100 requests per window
    };

    // Stricter limits for auth endpoints
    if (
      originalUrl.includes('/auth/') ||
      originalUrl.includes('/login') ||
      originalUrl.includes('/register')
    ) {
      options = {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 10, // 10 requests per window
      };
    }

    // Stricter limits for password reset
    else if (
      originalUrl.includes('/forgot-password') ||
      originalUrl.includes('/reset-password')
    ) {
      options = {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 5, // 5 requests per hour
      };
    }

    // API endpoints
    else if (originalUrl.startsWith('/api/')) {
      if (method === 'GET') {
        options = {
          windowMs: 15 * 60 * 1000, // 15 minutes
          maxRequests: 500, // 500 GET requests per window
        };
      } else {
        options = {
          windowMs: 15 * 60 * 1000, // 15 minutes
          maxRequests: 100, // 100 write requests per window
        };
      }
    }

    return options;
  }

  private getDefaultKey(req: Request): string {
    const user = (req as any).user;
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    // Use user ID if authenticated, otherwise use IP
    const identifier = user?.id || user?._id || ip;

    // Add endpoint to key for more granular rate limiting
    const endpoint = req.originalUrl.split('?')[0]; // Remove query params

    return `rate_limit:${identifier}:${endpoint}`;
  }

  private async checkRateLimit(
    key: string,
    options: RateLimitOptions,
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - options.windowMs;

    // Use CacheService (Redis or in-memory fallback) - no separate Redis client
    await this.cacheService.zremrangebyscore(key, 0, windowStart);
    await this.cacheService.zadd(key, now, now.toString());
    const requestCount = await this.cacheService.zcount(key, windowStart, now);
    const ttlSeconds = Math.ceil((options.windowMs + 60000) / 1000);
    await this.cacheService.expire(key, ttlSeconds);

    return requestCount <= options.maxRequests;
  }

  private async getRemainingRequests(
    key: string,
    options: RateLimitOptions,
  ): Promise<number> {
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const count = await this.cacheService.zcount(key, windowStart, now);
    return Math.max(0, options.maxRequests - count);
  }

  private async getResetTime(key: string, windowMs: number): Promise<number> {
    const oldestTimestamp = await this.cacheService.zrange(
      key,
      0,
      0,
      'WITHSCORES',
    );
    if (Array.isArray(oldestTimestamp) && oldestTimestamp.length >= 2) {
      const timestamp = parseInt(oldestTimestamp[1], 10);
      if (!Number.isNaN(timestamp)) {
        return timestamp + windowMs;
      }
    }
    return Date.now() + windowMs;
  }
}
