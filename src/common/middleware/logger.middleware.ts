import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    // Generate unique request ID if not already present
    if (!(req as any).requestId) {
      (req as any).requestId = uuidv4();
    }

    const requestId = (req as any).requestId;
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || 'Unknown';

    this.logger.log('Request initiated', {
      component: 'LoggerMiddleware',
      operation: 'use',
      type: 'request_initiated',
      requestId,
      method,
      url: originalUrl,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    });

    // Log request headers (sanitized)
    this.logger.debug('Request headers', {
      component: 'LoggerMiddleware',
      operation: 'use',
      type: 'request_headers',
      requestId,
      headers: this.sanitizeHeaders(req.headers),
    });

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function (chunk?: any, encoding?: BufferEncoding | (() => void)) {
      const duration = Date.now() - startTime;

      const logger = new Logger('HTTP');
      logger.log('Request completed', {
        component: 'LoggerMiddleware',
        operation: 'response',
        type: 'request_completed',
        requestId,
        method,
        url: originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('Content-Length') || 'unknown',
        timestamp: new Date().toISOString(),
      });

      // Call original end method
      return originalEnd.call(this, chunk, encoding as any);
    };

    next();
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };

    // Remove or mask sensitive headers
    const sensitiveHeaders = [
      'authorization',
      'x-api-key',
      'cookie',
      'x-mfa-token',
      'proxy-authorization',
      'x-forwarded-for',
      'x-real-ip',
    ];

    sensitiveHeaders.forEach((header) => {
      const lowerHeader = header.toLowerCase();
      if (sanitized[lowerHeader]) {
        if (header === 'cookie') {
          sanitized[lowerHeader] = '[REDACTED - COOKIE]';
        } else {
          sanitized[lowerHeader] = '[REDACTED]';
        }
      }
    });

    return sanitized;
  }
}
