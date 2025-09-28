import { shutdownTelemetry } from './observability/otel';
import express, { Application, Request, Response } from 'express';
import { cacheMiddleware } from './middleware/cache.middleware';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { EventEmitter } from 'events';
import * as Sentry from '@sentry/node';
import { flushSentry, closeSentry, isSentryEnabled, getSentryConfig } from './config/sentry';

// Increase EventEmitter limit globally to prevent memory leak warnings
EventEmitter.defaultMaxListeners = 25;
import { config } from './config';
import { connectDatabase } from './config/database';
import { errorHandler, notFoundHandler, securityLogger } from './middleware/error.middleware';
import { sanitizeInput } from './middleware/validation.middleware';
import { traceInterceptor } from './middleware/trace.middleware';
import {
    trackApiRequests,
    trackAuthEvents,
    trackAnalyticsEvents,
    trackProjectEvents,
    trackUserSession,
    trackOptimizationEvents
} from './middleware/mixpanel.middleware';
import { stream } from './utils/logger';
import { apiRouter } from './routes';
import { intelligenceService } from './services/intelligence.service';
import { initializeCronJobs } from './utils/cronJobs';
import cookieParser from 'cookie-parser';
import { agentService } from './services/agent.service';
import { redisService } from './services/redis.service';
import { otelBaggageMiddleware } from './middleware/otelBaggage';
import { requestMetricsMiddleware } from './middleware/requestMetrics';
import { TelemetryService } from './services/telemetry.service';
import { loggingService } from './services/logging.service';
import { loggerMiddleware } from './middleware/logger.middleware';
import { sentryContextMiddleware, sentryPerformanceMiddleware, sentryBusinessErrorMiddleware } from './middleware/sentry.middleware';

// Create Express app
const app: Application = express();

// Trust proxy
app.set('trust proxy', 1);

// Memory optimization settings
if (process.env.NODE_ENV === 'production') {
    // Force garbage collection more frequently
    if (global.gc && typeof global.gc === 'function') {
        setInterval(() => {
            if (global.gc) {
                global.gc();
            }
        }, 30000); // Every 30 seconds
    }
}

// Enhanced security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Security logging middleware
app.use(securityLogger);

// CORS
app.use(cors(config.cors));

// Body parsing with stricter limits to prevent memory issues
app.use(express.json({ 
    limit: '100mb', // Reduced from 10mb to prevent memory issues
    verify: (_req: Request, res: Response, buf: Buffer) => {
        // Stream large requests to prevent memory buildup
        if (buf.length > 1024 * 1024 * 100) { // 100MB
            res.status(413).json({ error: 'Request too large' });
            return;
        }
    }
}));
app.use(express.urlencoded({ 
    extended: true, 
    limit: '100mb', // Reduced from 10mb
    parameterLimit: 100 // Limit number of parameters
}));

// Cookie parsing
app.use(cookieParser());

// Compression
app.use(compression());

// Custom logging middleware to filter health checks
const customLogger = morgan('combined', {
    stream,
    skip: (req: Request, res: Response) => {
        // Skip logging for health checks from ELB
        const isHealthCheck = req.path === '/' &&
            req.method === 'GET' &&
            req.get('User-Agent')?.includes('ELB-HealthChecker');

        // Skip logging for successful requests from health checkers
        if (isHealthCheck && res.statusCode < 400) {
            return true;
        }

        return false;
    }
});

// Apply custom logging
app.use(customLogger);

// Logger middleware - apply early to capture all requests with UUID tracking
app.use(loggerMiddleware);

// OpenTelemetry middleware - apply early to capture all requests
app.use(otelBaggageMiddleware);
app.use(requestMetricsMiddleware);

// Sentry performance monitoring - apply early for transaction tracking
app.use(sentryPerformanceMiddleware);

// Sanitize input
app.use(sanitizeInput);

// Mixpanel tracking middleware
app.use(trackApiRequests);
app.use(trackAuthEvents);
app.use(trackAnalyticsEvents);
app.use(trackProjectEvents);
app.use(trackUserSession);
app.use(trackOptimizationEvents);

// Trace interceptor middleware
app.use(traceInterceptor);

// Sentry context middleware - capture user and request context
app.use(sentryContextMiddleware);

// API routes
app.use('/api', apiRouter);

// Apply cache middleware AFTER API routes to exclude them from caching
app.use(cacheMiddleware);

// Health check route with minimal logging
app.get('/', async (req, res) => {
    const isHealthCheck = req.get('User-Agent')?.includes('ELB-HealthChecker');

    if (!isHealthCheck) {
        loggingService.info('Health check accessed', {
            component: 'Server',
            operation: 'healthCheck',
            type: 'health_check',
            step: 'health_check_accessed',
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
    }

    // Check Sentry health
    const sentryHealth = await checkSentryHealth();

    res.json({
        success: true,
        message: 'Cost Katana Backend API',
        version: '1.0.0',
        docs: '/api-docs',
        timestamp: new Date().toISOString(),
        services: {
            sentry: sentryHealth
        }
    });
});

// Health check route specifically for load balancers
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Sentry status endpoint for monitoring
app.get('/sentry-status', async (_req, res) => {
    try {
        const sentryHealth = await checkSentryHealth();
        const sentryConfig = getSentryConfig();

        res.json({
            service: 'sentry',
            status: sentryHealth.enabled ? 'operational' : 'disabled',
            configured: sentryHealth.configured,
            environment: sentryHealth.environment,
            release: sentryHealth.release,
            sampleRate: sentryConfig.sampleRate,
            tracesSampleRate: sentryConfig.tracesSampleRate,
            profilesSampleRate: sentryConfig.profilesSampleRate,
            enablePerformanceMonitoring: sentryConfig.enablePerformanceMonitoring,
            enableProfiling: sentryConfig.enableProfiling,
            timestamp: new Date().toISOString(),
            ...(sentryHealth.lastError && { lastError: sentryHealth.lastError })
        });
    } catch (error) {
        res.status(500).json({
            service: 'sentry',
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

// Security monitoring dashboard (protected endpoint)
app.get('/security-dashboard', (req, res): any => {
    // Simple IP-based protection for security dashboard
    const allowedIPs = ['*'];
    const clientIP = req.ip || 'unknown';

    // For production, you should implement proper authentication
    if (process.env.NODE_ENV === 'production') {
        // In production, require authentication or IP whitelisting
        const isInternalIP = allowedIPs.some(range => {
            if (range.includes('/')) {
                // CIDR notation check would go here
                return false;
            }
            return clientIP === range;
        });

        if (!isInternalIP) {
            return res.status(403).json({ error: 'Access denied' });
        }
    }

    res.json({
        success: true,
        data: {},
        timestamp: new Date().toISOString()
    });
});

// Sentry business error middleware - capture business logic errors
app.use(sentryBusinessErrorMiddleware);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Sentry error handler - must be added after all other error middleware
app.use(Sentry.expressErrorHandler());

const PORT = process.env.PORT || 8000;

/**
 * Check Sentry health status
 */
async function checkSentryHealth(): Promise<{
    enabled: boolean;
    configured: boolean;
    environment?: string;
    release?: string;
    lastError?: string;
}> {
    try {
        const enabled = isSentryEnabled();
        const sentryConfig = getSentryConfig();

        if (!enabled) {
            return {
                enabled: false,
                configured: !!sentryConfig.dsn,
                environment: sentryConfig.environment,
                release: sentryConfig.release
            };
        }

        // Test Sentry by sending a test event (but don't actually send it)
        // We'll just check if the client is properly configured
        const client = Sentry.getClient();
        const isHealthy = !!client && !!client.getDsn();

        return {
            enabled: true,
            configured: true,
            environment: sentryConfig.environment,
            release: sentryConfig.release
        };
    } catch (error) {
        return {
            enabled: false,
            configured: false,
            lastError: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

export const startServer = async () => {
    try {
        // Use existing loggingService which now integrates BasicLoggerService internally
        loggingService.info('=== SERVER STARTUP INITIATED ===', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'started'
        });

        loggingService.info('Step 1: Connecting to MongoDB database', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'connect_database'
        });

        await connectDatabase();
        loggingService.info('✅ MongoDB connected successfully', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'database_connected'
        });

        // Start background telemetry enrichment
        try {
            loggingService.info('Step 2: Starting background telemetry enrichment', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'start_telemetry'
            });

            TelemetryService.startBackgroundEnrichment();
            loggingService.info('✅ Background telemetry enrichment started', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'telemetry_started'
            });
        } catch (error) {
            loggingService.warn('⚠️ Background telemetry enrichment failed', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'telemetry_failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
        }

        // Initialize Redis
        try {
            loggingService.info('Step 3: Connecting to Redis', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'connect_redis'
            });

            await redisService.connect();
            loggingService.info('✅ Redis connected successfully', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'redis_connected'
            });
        } catch (error) {
            loggingService.warn('⚠️ Redis connection failed, using in-memory cache as fallback', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'redis_failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
        }

        // Initialize default tips
        loggingService.info('Step 4: Initializing default intelligence tips', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'init_tips'
        });

        if (process.env.NODE_ENV !== 'test') {
            await intelligenceService.initializeDefaultTips();
        }
        
        // Initialize AIOps Agent
        try {
            loggingService.info('Step 5: Initializing AIOps Agent', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'init_agent'
            });

            await agentService.initialize();
            loggingService.info('🤖 AIOps Agent initialized successfully', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'agent_initialized'
            });
        } catch (error) {
            loggingService.warn('⚠️ AIOps Agent initialization failed, will initialize on first request', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'agent_failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
        }
        
        // Initialize Webhook Delivery Service
        try {
            loggingService.info('Step 6: Initializing webhook delivery service', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'init_webhook'
            });

            const { webhookDeliveryService } = await import('./services/webhookDelivery.service');
            loggingService.info('🪝 Webhook delivery service initialized successfully', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'webhook_initialized'
            });
            
            // Process pending deliveries with increased delay and retry mechanism
            const retryProcessingWithBackoff = async (attempt = 1, maxAttempts = 3) => {
                try {
                    // Increasing delay with each attempt
                    const delayMs = attempt * 5000;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    
                    loggingService.info('🪝 Attempting to process pending webhook deliveries', {
                        component: 'Server',
                        operation: 'startServer',
                        type: 'server_startup',
                        step: 'process_webhooks',
                        attempt,
                        maxAttempts
                    });

                    await webhookDeliveryService.processPendingDeliveries();
                    loggingService.info('🪝 Successfully processed pending webhook deliveries', {
                        component: 'Server',
                        operation: 'startServer',
                        type: 'server_startup',
                        step: 'webhooks_processed'
                    });
                } catch (err) {
                    loggingService.warn('⚠️ Error processing pending webhook deliveries', {
                        component: 'Server',
                        operation: 'startServer',
                        type: 'server_startup',
                        step: 'webhook_error',
                        attempt,
                        maxAttempts,
                        error: err instanceof Error ? err.message : 'Unknown error',
                        stack: err instanceof Error ? err.stack : undefined
                    });
                    
                    // Retry with backoff if not reached max attempts
                    if (attempt < maxAttempts) {
                        loggingService.info('🪝 Will retry processing pending webhook deliveries', {
                            component: 'Server',
                            operation: 'startServer',
                            type: 'server_startup',
                            step: 'webhook_retry',
                            nextAttempt: attempt + 1,
                            delaySeconds: (attempt + 1) * 5
                        });
                        retryProcessingWithBackoff(attempt + 1, maxAttempts);
                    }
                }
            };
            
            // Start the retry process
            retryProcessingWithBackoff();
            
        } catch (error) {
            loggingService.warn('⚠️ Webhook delivery service initialization failed', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'webhook_failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
        }
        
        loggingService.info('Step 7: Initializing cron jobs', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'init_cron'
        });

        initializeCronJobs();

        loggingService.info('Step 8: Starting HTTP server', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'start_http_server'
        });

        const server = app.listen(PORT, () => {
            loggingService.info('🚀 AI Cost Optimizer Backend running successfully', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'server_running',
                port: PORT,
                environment: process.env.NODE_ENV,
                databaseStatus: process.env.MONGODB_URI ? 'Connected' : 'Not configured'
            });

            loggingService.info('=== SERVER STARTUP COMPLETED ===', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'completed',
                port: PORT,
                environment: process.env.NODE_ENV
            });
        });

        // Configure server timeouts for MCP compatibility
        server.keepAliveTimeout = 65000; // 65 seconds (longer than client timeouts)
        server.headersTimeout = 66000; // 66 seconds (longer than keepAliveTimeout)
        
        // Enable TCP keep-alive with optimized settings for MCP
        server.on('connection', (socket) => {
            socket.setKeepAlive(true, 60000); // Enable keep-alive with 60s initial delay
            socket.setTimeout(30000); // 30 second socket timeout
            
            // Handle connection errors gracefully
            socket.on('error', (err) => {
                loggingService.warn('Socket error occurred', {
                    component: 'Server',
                    operation: 'startServer',
                    type: 'server_startup',
                    step: 'socket_error',
                    error: err.message
                });
            });
            
            // Handle connection close
            socket.on('close', (hadError) => {
                if (hadError) {
                    loggingService.warn('Socket closed with error', {
                        component: 'Server',
                        operation: 'startServer',
                        type: 'server_startup',
                        step: 'socket_closed_error'
                    });
                }
            });
        });
        
        // Handle server errors gracefully
        server.on('error', (err) => {
            loggingService.error('Server error occurred', {
                component: 'Server',
                operation: 'startServer',
                type: 'server_startup',
                step: 'server_error',
                error: err instanceof Error ? err.message : 'Unknown error',
                stack: err instanceof Error ? err.stack : undefined
            });
        });

    } catch (error) {
        loggingService.error('Failed to start server', {
            component: 'Server',
            operation: 'startServer',
            type: 'server_startup',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    }
};

startServer();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
    loggingService.info('🛑 SIGTERM received, shutting down gracefully', {
        component: 'Server',
        operation: 'shutdown',
        type: 'graceful_shutdown',
        step: 'sigterm_received'
    });
    try {
        const { multiAgentFlowService } = await import('./services/multiAgentFlow.service');
        const { webhookDeliveryService } = await import('./services/webhookDelivery.service');

        // Flush Sentry events first (quick operation)
        await flushSentry(2000);

        // Cleanup services
        await multiAgentFlowService.cleanup();
        await webhookDeliveryService.shutdown();

        // Shutdown telemetry and Sentry
        await shutdownTelemetry();
        await closeSentry(2000);

        process.exit(0);
    } catch (error) {
        loggingService.error('❌ Error during graceful shutdown', {
            component: 'Server',
            operation: 'shutdown',
            type: 'graceful_shutdown',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    loggingService.info('🛑 SIGINT received, shutting down gracefully', {
        component: 'Server',
        operation: 'shutdown',
        type: 'graceful_shutdown',
        step: 'sigint_received'
    });
    try {
        const { multiAgentFlowService } = await import('./services/multiAgentFlow.service');
        const { webhookDeliveryService } = await import('./services/webhookDelivery.service');

        // Flush Sentry events first (quick operation)
        await flushSentry(2000);

        // Cleanup services
        await multiAgentFlowService.cleanup();
        await webhookDeliveryService.shutdown();

        // Shutdown telemetry and Sentry
        await shutdownTelemetry();
        await closeSentry(2000);

        process.exit(0);
    } catch (error) {
        loggingService.error('❌ Error during graceful shutdown', {
            component: 'Server',
            operation: 'shutdown',
            type: 'graceful_shutdown',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    loggingService.error('❌ Uncaught Exception occurred', {
        component: 'Server',
        operation: 'shutdown',
        type: 'uncaught_exception',
        step: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    loggingService.error('❌ Unhandled Rejection occurred', {
        component: 'Server',
        operation: 'shutdown',
        type: 'unhandled_rejection',
        step: 'error',
        reason: reason instanceof Error ? reason.message : 'Unknown reason',
        stack: reason instanceof Error ? reason.stack : undefined,
        promise: promise.toString()
    });
    process.exit(1);
});

export default app;