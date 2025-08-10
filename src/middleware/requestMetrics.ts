import { Request, Response, NextFunction } from 'express';
import { metrics, trace, context, propagation } from '@opentelemetry/api';
import { TelemetryService } from '../services/telemetry.service';
import { logger } from '../utils/logger';

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
    
    // Get route pattern (will be set by Express after routing)
    let route = 'unknown';
    
    // Increment active requests
    const labels = {
        method: req.method,
        scheme: req.protocol,
    };
    
    activeRequests.add(1, labels);

    // Track request size if body exists
    if (req.body) {
        const size = JSON.stringify(req.body).length;
        requestSize.record(size, { ...labels, route });
    }

    // Hook into response finish event
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
        // Get the actual route that was matched
        route = (req as any).route?.path || req.path || 'unknown';
        
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const statusClass = `${Math.floor(statusCode / 100)}xx`;

        const finalLabels = {
            method: req.method,
            route,
            status_code: statusCode.toString(),
            status_class: statusClass,
            scheme: req.protocol,
        };

        // Record metrics
        requestCounter.add(1, finalLabels);
        requestDuration.record(duration, finalLabels);
        activeRequests.add(-1, { method: req.method, scheme: req.protocol });

        // Track response size
        let respSize = 0;
        if (res.getHeader('content-length')) {
            const size = parseInt(res.getHeader('content-length') as string, 10);
            if (!isNaN(size)) {
                respSize = size;
                responseSize.record(size, finalLabels);
            }
        }

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

            TelemetryService.storeTelemetryData({
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
                span_kind: 'server',
                status: statusCode >= 400 ? 'error' : 'success',
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
            }).catch(err => {
                logger.error('Failed to store HTTP telemetry in MongoDB:', err);
            });
        }

        // Call original end
        originalEnd.apply(res, args as any);
    } as any;

    next();
}

/**
 * Create custom business metrics
 */
export function createBusinessMetrics() {
    const meter = metrics.getMeter('cost-katana-business', '1.0.0');

    return {
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
}

// Export business metrics instance
export const businessMetrics = createBusinessMetrics();
