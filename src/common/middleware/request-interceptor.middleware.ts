import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestInterceptorMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    (req as Request & { _requestTime?: number })._requestTime = Date.now();
    next();
  }
}
