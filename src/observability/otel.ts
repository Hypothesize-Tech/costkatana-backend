import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { 
    ATTR_SERVICE_NAME, 
    ATTR_SERVICE_VERSION,
    SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader, MeterProvider } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { diag, DiagConsoleLogger, DiagLogLevel, metrics } from '@opentelemetry/api';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { logger } from '../utils/logger';

// Enable OpenTelemetry diagnostic logging in development
if (process.env.NODE_ENV !== 'production') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

let sdk: NodeSDK | null = null;
let isInitialized = false;

/**
 * Initialize OpenTelemetry SDK
 */
export async function startTelemetry(): Promise<void> {
    if (isInitialized) {
        logger.info('OpenTelemetry already initialized, skipping...');
        return;
    }

    try {
        const serviceName = process.env.OTEL_SERVICE_NAME || 'cost-katana-api';
        const environment = process.env.NODE_ENV || 'development';
        const version = process.env.npm_package_version || '2.0.0';

        // Create resource with service information
        const resource = Resource.default().merge(
            new Resource({
                [ATTR_SERVICE_NAME]: serviceName,
                [ATTR_SERVICE_VERSION]: version,
                [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
                'service.namespace': 'cost-katana',
                'cloud.provider': process.env.CLOUD_PROVIDER || 'aws',
                'cloud.region': process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION || 'us-east-1',
            })
        );

        // Configure trace exporter
        const traceExporter = new OTLPTraceExporter({
            url: process.env.OTLP_HTTP_TRACES_URL || 'http://localhost:4318/v1/traces',
            headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
                parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) : undefined,
            // Certificate path for TLS if provided
            ...(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE && {
                certificate: process.env.OTEL_EXPORTER_OTLP_CERTIFICATE
            })
        });

        // Configure metrics exporter
        const metricsExporter = new OTLPMetricExporter({
            url: process.env.OTLP_HTTP_METRICS_URL || 'http://localhost:4318/v1/metrics',
            headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
                parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) : undefined,
            ...(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE && {
                certificate: process.env.OTEL_EXPORTER_OTLP_CERTIFICATE
            })
        });

        // Create metric reader
        const metricReader = new PeriodicExportingMetricReader({
            exporter: metricsExporter,
            exportIntervalMillis: 30000, // 30 seconds
        });

        // Configure instrumentations
        const instrumentations = [
            // HTTP instrumentation with custom configuration
            new HttpInstrumentation({
                requestHook: (span, request) => {
                    // Add custom attributes to HTTP spans
                    if (request && typeof request === 'object' && 'headers' in request) {
                        const headers = request.headers as any;
                        if (headers['x-request-id']) {
                            span.setAttribute('http.request.id', headers['x-request-id']);
                        }
                        if (headers['x-tenant-id']) {
                            span.setAttribute('tenant.id', headers['x-tenant-id']);
                        }
                        if (headers['x-workspace-id']) {
                            span.setAttribute('workspace.id', headers['x-workspace-id']);
                        }
                        if (headers['x-user-id']) {
                            span.setAttribute('user.id', headers['x-user-id']);
                        }
                    }
                },
                ignoreIncomingRequestHook: (request) => {
                    // Ignore health check endpoints
                    const url = (request as any).url;
                    return url === '/health' || url === '/metrics' || url === '/';
                }
            }),
            // Express instrumentation
            new ExpressInstrumentation({
                requestHook: (span, info) => {
                    // Add route pattern as span name
                    if (info.route) {
                        span.updateName(`${info.request.method} ${info.route}`);
                    }
                }
            }),
            // MongoDB instrumentation
            new MongoDBInstrumentation({
                enhancedDatabaseReporting: true,
            }),
            // Auto-instrumentations for other libraries
            ...getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': {
                    enabled: false, // Disable fs instrumentation to reduce noise
                },
                '@opentelemetry/instrumentation-dns': {
                    enabled: false, // Disable DNS instrumentation
                },
                '@opentelemetry/instrumentation-net': {
                    enabled: false, // Disable net instrumentation
                },
            })
        ];

        // Create and configure SDK
        sdk = new NodeSDK({
            resource,
            traceExporter,
            instrumentations,
        });

        // Initialize the SDK
        await sdk.start();
        
        isInitialized = true;
        logger.info('🔭 OpenTelemetry initialized successfully', {
            serviceName,
            environment,
            tracesEndpoint: process.env.OTLP_HTTP_TRACES_URL || 'http://localhost:4318/v1/traces',
            metricsEndpoint: process.env.OTLP_HTTP_METRICS_URL || 'http://localhost:4318/v1/metrics',
        });

        // Register global meter provider for custom metrics
        const meterProvider = new MeterProvider({
            resource,
            readers: [metricReader],
        });
        metrics.setGlobalMeterProvider(meterProvider);

        // Register shutdown handlers
        registerShutdownHandlers();

    } catch (error) {
        logger.error('Failed to initialize OpenTelemetry:', error);
        // Don't throw - allow the application to continue without telemetry
    }
}

/**
 * Shutdown OpenTelemetry SDK gracefully
 */
export async function shutdownTelemetry(): Promise<void> {
    if (!sdk || !isInitialized) {
        return;
    }

    try {
        await sdk.shutdown();
        isInitialized = false;
        sdk = null;
        logger.info('OpenTelemetry shutdown successfully');
    } catch (error) {
        logger.error('Error shutting down OpenTelemetry:', error);
    }
}

/**
 * Parse header string into key-value pairs
 */
function parseHeaders(headerString: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const pairs = headerString.split(',');
    
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
            headers[key.trim()] = value.trim();
        }
    }
    
    return headers;
}

/**
 * Register shutdown handlers for graceful shutdown
 */
function registerShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down OpenTelemetry...`);
        await shutdownTelemetry();
    };

    // Note: These are also handled in server.ts, but we register here as backup
    process.once('SIGINT', () => shutdownHandler('SIGINT'));
    process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
}

// Export a function to check if telemetry is initialized
export function isTelemetryInitialized(): boolean {
    return isInitialized;
}
