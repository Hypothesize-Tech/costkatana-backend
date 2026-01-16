/**
 * Rate Limiter for MCP Tools
 * Prevents abuse and ensures fair usage
 */

import { loggingService } from '../../services/logging.service';
import { redisService } from '../../services/redis.service';
import { IntegrationType, HttpMethod } from '../types/permission.types';

export interface RateLimitConfig {
  requests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

export class RateLimiter {
  // Default rate limits
  private static readonly DEFAULT_LIMITS: Record<HttpMethod, RateLimitConfig> = {
    GET: { requests: 100, windowSeconds: 60 },
    POST: { requests: 50, windowSeconds: 60 },
    PUT: { requests: 50, windowSeconds: 60 },
    PATCH: { requests: 50, windowSeconds: 60 },
    DELETE: { requests: 10, windowSeconds: 3600 }, // 10 per hour for DELETE
  };

  /**
   * Check rate limit
   */
  static async checkRateLimit(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod,
    toolName: string
  ): Promise<RateLimitResult> {
    try {
      const config = this.DEFAULT_LIMITS[httpMethod];
      const key = `ratelimit:mcp:${userId}:${integration}:${httpMethod}`;

      // Get current count
      const count = await redisService.incr(key);

      // Set TTL if first request
      if (count === 1) {
        await redisService.set(key, '1', config.windowSeconds);
      }

      // Check if limit exceeded
      const allowed = count <= config.requests;
      const remaining = Math.max(0, config.requests - count);

      // Get reset time
      const ttl = await redisService.getTTL(key);
      const resetAt = new Date(Date.now() + (ttl > 0 ? ttl * 1000 : config.windowSeconds * 1000));

      if (!allowed) {
        loggingService.warn('Rate limit exceeded', {
          userId,
          integration,
          httpMethod,
          toolName,
          count,
          limit: config.requests,
          resetAt,
        });

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter: ttl > 0 ? ttl : config.windowSeconds,
        };
      }

      return {
        allowed: true,
        remaining,
        resetAt,
      };
    } catch (error) {
      loggingService.error('Rate limit check failed', {
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
   * Reset rate limit for user (admin function)
   */
  static async resetRateLimit(
    userId: string,
    integration?: IntegrationType
  ): Promise<number> {
    try {
      const pattern = integration
        ? `ratelimit:mcp:${userId}:${integration}:*`
        : `ratelimit:mcp:${userId}:*`;

      let deleted = 0;
      let cursor = '0';
      
      // Use Redis client directly for SCAN
      const client = redisService['client' as keyof typeof redisService] as any;
      
      if (!client || typeof client.scan !== 'function') {
        // Fallback to simple deletion if scan not available
        const keys = await client.keys(pattern);
        for (const key of keys) {
          try {
            await redisService.del(key);
            deleted++;
          } catch {
            // Continue on error
          }
        }
        return deleted;
      }
      
      // Use SCAN instead of KEYS to avoid blocking Redis
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor.toString();
        const keys = result.keys;
        
        if (keys.length > 0) {
          // Delete keys in batch
          const deletePromises = keys.map(async (key: string) => {
            try {
              await redisService.del(key);
              return 1;
            } catch {
              return 0;
            }
          });
          
          const results = await Promise.all(deletePromises);
          deleted += results.reduce((sum: number, result: number) => sum + result, 0);
        }
      } while (cursor !== '0');

      loggingService.info('Rate limits reset', {
        userId,
        integration,
        pattern,
        deleted,
      });

      return deleted;
    } catch (error) {
      loggingService.error('Failed to reset rate limit', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
      });
      return 0;
    }
  }

  /**
   * Get rate limit status
   */
  static async getRateLimitStatus(
    userId: string,
    integration: IntegrationType,
    httpMethod: HttpMethod
  ): Promise<{
    current: number;
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    try {
      const config = this.DEFAULT_LIMITS[httpMethod];
      const key = `ratelimit:mcp:${userId}:${integration}:${httpMethod}`;

      const current = parseInt(await redisService.get(key) || '0');
      const ttl = await redisService.getTTL(key);
      const resetAt = new Date(Date.now() + (ttl > 0 ? ttl * 1000 : config.windowSeconds * 1000));

      return {
        current,
        limit: config.requests,
        remaining: Math.max(0, config.requests - current),
        resetAt,
      };
    } catch (error) {
      const config = this.DEFAULT_LIMITS[httpMethod];
      return {
        current: 0,
        limit: config.requests,
        remaining: config.requests,
        resetAt: new Date(Date.now() + config.windowSeconds * 1000),
      };
    }
  }
}
