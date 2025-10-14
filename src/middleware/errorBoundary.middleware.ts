import { Request, Response, NextFunction } from 'express';
import { ErrorHandler, ErrorContext, ErrorSeverity } from '../errors/ErrorHandler';
import { ServiceError } from '../shared/BaseService';
import { loggingService } from '../services/logging.service';

export interface ErrorBoundaryOptions {
    enableStackTrace?: boolean;
    enableDetailedErrors?: boolean;
    maxErrorsPerMinute?: number;
    enableCircuitBreaker?: boolean;
}

/**
 * Global Error Boundary Middleware
 * Provides centralized error handling for all Express routes and middleware
 */
export class ErrorBoundaryMiddleware {
    private static errorCounts = new Map<string, { count: number; resetTime: number }>();
    private static readonly DEFAULT_OPTIONS: ErrorBoundaryOptions = {
        enableStackTrace: process.env.NODE_ENV === 'development',
        enableDetailedErrors: process.env.NODE_ENV === 'development',
        maxErrorsPerMinute: 60,
        enableCircuitBreaker: true
    };

    /**
     * Main error boundary middleware
     */
    public static errorBoundary(options: ErrorBoundaryOptions = {}) {
        const config = { ...ErrorBoundaryMiddleware.DEFAULT_OPTIONS, ...options };

        return (error: Error | ServiceError | any, req: Request, res: Response, next: NextFunction) => {
            // Skip if response already sent
            if (res.headersSent) {
                return next(error);
            }

            // Extract request context
            const context: ErrorContext = {
                userId: (req as any).user?.id || (req as any).userId,
                requestId: (req as any).requestId || req.headers['x-request-id'] as string,
                operation: `${req.method} ${req.path}`,
                component: 'API',
                additionalData: {
                    userAgent: req.headers['user-agent'],
                    ip: req.ip || req.connection.remoteAddress,
                    method: req.method,
                    url: req.originalUrl,
                    query: req.query,
                    body: ErrorBoundaryMiddleware.sanitizeRequestBody(req.body),
                    headers: ErrorBoundaryMiddleware.sanitizeHeaders(req.headers)
                }
            };

            // Process the error
            const processedError = ErrorHandler.processError(error, context);

            // Check rate limiting
            if (config.maxErrorsPerMinute && 
                ErrorBoundaryMiddleware.isRateLimited(req.ip || 'unknown', config.maxErrorsPerMinute)) {
                return ErrorBoundaryMiddleware.sendErrorResponse(res, {
                    ...processedError,
                    statusCode: 429,
                    message: 'Too many errors from this client'
                }, config);
            }

            // Check circuit breaker
            if (config.enableCircuitBreaker && 
                ErrorBoundaryMiddleware.isCircuitBreakerOpen(context.component || 'API')) {
                return ErrorBoundaryMiddleware.sendErrorResponse(res, {
                    ...processedError,
                    statusCode: 503,
                    message: 'Service temporarily unavailable'
                }, config);
            }

            // Send error response
            ErrorBoundaryMiddleware.sendErrorResponse(res, processedError, config);
        };
    }

    /**
     * Async error wrapper for route handlers
     */
    public static asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
        return (req: Request, res: Response, next: NextFunction) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    /**
     * Service-specific error boundary
     */
    public static serviceErrorBoundary(serviceName: string) {
        return (error: Error | ServiceError | any, req: Request, res: Response, next: NextFunction) => {
            const context: ErrorContext = {
                userId: (req as any).user?.id,
                requestId: (req as any).requestId,
                operation: `${req.method} ${req.path}`,
                component: serviceName,
                additionalData: {
                    service: serviceName,
                    endpoint: req.path,
                    method: req.method
                }
            };

            const processedError = ErrorHandler.processError(error, context);
            ErrorBoundaryMiddleware.sendErrorResponse(res, processedError, ErrorBoundaryMiddleware.DEFAULT_OPTIONS);
        };
    }

    /**
     * Validation error handler
     */
    public static validationErrorHandler() {
        return (error: any, req: Request, res: Response, next: NextFunction) => {
            // Handle express-validator errors
            if (error.array && typeof error.array === 'function') {
                const validationErrors = error.array();
                const serviceError = new ServiceError(
                    'Validation failed',
                    'VALIDATION_ERROR',
                    400,
                    { validationErrors }
                );
                
                return ErrorBoundaryMiddleware.errorBoundary()(serviceError, req, res, next);
            }

            // Handle Joi validation errors
            if (error.isJoi) {
                const serviceError = new ServiceError(
                    error.details[0]?.message || 'Validation failed',
                    'VALIDATION_ERROR',
                    400,
                    { validationDetails: error.details }
                );
                
                return ErrorBoundaryMiddleware.errorBoundary()(serviceError, req, res, next);
            }

            next(error);
        };
    }

    /**
     * Send standardized error response
     */
    private static sendErrorResponse(
        res: Response,
        error: any,
        config: ErrorBoundaryOptions
    ): void {
        const response: any = {
            success: false,
            error: {
                message: error.message || 'An error occurred',
                code: error.code || 'INTERNAL_ERROR',
                id: error.id,
                timestamp: error.timestamp || new Date().toISOString()
            }
        };

        // Add detailed error information in development
        if (config.enableDetailedErrors) {
            response.error.category = error.category;
            response.error.severity = error.severity;
            response.error.context = error.context;
            
            if (error.shouldRetry) {
                response.error.retryable = true;
                response.error.retryAfter = error.retryAfter;
            }
        }

        // Add stack trace in development
        if (config.enableStackTrace && error.stack) {
            response.error.stack = error.stack;
        }

        // Add correlation IDs for tracing
        if (error.context?.requestId) {
            response.error.requestId = error.context.requestId;
        }

        // Set appropriate status code
        const statusCode = error.statusCode || 500;
        
        // Add retry headers for retryable errors
        if (error.shouldRetry && error.retryAfter) {
            res.set('Retry-After', Math.ceil(error.retryAfter / 1000).toString());
        }

        // Add rate limit headers if applicable
        if (statusCode === 429) {
            res.set('X-RateLimit-Limit', '60');
            res.set('X-RateLimit-Remaining', '0');
            res.set('X-RateLimit-Reset', new Date(Date.now() + 60000).toISOString());
        }

        res.status(statusCode).json(response);
    }

    /**
     * Sanitize request body for logging
     */
    private static sanitizeRequestBody(body: any): any {
        if (!body || typeof body !== 'object') {
            return body;
        }

        const sensitiveFields = [
            'password', 'token', 'secret', 'key', 'authorization',
            'credit_card', 'ssn', 'social_security'
        ];

        const sanitized = { ...body };
        
        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    /**
     * Sanitize headers for logging
     */
    private static sanitizeHeaders(headers: any): any {
        const sensitiveHeaders = [
            'authorization', 'cookie', 'x-api-key', 'x-auth-token'
        ];

        const sanitized = { ...headers };
        
        for (const header of sensitiveHeaders) {
            if (sanitized[header]) {
                sanitized[header] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    /**
     * Check if client is rate limited
     */
    private static isRateLimited(clientId: string, maxErrorsPerMinute: number): boolean {
        const now = Date.now();
        const minuteAgo = now - 60000;
        
        const clientErrors = ErrorBoundaryMiddleware.errorCounts.get(clientId);
        
        if (!clientErrors || clientErrors.resetTime < minuteAgo) {
            ErrorBoundaryMiddleware.errorCounts.set(clientId, { count: 1, resetTime: now });
            return false;
        }

        clientErrors.count++;
        return clientErrors.count > maxErrorsPerMinute;
    }

    /**
     * Check if circuit breaker is open for a component
     */
    private static isCircuitBreakerOpen(component: string): boolean {
        // This would integrate with the circuit breaker logic in BaseService
        // For now, implement a simple version
        const errorKey = `circuit_${component}`;
        const componentErrors = ErrorBoundaryMiddleware.errorCounts.get(errorKey);
        
        if (!componentErrors) {
            return false;
        }

        const now = Date.now();
        const fiveMinutesAgo = now - 300000; // 5 minutes

        // Reset if it's been more than 5 minutes
        if (componentErrors.resetTime < fiveMinutesAgo) {
            ErrorBoundaryMiddleware.errorCounts.delete(errorKey);
            return false;
        }

        // Open circuit breaker if more than 50 errors in 5 minutes
        return componentErrors.count > 50;
    }

    /**
     * 404 Not Found handler
     */
    public static notFoundHandler() {
        return (req: Request, res: Response, next: NextFunction) => {
            const error = new ServiceError(
                `Route ${req.method} ${req.path} not found`,
                'ROUTE_NOT_FOUND',
                404,
                {
                    method: req.method,
                    path: req.path,
                    originalUrl: req.originalUrl
                }
            );

            next(error);
        };
    }

    /**
     * Health check for error boundary
     */
    public static getHealthStatus(): {
        errorCounts: Record<string, any>;
        circuitBreakerStatus: Record<string, boolean>;
        uptime: number;
    } {
        const errorCounts: Record<string, any> = {};
        const circuitBreakerStatus: Record<string, boolean> = {};

        for (const [key, value] of ErrorBoundaryMiddleware.errorCounts.entries()) {
            if (key.startsWith('circuit_')) {
                const component = key.replace('circuit_', '');
                circuitBreakerStatus[component] = value.count > 50;
            } else {
                errorCounts[key] = value;
            }
        }

        return {
            errorCounts,
            circuitBreakerStatus,
            uptime: process.uptime()
        };
    }

    /**
     * Reset error tracking (useful for testing)
     */
    public static resetErrorCounts(): void {
        ErrorBoundaryMiddleware.errorCounts.clear();
    }
}
