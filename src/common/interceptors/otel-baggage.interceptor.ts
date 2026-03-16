import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class OtelBaggageInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OtelBaggageInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();

    // Skip for SSE/streaming - do not set headers (avoids ERR_HTTP_HEADERS_SENT)
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

    const requestId =
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-trace-id'] as string) ||
      `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const userId = (request as any).user?.id || 'anonymous';
    const tenantId = request.headers['x-tenant-id'] as string;
    const workspaceId = request.headers['x-workspace-id'] as string;

    // Set baggage headers for downstream services
    if (requestId) {
      response.setHeader('x-request-id', requestId);
    }

    if (tenantId) {
      response.setHeader('x-tenant-id', tenantId);
    }

    if (workspaceId) {
      response.setHeader('x-workspace-id', workspaceId);
    }

    // Add to request for use in services
    (request as any).requestId = requestId;
    (request as any).tenantId = tenantId;
    (request as any).workspaceId = workspaceId;

    this.logger.debug('OpenTelemetry baggage propagated', {
      requestId,
      userId,
      tenantId,
      workspaceId,
      path: request.path,
    });

    return next.handle().pipe(
      tap(() => {
        // Could add response baggage here if needed
      }),
    );
  }
}
