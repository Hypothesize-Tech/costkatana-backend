import { Request, Response, NextFunction } from 'express';
import { context, propagation, trace } from '@opentelemetry/api';
import { ulid } from 'ulid';
import { loggingService } from '../services/logging.service';

/**
 * Express middleware to extract and set W3C Baggage context
 * This enables context propagation across distributed systems
 */
export function otelBaggageMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    
    loggingService.info('=== OPENTELEMETRY BAGGAGE MIDDLEWARE STARTED ===', {
        component: 'OTelBaggageMiddleware',
        operation: 'otelBaggageMiddleware',
        type: 'otel_baggage',
        path: req.path,
        method: req.method
    });

    try {
        loggingService.info('Step 1: Extracting context from incoming request headers', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'extract_context'
        });

        // Extract context from incoming request headers (W3C Trace Context)
        const extractedContext = propagation.extract(context.active(), req.headers);
        
        loggingService.info('Context extracted successfully from headers', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'context_extracted',
            hasHeaders: !!req.headers,
            headerCount: Object.keys(req.headers).length
        });

        loggingService.info('Step 2: Generating or extracting request ID', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'generate_request_id'
        });

        // Get or generate request ID
        const requestId = (req.headers['x-request-id'] as string) || 
                         (req.headers['x-amzn-trace-id'] as string) || 
                         ulid();
        
        loggingService.info('Request ID determined', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'request_id_determined',
            requestId,
            source: req.headers['x-request-id'] ? 'x-request-id' : 
                   req.headers['x-amzn-trace-id'] ? 'x-amzn-trace-id' : 'generated'
        });

        loggingService.info('Step 3: Extracting tenant and workspace information', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'extract_tenant_workspace'
        });

        // Extract tenant, workspace, and user information
        const tenantId = req.headers['x-tenant-id'] as string || 
                        (req as any).user?.tenantId || 
                        'default';
        
        const workspaceId = req.headers['x-workspace-id'] as string || 
                           (req as any).user?.workspaceId || 
                           'default';
        
        const userId = req.headers['x-user-id'] as string || 
                      (req as any).user?.id || 
                      (req as any).user?._id?.toString() || 
                      'anonymous';
        
        const tenantRegion = req.headers['x-tenant-region'] as string || 
                            process.env.CK_TELEMETRY_REGION || 
                            'auto';

        loggingService.info('Tenant and workspace information extracted', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'tenant_workspace_extracted',
            tenantId,
            workspaceId,
            userId,
            tenantRegion,
            hasTenantHeader: !!req.headers['x-tenant-id'],
            hasWorkspaceHeader: !!req.headers['x-workspace-id'],
            hasUserIdHeader: !!req.headers['x-user-id'],
            hasRegionHeader: !!req.headers['x-tenant-region']
        });

        loggingService.info('Step 4: Setting up baggage for context propagation', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'setup_baggage'
        });

        // Set baggage for context propagation
        const baggage = propagation.getBaggage(extractedContext) || propagation.createBaggage();
        const updatedBaggage = baggage
            .setEntry('request_id', { value: requestId })
            .setEntry('tenant_id', { value: tenantId })
            .setEntry('workspace_id', { value: workspaceId })
            .setEntry('user_id', { value: userId })
            .setEntry('tenant_region', { value: tenantRegion });

        loggingService.info('Baggage entries configured successfully', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'baggage_configured',
            baggageEntries: ['request_id', 'tenant_id', 'workspace_id', 'user_id', 'tenant_region']
        });

        // Set the updated context with baggage
        const contextWithBaggage = propagation.setBaggage(extractedContext, updatedBaggage);

        loggingService.info('Context with baggage created successfully', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'context_with_baggage_created'
        });

        loggingService.info('Step 5: Running request within context with baggage', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'run_with_context'
        });

        // Run the rest of the request within the context with baggage
        context.with(contextWithBaggage, () => {
            loggingService.info('Step 6: Configuring active span attributes', {
                component: 'OTelBaggageMiddleware',
                operation: 'otelBaggageMiddleware',
                type: 'otel_baggage',
                step: 'configure_span'
            });

            // Get the current span and add attributes
            const span = trace.getActiveSpan();
            if (span) {
                span.setAttributes({
                    'request.id': requestId,
                    'tenant.id': tenantId,
                    'workspace.id': workspaceId,
                    'user.id': userId,
                    'tenant.region': tenantRegion,
                    'http.request.path': req.path,
                    'http.request.method': req.method,
                });

                loggingService.info('Basic span attributes set successfully', {
                    component: 'OTelBaggageMiddleware',
                    operation: 'otelBaggageMiddleware',
                    type: 'otel_baggage',
                    step: 'basic_attributes_set',
                    attributes: ['request.id', 'tenant.id', 'workspace.id', 'user.id', 'tenant.region', 'http.request.path', 'http.request.method']
                });

                // Add user agent if present
                const userAgent = req.headers['user-agent'];
                if (userAgent) {
                    span.setAttribute('http.user_agent', userAgent);
                    loggingService.info('User agent attribute added to span', {
                        component: 'OTelBaggageMiddleware',
                        operation: 'otelBaggageMiddleware',
                        type: 'otel_baggage',
                        step: 'user_agent_attribute_set',
                        hasUserAgent: true
                    });
                } else {
                    loggingService.debug('No user agent header present', {
                        component: 'OTelBaggageMiddleware',
                        operation: 'otelBaggageMiddleware',
                        type: 'otel_baggage',
                        step: 'no_user_agent',
                        hasUserAgent: false
                    });
                }

                // Add API key info if present (without exposing the actual key)
                const apiKey = req.headers['authorization'];
                if (apiKey) {
                    const authType = apiKey.startsWith('Bearer') ? 'bearer' : 'api_key';
                    span.setAttribute('auth.type', authType);
                    span.setAttribute('auth.present', true);
                    
                    loggingService.info('Authentication attributes added to span', {
                        component: 'OTelBaggageMiddleware',
                        operation: 'otelBaggageMiddleware',
                        type: 'otel_baggage',
                        step: 'auth_attributes_set',
                        authType,
                        hasAuth: true
                    });
                } else {
                    loggingService.debug('No authorization header present', {
                        component: 'OTelBaggageMiddleware',
                        operation: 'otelBaggageMiddleware',
                        type: 'otel_baggage',
                        step: 'no_auth_header',
                        hasAuth: false
                    });
                }
            } else {
                loggingService.warn('No active span found for request', {
                    component: 'OTelBaggageMiddleware',
                    operation: 'otelBaggageMiddleware',
                    type: 'otel_baggage',
                    step: 'no_active_span',
                    requestId
                });
            }

            loggingService.info('Step 7: Storing telemetry context in request object', {
                component: 'OTelBaggageMiddleware',
                operation: 'otelBaggageMiddleware',
                type: 'otel_baggage',
                step: 'store_telemetry_context'
            });

            // Store in request for easy access by other middleware/controllers
            (req as any).telemetry = {
                requestId,
                tenantId,
                workspaceId,
                userId,
                tenantRegion,
                span,
            };

            loggingService.info('Telemetry context stored in request object', {
                component: 'OTelBaggageMiddleware',
                operation: 'otelBaggageMiddleware',
                type: 'otel_baggage',
                step: 'telemetry_context_stored',
                hasSpan: !!span
            });

            loggingService.info('Step 8: Setting response headers for tracing', {
                component: 'OTelBaggageMiddleware',
                operation: 'otelBaggageMiddleware',
                type: 'otel_baggage',
                step: 'set_response_headers'
            });

            // Set request ID in response header for tracing
            res.setHeader('X-Request-Id', requestId);

            // Set trace parent header for distributed tracing
            const headers: Record<string, string> = {};
            propagation.inject(context.active(), headers);
            if (headers['traceparent']) {
                res.setHeader('Traceparent', headers['traceparent']);
                loggingService.info('Traceparent header set successfully', {
                    component: 'OTelBaggageMiddleware',
                    operation: 'otelBaggageMiddleware',
                    type: 'otel_baggage',
                    step: 'traceparent_header_set',
                    hasTraceparent: true
                });
            } else {
                loggingService.debug('No traceparent header available', {
                    component: 'OTelBaggageMiddleware',
                    operation: 'otelBaggageMiddleware',
                    type: 'otel_baggage',
                    step: 'no_traceparent',
                    hasTraceparent: false
                });
            }

            loggingService.info('Response headers configured successfully', {
                component: 'OTelBaggageMiddleware',
                operation: 'otelBaggageMiddleware',
                type: 'otel_baggage',
                step: 'response_headers_configured',
                requestIdHeader: 'X-Request-Id',
                traceparentHeader: headers['traceparent'] ? 'Traceparent' : 'none'
            });

            loggingService.info('OpenTelemetry baggage middleware processing completed successfully', {
                component: 'OTelBaggageMiddleware',
                operation: 'otelBaggageMiddleware',
                type: 'otel_baggage',
                step: 'processing_complete',
                totalTime: `${Date.now() - startTime}ms`
            });

            next();
        });

    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'error',
            totalTime: `${Date.now() - startTime}ms`
        });
        
        loggingService.warn('Continuing without baggage due to error', {
            component: 'OTelBaggageMiddleware',
            operation: 'otelBaggageMiddleware',
            type: 'otel_baggage',
            step: 'continue_without_baggage',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Continue without baggage if there's an error
        next();
    }

    loggingService.info('=== OPENTELEMETRY BAGGAGE MIDDLEWARE COMPLETED ===', {
        component: 'OTelBaggageMiddleware',
        operation: 'otelBaggageMiddleware',
        type: 'otel_baggage',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });
}

/**
 * Helper to get telemetry context from request
 */
export function getTelemetryContext(req: Request): {
    requestId: string;
    tenantId: string;
    workspaceId: string;
    userId: string;
    tenantRegion: string;
    span?: any;
} {
    const startTime = Date.now();
    
    loggingService.debug('=== GET TELEMETRY CONTEXT HELPER STARTED ===', {
        component: 'OTelBaggageMiddleware',
        operation: 'getTelemetryContext',
        type: 'telemetry_helper',
        step: 'helper_started'
    });

    const telemetry = (req as any).telemetry;
    
    if (telemetry) {
        loggingService.debug('Telemetry context found in request object', {
            component: 'OTelBaggageMiddleware',
            operation: 'getTelemetryContext',
            type: 'telemetry_helper',
            step: 'context_found',
            hasSpan: !!telemetry.span,
            totalTime: `${Date.now() - startTime}ms`
        });
        
        return telemetry;
    }

    loggingService.debug('No telemetry context found, generating fallback', {
        component: 'OTelBaggageMiddleware',
        operation: 'getTelemetryContext',
        type: 'telemetry_helper',
        step: 'fallback_generated',
        reason: 'middleware_not_run'
    });

    // Fallback if middleware hasn't run
    const fallbackContext = {
        requestId: ulid(),
        tenantId: 'default',
        workspaceId: 'default',
        userId: 'anonymous',
        tenantRegion: 'auto',
    };

    loggingService.debug('Fallback telemetry context generated', {
        component: 'OTelBaggageMiddleware',
        operation: 'getTelemetryContext',
        type: 'telemetry_helper',
        step: 'fallback_created',
        fallbackContext,
        totalTime: `${Date.now() - startTime}ms`
    });

    return fallbackContext;
}
