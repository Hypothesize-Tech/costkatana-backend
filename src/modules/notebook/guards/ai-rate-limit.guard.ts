import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * AIRateLimitGuard
 *
 * Custom rate limiting guard specifically for AI-powered endpoints.
 * Limits requests to 20 per minute per user to prevent abuse and ensure fair usage.
 */
@Injectable()
export class AIRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AIRateLimitGuard.name);
  private readonly MAX_REQUESTS_PER_MINUTE = 20;
  private readonly WINDOW_MS = 60 * 1000; // 1 minute
  private readonly CACHE_KEY_PREFIX = 'ai_rate_limit:';

  constructor(private readonly cacheService: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = this.getUserId(request);

    if (!userId) {
      // If no user ID, allow the request but log warning
      this.logger.warn('No user ID found in request, allowing request');
      return true;
    }

    const rateLimitInfo = await this.checkRateLimit(userId);

    // Add rate limit headers to response
    const response = context.switchToHttp().getResponse();
    this.setRateLimitHeaders(response, rateLimitInfo);

    if (rateLimitInfo.remaining < 0) {
      // Rate limit exceeded
      throw new HttpException(
        {
          error: 'Too Many Requests',
          message: 'AI request rate limit exceeded. Please try again later.',
          retryAfter: rateLimitInfo.retryAfter,
          limit: rateLimitInfo.limit,
          remaining: 0,
          resetTime: rateLimitInfo.resetTime,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Check if user has exceeded rate limit
   */
  private async checkRateLimit(userId: string): Promise<RateLimitInfo> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${userId}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_MS;

    try {
      // Get current request count for this user
      const userRequests = await this.getUserRequests(cacheKey, windowStart);

      // Count requests in current window
      const currentWindowRequests = userRequests.filter(
        (timestamp) => timestamp >= windowStart,
      ).length;

      // Calculate remaining requests
      const remaining = this.MAX_REQUESTS_PER_MINUTE - currentWindowRequests;

      // Calculate reset time (when the oldest request in current window expires)
      let resetTime = now + this.WINDOW_MS;
      if (userRequests.length > 0) {
        const oldestRequest = Math.min(
          ...userRequests.filter((timestamp) => timestamp >= windowStart),
        );
        if (oldestRequest) {
          resetTime = oldestRequest + this.WINDOW_MS;
        }
      }

      // Calculate retry after time if limit exceeded
      let retryAfter: number | undefined;
      if (remaining < 0) {
        retryAfter = Math.ceil((resetTime - now) / 1000); // seconds
      }

      return {
        limit: this.MAX_REQUESTS_PER_MINUTE,
        remaining: Math.max(0, remaining),
        resetTime,
        retryAfter,
      };
    } catch (error) {
      this.logger.error('Error checking AI rate limit', { error });
      // On error, allow the request but log the issue
      return {
        limit: this.MAX_REQUESTS_PER_MINUTE,
        remaining: this.MAX_REQUESTS_PER_MINUTE - 1, // Allow this request
        resetTime: now + this.WINDOW_MS,
      };
    }
  }

  /**
   * Get user's request timestamps from cache
   */
  private async getUserRequests(
    cacheKey: string,
    windowStart: number,
  ): Promise<number[]> {
    try {
      const cached = await this.cacheService.get<string>(cacheKey);
      let timestamps: number[] = [];

      if (cached) {
        try {
          timestamps = JSON.parse(cached);
          // Filter out timestamps outside current window and clean old entries
          timestamps = timestamps.filter(
            (timestamp) => timestamp >= windowStart,
          );
        } catch (parseError) {
          this.logger.warn(
            'Failed to parse cached rate limit data, resetting',
            {
              error: parseError,
            },
          );
          timestamps = [];
        }
      }

      // Add current request timestamp
      timestamps.push(Date.now());

      // Keep only recent timestamps (within 2x window to handle edge cases)
      const maxAge = this.WINDOW_MS * 2;
      const cutoffTime = Date.now() - maxAge;
      timestamps = timestamps.filter((timestamp) => timestamp >= cutoffTime);

      // Limit array size to prevent memory issues (keep last 100 requests)
      if (timestamps.length > 100) {
        timestamps = timestamps.slice(-100);
      }

      // Update cache with new timestamps
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(timestamps),
        Math.ceil(this.WINDOW_MS / 1000) + 60,
      ); // TTL slightly longer than window

      return timestamps;
    } catch (cacheError) {
      this.logger.error('Cache error in AI rate limiting', {
        error: cacheError,
      });
      // Return empty array to allow request on cache failure
      return [Date.now()];
    }
  }

  /**
   * Extract user ID from request
   */
  private getUserId(request: any): string | null {
    // Try different ways to get user ID
    if (request.user?.id) {
      return request.user.id;
    }

    if (request.user?._id) {
      return request.user._id.toString();
    }

    if (request.user?.userId) {
      return request.user.userId;
    }

    // Check JWT payload
    if (request.user?.sub) {
      return request.user.sub;
    }

    // Check headers for user ID (fallback)
    if (request.headers?.['x-user-id']) {
      return request.headers['x-user-id'];
    }

    return null;
  }

  /**
   * Set rate limit headers on response
   */
  private setRateLimitHeaders(
    response: any,
    rateLimitInfo: RateLimitInfo,
  ): void {
    try {
      response.set({
        'X-RateLimit-Limit': rateLimitInfo.limit.toString(),
        'X-RateLimit-Remaining': rateLimitInfo.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(
          rateLimitInfo.resetTime / 1000,
        ).toString(), // Unix timestamp
        'X-RateLimit-Retry-After': rateLimitInfo.retryAfter?.toString() || '0',
      });
    } catch (error) {
      // Ignore header setting errors
      this.logger.warn('Failed to set rate limit headers', { error });
    }
  }
}
