import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';
import { Logger } from '@nestjs/common';

@Injectable()
export class CortexResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CortexResponseInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        if (request.cortex?.enabled && !response.headersSent) {
          // Add Cortex metadata to response headers
          response.setHeader('X-Cortex-Optimized', 'true');

          // If the response has metrics, add them
          if (data && data._cortexMetrics) {
            response.setHeader(
              'X-Cortex-Token-Reduction',
              data._cortexMetrics.tokenReduction || '0',
            );
            response.setHeader(
              'X-Cortex-Cost-Savings',
              data._cortexMetrics.costSavings || '0',
            );
            response.setHeader(
              'X-Cortex-Model-Used',
              data._cortexMetrics.modelUsed || 'none',
            );
            response.setHeader(
              'X-Cortex-Cache-Hit',
              data._cortexMetrics.cacheHit || 'false',
            );

            // Remove internal metrics from response body unless debug mode
            if (process.env.NODE_ENV !== 'development') {
              delete data._cortexMetrics;
            }
          }
        }

        return data;
      }),
    );
  }
}
