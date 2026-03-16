import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestPriorityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const priority = req.get('x-priority') ?? 'normal';
    const valid = ['low', 'normal', 'high', 'critical'].includes(priority);
    (req as Request & { priority: string }).priority = valid
      ? priority
      : 'normal';
    next();
  }
}
