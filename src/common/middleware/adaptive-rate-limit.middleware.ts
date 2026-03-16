import {
  Injectable,
  NestMiddleware,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  AdaptiveRateLimitService,
  AdaptiveRateLimitConfig,
  RateLimitDecision,
} from '../services/adaptive-rate-limit.service';
import { CacheService } from '../cache/cache.service';
import { LoggingService } from '../services/logging.service';

export interface AdaptiveRateLimitOptions extends Partial<AdaptiveRateLimitConfig> {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message?: string;
  priority?: 'high' | 'medium' | 'low';
  endpoint?: string;
  enableGracefulDegradation?: boolean;
  degradationMode?: 'reduce_features' | 'cache_only' | 'essential_only';
}

/**
 * Enhanced Adaptive Rate Limiting Middleware
 * Provides sophisticated traffic management with system load awareness
 */
@Injectable()
export class AdaptiveRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdaptiveRateLimitMiddleware.name);

  /** Max wait for adaptive rate limit check; if exceeded, allow request (fail open). */
  private static readonly ADAPTIVE_CHECK_TIMEOUT_MS = 2500;

  constructor(
    private readonly adaptiveRateLimitService: AdaptiveRateLimitService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      this.logger.log('=== ADAPTIVE RATE LIMIT MIDDLEWARE STARTED ===', {
        component: 'AdaptiveRateLimitMiddleware',
        operation: 'use',
        type: 'adaptive_rate_limit',
        requestId,
        path: req.path,
        method: req.method,
        priority: 'medium',
        endpoint: req.path,
      });

      const options = this.getRateLimitOptions(req);
      const key = options.keyGenerator
        ? options.keyGenerator(req)
        : this.getDefaultKey(req);

      this.logger.debug('Adaptive rate limit key generated', {
        component: 'AdaptiveRateLimitMiddleware',
        operation: 'use',
        type: 'adaptive_rate_limit_key',
        requestId,
        key,
        endpoint: options.endpoint,
      });

      const decision = await this.checkRateLimitWithTimeout(key, options, req);

      if (decision === 'timeout') {
        this.logger.warn(
          'Adaptive rate limit check timed out, allowing request',
          {
            component: 'AdaptiveRateLimitMiddleware',
            operation: 'use',
            type: 'adaptive_rate_limit_timeout',
            requestId,
            key,
            duration: `${Date.now() - startTime}ms`,
          },
        );
        return next();
      }

      this.setResponseHeaders(res, decision);

      if (!decision.allowed) {
        if (options.enableGracefulDegradation && options.priority !== 'high') {
          const degradationResult = await this.handleGracefulDegradation(
            req,
            res,
            options.degradationMode || 'reduce_features',
          );

          if (degradationResult.handled) {
            this.logger.log('Request handled via graceful degradation', {
              component: 'AdaptiveRateLimitMiddleware',
              key,
              degradationMode: options.degradationMode,
              reason: degradationResult.reason,
              requestId,
            });
            return;
          }
        }

        const retryAfter = decision.retryAfter || 60;

        this.logger.warn('Adaptive rate limit exceeded', {
          component: 'AdaptiveRateLimitMiddleware',
          operation: 'use',
          type: 'adaptive_rate_limit_exceeded',
          requestId,
          key,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          systemLoad: decision.systemLoad,
          trafficPressure: decision.trafficPressure,
          adjustedLimit: decision.adjustedLimit,
          retryAfter,
          reason: decision.reason,
        });

        throw new HttpException(
          {
            error: 'Rate limit exceeded',
            message: options.message,
            retryAfter,
            systemLoad: decision.systemLoad,
            reason: decision.reason,
            adaptiveLimit: decision.adjustedLimit,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.updateUsageCounterWithTimeout(key, decision.adjustedLimit);

      if (options.skipSuccessfulRequests || options.skipFailedRequests) {
        this.setupSkipLogic(
          req,
          res,
          key,
          options.skipSuccessfulRequests,
          options.skipFailedRequests,
        );
      }

      (req as any).systemLoad = {
        load: decision.systemLoad,
        trafficPressure: decision.trafficPressure,
        adaptedLimit: decision.adjustedLimit,
      };

      this.logger.log('Adaptive rate limit check passed', {
        component: 'AdaptiveRateLimitMiddleware',
        operation: 'use',
        type: 'adaptive_rate_limit_passed',
        requestId,
        key,
        remaining: await this.getRemainingRequestsWithTimeout(key, options),
        systemLoad: decision.systemLoad,
        trafficPressure: decision.trafficPressure,
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Adaptive rate limit middleware error', {
        component: 'AdaptiveRateLimitMiddleware',
        operation: 'use',
        type: 'adaptive_rate_limit_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        path: req.path,
        method: req.method,
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    }
  }

  /**
   * Run adaptive rate limit check with a timeout. Returns decision or 'timeout' to fail open.
   */
  private async checkRateLimitWithTimeout(
    key: string,
    options: AdaptiveRateLimitOptions,
    req: Request,
  ): Promise<RateLimitDecision | 'timeout'> {
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(
        () => resolve('timeout'),
        AdaptiveRateLimitMiddleware.ADAPTIVE_CHECK_TIMEOUT_MS,
      );
    });
    const checkPromise = this.adaptiveRateLimitService.checkRateLimit(
      key,
      options,
      {
        userId: (req as any).user?.id,
        endpoint: options.endpoint,
        priority: options.priority,
      },
    );
    return Promise.race([checkPromise, timeoutPromise]);
  }

  private async getRemainingRequestsWithTimeout(
    key: string,
    options: AdaptiveRateLimitOptions,
  ): Promise<number> {
    const timeoutMs = 1500;
    const fallback = options.maxRequests ?? 100;
    const timeoutPromise = new Promise<number>((resolve) =>
      setTimeout(() => resolve(fallback), timeoutMs),
    );
    return Promise.race([
      this.getRemainingRequests(key, options),
      timeoutPromise,
    ]);
  }

  private async updateUsageCounterWithTimeout(
    key: string,
    limit: number,
  ): Promise<void> {
    const timeoutMs = 1500;
    await Promise.race([
      this.updateUsageCounter(key, limit),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private getRateLimitOptions(req: Request): AdaptiveRateLimitOptions {
    const { method, originalUrl } = req;

    let options: AdaptiveRateLimitOptions = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100,
      enableGracefulDegradation: true,
      degradationMode: 'reduce_features',
      priority: 'medium',
    };

    // Stricter limits for auth endpoints
    if (
      originalUrl.includes('/auth/') ||
      originalUrl.includes('/login') ||
      originalUrl.includes('/register')
    ) {
      options = {
        ...options,
        windowMs: 15 * 60 * 1000,
        maxRequests: 10,
      };
    }

    // Stricter limits for password reset
    else if (
      originalUrl.includes('/forgot-password') ||
      originalUrl.includes('/reset-password')
    ) {
      options = {
        ...options,
        windowMs: 60 * 60 * 1000,
        maxRequests: 5,
      };
    }

    // API endpoints
    else if (originalUrl.startsWith('/api/')) {
      if (method === 'GET') {
        options = {
          ...options,
          windowMs: 15 * 60 * 1000,
          maxRequests: 500,
        };
      } else {
        options = {
          ...options,
          windowMs: 15 * 60 * 1000,
          maxRequests: 100,
        };
      }
    }

    return options;
  }

  private getDefaultKey(req: Request): string {
    const user = (req as any).user;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    const identifier = user?.id || user?._id || ip;
    const endpoint = req.originalUrl.split('?')[0];

    return `adaptive_rate_limit:${identifier}:${endpoint}`;
  }

  private setResponseHeaders(res: Response, decision: RateLimitDecision): void {
    res.setHeader('X-RateLimit-Limit', decision.currentLimit.toString());
    res.setHeader(
      'X-RateLimit-Adaptive-Limit',
      decision.adjustedLimit.toString(),
    );
    res.setHeader('X-RateLimit-System-Load', decision.systemLoad.toFixed(2));
    res.setHeader(
      'X-RateLimit-Traffic-Pressure',
      decision.trafficPressure.toFixed(2),
    );
  }

  private async handleGracefulDegradation(
    req: Request,
    res: Response,
    mode: 'reduce_features' | 'cache_only' | 'essential_only',
  ): Promise<{ handled: boolean; reason?: string }> {
    try {
      switch (mode) {
        case 'cache_only':
          const cacheResult = await this.tryServeFromCache(req);
          if (cacheResult.success) {
            res.setHeader('X-Served-From', 'cache-degradation');
            res.setHeader('X-Degradation-Mode', 'cache_only');
            res.json(cacheResult.data);
            return {
              handled: true,
              reason: 'Served from cache during high load',
            };
          }
          break;

        case 'reduce_features':
          (req as any).degradationMode = 'reduce_features';
          (req as any).systemOverload = true;
          res.setHeader('X-Degradation-Mode', 'reduce_features');
          res.setHeader('X-System-Load-Warning', 'true');
          return { handled: false };

        case 'essential_only':
          if (this.isEssentialEndpoint(req.path)) {
            (req as any).degradationMode = 'essential_only';
            res.setHeader('X-Degradation-Mode', 'essential_only');
            return { handled: false };
          }
          break;
      }

      return { handled: false };
    } catch (error) {
      this.logger.warn('Graceful degradation failed', {
        component: 'AdaptiveRateLimitMiddleware',
        mode,
        error: error instanceof Error ? error.message : String(error),
      });
      return { handled: false };
    }
  }

  private async tryServeFromCache(
    req: Request,
  ): Promise<{ success: boolean; data?: any }> {
    try {
      const cacheKey = `degradation_cache:${req.path}:${JSON.stringify(req.query)}`;
      const cachedData = await this.cacheService.get(cacheKey);

      if (cachedData) {
        return { success: true, data: cachedData };
      }

      return { success: false };
    } catch (error) {
      return { success: false };
    }
  }

  private isEssentialEndpoint(path: string): boolean {
    const essentialPaths = [
      '/api/health',
      '/api/status',
      '/api/auth/logout',
      '/api/emergency',
      '/api/system/status',
    ];

    return essentialPaths.some((essential) => path.startsWith(essential));
  }

  private async updateUsageCounter(key: string, limit: number): Promise<void> {
    try {
      const now = Date.now();
      const windowMs = 60000; // 1 minute window

      let record = await this.cacheService.get(key);
      if (!record) {
        record = { count: 0, resetTime: now + windowMs };
      }

      const recordData = record as any;
      const nowTime = Date.now();

      if (recordData.resetTime < nowTime) {
        recordData.count = 0;
        recordData.resetTime = nowTime + windowMs;
      }

      recordData.count++;

      const ttl = Math.ceil((recordData.resetTime - nowTime) / 1000);
      await this.cacheService.set(key, recordData, ttl);
    } catch (error) {
      this.logger.warn('Failed to update usage counter', {
        component: 'AdaptiveRateLimitMiddleware',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getRemainingRequests(
    key: string,
    options: AdaptiveRateLimitOptions,
  ): Promise<number> {
    try {
      const now = Date.now();
      const windowMs = options.windowMs || 900000; // 15 minutes default
      const windowStart = now - windowMs;

      const record = await this.cacheService.get(key);
      if (!record) return options.maxRequests || 100;

      const recordData = record as any;
      const count = recordData.count || 0;
      return Math.max(0, (options.maxRequests || 100) - count);
    } catch (error) {
      return options.maxRequests || 100;
    }
  }

  private setupSkipLogic(
    req: Request,
    res: Response,
    cacheKey: string,
    skipSuccessfulRequests: boolean | undefined,
    skipFailedRequests: boolean | undefined,
  ): void {
    const originalSend = res.send;

    res.send = function (data: any) {
      const handleSkipLogic = async () => {
        try {
          let shouldDecrement = false;

          if (skipSuccessfulRequests && res.statusCode < 400) {
            shouldDecrement = true;
          } else if (skipFailedRequests && res.statusCode >= 400) {
            shouldDecrement = true;
          }

          if (shouldDecrement) {
            const record = await this.cacheService.get(cacheKey);
            if (record) {
              const recordData = record;
              recordData.count = Math.max(0, recordData.count - 1);

              const now = Date.now();
              const ttl = Math.ceil((recordData.resetTime - now) / 1000);
              if (ttl > 0) {
                await this.cacheService.set(cacheKey, recordData, ttl);
              }
            }
          }
        } catch (error) {
          // Non-critical, just log
        }
      };

      handleSkipLogic().catch((error) => {
        this.logger.error('Error in adaptive rate limit skip logic', {
          component: 'AdaptiveRateLimitMiddleware',
          cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return originalSend.call(this, data);
    }.bind(this);
  }

  /**
   * Get adaptive rate limiting statistics
   */
  async getStatistics(): Promise<any> {
    try {
      return await this.adaptiveRateLimitService.getStatistics();
    } catch (error) {
      this.logger.error('Failed to get adaptive rate limit statistics', {
        component: 'AdaptiveRateLimitMiddleware',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
