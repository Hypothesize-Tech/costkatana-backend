import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Generate unique request ID
    const requestId = uuidv4();
    (request as any).requestId = requestId;

    const startTime = Date.now();
    const { method, originalUrl, ip } = request;
    const userAgent = request.get('User-Agent') || 'Unknown';
    const user = (request as any).user;

    this.logger.log('=== REQUEST START ===', {
      component: 'LoggingInterceptor',
      operation: 'intercept',
      type: 'request_logging',
      requestId,
      method,
      url: originalUrl,
      ip,
      userAgent,
      userId: user?.id || user?._id,
      userEmail: user?.email,
      timestamp: new Date().toISOString(),
    });

    this.logger.log('Request details', {
      component: 'LoggingInterceptor',
      operation: 'intercept',
      type: 'request_logging',
      requestId,
      headers: this.sanitizeHeaders(request.headers),
      query: request.query,
      params: request.params,
      body: this.shouldLogBody(request)
        ? this.sanitizeBody(request.body)
        : '[REDACTED]',
    });

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        this.logger.log('=== REQUEST COMPLETED ===', {
          component: 'LoggingInterceptor',
          operation: 'intercept',
          type: 'request_logging',
          requestId,
          method,
          url: originalUrl,
          statusCode,
          duration: `${duration}ms`,
          userId: user?.id || user?._id,
          responseSize: this.getResponseSize(data),
          timestamp: new Date().toISOString(),
        });

        // Log performance warnings
        if (duration > 5000) {
          this.logger.warn('Slow request detected', {
            component: 'LoggingInterceptor',
            operation: 'intercept',
            type: 'performance_warning',
            requestId,
            method,
            url: originalUrl,
            duration: `${duration}ms`,
            threshold: '5000ms',
          });
        }

        // Log security-relevant successful requests
        if (statusCode >= 400) {
          this.logger.warn('Request completed with error status', {
            component: 'LoggingInterceptor',
            operation: 'intercept',
            type: 'error_response',
            requestId,
            method,
            url: originalUrl,
            statusCode,
            duration: `${duration}ms`,
            userId: user?.id || user?._id,
          });
        }
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        this.logger.error('=== REQUEST FAILED ===', {
          component: 'LoggingInterceptor',
          operation: 'intercept',
          type: 'request_logging',
          requestId,
          method,
          url: originalUrl,
          duration: `${duration}ms`,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
          userId: user?.id || user?._id,
          timestamp: new Date().toISOString(),
        });

        throw error;
      }),
    );
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...(headers ?? {}) };

    // Remove sensitive headers
    const sensitiveHeaders = [
      'authorization',
      'x-api-key',
      'cookie',
      'x-mfa-token',
      'proxy-authorization',
    ];

    sensitiveHeaders.forEach((header) => {
      if (sanitized[header.toLowerCase()]) {
        sanitized[header.toLowerCase()] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  private shouldLogBody(request: Request): boolean {
    const { method, originalUrl } = request;

    // Don't log bodies for sensitive endpoints
    const sensitiveEndpoints = [
      '/auth/login',
      '/auth/register',
      '/users/change-password',
      '/users/reset-password',
    ];

    if (sensitiveEndpoints.some((endpoint) => originalUrl.includes(endpoint))) {
      return false;
    }

    // Only log bodies for POST, PUT, PATCH methods
    return ['POST', 'PUT', 'PATCH'].includes(method);
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sanitized = { ...body };

    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'currentPassword',
      'newPassword',
      'confirmPassword',
      'token',
      'apiKey',
      'secret',
      'mfaToken',
      'creditCard',
      'cvv',
    ];

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  private getResponseSize(data: any): string {
    try {
      if (data === undefined || data === null) {
        return '0B';
      }

      const size = Buffer.byteLength(JSON.stringify(data), 'utf8');

      // Format size in human readable format
      if (size < 1024) {
        return `${size}B`;
      } else if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)}KB`;
      } else {
        return `${(size / (1024 * 1024)).toFixed(1)}MB`;
      }
    } catch (error) {
      return 'unknown';
    }
  }
}
