import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';

@Injectable()
export class SearchAuditMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SearchAuditMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.path.toLowerCase();
    const isSearch =
      path.includes('search') ||
      path.includes('query') ||
      (req.method === 'GET' &&
        (req.query?.q != null || req.query?.query != null));
    if (isSearch) {
      this.logger.debug('Search/query request', {
        path: req.path,
        method: req.method,
        hasQuery: !!req.query?.q || !!req.query?.query,
      });
    }
    next();
  }
}
