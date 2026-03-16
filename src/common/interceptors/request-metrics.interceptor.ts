import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestMetricsInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip for SSE/streaming - do not set headers or tap (avoids ERR_HTTP_HEADERS_SENT)
    const url = request.originalUrl || request.url || request.path || '';
    if (
      url.includes('comparison-progress') ||
      url.includes('/stream/') ||
      url.includes('/stream') ||
      url.includes('/messages/') ||
      url.includes('/upload-progress/')
    ) {
      return next.handle();
    }

    const startTime = Date.now();
    const requestId = (request as any).requestId || 'unknown';
    const userId = (request as any).user?.id || 'anonymous';

    // Track request start
    this.logger.debug('Request started', {
      component: 'RequestMetricsInterceptor',
      operation: 'request_start',
      type: 'request_metrics',
      requestId,
      method: request.method,
      url: request.url,
      path: request.path,
      userId,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      contentLength: request.headers['content-length'],
    });

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Set response headers with metrics (guard against headers already sent)
        if (!response.headersSent) {
          response.setHeader('X-Response-Time', `${duration}ms`);
          response.setHeader('X-Request-ID', requestId);
        }

        // Log metrics
        this.logger.log('Request completed', {
          component: 'RequestMetricsInterceptor',
          operation: 'request_complete',
          type: 'request_metrics',
          requestId,
          method: request.method,
          path: request.path,
          statusCode,
          duration,
          responseSize: this.getResponseSize(data, response),
          userId,
          success: statusCode < 400,
        });

        // Log slow requests
        if (duration > 5000) {
          // 5 seconds
          this.logger.warn('Slow request detected', {
            component: 'RequestMetricsInterceptor',
            operation: 'slow_request',
            type: 'performance_warning',
            requestId,
            method: request.method,
            path: request.path,
            duration,
            statusCode,
            userId,
          });
        }

        // Log error responses
        if (statusCode >= 400) {
          this.logger.warn('Error response', {
            component: 'RequestMetricsInterceptor',
            operation: 'error_response',
            type: 'error_metrics',
            requestId,
            method: request.method,
            path: request.path,
            statusCode,
            duration,
            userId,
          });
        }
      }),
    );
  }

  private getResponseSize(data: any, response: Response): number {
    try {
      // Try to get from response headers first
      const contentLength = response.get('content-length');
      if (contentLength) {
        return parseInt(contentLength, 10);
      }

      // Estimate from data
      if (typeof data === 'string') {
        return Buffer.byteLength(data, 'utf8');
      }

      if (data && typeof data === 'object') {
        return Buffer.byteLength(JSON.stringify(data), 'utf8');
      }

      return 0;
    } catch (error) {
      return 0;
    }
  }
}
