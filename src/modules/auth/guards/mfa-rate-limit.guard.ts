import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { isRedisEnabled } from '../../../config/redis';
import {
  MFA_RATE_LIMIT_KEY,
  MfaRateLimitOptions,
} from '../decorators/mfa-rate-limit.decorator';

@Injectable()
export class MfaRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(MfaRateLimitGuard.name);
  private redis: Redis | null = null;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    this.initializeRedis();
  }

  private initializeRedis(): void {
    if (!isRedisEnabled()) {
      this.redis = null;
      this.logger.log(
        'Redis disabled - MFA rate limit guard using pass-through',
      );
      return;
    }

    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const redisUrl = this.configService.get<string>('REDIS_URL');

    try {
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          retryStrategy: (times) => Math.min(times * 100, 3000),
          maxRetriesPerRequest: 3,
        });
      } else {
        this.redis = new Redis({
          host,
          port,
          password: password || undefined,
          db: parseInt(this.configService.get<string>('REDIS_DB') || '0', 10),
          retryStrategy: (times) => Math.min(times * 100, 3000),
          maxRetriesPerRequest: 3,
        });
      }

      this.redis.on('error', (err) => {
        this.logger.warn('Redis error in MFA rate limit guard', {
          error: err.message,
        });
      });
    } catch (error) {
      this.logger.warn('Redis initialization failed in MFA rate limit guard', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.redis = null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    try {
      this.logger.log('MFA rate limit check initiated', {
        component: 'MfaRateLimitGuard',
        operation: 'canActivate',
        type: 'mfa_rate_limit',
        path: request.path,
        method: request.method,
        ip: request.ip,
      });

      // Get rate limit options from decorator metadata
      const options = this.reflector.get<MfaRateLimitOptions>(
        MFA_RATE_LIMIT_KEY,
        context.getHandler(),
      );

      if (!options) {
        // No rate limiting configured for this route
        return true;
      }

      const key = this.generateKey(request, options);
      const isAllowed = await this.checkRateLimit(key, options);

      if (!isAllowed) {
        const resetTime = await this.getResetTime(key, options.windowMs);

        this.logger.warn('MFA rate limit exceeded', {
          component: 'MfaRateLimitGuard',
          operation: 'canActivate',
          type: 'mfa_rate_limit_exceeded',
          key,
          path: request.path,
          method: request.method,
          ip: request.ip,
          windowMs: options.windowMs,
          maxRequests: options.max,
          resetTime,
        });

        // Add rate limit headers
        response.setHeader('X-RateLimit-Limit', options.max.toString());
        response.setHeader('X-RateLimit-Remaining', '0');
        response.setHeader('X-RateLimit-Reset', resetTime.toString());
        response.setHeader(
          'Retry-After',
          Math.ceil((resetTime - Date.now()) / 1000).toString(),
        );

        throw new HttpException(
          'Too many MFA requests, please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Add rate limit headers for successful checks
      const remaining = await this.getRemainingRequests(key, options);
      const resetTime = await this.getResetTime(key, options.windowMs);

      response.setHeader('X-RateLimit-Limit', options.max.toString());
      response.setHeader('X-RateLimit-Remaining', remaining.toString());
      response.setHeader('X-RateLimit-Reset', resetTime.toString());

      this.logger.log('MFA rate limit check passed', {
        component: 'MfaRateLimitGuard',
        operation: 'canActivate',
        type: 'mfa_rate_limit_passed',
        key,
        remaining,
        resetTime,
        duration: `${Date.now() - startTime}ms`,
      });

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('MFA rate limit guard error', {
        component: 'MfaRateLimitGuard',
        operation: 'canActivate',
        type: 'mfa_rate_limit_error',
        path: request.path,
        method: request.method,
        ip: request.ip,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      // If Redis is down, allow the request to proceed
      this.logger.warn(
        'Redis unavailable for MFA rate limiting, allowing request to proceed',
        {
          component: 'MfaRateLimitGuard',
          operation: 'canActivate',
          type: 'mfa_rate_limit_fallback',
          path: request.path,
          method: request.method,
          ip: request.ip,
        },
      );

      return true;
    }
  }

  /**
   * Generates a unique Redis key for MFA rate limiting based on the user's IP and request endpoint.
   *
   * Key format: mfa:ratelimit:<ip>:<endpoint>
   *
   * @param request - Express Request object
   * @param options - MfaRateLimitOptions (unused, available for future key customization)
   * @returns A unique Redis key as a string
   */
  private generateKey(request: Request, _options: MfaRateLimitOptions): string {
    // Prefer request.ip, fallback to connection.remoteAddress, else "unknown"
    const ip =
      request.ip ||
      (request.connection &&
      typeof request.connection.remoteAddress === 'string'
        ? request.connection.remoteAddress
        : 'unknown');
    // Remove query parameters from path for endpoint uniqueness
    const endpoint =
      typeof request.path === 'string' ? request.path.split('?')[0] : 'unknown';

    return `mfa:ratelimit:${ip}:${endpoint}`;
  }

  private async checkRateLimit(
    key: string,
    options: MfaRateLimitOptions,
  ): Promise<boolean> {
    if (!this.redis) {
      // Allow request if Redis is unavailable
      return true;
    }

    const now = Date.now();
    const windowStart = now - options.windowMs;

    try {
      // Use Redis sorted set to store request timestamps
      const multi = this.redis.multi();

      // Remove old entries outside the window
      multi.zremrangebyscore(key, 0, windowStart);

      // Add current request timestamp
      multi.zadd(key, now, now.toString());

      // Count requests in current window
      multi.zcount(key, windowStart, now);

      // Set expiry on the key (window + buffer)
      multi.pexpire(key, options.windowMs + 60000); // +1 minute buffer

      const results = await multi.exec();

      if (!results) {
        throw new Error('Redis multi exec failed');
      }

      const requestCount = results[2][1] as number;
      return requestCount <= options.max;
    } catch (error) {
      this.logger.error('Redis MFA rate limit check failed', {
        component: 'MfaRateLimitGuard',
        operation: 'checkRateLimit',
        type: 'redis_error',
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async getRemainingRequests(
    key: string,
    options: MfaRateLimitOptions,
  ): Promise<number> {
    if (!this.redis) {
      return options.max;
    }

    try {
      const now = Date.now();
      const windowStart = now - options.windowMs;
      const count = await this.redis.zcount(key, windowStart, now);
      return Math.max(0, options.max - count);
    } catch (error) {
      return options.max; // Return max if Redis fails
    }
  }

  private async getResetTime(key: string, windowMs: number): Promise<number> {
    if (!this.redis) {
      return Date.now() + windowMs;
    }

    try {
      // Get the oldest timestamp in the current window
      const oldestTimestamp = await this.redis.zrange(key, 0, 0, 'WITHSCORES');

      if (oldestTimestamp && oldestTimestamp.length >= 2) {
        const timestamp = parseInt(oldestTimestamp[1]);
        return timestamp + windowMs;
      }

      // If no entries, reset time is current time + window
      return Date.now() + windowMs;
    } catch (error) {
      return Date.now() + windowMs;
    }
  }
}
