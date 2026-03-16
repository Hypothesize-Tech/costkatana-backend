import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';

@Injectable()
export class ErrorBoundaryMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ErrorBoundaryMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const onError = (err: unknown): void => {
      this.logger.error('Unhandled error in request pipeline', {
        path: req.path,
        method: req.method,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          statusCode: 500,
          message: 'Internal server error',
        });
      }
    };
    try {
      next();
    } catch (e) {
      onError(e);
    }
  }
}
