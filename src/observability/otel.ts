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
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { loggingService } from '../services/logging.service';
// import { SelfHealingSpanProcessor } from './selfHealingSpanProcessor'; // Temporarily disabled due to compilation issues

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
    const startTime = Date.now();
    
    loggingService.info('=== OPENTELEMETRY INITIALIZATION STARTED ===', {
        component: 'OpenTelemetry',
        operation: 'startTelemetry',
        type: 'telemetry_initialization',
        step: 'started'
    });

    if (isInitialized) {
        loggingService.info('OpenTelemetry already initialized, skipping...', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'already_initialized',
            totalTime: `${Date.now() - startTime}ms`
        });
        return;
    }

    try {
        loggingService.info('Step 1: Gathering environment configuration', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'gather_config'
        });

        const serviceName = process.env.OTEL_SERVICE_NAME || 'cost-katana-api';
        const environment = process.env.NODE_ENV || 'development';
        const version = process.env.npm_package_version || '2.0.0';

        loggingService.info('Environment configuration gathered', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'config_gathered',
            serviceName,
            environment,
            version,
            cloudProvider: process.env.CLOUD_PROVIDER || 'aws',
            cloudRegion: process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION || 'us-east-1'
        });

        loggingService.info('Step 2: Creating OpenTelemetry resource', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'create_resource'
        });

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

        loggingService.info('OpenTelemetry resource created successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'resource_created',
            serviceName,
            environment,
            version
        });

        loggingService.info('Step 3: Configuring trace exporter', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'configure_trace_exporter'
        });

        // Configure trace exporter with self-healing processor
        let traceExporter;
        const tracesUrl = process.env.OTLP_HTTP_TRACES_URL;
        
        if (tracesUrl && tracesUrl.trim() !== '') {
            traceExporter = new OTLPTraceExporter({
                url: tracesUrl,
                headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
                    parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) : undefined,
                // Certificate path for TLS if provided
                ...(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE && {
                    certificate: process.env.OTEL_EXPORTER_OTLP_CERTIFICATE
                })
            });
        } else {
            // Use console exporter for development when OTLP is disabled
            const { ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
            traceExporter = new ConsoleSpanExporter();
        }

        loggingService.info('Trace exporter configured successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'trace_exporter_configured',
            exporterType: tracesUrl && tracesUrl.trim() !== '' ? 'OTLP' : 'Console',
            tracesEndpoint: tracesUrl || 'console',
            hasCustomHeaders: !!process.env.OTEL_EXPORTER_OTLP_HEADERS,
            hasCertificate: !!process.env.OTEL_EXPORTER_OTLP_CERTIFICATE
        });

        loggingService.info('Step 4: Configuring metrics exporter', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'configure_metrics_exporter'
        });

        // Configure metrics exporter
        let metricsExporter;
        const metricsUrl = process.env.OTLP_HTTP_METRICS_URL;
        
        if (metricsUrl && metricsUrl.trim() !== '') {
            metricsExporter = new OTLPMetricExporter({
                url: metricsUrl,
                headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
                    parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) : undefined,
                ...(process.env.OTEL_EXPORTER_OTLP_CERTIFICATE && {
                    certificate: process.env.OTEL_EXPORTER_OTLP_CERTIFICATE
                })
            });
        } else {
            // Use console exporter for development when OTLP is disabled
            const { ConsoleMetricExporter } = await import('@opentelemetry/sdk-metrics');
            metricsExporter = new ConsoleMetricExporter();
        }

        loggingService.info('Metrics exporter configured successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'metrics_exporter_configured',
            exporterType: metricsUrl && metricsUrl.trim() !== '' ? 'OTLP' : 'Console',
            metricsEndpoint: metricsUrl || 'console'
        });

        loggingService.info('Step 5: Creating metric reader', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'create_metric_reader'
        });

        // Create metric reader
        const metricReader = new PeriodicExportingMetricReader({
            exporter: metricsExporter,
            exportIntervalMillis: 30000, // 30 seconds
        });

        loggingService.info('Metric reader created successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'metric_reader_created',
            exportInterval: '30000ms'
        });

        loggingService.info('Step 6: Configuring instrumentations', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'configure_instrumentations'
        });

        // Configure instrumentations
        const instrumentations = [
            new AwsInstrumentation({
                suppressInternalInstrumentation: true,
            }),
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

                        // Add cost-katana specific attributes
                        if (headers['x-api-key']) {
                            span.setAttribute('costkatana.api_key_present', true);
                        }
                        if (headers['x-model-preference']) {
                            span.setAttribute('costkatana.model_preference', headers['x-model-preference']);
                        }
                        if (headers['x-cost-limit']) {
                            span.setAttribute('costkatana.cost_limit', parseFloat(headers['x-cost-limit']) || 0);
                        }
                    }
                },
                responseHook: (span, response) => {
                    // Add response-specific enrichments
                    if (response && typeof response === 'object' && 'headers' in response) {
                        const headers = response.headers as any;
                        if (headers['x-cache-status']) {
                            span.setAttribute('cache.hit', headers['x-cache-status'] === 'HIT');
                        }
                        if (headers['x-processing-time']) {
                            span.setAttribute('processing.latency_ms', parseFloat(headers['x-processing-time']) || 0);
                        }
                        if (headers['x-cost-incurred']) {
                            span.setAttribute('costkatana.cost.usd', parseFloat(headers['x-cost-incurred']) || 0);
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

        loggingService.info('Instrumentations configured successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'instrumentations_configured',
            totalInstrumentations: instrumentations.length,
            awsInstrumentation: true,
            httpInstrumentation: true,
            expressInstrumentation: true,
            mongoDBInstrumentation: true,
            autoInstrumentations: true
        });

        loggingService.info('Step 7: Creating and configuring SDK', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'create_sdk'
        });

        // Create and configure SDK
        sdk = new NodeSDK({
            resource,
            traceExporter,
            instrumentations,
        });

        loggingService.info('SDK created successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'sdk_created'
        });

        loggingService.info('Step 8: Starting OpenTelemetry SDK', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'start_sdk'
        });

        // Initialize the SDK
        await sdk.start();
        
        isInitialized = true;

        loggingService.info('OpenTelemetry SDK started successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'sdk_started'
        });

        loggingService.info('Step 9: Setting up global meter provider', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'setup_meter_provider'
        });

        // Register global meter provider for custom metrics
        const meterProvider = new MeterProvider({
            resource,
            readers: [metricReader],
        });
        metrics.setGlobalMeterProvider(meterProvider);

        loggingService.info('Global meter provider configured successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'meter_provider_configured'
        });

        loggingService.info('Step 10: Registering shutdown handlers', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'register_shutdown_handlers'
        });

        // Register shutdown handlers
        registerShutdownHandlers();

        loggingService.info('Shutdown handlers registered successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'shutdown_handlers_registered'
        });

        loggingService.info('🔭 OpenTelemetry initialized successfully', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'completed',
            serviceName,
            environment,
            tracesEndpoint: tracesUrl || 'console',
            metricsEndpoint: metricsUrl || 'console',
            tracesExporterType: tracesUrl && tracesUrl.trim() !== '' ? 'OTLP' : 'Console',
            metricsExporterType: metricsUrl && metricsUrl.trim() !== '' ? 'OTLP' : 'Console',
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== OPENTELEMETRY INITIALIZATION COMPLETED ===', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

    } catch (error) {
        loggingService.error('Failed to initialize OpenTelemetry', {
            component: 'OpenTelemetry',
            operation: 'startTelemetry',
            type: 'telemetry_initialization',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            totalTime: `${Date.now() - startTime}ms`
        });
        // Don't throw - allow the application to continue without telemetry
    }
}

/**
 * Shutdown OpenTelemetry SDK gracefully
 */
export async function shutdownTelemetry(): Promise<void> {
    const startTime = Date.now();
    
    loggingService.info('=== OPENTELEMETRY SHUTDOWN STARTED ===', {
        component: 'OpenTelemetry',
        operation: 'shutdownTelemetry',
        type: 'telemetry_shutdown',
        step: 'started'
    });

    if (!sdk || !isInitialized) {
        loggingService.info('OpenTelemetry not initialized, skipping shutdown', {
            component: 'OpenTelemetry',
            operation: 'shutdownTelemetry',
            type: 'telemetry_shutdown',
            step: 'not_initialized',
            totalTime: `${Date.now() - startTime}ms`
        });
        return;
    }

    try {
        loggingService.info('Step 1: Shutting down OpenTelemetry SDK', {
            component: 'OpenTelemetry',
            operation: 'shutdownTelemetry',
            type: 'telemetry_shutdown',
            step: 'shutdown_sdk'
        });

        await sdk.shutdown();
        isInitialized = false;
        sdk = null;

        loggingService.info('OpenTelemetry shutdown successfully', {
            component: 'OpenTelemetry',
            operation: 'shutdownTelemetry',
            type: 'telemetry_shutdown',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== OPENTELEMETRY SHUTDOWN COMPLETED ===', {
            component: 'OpenTelemetry',
            operation: 'shutdownTelemetry',
            type: 'telemetry_shutdown',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

    } catch (error) {
        loggingService.error('Error shutting down OpenTelemetry', {
            component: 'OpenTelemetry',
            operation: 'shutdownTelemetry',
            type: 'telemetry_shutdown',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            totalTime: `${Date.now() - startTime}ms`
        });
    }
}

/**
 * Parse header string into key-value pairs
 */
function parseHeaders(headerString: string): Record<string, string> {
    const startTime = Date.now();
    
    loggingService.debug('=== HEADER PARSING STARTED ===', {
        component: 'OpenTelemetry',
        operation: 'parseHeaders',
        type: 'header_parsing',
        step: 'started',
        headerString
    });

    const headers: Record<string, string> = {};
    const pairs = headerString.split(',');
    
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
            headers[key.trim()] = value.trim();
        }
    }
    
    loggingService.debug('Headers parsed successfully', {
        component: 'OpenTelemetry',
        operation: 'parseHeaders',
        type: 'header_parsing',
        step: 'completed',
        parsedHeaders: Object.keys(headers),
        totalTime: `${Date.now() - startTime}ms`
    });
    
    return headers;
}

/**
 * Register shutdown handlers for graceful shutdown
 */
function registerShutdownHandlers(): void {
    loggingService.info('=== SHUTDOWN HANDLERS REGISTRATION STARTED ===', {
        component: 'OpenTelemetry',
        operation: 'registerShutdownHandlers',
        type: 'shutdown_handlers',
        step: 'started'
    });

    const shutdownHandler = async (signal: string) => {
        loggingService.info(`Received ${signal}, shutting down OpenTelemetry...`, {
            component: 'OpenTelemetry',
            operation: 'shutdownHandler',
            type: 'shutdown_handlers',
            step: 'signal_received',
            signal
        });
        await shutdownTelemetry();
    };

    // Note: These are also handled in server.ts, but we register here as backup
    process.once('SIGINT', () => shutdownHandler('SIGINT'));
    process.once('SIGTERM', () => shutdownHandler('SIGTERM'));

    loggingService.info('Shutdown handlers registered successfully', {
        component: 'OpenTelemetry',
        operation: 'registerShutdownHandlers',
        type: 'shutdown_handlers',
        step: 'completed',
        registeredSignals: ['SIGINT', 'SIGTERM']
    });

    loggingService.info('=== SHUTDOWN HANDLERS REGISTRATION COMPLETED ===', {
        component: 'OpenTelemetry',
        operation: 'registerShutdownHandlers',
        type: 'shutdown_handlers',
        step: 'completed'
    });
}

// Export a function to check if telemetry is initialized
export function isTelemetryInitialized(): boolean {
    return isInitialized;
}
