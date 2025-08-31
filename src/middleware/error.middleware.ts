import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { loggingService } from '../services/logging.service';
import { config } from '../config';

interface ErrorResponse {
    success: false;
    message: string;
    errors?: any;
    stack?: string;
}

export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;

    constructor(message: string, statusCode: number = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export const errorHandler = (
    err: Error | AppError | ZodError,
    req: any,
    res: Response
) => {
    const startTime = Date.now();
    
    loggingService.info('=== ERROR HANDLER MIDDLEWARE STARTED ===', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        path: req.originalUrl,
        method: req.method
    });

    loggingService.info('Step 1: Analyzing error type and context', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'analyze_error',
        errorName: err.name,
        errorMessage: err.message,
        hasStack: !!err.stack
    });

    let error: AppError;

    if (err instanceof AppError) {
        loggingService.info('AppError instance detected', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'app_error_detected',
            statusCode: err.statusCode,
            message: err.message,
            isOperational: err.isOperational
        });
        error = err;
    } else if (err instanceof ZodError) {
        loggingService.info('ZodError validation error detected', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'zod_error_detected',
            errorCount: err.errors.length
        });

        const message = 'Validation error';
        const errors = err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
        }));

        loggingService.info('Validation errors processed', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'validation_errors_processed',
            errorCount: errors.length,
            fields: errors.map(e => e.field)
        });

        loggingService.info('=== ERROR HANDLER MIDDLEWARE COMPLETED ===', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'completed',
            statusCode: 400,
            totalTime: `${Date.now() - startTime}ms`
        });

        return res.status(400).json({
            success: false,
            message,
            errors,
        } as ErrorResponse);
    } else if (err.name === 'CastError') {
        loggingService.info('MongoDB CastError detected', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'cast_error_detected',
            errorName: err.name,
            originalMessage: err.message
        });
        error = new AppError('Invalid ID format', 400);
    } else if (err.name === 'ValidationError') {
        loggingService.info('MongoDB ValidationError detected', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'validation_error_detected',
            errorName: err.name,
            originalMessage: err.message
        });
        const message = 'Validation error';
        error = new AppError(message, 400);
    } else if (err.name === 'MongoServerError' && (err as any).code === 11000) {
        loggingService.info('MongoDB duplicate key error detected', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'duplicate_key_error_detected',
            errorName: err.name,
            errorCode: (err as any).code,
            keyValue: (err as any).keyValue
        });
        const field = Object.keys((err as any).keyValue)[0];
        error = new AppError(`${field} already exists`, 409);
    } else {
        loggingService.info('Generic error detected, creating AppError', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'generic_error_detected',
            errorName: err.name,
            originalMessage: err.message
        });
        error = new AppError(err.message || 'Internal server error', 500);
    }

    loggingService.info('Step 2: Building comprehensive error context', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'build_context'
    });

    // Enhanced logging with security context
    const logContext = {
        error: {
            message: error.message,
            statusCode: error.statusCode,
            stack: error.stack,
            name: err.name
        },
        request: {
            method: req.method,
            url: req.url,
            originalUrl: req.originalUrl,
            headers: req.headers,
            body: req.body,
            query: req.query,
            params: req.params,
            ip: req.ip,
            user: req.user,
            userAgent: req.get('User-Agent'),
            timestamp: new Date().toISOString()
        }
    };

    loggingService.info('Error context built successfully', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'context_built',
        statusCode: error.statusCode,
        hasUser: !!req.user,
        hasStack: !!error.stack
    });

    loggingService.info('Step 3: Determining logging priority and security context', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'determine_priority'
    });

    // Log security-related errors with higher priority
    if (error.statusCode === 403 || error.statusCode === 401) {
        loggingService.info('Security error detected, logging with high priority', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'security_error_logging',
            statusCode: error.statusCode,
            securityType: error.statusCode === 401 ? 'Unauthorized' : 'Forbidden'
        });
        loggingService.warn('Security error:', logContext);
    } else if (error.statusCode >= 500) {
        loggingService.info('Server error detected, logging as error', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'server_error_logging',
            statusCode: error.statusCode,
            severity: 'high'
        });
        loggingService.error('Server error:', logContext);
    } else if (error.statusCode === 404) {
        loggingService.info('Resource not found error detected, enhanced security logging', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'not_found_logging',
            statusCode: error.statusCode,
            securityNote: 'Potential scanning or probing attempt'
        });
        // Enhanced 404 logging for security monitoring
        loggingService.warn('Resource not found:', {
            ...logContext,
            securityNote: 'Potential scanning or probing attempt'
        });
    } else {
        loggingService.info('Client error detected, standard warning logging', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'client_error_logging',
            statusCode: error.statusCode,
            severity: 'medium'
        });
        loggingService.warn('Client error:', logContext);
    }

    loggingService.info('Step 4: Preparing error response', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'prepare_response'
    });

    const response: ErrorResponse = {
        success: false,
        message: error.message,
    };

    // Include stack trace in development
    if (config.env === 'development' && error.stack) {
        loggingService.info('Development mode: Including stack trace in response', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'include_stack_trace',
            environment: config.env,
            hasStack: !!error.stack
        });
        response.stack = error.stack;
    } else {
        loggingService.info('Production mode: Stack trace excluded from response', {
            component: 'ErrorMiddleware',
            operation: 'errorHandler',
            type: 'error_handling',
            step: 'exclude_stack_trace',
            environment: config.env
        });
    }

    loggingService.info('Error response prepared successfully', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'response_prepared',
        statusCode: error.statusCode,
        hasStack: !!response.stack,
        responseSize: JSON.stringify(response).length
    });

    loggingService.info('Step 5: Sending error response to client', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'send_response'
    });

    res.status(error.statusCode).json(response);

    loggingService.info('Error response sent successfully', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'response_sent',
        statusCode: error.statusCode,
        responseTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== ERROR HANDLER MIDDLEWARE COMPLETED ===', {
        component: 'ErrorMiddleware',
        operation: 'errorHandler',
        type: 'error_handling',
        step: 'completed',
        statusCode: error.statusCode,
        totalTime: `${Date.now() - startTime}ms`
    });

    return;
};

export const notFoundHandler = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    const startTime = Date.now();

    loggingService.info('=== NOT FOUND HANDLER MIDDLEWARE STARTED ===', {
        component: 'ErrorMiddleware',
        operation: 'notFoundHandler',
        type: 'not_found_handling',
        path: req.originalUrl,
        method: req.method
    });

    loggingService.info('Step 1: Creating AppError for not found route', {
        component: 'ErrorMiddleware',
        operation: 'notFoundHandler',
        type: 'not_found_handling',
        step: 'create_error'
    });

    const error = new AppError(`Route ${req.originalUrl} not found`, 404);

    loggingService.info('AppError created successfully', {
        component: 'ErrorMiddleware',
        operation: 'notFoundHandler',
        type: 'not_found_handling',
        step: 'error_created',
        message: error.message,
        statusCode: error.statusCode,
        path: req.originalUrl
    });

    loggingService.info('Step 2: Passing error to next middleware', {
        component: 'ErrorMiddleware',
        operation: 'notFoundHandler',
        type: 'not_found_handling',
        step: 'pass_to_next'
    });

    loggingService.info('=== NOT FOUND HANDLER MIDDLEWARE COMPLETED ===', {
        component: 'ErrorMiddleware',
        operation: 'notFoundHandler',
        type: 'not_found_handling',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    next(error);
};

export const asyncHandler = (fn: Function) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const startTime = Date.now();

        loggingService.info('=== ASYNC HANDLER MIDDLEWARE STARTED ===', {
            component: 'ErrorMiddleware',
            operation: 'asyncHandler',
            type: 'async_handling',
            path: req.originalUrl,
            method: req.method
        });

        loggingService.info('Step 1: Wrapping async function execution', {
            component: 'ErrorMiddleware',
            operation: 'asyncHandler',
            type: 'async_handling',
            step: 'wrap_execution'
        });

        Promise.resolve(fn(req, res, next))
            .then(() => {
                loggingService.info('Async function executed successfully', {
                    component: 'ErrorMiddleware',
                    operation: 'asyncHandler',
                    type: 'async_handling',
                    step: 'execution_success',
                    totalTime: `${Date.now() - startTime}ms`
                });
            })
            .catch((error) => {
                loggingService.info('Async function error caught, passing to error handler', {
                    component: 'ErrorMiddleware',
                    operation: 'asyncHandler',
                    type: 'async_handling',
                    step: 'error_caught',
                    errorName: error.name,
                    errorMessage: error.message,
                    totalTime: `${Date.now() - startTime}ms`
                });
                next(error);
            });

        loggingService.info('=== ASYNC HANDLER MIDDLEWARE COMPLETED ===', {
            component: 'ErrorMiddleware',
            operation: 'asyncHandler',
            type: 'async_handling',
            step: 'completed',
            setupTime: `${Date.now() - startTime}ms`
        });
    };
};

// Security middleware for additional protection
export const securityLogger = (req: Request, _res: Response, next: NextFunction) => {
    const startTime = Date.now();

    loggingService.info('=== SECURITY LOGGER MIDDLEWARE STARTED ===', {
        component: 'ErrorMiddleware',
        operation: 'securityLogger',
        type: 'security_logging',
        path: req.originalUrl,
        method: req.method
    });

    loggingService.info('Step 1: Analyzing request for security concerns', {
        component: 'ErrorMiddleware',
        operation: 'securityLogger',
        type: 'security_logging',
        step: 'analyze_security'
    });

    // Check for potential security issues
    const securityChecks = {
        hasSuspiciousHeaders: checkSuspiciousHeaders(req.headers),
        hasSuspiciousQuery: checkSuspiciousQuery(req.query),
        hasSuspiciousBody: checkSuspiciousBody(req.body),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
    };

    loggingService.info('Security analysis completed', {
        component: 'ErrorMiddleware',
        operation: 'securityLogger',
        type: 'security_logging',
        step: 'security_analyzed',
        hasSuspiciousHeaders: securityChecks.hasSuspiciousHeaders,
        hasSuspiciousQuery: securityChecks.hasSuspiciousQuery,
        hasSuspiciousBody: securityChecks.hasSuspiciousBody,
        ipAddress: securityChecks.ipAddress
    });

    // Log security concerns if any detected
    if (securityChecks.hasSuspiciousHeaders || securityChecks.hasSuspiciousQuery || securityChecks.hasSuspiciousBody) {
        loggingService.warn('Potential security concern detected', {
            component: 'ErrorMiddleware',
            operation: 'securityLogger',
            type: 'security_logging',
            step: 'security_concern_detected',
            securityChecks,
            path: req.originalUrl,
            method: req.method
        });
    } else {
        loggingService.info('No security concerns detected', {
            component: 'ErrorMiddleware',
            operation: 'securityLogger',
            type: 'security_logging',
            step: 'no_security_concerns',
            path: req.originalUrl,
            method: req.method
        });
    }

    loggingService.info('=== SECURITY LOGGER MIDDLEWARE COMPLETED ===', {
        component: 'ErrorMiddleware',
        operation: 'securityLogger',
        type: 'security_logging',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    next();
};

// Helper methods for security analysis
const checkSuspiciousHeaders = (headers: any): boolean => {
    const suspiciousPatterns = [
        /script/i,
        /javascript/i,
        /vbscript/i,
        /onload/i,
        /onerror/i,
        /eval/i
    ];

    return Object.values(headers).some((value: any) =>
        suspiciousPatterns.some(pattern => pattern.test(value))
    );
};

const checkSuspiciousQuery = (query: any): boolean => {
    const suspiciousPatterns = [
        /script/i,
        /javascript/i,
        /vbscript/i,
        /onload/i,
        /onerror/i,
        /eval/i
    ];

    return Object.values(query).some((value: any) =>
        suspiciousPatterns.some(pattern => pattern.test(value))
    );
};

const checkSuspiciousBody = (body: any): boolean => {
    if (!body) return false;
    
    const suspiciousPatterns = [
        /script/i,
        /javascript/i,
        /vbscript/i,
        /onload/i,
        /onerror/i,
        /eval/i
    ];

    return Object.values(body).some((value: any) =>
        suspiciousPatterns.some(pattern => pattern.test(value))
    );
};