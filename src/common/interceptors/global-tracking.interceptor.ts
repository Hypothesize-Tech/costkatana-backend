import * as crypto from 'crypto';
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestTracking } from '../../schemas/misc/request-tracking.schema';

@Injectable()
export class GlobalTrackingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(GlobalTrackingInterceptor.name);

  constructor(
    @InjectModel(RequestTracking.name)
    private readonly requestTrackingModel: Model<RequestTracking>,
  ) {}

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
    const requestId =
      (request as any).requestId ||
      (request.headers['x-request-id'] as string) ||
      crypto.randomUUID();

    // Extract tracking information
    const trackingData = {
      requestId,
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      path: request.path,
      query: request.query,
      headers: this.sanitizeHeaders(request.headers),
      userId: (request as any).user?.id || 'anonymous',
      userAgent: request.headers['user-agent'] || '',
      ip: request.ip || request.connection?.remoteAddress || '',
      contentType: request.headers['content-type'] || '',
      contentLength: request.headers['content-length'] || '',
    };

    // Add tracking headers to response
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('X-Tracking-Timestamp', trackingData.timestamp);

    this.logger.debug('Request tracking initiated', {
      component: 'GlobalTrackingInterceptor',
      operation: 'request_tracking',
      type: 'request_tracking',
      ...trackingData,
    });

    return next.handle().pipe(
      tap((data) => {
        try {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          // Only set header if response not yet sent (avoid ERR_HTTP_HEADERS_SENT)
          if (!response.headersSent) {
            response.setHeader('X-Response-Time', `${duration}ms`);
          }

          // Track response (fire-and-forget to avoid blocking or late work after response sent)
          const responseTracking = {
            requestId,
            statusCode,
            duration,
            responseSize: this.estimateResponseSize(data),
            responseHeaders: response.headersSent
              ? {}
              : this.sanitizeHeaders(response.getHeaders()),
            success: statusCode < 400,
          };

          void this.persistTracking(
            request,
            trackingData,
            statusCode,
            duration,
            responseTracking,
          );
        } catch (err) {
          this.logger.warn(
            'Request tracking tap error (response may already be sent)',
            {
              component: 'GlobalTrackingInterceptor',
              operation: 'request_tracking',
              requestId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }),
    );
  }

  /**
   * Persist tracking data to DB without blocking the response.
   * Runs asynchronously to avoid any risk of setting headers after send.
   */
  private async persistTracking(
    request: Request,
    trackingData: Record<string, any>,
    statusCode: number,
    duration: number,
    responseTracking: {
      responseSize: number;
      responseHeaders: Record<string, string>;
      success: boolean;
    },
  ): Promise<void> {
    try {
      await this.requestTrackingModel.create({
        ...trackingData,
        statusCode,
        responseTime: duration,
        responseSize: responseTracking.responseSize,
        completedAt: new Date(),
        outcome:
          statusCode < 400
            ? 'success'
            : statusCode < 500
              ? 'redirect'
              : 'error',
        endpoint: trackingData.path,
        metadata: {
          systemLoad: (request as any).systemLoad,
          degradationMode: (request as any).degradationMode,
          responseHeaders: responseTracking.responseHeaders,
          success: responseTracking.success,
        },
      });

      this.logger.debug('Request tracking data stored', {
        component: 'GlobalTrackingInterceptor',
        operation: 'request_tracking',
        requestId: trackingData.requestId,
        duration,
        statusCode,
      });
    } catch (error) {
      this.logger.error('Failed to store request tracking data', {
        component: 'GlobalTrackingInterceptor',
        operation: 'request_tracking',
        requestId: trackingData.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private sanitizeHeaders(headers: any): Record<string, string> {
    const sensitiveHeaders = [
      'authorization',
      'x-api-key',
      'cookie',
      'set-cookie',
      'x-auth-token',
      'x-csrf-token',
    ];

    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = Array.isArray(value)
          ? value.join(', ')
          : String(value);
      }
    }

    return sanitized;
  }

  private estimateResponseSize(data: any): number {
    try {
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
