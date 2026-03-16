import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TraceMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      this.logger.debug('Trace context setup initiated', {
        component: 'TraceMiddleware',
        operation: 'use',
        type: 'trace_setup',
        requestId,
        method: req.method,
        url: req.originalUrl,
      });

      // Extract trace context from headers (OpenTelemetry standard)
      const traceId = this.extractTraceId(req);
      const spanId = this.extractSpanId(req);
      const parentSpanId = req.headers['x-b3-parentspanid'] as string;
      const sampled = req.headers['x-b3-sampled'] as string;

      // Set trace context on request
      (req as any).traceContext = {
        traceId,
        spanId,
        parentSpanId,
        sampled: sampled === '1' || sampled === 'true',
        baggage: this.extractBaggage(req),
      };

      // Add trace headers to response
      res.setHeader('x-trace-id', traceId);
      res.setHeader('x-request-id', requestId);

      // Set OpenTelemetry headers for downstream services
      if (traceId) {
        res.setHeader('x-b3-traceid', traceId);
      }
      if (spanId) {
        res.setHeader('x-b3-spanid', spanId);
      }
      if (parentSpanId) {
        res.setHeader('x-b3-parentspanid', parentSpanId);
      }

      this.logger.debug('Trace context setup completed', {
        component: 'TraceMiddleware',
        operation: 'use',
        type: 'trace_setup_completed',
        requestId,
        traceId,
        spanId,
        hasParentSpan: !!parentSpanId,
        sampled: (req as any).traceContext.sampled,
        baggageKeys: Object.keys((req as any).traceContext.baggage || {}),
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      this.logger.error('Trace middleware setup error', {
        component: 'TraceMiddleware',
        operation: 'use',
        type: 'trace_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      // Continue processing even if tracing setup fails
      next();
    }
  }

  private extractTraceId(req: Request): string {
    // Try different header formats
    return (
      (req.headers['x-b3-traceid'] as string) ||
      (req.headers['x-trace-id'] as string) ||
      (req.headers['trace-id'] as string) ||
      this.generateTraceId()
    );
  }

  private extractSpanId(req: Request): string {
    // Try different header formats
    return (
      (req.headers['x-b3-spanid'] as string) ||
      (req.headers['x-span-id'] as string) ||
      this.generateSpanId()
    );
  }

  private extractBaggage(req: Request): Record<string, string> {
    const baggage: Record<string, string> = {};

    // Extract from x-b3-baggage header
    const baggageHeader = req.headers['x-b3-baggage'] as string;
    if (baggageHeader) {
      try {
        // Parse comma-separated key=value pairs
        baggageHeader.split(',').forEach((pair) => {
          const [key, value] = pair.trim().split('=');
          if (key && value) {
            baggage[key] = decodeURIComponent(value);
          }
        });
      } catch (error) {
        this.logger.warn('Failed to parse baggage header', {
          component: 'TraceMiddleware',
          operation: 'extractBaggage',
          type: 'baggage_parse_error',
          baggageHeader,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Extract individual baggage headers
    Object.keys(req.headers).forEach((headerKey) => {
      if (headerKey.startsWith('x-baggage-')) {
        const baggageKey = headerKey.substring('x-baggage-'.length);
        const value = req.headers[headerKey] as string;
        if (value) {
          baggage[baggageKey] = value;
        }
      }
    });

    return baggage;
  }

  private generateTraceId(): string {
    // Generate a 64-bit trace ID (16 hex characters)
    return this.generateRandomHex(16);
  }

  private generateSpanId(): string {
    // Generate a 64-bit span ID (16 hex characters)
    return this.generateRandomHex(16);
  }

  private generateRandomHex(length: number): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}
