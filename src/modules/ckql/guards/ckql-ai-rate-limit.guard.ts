import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';

/**
 * CKQL AI rate limit: 30 requests per minute per user (matches Express backend).
 * Applied to POST /ckql/query and POST /ckql/narratives.
 */
@Injectable()
export class CkqlAiRateLimitGuard implements CanActivate {
  private readonly MAX_REQUESTS_PER_MINUTE = 30;
  private readonly WINDOW_MS = 60 * 1000;
  private readonly CACHE_KEY_PREFIX = 'ckql_ai_rate_limit:';

  constructor(private readonly cacheService: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = this.getUserId(request);

    if (!userId) {
      return true;
    }

    const cacheKey = `${this.CACHE_KEY_PREFIX}${userId}`;
    const now = Date.now();

    const record = await this.cacheService.get<{
      count: number;
      resetTime: number;
    }>(cacheKey);

    let count: number;
    let resetTime: number;

    if (!record || record.resetTime < now) {
      count = 1;
      resetTime = now + this.WINDOW_MS;
    } else {
      count = record.count + 1;
      resetTime = record.resetTime;
    }

    const ttlSeconds = Math.ceil((resetTime - now) / 1000);
    await this.cacheService.set(
      cacheKey,
      { count, resetTime },
      Math.max(ttlSeconds, 60),
    );

    const response = context.switchToHttp().getResponse();
    response.setHeader(
      'X-RateLimit-Limit',
      this.MAX_REQUESTS_PER_MINUTE.toString(),
    );
    response.setHeader(
      'X-RateLimit-Remaining',
      Math.max(0, this.MAX_REQUESTS_PER_MINUTE - count).toString(),
    );
    response.setHeader(
      'X-RateLimit-Reset',
      Math.ceil(resetTime / 1000).toString(),
    );

    if (count > this.MAX_REQUESTS_PER_MINUTE) {
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      response.setHeader('Retry-After', retryAfter.toString());
      throw new HttpException(
        {
          success: false,
          error: 'Too many AI queries, please try again later',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getUserId(request: {
    user?: { id?: string; _id?: unknown };
  }): string | null {
    if (request.user?.id) return request.user.id;
    if (request.user?._id) return String(request.user._id);
    return null;
  }
}
