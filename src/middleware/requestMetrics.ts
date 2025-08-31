import { Request, Response, NextFunction } from 'express';
import { metrics, trace, context, propagation } from '@opentelemetry/api';
import { TelemetryService } from '../services/telemetry.service';
import { loggingService } from '../services/logging.service';

const meter = metrics.getMeter('cost-katana-http', '1.0.0');

// Create metrics
const requestCounter = meter.createCounter('http.server.request.count', {
    description: 'Total number of HTTP requests',
    unit: '1',
});

const requestDuration = meter.createHistogram('http.server.request.duration', {
    description: 'HTTP request duration',
    unit: 'ms',
});

const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
    description: 'Number of active HTTP requests',
    unit: '1',
});

const requestSize = meter.createHistogram('http.server.request.size', {
    description: 'HTTP request body size',
    unit: 'bytes',
});

const responseSize = meter.createHistogram('http.server.response.size', {
    description: 'HTTP response body size',
    unit: 'bytes',
});

/**
 * Middleware to collect HTTP request metrics
 */
export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    
    loggingService.info('=== REQUEST METRICS MIDDLEWARE STARTED ===', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        path: req.path,
        method: req.method,
        protocol: req.protocol
    });

    loggingService.info('Step 1: Initializing request metrics collection', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'init_metrics'
    });
    
    // Get route pattern (will be set by Express after routing)
    let route = 'unknown';
    
    loggingService.info('Route pattern initialized', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'route_init',
        initialRoute: route,
        actualPath: req.path
    });
    
    // Increment active requests
    const labels = {
        method: req.method,
        scheme: req.protocol,
    };
    
    activeRequests.add(1, labels);

    loggingService.info('Active requests counter incremented', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'active_requests_incremented',
        method: req.method,
        scheme: req.protocol,
        labels
    });

    loggingService.info('Step 2: Tracking request size metrics', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'track_request_size'
    });

    // Track request size if body exists
    if (req.body) {
        const size = JSON.stringify(req.body).length;
        requestSize.record(size, { ...labels, route });
        
        loggingService.info('Request size metrics recorded', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'request_size_recorded',
            size,
            hasBody: true,
            route
        });
    } else {
        loggingService.debug('No request body, skipping request size metrics', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'no_request_body',
            hasBody: false
        });
    }

    loggingService.info('Step 3: Setting up response metrics collection', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'setup_response_metrics'
    });

    // Hook into response finish event
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
        const responseStartTime = Date.now();
        
        loggingService.info('Response end intercepted, collecting final metrics', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'response_intercepted',
            responseTime: `${responseStartTime - startTime}ms`
        });
        
        // Get the actual route that was matched
        route = (req as any).route?.path || req.path || 'unknown';
        
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const statusClass = `${Math.floor(statusCode / 100)}xx`;

        loggingService.info('Response details extracted', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'response_details_extracted',
            route,
            duration,
            statusCode,
            statusClass,
            originalPath: req.path,
            matchedRoute: (req as any).route?.path
        });

        const finalLabels = {
            method: req.method,
            route,
            status_code: statusCode.toString(),
            status_class: statusClass,
            scheme: req.protocol,
        };

        loggingService.info('Step 4: Recording final request metrics', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'record_final_metrics'
        });

        // Record metrics
        requestCounter.add(1, finalLabels);
        requestDuration.record(duration, finalLabels);
        activeRequests.add(-1, { method: req.method, scheme: req.protocol });

        loggingService.info('Core metrics recorded successfully', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'core_metrics_recorded',
            requestCount: 1,
            duration,
            activeRequestsDecremented: -1,
            finalLabels
        });

        loggingService.info('Step 5: Tracking response size metrics', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'track_response_size'
        });

        // Track response size
        let respSize = 0;
        if (res.getHeader('content-length')) {
            const size = parseInt(res.getHeader('content-length') as string, 10);
            if (!isNaN(size)) {
                respSize = size;
                responseSize.record(size, finalLabels);
                
                loggingService.info('Response size metrics recorded', {
                    component: 'RequestMetricsMiddleware',
                    operation: 'requestMetricsMiddleware',
                    type: 'request_metrics',
                    step: 'response_size_recorded',
                    size,
                    hasContentLength: true,
                    finalLabels
                });
            } else {
                loggingService.debug('Invalid content-length header, skipping response size metrics', {
                    component: 'RequestMetricsMiddleware',
                    operation: 'requestMetricsMiddleware',
                    type: 'request_metrics',
                    step: 'invalid_content_length',
                    contentLength: res.getHeader('content-length')
                });
            }
        } else {
            loggingService.debug('No content-length header, skipping response size metrics', {
                component: 'RequestMetricsMiddleware',
                operation: 'requestMetricsMiddleware',
                type: 'request_metrics',
                step: 'no_content_length',
                hasContentLength: false
            });
        }

        loggingService.info('Step 6: Collecting telemetry data for storage', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'collect_telemetry_data'
        });

        // Store telemetry data in MongoDB (async, non-blocking)
        const span = trace.getActiveSpan();
        if (span) {
            const spanContext = span.spanContext();
            const activeBaggage = propagation.getBaggage(context.active());
            const baggage: Record<string, string> = {};
            if (activeBaggage) {
                const entries = activeBaggage.getAllEntries();
                entries.forEach(([key, entry]) => {
                    baggage[key] = entry.value;
                });
            }

            loggingService.info('Telemetry data prepared for storage', {
                component: 'RequestMetricsMiddleware',
                operation: 'requestMetricsMiddleware',
                type: 'request_metrics',
                step: 'telemetry_data_prepared',
                hasSpan: true,
                hasBaggage: !!activeBaggage,
                baggageEntries: Object.keys(baggage),
                traceId: spanContext.traceId,
                spanId: spanContext.spanId
            });

            const telemetryData = {
                trace_id: spanContext.traceId,
                span_id: spanContext.spanId,
                parent_span_id: (span as any).parentSpanId,
                tenant_id: baggage.tenant_id || 'default',
                workspace_id: baggage.workspace_id || 'default',
                user_id: baggage.user_id || 'anonymous',
                request_id: baggage.request_id || `http_${Date.now()}`,
                timestamp: new Date(),
                start_time: new Date(startTime),
                end_time: new Date(),
                duration_ms: duration,
                service_name: 'cost-katana-api',
                operation_name: `http.${req.method.toLowerCase()}`,
                span_kind: 'server' as const,
                status: statusCode >= 400 ? 'error' as const : 'success' as const,
                status_message: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
                http_route: route,
                http_method: req.method,
                http_status_code: statusCode,
                http_url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
                http_target: req.originalUrl,
                http_host: req.get('host'),
                http_scheme: req.protocol,
                http_user_agent: req.get('user-agent'),
                net_peer_ip: req.ip || req.socket.remoteAddress,
                attributes: {
                    request_size: JSON.stringify(req.body || {}).length,
                    response_size: respSize,
                    status_class: statusClass
                }
            };

            loggingService.info('Step 7: Storing telemetry data in MongoDB', {
                component: 'RequestMetricsMiddleware',
                operation: 'requestMetricsMiddleware',
                type: 'request_metrics',
                step: 'store_telemetry_data',
                telemetryData: {
                    traceId: telemetryData.trace_id,
                    spanId: telemetryData.span_id,
                    tenantId: telemetryData.tenant_id,
                    workspaceId: telemetryData.workspace_id,
                    userId: telemetryData.user_id,
                    requestId: telemetryData.request_id,
                    duration: telemetryData.duration_ms,
                    status: telemetryData.status,
                    route: telemetryData.http_route,
                    method: telemetryData.http_method,
                    statusCode: telemetryData.http_status_code
                }
            });

            TelemetryService.storeTelemetryData(telemetryData).catch(err => {
                loggingService.logError(err as Error, {
                    component: 'RequestMetricsMiddleware',
                    operation: 'requestMetricsMiddleware',
                    type: 'request_metrics',
                    step: 'telemetry_storage_failed',
                    error: err instanceof Error ? err.message : 'Unknown error'
                });
            });
        } else {
            loggingService.warn('No active span found, skipping telemetry data storage', {
                component: 'RequestMetricsMiddleware',
                operation: 'requestMetricsMiddleware',
                type: 'request_metrics',
                step: 'no_active_span',
                hasSpan: false
            });
        }

        loggingService.info('Response metrics collection completed', {
            component: 'RequestMetricsMiddleware',
            operation: 'requestMetricsMiddleware',
            type: 'request_metrics',
            step: 'response_metrics_complete',
            totalDuration: `${Date.now() - startTime}ms`,
            responseProcessingTime: `${Date.now() - responseStartTime}ms`
        });

        // Call original end
        originalEnd.apply(res, args as any);
    } as any;

    loggingService.info('Response metrics collection setup completed', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'setup_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== REQUEST METRICS MIDDLEWARE COMPLETED ===', {
        component: 'RequestMetricsMiddleware',
        operation: 'requestMetricsMiddleware',
        type: 'request_metrics',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
}

/**
 * Create custom business metrics
 */
export function createBusinessMetrics() {
    const startTime = Date.now();
    
    loggingService.info('=== BUSINESS METRICS CREATION STARTED ===', {
        component: 'RequestMetricsMiddleware',
        operation: 'createBusinessMetrics',
        type: 'business_metrics',
        step: 'creation_started'
    });

    const meter = metrics.getMeter('cost-katana-business', '1.0.0');

    loggingService.info('Business metrics meter created', {
        component: 'RequestMetricsMiddleware',
        operation: 'createBusinessMetrics',
        type: 'business_metrics',
        step: 'meter_created',
        meterName: 'cost-katana-business',
        meterVersion: '1.0.0'
    });

    const businessMetrics = {
        userRegistrations: meter.createCounter('business.user.registrations', {
            description: 'Total number of user registrations',
            unit: '1',
        }),

        projectsCreated: meter.createCounter('business.projects.created', {
            description: 'Total number of projects created',
            unit: '1',
        }),

        optimizationsPerformed: meter.createCounter('business.optimizations.performed', {
            description: 'Total number of optimizations performed',
            unit: '1',
        }),

        costSavings: meter.createHistogram('business.cost.savings', {
            description: 'Cost savings achieved through optimizations',
            unit: 'USD',
        }),

        apiKeysCreated: meter.createCounter('business.api_keys.created', {
            description: 'Total number of API keys created',
            unit: '1',
        }),

        llmRequests: meter.createCounter('business.llm.requests', {
            description: 'Total number of LLM requests processed',
            unit: '1',
        }),

        cacheHits: meter.createCounter('business.cache.hits', {
            description: 'Total number of cache hits',
            unit: '1',
        }),

        cacheMisses: meter.createCounter('business.cache.misses', {
            description: 'Total number of cache misses',
            unit: '1',
        }),
    };

    loggingService.info('Business metrics created successfully', {
        component: 'RequestMetricsMiddleware',
        operation: 'createBusinessMetrics',
        type: 'business_metrics',
        step: 'metrics_created',
        metricsCount: Object.keys(businessMetrics).length,
        metrics: Object.keys(businessMetrics),
        totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== BUSINESS METRICS CREATION COMPLETED ===', {
        component: 'RequestMetricsMiddleware',
        operation: 'createBusinessMetrics',
        type: 'business_metrics',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    return businessMetrics;
}

// Export business metrics instance
export const businessMetrics = createBusinessMetrics();
