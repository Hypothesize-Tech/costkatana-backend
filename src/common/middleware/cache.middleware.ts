import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { CacheService } from '../cache/cache.service';

interface CacheOptions {
  ttl: number; // Time to live in seconds
  keyGenerator?: (req: Request) => string;
  shouldCache?: (req: Request, res: Response) => boolean;
}

/** Max time to wait for cache lookup before proceeding as cache miss (fail-fast when Redis is slow). */
const CACHE_LOOKUP_TIMEOUT_MS = 2000;

/**
 * HTTP response cache middleware using shared CacheService (Redis with in-memory fallback).
 * When Redis is unavailable, caching degrades gracefully and responses are not cached.
 * Cache lookup is bounded by CACHE_LOOKUP_TIMEOUT_MS to avoid slow requests when Redis is down.
 */
@Injectable()
export class CacheMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CacheMiddleware.name);

  constructor(private readonly cacheService: CacheService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      // Only cache GET requests
      if (req.method !== 'GET') {
        return next();
      }

      // Skip SSE and streaming endpoints (headers/body written incrementally)
      const url = req.originalUrl || req.url || req.path || '';
      if (
        url.includes('comparison-progress') ||
        url.includes('/stream/') ||
        url.includes('/stream') ||
        url.includes('/messages/') ||
        url.includes('/upload-progress/') ||
        url.includes('/key-vault/')
      ) {
        return next();
      }

      // Skip endpoints that must always return fresh data (no server-side caching)
      const noCachePaths = [
        '/vercel/connections', // exact match for GET list, not /connections/:id
        '/github/connections',
        '/github/integrations',
        '/google/connections',
        '/aws/connections',
        '/mcp/mongodb/connections',
        '/webhooks', // webhook list, queue stats, etc. - real-time data
        '/admin/discounts', // discount management - always return fresh data
        // Profile, subscription, usage, analytics — user-specific; must not be Redis-cached
        '/user/profile',
        '/user/stats',
        '/user/subscription',
        '/user/spending',
        '/analytics/recent-usage',
        '/user/activities',
        '/usage',
        '/guardrails/usage',
      ];
      const isNoCache =
        noCachePaths.some((p) => url.includes(p)) &&
        !url.match(/\/connections\/[^/]+/); // exclude /connections/:id for connection lists
      if (isNoCache) {
        return next();
      }

      const options = this.getCacheOptions(req);
      const cacheKey = options.keyGenerator
        ? options.keyGenerator(req)
        : this.generateCacheKey(req);

      this.logger.debug('Cache check initiated', {
        component: 'CacheMiddleware',
        operation: 'use',
        type: 'cache_check',
        requestId,
        method: req.method,
        url: req.originalUrl,
        cacheKey,
        ttl: options.ttl,
      });

      // Try to get cached response with timeout (fail-fast when Redis is slow/unavailable)
      const cachedResponse = await this.getCachedResponseWithTimeout(cacheKey);

      if (cachedResponse) {
        this.logger.log('Cache hit - returning cached response', {
          component: 'CacheMiddleware',
          operation: 'use',
          type: 'cache_hit',
          requestId,
          cacheKey,
          responseSize: cachedResponse.data?.length ?? 0,
          cachedAt: cachedResponse.cachedAt,
          duration: `${Date.now() - startTime}ms`,
        });

        // Set cache headers
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        res.setHeader('X-Cached-At', cachedResponse.cachedAt);

        // Send cached response
        res.status(cachedResponse.statusCode).json(cachedResponse.data);
        return;
      }

      this.logger.log('Cache miss - proceeding to handler', {
        component: 'CacheMiddleware',
        operation: 'use',
        type: 'cache_miss',
        requestId,
        cacheKey,
        duration: `${Date.now() - startTime}ms`,
      });

      // Override res.json to cache the response
      const originalJson = res.json;
      res.json = (body: any) => {
        // Only cache successful responses
        if (
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          (!options.shouldCache || options.shouldCache(req, res))
        ) {
          this.cacheResponse(
            cacheKey,
            {
              data: body,
              statusCode: res.statusCode,
              headers: res.getHeaders(),
              cachedAt: new Date().toISOString(),
            },
            options.ttl,
          ).catch((error) => {
            this.logger.error('Failed to cache response', {
              component: 'CacheMiddleware',
              operation: 'cache_response',
              type: 'cache_error',
              requestId,
              cacheKey,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });

          res.setHeader('X-Cache-Status', 'MISS');
          res.setHeader('X-Cache-Key', cacheKey);
        }

        return originalJson.call(res, body);
      };

      next();
    } catch (error) {
      this.logger.error('Cache middleware error', {
        component: 'CacheMiddleware',
        operation: 'use',
        type: 'cache_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      // Continue without caching on error
      next();
    }
  }

  private getCacheOptions(req: Request): CacheOptions {
    const { originalUrl } = req;

    // Default cache options
    const options: CacheOptions = {
      ttl: 300, // 5 minutes default
    };

    // Analytics and metrics endpoints - longer cache
    if (
      originalUrl.includes('/analytics/') ||
      originalUrl.includes('/metrics/')
    ) {
      options.ttl = 1800; // 30 minutes
    }

    // User profile data - shorter cache
    else if (
      originalUrl.includes('/users/profile') ||
      originalUrl.includes('/users/stats')
    ) {
      options.ttl = 60; // 1 minute
    }

    // Project data - medium cache
    else if (originalUrl.includes('/projects/')) {
      options.ttl = 300; // 5 minutes
    }

    // Cost optimization results - longer cache
    else if (
      originalUrl.includes('/optimization/') ||
      originalUrl.includes('/cost/')
    ) {
      options.ttl = 600; // 10 minutes
    }

    return options;
  }

  private generateCacheKey(req: Request): string {
    const { originalUrl, query, params } = req;
    const user = (req as any).user;

    // Create a hash of the request details
    const keyData = {
      url: originalUrl,
      query: this.sortObject(query),
      params: this.sortObject(params),
      userId: user?.id || user?._id || 'anonymous',
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(keyData))
      .digest('hex');

    return `cache:${hash.substring(0, 16)}`; // Use first 16 chars for readability
  }

  private sortObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const sorted: any = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = obj[key];
      });

    return sorted;
  }

  private async getCachedResponseWithTimeout(cacheKey: string): Promise<any> {
    try {
      const result = await Promise.race([
        this.getCachedResponse(cacheKey),
        new Promise<null>((_, reject) =>
          setTimeout(
            () => reject(new Error('CACHE_LOOKUP_TIMEOUT')),
            CACHE_LOOKUP_TIMEOUT_MS,
          ),
        ),
      ]);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'CACHE_LOOKUP_TIMEOUT') {
        this.logger.debug('Cache lookup timed out, proceeding as miss', {
          component: 'CacheMiddleware',
          operation: 'getCachedResponseWithTimeout',
          cacheKey,
          timeoutMs: CACHE_LOOKUP_TIMEOUT_MS,
        });
      }
      return null;
    }
  }

  private async getCachedResponse(cacheKey: string): Promise<any> {
    try {
      const parsed = await this.cacheService.get<{
        data: any;
        statusCode: number;
        cachedAt: string;
        ttl: number;
      }>(cacheKey);
      if (!parsed) {
        return null;
      }

      // Check if cache entry has expired (TTL is enforced by CacheService; this is a sanity check)
      const cachedAt = new Date(parsed.cachedAt);
      const now = new Date();
      const age = (now.getTime() - cachedAt.getTime()) / 1000; // Age in seconds

      if (age > (parsed.ttl ?? 0)) {
        await this.cacheService.del(cacheKey);
        return null;
      }

      return parsed;
    } catch (error) {
      this.logger.warn('Failed to retrieve cached response', {
        component: 'CacheMiddleware',
        operation: 'getCachedResponse',
        type: 'cache_retrieve_error',
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private async cacheResponse(
    cacheKey: string,
    response: any,
    ttl: number,
  ): Promise<void> {
    try {
      const cacheEntry = {
        ...response,
        ttl,
        cachedAt: new Date().toISOString(),
      };

      await this.cacheService.set(cacheKey, cacheEntry, ttl);

      this.logger.debug('Response cached successfully', {
        component: 'CacheMiddleware',
        operation: 'cacheResponse',
        type: 'cache_success',
        cacheKey,
        ttl,
        responseSize: JSON.stringify(response.data).length,
      });
    } catch (error) {
      this.logger.error('Failed to cache response', {
        component: 'CacheMiddleware',
        operation: 'cacheResponse',
        type: 'cache_error',
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Method to invalidate cache by pattern
  async invalidateCache(pattern: string): Promise<number> {
    try {
      const keyList = await this.cacheService.keys(pattern);
      if (keyList.length === 0) {
        return 0;
      }
      const deleted = await this.cacheService.delMany(keyList);
      this.logger.log('Cache invalidated', {
        component: 'CacheMiddleware',
        operation: 'invalidateCache',
        type: 'cache_invalidation',
        pattern,
        keysDeleted: deleted,
      });
      return deleted;
    } catch (error) {
      this.logger.error('Failed to invalidate cache', {
        component: 'CacheMiddleware',
        operation: 'invalidateCache',
        type: 'cache_invalidation_error',
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}
