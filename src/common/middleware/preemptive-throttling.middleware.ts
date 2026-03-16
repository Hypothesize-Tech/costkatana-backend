import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';

@Injectable()
export class PreemptiveThrottlingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PreemptiveThrottlingMiddleware.name);
  private requestCount = 0;
  private windowStart = Date.now();
  private readonly maxPerMinute = 300;

  use(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    if (now - this.windowStart > 60_000) {
      this.windowStart = now;
      this.requestCount = 0;
    }
    this.requestCount += 1;
    if (this.requestCount > this.maxPerMinute) {
      this.logger.warn('Preemptive throttle: rate exceeded', {
        path: req.path,
        count: this.requestCount,
      });
      res.status(429).json({ statusCode: 429, message: 'Too many requests' });
      return;
    }
    next();
  }
}
