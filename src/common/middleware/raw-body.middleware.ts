import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RawBodyMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      // Only capture raw body for specific routes that need it
      if (this.shouldCaptureRawBody(req)) {
        this.logger.debug('Raw body capture initiated', {
          component: 'RawBodyMiddleware',
          operation: 'use',
          type: 'raw_body_capture',
          requestId,
          method: req.method,
          url: req.originalUrl,
          contentType: (req.headers ?? {})['content-type'],
        });

        const chunks: Buffer[] = [];

        // Override req.on to capture raw data
        const originalOn = req.on;
        req.on = function (event: string, listener: (...args: any[]) => void) {
          if (event === 'data') {
            // Intercept data chunks
            const originalListener = listener;
            listener = (chunk: Buffer) => {
              chunks.push(chunk);
              originalListener.call(this, chunk);
            };
          } else if (event === 'end') {
            // When request ends, store the raw body
            const originalListener = listener;
            listener = () => {
              const rawBody = Buffer.concat(chunks);
              (req as any).rawBody = rawBody;

              new Logger('RawBodyMiddleware').debug('Raw body captured', {
                component: 'RawBodyMiddleware',
                operation: 'raw_body_captured',
                type: 'raw_body_capture',
                requestId,
                size: rawBody.length,
                duration: `${Date.now() - startTime}ms`,
              });

              originalListener.call(this);
            };
          }

          return originalOn.call(this, event, listener);
        };

        this.logger.debug('Raw body capture setup completed', {
          component: 'RawBodyMiddleware',
          operation: 'use',
          type: 'raw_body_setup',
          requestId,
          duration: `${Date.now() - startTime}ms`,
        });
      } else {
        this.logger.debug(
          'Raw body capture skipped - not required for this route',
          {
            component: 'RawBodyMiddleware',
            operation: 'use',
            type: 'raw_body_skip',
            requestId,
            method: req.method,
            url: req.originalUrl,
          },
        );
      }

      next();
    } catch (error) {
      this.logger.error('Raw body middleware error', {
        component: 'RawBodyMiddleware',
        operation: 'use',
        type: 'raw_body_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      // Continue processing even if raw body capture fails
      next();
    }
  }

  private shouldCaptureRawBody(req: Request): boolean {
    const { method, originalUrl } = req;
    const headers = req.headers ?? {};

    // Webhook endpoints that need raw body for signature verification
    if (
      originalUrl.includes('/webhooks/') ||
      originalUrl.includes('/webhook')
    ) {
      return true;
    }

    // Stripe webhooks specifically
    if (
      originalUrl.includes('/stripe/webhook') ||
      headers['user-agent']?.includes('Stripe')
    ) {
      return true;
    }

    // Payment provider webhooks
    if (
      originalUrl.includes('/payments/webhook') ||
      originalUrl.includes('/billing/webhook')
    ) {
      return true;
    }

    // GitHub webhooks
    if (headers['x-github-event']) {
      return true;
    }

    // Generic webhook detection by headers
    if (
      headers['x-hub-signature'] ||
      headers['x-signature'] ||
      headers['x-webhook-signature']
    ) {
      return true;
    }

    // Content types that might need raw body
    const contentType = headers['content-type']?.toLowerCase();
    if (
      contentType?.includes('application/x-www-form-urlencoded') &&
      method === 'POST'
    ) {
      return true;
    }

    return false;
  }
}
