/**
 * Rate Limiter Service for MCP Tools
 * Redis-based sliding window rate limiting to prevent abuse and ensure fair usage.
 * Uses Redis sorted sets (ZADD/ZREMRANGEBYSCORE/ZCARD) for distributed sliding window counters.
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CacheService } from '../../../common/cache/cache.service';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  RateLimitConfig,
  RateLimitResult,
  HttpMethod,
  IntegrationType,
} from '../types/mcp.types';

@Injectable()
export class RateLimiterService {
  // Default rate limits per HTTP method
  private static readonly DEFAULT_LIMITS: Record<HttpMethod, RateLimitConfig> =
    {
      GET: { requests: 100, windowSeconds: 60 },
      POST: { requests: 50, windowSeconds: 60 },
      PUT: { requests: 50, windowSeconds: 60 },
      PATCH: { requests: 50, windowSeconds: 60 },
      DELETE: { requests: 10, windowSeconds: 3600 }, // 10 per hour for DELETE
    };

  private readonly CACHE_PREFIX = 'ratelimit:mcp:';

  constructor(
    private cacheService: CacheService,
    private logger: LoggerService,
  ) {}

  /**
   * Check rate limit using Redis sliding window (sorted set).
   * Each request adds a member with score=timestamp; we count members in the window and prune old ones.
   */
  async checkRateLimit(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod,
    toolName: string,
  ): Promise<RateLimitResult> {
    try {
      const config = RateLimiterService.DEFAULT_LIMITS[httpMethod];
      const key = this.getCacheKey(userId, integration, httpMethod);
      const now = Date.now();
      const windowStart = now - config.windowSeconds * 1000;

      // Prune requests outside the sliding window
      await this.cacheService.zremrangebyscore(key, -Infinity, windowStart);

      // Add current request to the sorted set (score = timestamp)
      await this.cacheService.zadd(key, now, `${now}:${randomUUID()}`);

      // Refresh TTL so the key expires after the window
      await this.cacheService.expire(key, config.windowSeconds + 60);

      // Count requests in the current window
      const currentCount = await this.cacheService.zcount(
        key,
        windowStart,
        now,
      );

      // Check if limit exceeded
      const allowed = currentCount <= config.requests;

      const resetAt = new Date(now + config.windowSeconds * 1000);

      if (allowed) {
        return {
          allowed: true,
          remaining: Math.max(0, config.requests - currentCount),
          resetAt,
        };
      } else {
        this.logger.warn('Rate limit exceeded', {
          userId,
          integration,
          httpMethod,
          toolName,
          currentCount,
          limit: config.requests,
          resetAt,
        });

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter: config.windowSeconds,
        };
      }
    } catch (error) {
      this.logger.error('Rate limit check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
        httpMethod,
      });

      // Fail open on error
      return {
        allowed: true,
        remaining: 100,
        resetAt: new Date(Date.now() + 60000),
      };
    }
  }

  /**
   * Reset rate limit for a user (admin function)
   */
  async resetRateLimit(
    userId: string,
    integration?: IntegrationType,
  ): Promise<number> {
    try {
      let deletedCount = 0;

      if (integration) {
        // Reset for specific integration
        for (const method of Object.keys(
          RateLimiterService.DEFAULT_LIMITS,
        ) as HttpMethod[]) {
          const key = this.getCacheKey(userId, integration, method);
          const deleted = await this.cacheService.del(key);
          if (deleted) deletedCount++;
        }
      } else {
        // Reset for all integrations (use pattern matching)
        // Since CacheService doesn't have pattern deletion, we'll try to delete known patterns
        const integrations: IntegrationType[] = [
          'vercel',
          'github',
          'google',
          'slack',
          'discord',
          'jira',
          'linear',
          'mongodb',
          'aws',
        ];
        const methods = Object.keys(
          RateLimiterService.DEFAULT_LIMITS,
        ) as HttpMethod[];

        for (const int of integrations) {
          for (const method of methods) {
            const key = this.getCacheKey(userId, int, method);
            try {
              const deleted = await this.cacheService.del(key);
              if (deleted) deletedCount++;
            } catch {
              // Continue on error
            }
          }
        }
      }

      this.logger.log('Rate limits reset', {
        userId,
        integration,
        deletedCount,
      });

      return deletedCount;
    } catch (error) {
      this.logger.error('Failed to reset rate limit', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
      });
      return 0;
    }
  }

  /**
   * Get rate limit status using sliding window count (ZCARD of current window).
   */
  async getRateLimitStatus(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod,
  ): Promise<{
    current: number;
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    try {
      const config = RateLimiterService.DEFAULT_LIMITS[httpMethod];
      const key = this.getCacheKey(userId, integration, httpMethod);
      const now = Date.now();
      const windowStart = now - config.windowSeconds * 1000;

      await this.cacheService.zremrangebyscore(key, -Infinity, windowStart);
      const current = await this.cacheService.zcard(key);

      const resetAt = new Date(now + config.windowSeconds * 1000);

      return {
        current,
        limit: config.requests,
        remaining: Math.max(0, config.requests - current),
        resetAt,
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit status', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
        httpMethod,
      });

      const config = RateLimiterService.DEFAULT_LIMITS[httpMethod];
      return {
        current: 0,
        limit: config.requests,
        remaining: config.requests,
        resetAt: new Date(Date.now() + config.windowSeconds * 1000),
      };
    }
  }

  /**
   * Get rate limit configuration for an HTTP method
   */
  getRateLimitConfig(httpMethod: HttpMethod): RateLimitConfig {
    return RateLimiterService.DEFAULT_LIMITS[httpMethod];
  }

  /**
   * Check if a request would be rate limited (dry run) — uses sliding window count.
   */
  async wouldBeRateLimited(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod,
  ): Promise<boolean> {
    try {
      const config = RateLimiterService.DEFAULT_LIMITS[httpMethod];
      const key = this.getCacheKey(userId, integration, httpMethod);
      const now = Date.now();
      const windowStart = now - config.windowSeconds * 1000;

      await this.cacheService.zremrangebyscore(key, -Infinity, windowStart);
      const currentCount = await this.cacheService.zcard(key);
      return currentCount >= config.requests;
    } catch (error) {
      // On error, assume not rate limited (fail open)
      return false;
    }
  }

  /**
   * Get all rate limit keys for a user using Redis SCAN (non-blocking)
   */
  async getUserRateLimitKeys(userId: string): Promise<string[]> {
    const pattern = `${this.CACHE_PREFIX}${userId}:*`;
    try {
      const keys = await this.cacheService.scanKeys(pattern);
      return keys;
    } catch {
      return [];
    }
  }

  /**
   * Get cache key for rate limiting
   */
  private getCacheKey(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod,
  ): string {
    return `${this.CACHE_PREFIX}${userId}:${integration}:${httpMethod}`;
  }

  /**
   * Get rate limit statistics for monitoring (uses CacheService.keys for Redis).
   */
  async getRateLimitStats(): Promise<{
    totalKeys: number;
    keysByIntegration: Record<string, number>;
    keysByMethod: Record<string, number>;
  }> {
    try {
      const keysByIntegration: Record<string, number> = {};
      const keysByMethod: Record<string, number> = {};
      const pattern = `${this.CACHE_PREFIX}*`;
      const keyList = await this.cacheService.keys(pattern);

      for (const key of keyList) {
        // Parse the key format: ratelimit:mcp:{userId}:{integration}:{httpMethod}
        const parts = key.split(':');
        if (parts.length >= 5) {
          const integration = parts[3];
          const httpMethod = parts[4];

          keysByIntegration[integration] =
            (keysByIntegration[integration] || 0) + 1;
          keysByMethod[httpMethod] = (keysByMethod[httpMethod] || 0) + 1;
        }
      }

      const totalKeys = keyList.length;

      this.logger.debug('Rate limit stats gathered', {
        totalKeys,
        integrations: Object.keys(keysByIntegration).length,
        methods: Object.keys(keysByMethod).length,
      });

      return {
        totalKeys,
        keysByIntegration,
        keysByMethod,
      };
    } catch (error) {
      this.logger.error('Failed to gather rate limit stats', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return empty stats on error
      return {
        totalKeys: 0,
        keysByIntegration: {},
        keysByMethod: {},
      };
    }
  }
}
