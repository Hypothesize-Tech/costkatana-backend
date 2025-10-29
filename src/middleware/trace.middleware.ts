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
    if (req.path === '/' || req.path === '/health' || req.path.includes('/health')) {
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

    // Skip static files and common bot/hacker requests
    const staticPaths = [
        '.env',              // Environment files (hackers/bots)
        '.aws',              // AWS credentials (hackers/bots)
        'favicon.ico',       // Browser requests
        'robots.txt',        // SEO bots
        'sitemap.xml',       // SEO bots
        'ads.txt',           // Ad verification
        'app-ads.txt',       // App ad verification
        'sellers.json',      // Ad sellers
        '.well-known',       // Security/cert verification
        '/wp-',              // WordPress attacks
        '/wordpress',        // WordPress attacks
        '/phpmyadmin',       // Database attacks
        '/admin',            // Admin panel attacks
        '/vendor/phpunit',   // PHP unit test attacks
        '/cgi-bin',          // CGI attacks
        '/sites/all',        // Drupal attacks
        'eval-stdin.php',    // PHP eval attacks
        '/database/',        // Database folder attacks
        '/conf/',            // Config folder attacks
        '/audio/',           // Random folder probes
        '/crm/',             // CRM folder probes
        '/local/',           // Local folder probes
        '/old/',             // Old folder probes
        '/new/',             // New folder probes
        '/library/',         // Library folder probes
        '/apps/',            // Apps folder probes
        '/src/',             // Source folder probes
        '/base/',            // Base folder probes
        '/core/',            // Core folder probes
        '/protected/',       // Protected folder probes
        '/www/',             // WWW folder probes
        '/production/',      // Production folder probes
        '/app/config/'       // App config probes
    ];
    if (staticPaths.some(path => req.path.includes(path))) {
        loggingService.info('Tracing skipped for static/bot request', {
            component: 'TraceMiddleware',
            operation: 'traceInterceptor',
            type: 'trace_interceptor',
            step: 'static_bot_request_skipped',
            path: req.path,
            reason: 'static_or_bot_request'
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

    // Check if this is an SDK request from CostKatana users (they can trace everything)
    // vs internal CostKatana backend requests (only trace AI APIs)
    const isSDKRequest = req.headers['x-costkatana-sdk'] ?? req.headers['x-api-key'];
    
    // For internal CostKatana backend requests, only trace AI endpoints
    if (!isSDKRequest) {
        // Explicitly block all health check and non-AI monitoring endpoints
        const blockedPatterns = [
            '/health',
            '/cursor/health',
            '/chatgpt/health', 
            '/telemetry/health',
            '/gateway/health',
            '/cursor/action',  // Cursor IDE telemetry
            '/auth/',
            '/user/',
            '/users/',
            '/settings/',
            '/preferences/',
            '/projects/',
            '/teams/',
            '/billing/',
            '/notifications/',
            '/analytics/',
            '/metrics/',
            '/status',
            '/session-replay/',
            '/ingestion/',
            '/backup/',
            '/email/'
        ];

        // Check if request matches any blocked pattern
        const isBlocked = blockedPatterns.some(pattern => req.path.includes(pattern));
        
        if (isBlocked) {
            loggingService.info('Tracing skipped for blocked endpoint', {
                component: 'TraceMiddleware',
                operation: 'traceInterceptor',
                type: 'trace_interceptor',
                step: 'blocked_endpoint_skipped',
                path: req.path,
                reason: 'blocked_non_ai_endpoint'
            });
            return next();
        }

        // Whitelist: only allow specific AI endpoints that make AI model inference calls
        const allowedAIEndpoints = [
            // Chat endpoints (AWS Bedrock)
            '/api/chat/message',
            '/api/chat/send',
            
            // Agent endpoints (AI reasoning)
            '/api/agent/query',
            '/api/agent/stream',
            '/api/agent/feedback',
            '/api/agent/analyze',
            
            // Experimentation endpoints (Model testing with Bedrock)
            '/api/experimentation/model-comparison',
            '/api/experimentation/real-time-comparison',
            '/api/experimentation/real-time-simulation',
            '/api/experimentation/what-if-scenarios',
            
            // Gateway endpoints (AI routing and evaluation)
            '/api/gateway/models',
            '/api/gateway/evaluate',
            '/api/gateway/proxy',
            '/api/gateway/chat',
            '/api/gateway/completions',
            
            // Onboarding LLM query
            '/api/onboarding/llm-query',
            '/api/onboarding/execute-llm',
            
            // Prompt Template AI generation
            '/api/prompt-templates/generate',
            '/api/prompt-templates/generate-from-intent',
            
            // Notebook AI insights
            '/api/notebooks/ai-insights',
            
            // Pricing model evaluation (Bedrock tests)
            '/api/pricing/evaluate-model',
            '/api/pricing/test-model-performance',
            
            // Intelligence AI analysis
            '/api/intelligence/analyze',
            '/api/intelligence/recommendations',
            
            // Predictive Intelligence AI
            '/api/predictive-intelligence/predict',
            '/api/predictive-intelligence/forecast',
            
            // Any generic Bedrock endpoint
            '/api/bedrock/'
        ];

        const isAllowedAIEndpoint = allowedAIEndpoints.some(endpoint => req.path.includes(endpoint));
        
        if (!isAllowedAIEndpoint) {
            loggingService.info('Tracing skipped for non-whitelisted endpoint', {
                component: 'TraceMiddleware',
                operation: 'traceInterceptor',
                type: 'trace_interceptor',
                step: 'non_whitelisted_endpoint_skipped',
                path: req.path,
                reason: 'not_in_ai_whitelist'
            });
            return next();
        }
    }
    // SDK requests from users: trace everything (AI + non-AI)

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

        // Extract userId from authenticated request
        const userId = (req as any).user?.userId ?? (req as any).user?._id?.toString();

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
                ip: req.ip,
                userId: userId  // Include authenticated userId
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
                            message: body?.error ?? body?.message ?? `HTTP ${res.statusCode}`,
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
