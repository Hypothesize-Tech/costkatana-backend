import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { MixpanelTrackingMiddleware } from './common/middleware/mixpanel-tracking.middleware';
import { AiLoggingMiddleware } from './common/middleware/ai-logging.middleware';
import { PricingRegistryService } from './modules/pricing/services/pricing-registry.service';
import { EnterpriseTrafficManagementMiddleware } from './common/middleware/enterprise-traffic-management.middleware';
import { GracefulDegradationMiddleware } from './common/middleware/graceful-degradation.middleware';
import { AgentSandboxMiddleware } from './common/middleware/agent-sandbox.middleware';
import helmet from 'helmet';
import sanitizeHtml from 'sanitize-html';
import * as express from 'express';
import { EventEmitter } from 'events';
import * as net from 'net';
import { flushSentry, closeSentry } from './config/sentry';
import { WebhookDeliveryService } from './modules/webhook/webhook-delivery.service';
import { OpenTelemetryService } from './common/services/opentelemetry.service';
import { FaissVectorService } from './modules/ingestion/services/faiss-vector.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  validateEnv();

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get<number>('port') ?? 8000;
  const cors = configService.get('cors');
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  // CORS first - before any other middleware so OPTIONS preflight is handled correctly
  app.enableCors({
    origin: cors.origin,
    credentials: cors.credentials,
    methods: cors.methods,
    allowedHeaders: cors.allowedHeaders,
    exposedHeaders: cors.exposedHeaders,
    preflightContinue: cors.preflightContinue,
    optionsSuccessStatus: cors.optionsSuccessStatus,
  });

  // Configure EventEmitter for high-throughput scenarios
  EventEmitter.defaultMaxListeners = 25;

  // Trust proxy for load balancer deployments
  (app as any).set('trust proxy', 1);

  // Server timeout configurations for long-running connections (MCP SSE)
  const server = app.getHttpAdapter().getInstance();
  if (server && typeof server.setTimeout === 'function') {
    server.keepAliveTimeout = 65000; // 65 seconds
    server.headersTimeout = 66000; // 66 seconds

    // Handle socket idle timeouts
    server.on('connection', (socket: net.Socket) => {
      socket.setTimeout(300000); // 5 minutes idle timeout
      socket.on('timeout', () => {
        logger.warn('Socket idle timeout, destroying connection');
        socket.destroy();
      });
    });
  }

  // Production garbage collection optimization
  if (isProduction && typeof global.gc === 'function') {
    setInterval(() => {
      global.gc!();
    }, 30000); // Run GC every 30 seconds in production
  }

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      // Allow frontend (different port = different origin) to read API responses
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Input sanitization middleware (only mutate body; query/params are read-only on IncomingMessage)
  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
      }
      next();
    },
  );

  // Global filters, pipes, and interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Observability and feature middleware (bind so middleware keeps `this`)
  const mixpanelMiddleware = new MixpanelTrackingMiddleware(configService);
  app.use(mixpanelMiddleware.use.bind(mixpanelMiddleware));
  const aiLoggingMiddleware = new AiLoggingMiddleware(
    configService,
    app.get(PricingRegistryService),
  );
  app.use(aiLoggingMiddleware.use.bind(aiLoggingMiddleware));
  const enterpriseTrafficMiddleware = new EnterpriseTrafficManagementMiddleware(
    configService,
  );
  app.use(enterpriseTrafficMiddleware.use.bind(enterpriseTrafficMiddleware));
  const gracefulDegradationMiddleware = new GracefulDegradationMiddleware(
    configService,
  );
  app.use(
    gracefulDegradationMiddleware.use.bind(gracefulDegradationMiddleware),
  );
  const agentSandboxMiddleware = new AgentSandboxMiddleware(configService);
  app.use(agentSandboxMiddleware.use.bind(agentSandboxMiddleware));

  await app.listen(port);
  logger.log(`Cost Katana Backend (NestJS) listening on port ${port}`);

  const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds max wait
  let shuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn(`Shutdown already in progress, ignoring ${signal}`);
      return;
    }
    shuttingDown = true;
    logger.log(`Received ${signal}, starting graceful shutdown...`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms`),
          ),
        SHUTDOWN_TIMEOUT_MS,
      );
    });

    try {
      // --- Explicit cleanup before app.close() (order matters) ---

      // 1. Flush telemetry (Sentry + OpenTelemetry) so pending events/spans are sent
      try {
        await flushSentry(2000);
        await closeSentry(2000);
        logger.log('Sentry flushed and closed');
      } catch (e) {
        logger.warn('Sentry flush/close skipped or failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        const otel = app.get(OpenTelemetryService);
        await otel.shutdownTelemetry();
        logger.log('OpenTelemetry telemetry flushed and shut down');
      } catch (e) {
        logger.warn('OpenTelemetry shutdown skipped or failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // 2. Flush pending webhooks and close delivery queue/worker
      try {
        const webhookDelivery = app.get(WebhookDeliveryService);
        await webhookDelivery.shutdown();
        logger.log(
          'Webhook delivery service shut down (pending webhooks handled)',
        );
      } catch (e) {
        logger.warn('Webhook delivery shutdown skipped or failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // 3. Save FAISS indexes to disk
      try {
        const faiss = app.get(FaissVectorService);
        await faiss.shutdown();
        logger.log('FAISS indexes saved to disk');
      } catch (e) {
        logger.warn('FAISS shutdown skipped or failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // 4. app.close() stops HTTP server, closes DB connections, and runs all onModuleDestroy (including MCP)
      await Promise.race([app.close(), timeoutPromise]);
      logger.log(
        'Application closed (HTTP server, database, MCP connections cleaned up)',
      );

      logger.log('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      const errName = error instanceof Error ? error.name : '';
      const isRedisShutdown =
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('Connection is closed') ||
        errMsg.includes('max retries per request') ||
        errMsg.includes('Reached the max retries') ||
        errCode === 'ETIMEDOUT' ||
        errCode === 'ECONNREFUSED' ||
        errName === 'MaxRetriesPerRequestError';

      if (isRedisShutdown) {
        logger.warn(
          'Shutdown completed with Redis cleanup warnings (non-fatal)',
          {
            error: errMsg,
          },
        );
        process.exit(0);
      }

      if (errMsg.includes('Shutdown timed out')) {
        logger.error('Graceful shutdown timed out; forcing exit', {
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        });
        process.exit(1);
      }

      logger.error('Error during graceful shutdown', error);
      process.exit(1);
    }
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    const err = reason instanceof Error ? reason : undefined;
    const msg = err?.message ?? String(reason);
    const code =
      err && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    const name = err?.name ?? '';
    const isRedisRelated =
      (msg &&
        (msg.includes('ETIMEDOUT') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ENOTFOUND') ||
          msg.includes('Connection is closed') ||
          msg.includes('max retries per request') ||
          msg.includes('Reached the max retries'))) ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      name === 'MaxRetriesPerRequestError';

    if (isRedisRelated) {
      logger.warn(
        'Unhandled rejection from Redis (non-fatal); app continues. Fix Redis or run without it.',
        { reason: msg || code || name },
      );
      return;
    }

    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
  });
}

// Helper function to sanitize objects recursively
function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizeHtml(obj, {
      allowedTags: [],
      allowedAttributes: {},
      disallowedTagsMode: 'discard',
    });
  } else if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  } else if (obj !== null && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Application failed to start. This error will cause the process to exit.',
    {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    },
  );
  // Ensure stderr gets the error for ECS/CloudWatch log capture
  console.error('[Cost Katana] Bootstrap failed:', error?.message || error);
  if (error?.stack) console.error(error.stack);
  process.exit(1);
});
