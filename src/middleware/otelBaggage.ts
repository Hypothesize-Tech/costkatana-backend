import { Request, Response, NextFunction } from 'express';
import { context, propagation, trace } from '@opentelemetry/api';
import { ulid } from 'ulid';
import { logger } from '../utils/logger';

/**
 * Express middleware to extract and set W3C Baggage context
 * This enables context propagation across distributed systems
 */
export function otelBaggageMiddleware(req: Request, res: Response, next: NextFunction): void {
    try {
        // Extract context from incoming request headers (W3C Trace Context)
        const extractedContext = propagation.extract(context.active(), req.headers);
        
        // Get or generate request ID
        const requestId = (req.headers['x-request-id'] as string) || 
                         (req.headers['x-amzn-trace-id'] as string) || 
                         ulid();
        
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

        // Set baggage for context propagation
        const baggage = propagation.getBaggage(extractedContext) || propagation.createBaggage();
        const updatedBaggage = baggage
            .setEntry('request_id', { value: requestId })
            .setEntry('tenant_id', { value: tenantId })
            .setEntry('workspace_id', { value: workspaceId })
            .setEntry('user_id', { value: userId })
            .setEntry('tenant_region', { value: tenantRegion });

        // Set the updated context with baggage
        const contextWithBaggage = propagation.setBaggage(extractedContext, updatedBaggage);

        // Run the rest of the request within the context with baggage
        context.with(contextWithBaggage, () => {
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

                // Add user agent if present
                const userAgent = req.headers['user-agent'];
                if (userAgent) {
                    span.setAttribute('http.user_agent', userAgent);
                }

                // Add API key info if present (without exposing the actual key)
                const apiKey = req.headers['authorization'];
                if (apiKey) {
                    span.setAttribute('auth.type', apiKey.startsWith('Bearer') ? 'bearer' : 'api_key');
                    span.setAttribute('auth.present', true);
                }
            }

            // Store in request for easy access by other middleware/controllers
            (req as any).telemetry = {
                requestId,
                tenantId,
                workspaceId,
                userId,
                tenantRegion,
                span,
            };

            // Set request ID in response header for tracing
            res.setHeader('X-Request-Id', requestId);

            // Set trace parent header for distributed tracing
            const headers: Record<string, string> = {};
            propagation.inject(context.active(), headers);
            if (headers['traceparent']) {
                res.setHeader('Traceparent', headers['traceparent']);
            }

            next();
        });
    } catch (error) {
        logger.error('Error in OpenTelemetry baggage middleware:', error);
        // Continue without baggage if there's an error
        next();
    }
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
    const telemetry = (req as any).telemetry;
    
    if (telemetry) {
        return telemetry;
    }

    // Fallback if middleware hasn't run
    return {
        requestId: ulid(),
        tenantId: 'default',
        workspaceId: 'default',
        userId: 'anonymous',
        tenantRegion: 'auto',
    };
}
