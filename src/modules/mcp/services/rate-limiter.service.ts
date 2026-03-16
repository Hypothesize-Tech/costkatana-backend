/**
 * Rate Limiter Service for MCP Tools
 * Redis-based rate limiting to prevent abuse and ensure fair usage
 */

import { Injectable } from '@nestjs/common';
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
   * Check rate limit for a user/integration/method combination
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

      // Get current count
      const currentCount = (await this.cacheService.get<number>(key)) || 0;

      // Increment count
      const newCount = currentCount + 1;

      // Check if limit exceeded
      const allowed = newCount <= config.requests;

      // Calculate reset time
      const resetAt = new Date(Date.now() + config.windowSeconds * 1000);

      if (allowed) {
        // Set/update the count with TTL
        await this.cacheService.set(key, newCount, config.windowSeconds);

        return {
          allowed: true,
          remaining: config.requests - newCount,
          resetAt,
        };
      } else {
        // Rate limit exceeded
        this.logger.warn('Rate limit exceeded', {
          userId,
          integration,
          httpMethod,
          toolName,
          currentCount: newCount,
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
   * Get rate limit status for a user/integration/method
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

      const current = (await this.cacheService.get<number>(key)) || 0;
      let ttl = config.windowSeconds;
      try {
        const redisClient = (this.cacheService as any).redis;
        if (redisClient) {
          const ttlValue = await redisClient.ttl(key);
          if (ttlValue > 0) {
            ttl = ttlValue;
          }
        }
      } catch (error) {
        // Fallback to default window
        this.logger.debug('Failed to get TTL from Redis, using default', {
          error,
        });
      }
      const resetAt = new Date(Date.now() + ttl * 1000);

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
   * Check if a request would be rate limited (dry run)
   */
  async wouldBeRateLimited(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod,
  ): Promise<boolean> {
    try {
      const config = RateLimiterService.DEFAULT_LIMITS[httpMethod];
      const key = this.getCacheKey(userId, integration, httpMethod);

      const currentCount = (await this.cacheService.get<number>(key)) || 0;
      return currentCount >= config.requests;
    } catch (error) {
      // On error, assume not rate limited (fail open)
      return false;
    }
  }

  /**
   * Get all rate limit keys for a user (for cleanup/debugging)
   */
  async getUserRateLimitKeys(userId: string): Promise<string[]> {
    // Note: This is a simplified version since CacheService doesn't have scan functionality
    // In production, you might want to extend CacheService or use Redis directly
    const keys: string[] = [];
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

    for (const integration of integrations) {
      for (const method of methods) {
        const key = this.getCacheKey(userId, integration, method);
        try {
          const exists = (await this.cacheService.get(key)) !== null;
          if (exists) {
            keys.push(key);
          }
        } catch {
          // Continue on error
        }
      }
    }

    return keys;
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
   * Get rate limit statistics for monitoring
   */
  async getRateLimitStats(): Promise<{
    totalKeys: number;
    keysByIntegration: Record<string, number>;
    keysByMethod: Record<string, number>;
  }> {
    try {
      // Use Redis SCAN to find all rate limit keys
      const keysByIntegration: Record<string, number> = {};
      const keysByMethod: Record<string, number> = {};
      let totalKeys = 0;

      // Get the underlying Redis client from CacheService
      const redisClient = (this.cacheService as any).redis;
      if (!redisClient) {
        this.logger.warn('Redis client not available for stats gathering');
        return { totalKeys: 0, keysByIntegration: {}, keysByMethod: {} };
      }

      let cursor = '0';
      const pattern = `${this.CACHE_PREFIX}*`;

      do {
        const result = await redisClient.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = result[0];
        const keys = result[1];

        for (const key of keys) {
          totalKeys++;

          // Parse the key format: ratelimit:mcp:{userId}:{integration}:{httpMethod}
          const parts = key.split(':');
          if (parts.length === 5) {
            const integration = parts[3];
            const httpMethod = parts[4];

            keysByIntegration[integration] =
              (keysByIntegration[integration] || 0) + 1;
            keysByMethod[httpMethod] = (keysByMethod[httpMethod] || 0) + 1;
          }
        }
      } while (cursor !== '0');

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
