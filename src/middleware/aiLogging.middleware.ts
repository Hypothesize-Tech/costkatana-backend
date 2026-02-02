import { Request, Response, NextFunction } from 'express';
import { aiLogger } from '../services/aiLogger.service';
import { loggingService } from '../services/logging.service';

/**
 * AI Logging Middleware
 * Automatically captures AI-related API endpoint calls
 */

declare global {
    namespace Express {
        interface Request {
            aiLogContext?: {
                startTime: number;
                requestId: string;
                userId?: string;
                projectId?: string;
            };
        }
    }
}

/**
 * Initialize AI logging context for the request
 */
export const initAILogContext = (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.headers['x-request-id'] as string || 
                      req.headers['x-correlation-id'] as string ||
                      `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    req.aiLogContext = {
        startTime: Date.now(),
        requestId,
        userId: (req as any).user?.id || (req as any).userId,
        projectId: (req as any).projectId || req.body?.projectId || req.query?.projectId as string
    };
    
    // Add request ID to response headers for tracing
    res.setHeader('X-Request-ID', requestId);
    
    next();
};

/**
 * Log AI endpoint calls automatically
 * Use this middleware on AI-related routes
 */
// Helper functions for logAIEndpoint
function extractServiceFromPath(path: string): string {
    if (path.includes('bedrock')) return 'aws-bedrock';
    if (path.includes('openai')) return 'openai';
    if (path.includes('anthropic')) return 'anthropic';
    if (path.includes('cortex')) return 'cortex';
    if (path.includes('experimentation')) return 'experimentation';
    return 'api';
}

function extractOperationFromPath(path: string, method: string): string {
    if (path.includes('chat')) return 'chat';
    if (path.includes('completion')) return 'completion';
    if (path.includes('embedding')) return 'embedding';
    if (path.includes('invoke')) return 'invokeModel';
    if (path.includes('optimize')) return 'optimize';
    if (path.includes('experiment')) return 'experiment';
    return method.toLowerCase();
}

function categorizeError(statusCode: number): string {
    if (statusCode === 401 || statusCode === 403) return 'auth_error';
    if (statusCode === 429) return 'rate_limit';
    if (statusCode === 408 || statusCode === 504) return 'timeout';
    if (statusCode >= 400 && statusCode < 500) return 'client_error';
    if (statusCode >= 500) return 'server_error';
    return 'unknown';
}

export const logAIEndpoint = (options: {
    service?: string;
    operation?: string;
    extractModel?: (req: Request) => string;
    extractTokens?: (req: Request, res: Response) => { input: number; output: number };
} = {}) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        const context = req.aiLogContext || {
            startTime,
            requestId: `req_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            userId: (req as any).user?.id,
            projectId: req.body?.projectId || req.query?.projectId
        };
        
        // Store original response methods
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        
        let responseBody: any;
        let responseCaptured = false;
        
        // Intercept response
        res.json = function(body: any) {
            if (!responseCaptured) {
                responseBody = body;
                responseCaptured = true;
            }
            return originalJson(body);
        };
        
        res.send = function(body: any) {
            if (!responseCaptured) {
                responseBody = body;
                responseCaptured = true;
            }
            return originalSend(body);
        };
        
        // Continue to next middleware
        next();
        
        // Log after response is sent (non-blocking)
        res.on('finish', async () => {
            try {
                const responseTime = Date.now() - startTime;
                const statusCode = res.statusCode;
                const success = statusCode < 400;
                
                // Extract model info
                const model = options.extractModel 
                    ? options.extractModel(req)
                    : req.body?.model || req.query?.model as string || 'unknown';
                
                // Extract tokens
                let inputTokens = 0;
                let outputTokens = 0;
                
                if (options.extractTokens) {
                    const tokens = options.extractTokens(req, res);
                    inputTokens = tokens.input;
                    outputTokens = tokens.output;
                } else if (responseBody) {
                    // Try to extract from response body
                    inputTokens = responseBody.usage?.prompt_tokens || 
                                 responseBody.usage?.input_tokens || 
                                 responseBody.inputTokens || 0;
                    outputTokens = responseBody.usage?.completion_tokens || 
                                  responseBody.usage?.output_tokens || 
                                  responseBody.outputTokens || 0;
                }
                
                // Extract cost
                const cost = responseBody?.cost || responseBody?.metadata?.cost || 0;
                
                // Extract error info
                let errorMessage: string | undefined;
                let errorType: string | undefined;
                
                if (!success) {
                    errorMessage = responseBody?.error?.message || 
                                  responseBody?.message || 
                                  `HTTP ${statusCode}`;
                    errorType = categorizeError(statusCode);
                }
                
                // Log the AI call
                await aiLogger.logAICall({
                    userId: context.userId || 'anonymous',
                    projectId: context.projectId,
                    requestId: context.requestId,
                    service: options.service || extractServiceFromPath(req.path),
                    operation: options.operation || extractOperationFromPath(req.path, req.method),
                    aiModel: model,
                    endpoint: req.path,
                    method: req.method,
                    statusCode,
                    success,
                    responseTime,
                    inputTokens,
                    outputTokens,
                    cost,
                    prompt: req.body?.prompt || req.body?.messages?.[0]?.content,
                    parameters: {
                        temperature: req.body?.temperature,
                        maxTokens: req.body?.max_tokens || req.body?.maxTokens,
                        topP: req.body?.top_p || req.body?.topP,
                        ...req.body?.parameters
                    },
                    result: responseBody?.text || responseBody?.content || responseBody?.response,
                    errorMessage,
                    errorType,
                    ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
                    userAgent: req.headers['user-agent'],
                    traceId: req.body?.traceId || req.query?.traceId as string,
                    experimentId: req.body?.experimentId || req.query?.experimentId as string,
                    sessionId: req.body?.sessionId || req.query?.sessionId as string,
                    cortexEnabled: req.body?.cortex?.enabled || false,
                    cacheHit: responseBody?.cached || false,
                    tags: req.body?.tags || [],
                    logSource: 'http-middleware'
                });
            } catch (error) {
                // Never let logging errors affect the response
                loggingService.error('Failed to log AI endpoint call', {
                    component: 'AILoggingMiddleware',
                    error: error instanceof Error ? error.message : String(error),
                    path: req.path
                });
            }
        });
    };
};

/**
 * Error logging middleware
 * Catches and logs errors with AI context
 */
export const logAIError = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const context = req.aiLogContext || {
        startTime: Date.now(),
        requestId: 'unknown',
        userId: (req as any).user?.id,
        projectId: undefined
    };
    
    const responseTime = Date.now() - context.startTime;
    
    // Log error asynchronously
    aiLogger.logAICall({
        userId: context.userId || 'anonymous',
        projectId: context.projectId,
        requestId: context.requestId,
        service: 'api',
        operation: req.path,
        aiModel: 'unknown',
        endpoint: req.path,
        method: req.method,
        statusCode: 500,
        success: false,
        responseTime,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: error.message,
        errorType: 'server_error',
        errorStack: error.stack,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
        userAgent: req.headers['user-agent'],
        logLevel: 'ERROR',
        logSource: 'error-middleware'
    }).catch(err => {
        loggingService.error('Failed to log error', {
            component: 'AILoggingMiddleware',
            error: err instanceof Error ? err.message : String(err)
        });
    });
    
    next(error);
};

