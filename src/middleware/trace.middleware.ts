import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { traceService } from '../services/trace.service';
import { loggingService } from '../services/logging.service';

declare global {
    namespace Express {
        interface Request {
            traceContext?: {
                sessionId: string;
                traceId: string;
                parentId?: string;
            };
        }
    }
}

export const traceInterceptor = async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    loggingService.info('=== TRACE INTERCEPTOR MIDDLEWARE STARTED ===', {
        component: 'TraceMiddleware',
        operation: 'traceInterceptor',
        type: 'trace_interceptor',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Checking if tracing should be skipped', {
        component: 'TraceMiddleware',
        operation: 'traceInterceptor',
        type: 'trace_interceptor',
        step: 'check_skip_conditions'
    });

    // Skip tracing for health checks and static assets
    if (req.path === '/' || req.path === '/health' || req.path.startsWith('/api/health')) {
        loggingService.info('Tracing skipped for health check endpoint', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'health_check_skipped',
            path: req.path,
            reason: 'health_check_endpoint'
        });
        return next();
    }

    // Skip tracing for trace endpoints themselves to avoid recursion
    if (req.path.includes('/sessions') || req.path.includes('/traces')) {
        loggingService.info('Tracing skipped for trace endpoint to avoid recursion', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'trace_endpoint_skipped',
            path: req.path,
            reason: 'recursion_prevention'
        });
        return next();
    }

    loggingService.info('Step 2: Extracting trace session and parent IDs', {
        component: 'TraceMiddleware',
        operation: 'traceInterceptor',
        type: 'trace_interceptor',
        step: 'extract_trace_ids'
    });

    const sessionId = req.headers['x-session-id'] as string || 
                     req.headers['x-trace-session-id'] as string || 
                     uuidv4();
    const parentId = req.headers['x-parent-trace-id'] as string;

    loggingService.info('Trace IDs extracted successfully', {
        component: 'TraceMiddleware',
        operation: 'traceInterceptor',
        type: 'trace_interceptor',
        step: 'trace_ids_extracted',
        sessionId,
        parentId,
        sessionIdSource: req.headers['x-session-id'] ? 'x-session-id' : 
                        req.headers['x-trace-session-id'] ? 'x-trace-session-id' : 'generated',
        hasParentId: !!parentId
    });

    try {
        loggingService.info('Step 3: Starting root span for HTTP request', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'start_root_span'
        });

        // Start root span for this HTTP request
        const trace = await traceService.startSpan({
            sessionId,
            parentId,
            name: `${req.method} ${req.path}`,
            type: 'http',
            metadata: {
                method: req.method,
                path: req.path,
                query: req.query,
                headers: {
                    'user-agent': req.headers['user-agent'],
                    'content-type': req.headers['content-type']
                },
                ip: req.ip
            }
        });

        loggingService.info('Root span started successfully', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'root_span_started',
            traceId: trace.traceId,
            spanName: `${req.method} ${req.path}`,
            spanType: 'http',
            metadata: {
                method: req.method,
                path: req.path,
                hasQuery: !!req.query,
                hasUserAgent: !!req.headers['user-agent'],
                hasContentType: !!req.headers['content-type'],
                hasIP: !!req.ip
            }
        });

        loggingService.info('Step 4: Attaching trace context to request object', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'attach_trace_context'
        });

        // Attach trace context to request
        req.traceContext = {
            sessionId,
            traceId: trace.traceId,
            parentId
        };

        loggingService.info('Trace context attached to request successfully', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'trace_context_attached',
            traceContext: {
                sessionId: req.traceContext.sessionId,
                traceId: req.traceContext.traceId,
                parentId: req.traceContext.parentId
            }
        });

        loggingService.info('Step 5: Setting up response interception for span ending', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'setup_response_interception'
        });

        // Store original res.json to intercept response
        const originalJson = res.json.bind(res);
        res.json = function(body: any) {
            const responseStartTime = Date.now();
            
            loggingService.info('Response.json intercepted, ending trace span', {
                component: 'TraceMiddleware',
                operation: 'traceInterceptor',
                type: 'trace_interceptor',
                step: 'response_intercepted',
                responseTime: `${responseStartTime - startTime}ms`,
                hasBody: !!body
            });

            // End the span when response is sent
            const endSpan = async () => {
                try {
                    loggingService.info('Step 5a: Ending HTTP trace span', {
                        component: 'TraceMiddleware',
                        operation: 'traceInterceptor',
                        type: 'trace_interceptor',
                        step: 'end_span',
                        traceId: trace.traceId,
                        statusCode: res.statusCode,
                        responseSize: JSON.stringify(body).length
                    });

                    await traceService.endSpan(trace.traceId, {
                        status: res.statusCode >= 400 ? 'error' : 'ok',
                        metadata: {
                            statusCode: res.statusCode,
                            responseSize: JSON.stringify(body).length
                        },
                        error: res.statusCode >= 400 ? {
                            message: body?.error || body?.message || `HTTP ${res.statusCode}`,
                        } : undefined
                    });

                    loggingService.info('Trace span ended successfully', {
                        component: 'TraceMiddleware',
                        operation: 'traceInterceptor',
                        type: 'trace_interceptor',
                        step: 'span_ended',
                        traceId: trace.traceId,
                        status: res.statusCode >= 400 ? 'error' : 'ok',
                        statusCode: res.statusCode,
                        responseSize: JSON.stringify(body).length,
                        hasError: res.statusCode >= 400
                    });
                } catch (error) {
                    loggingService.logError(error as Error, {
                        component: 'TraceMiddleware',
                        operation: 'traceInterceptor',
                        type: 'trace_interceptor',
                        step: 'span_end_error',
                        traceId: trace.traceId,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            };

            // End span asynchronously without blocking response
            endSpan();
            
            loggingService.info('Span ending initiated asynchronously', {
                component: 'TraceMiddleware',
                operation: 'traceInterceptor',
                type: 'trace_interceptor',
                step: 'span_ending_initiated',
                traceId: trace.traceId,
                asyncExecution: true
            });
            
            return originalJson(body);
        };

        loggingService.info('Response interception setup completed successfully', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'response_interception_setup_complete',
            setupTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('Trace interceptor processing completed successfully', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'processing_complete',
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== TRACE INTERCEPTOR MIDDLEWARE COMPLETED ===', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'completed',
            totalTime: `${Date.now() - startTime}ms`
        });

        next();
    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'error',
            totalTime: `${Date.now() - startTime}ms`
        });
        
        loggingService.warn('Continuing without tracing due to error', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'continue_without_tracing',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Continue without tracing if there's an error
        next();
    }
};
