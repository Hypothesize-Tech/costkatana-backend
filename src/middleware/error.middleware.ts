import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { config } from '../config';
import { recordSuspicious404, recordDangerousPattern } from '../utils/security-monitor';

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
    let error: AppError;

    if (err instanceof AppError) {
        error = err;
    } else if (err instanceof ZodError) {
        const message = 'Validation error';
        const errors = err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
        }));

        return res.status(400).json({
            success: false,
            message,
            errors,
        } as ErrorResponse);
    } else if (err.name === 'CastError') {
        error = new AppError('Invalid ID format', 400);
    } else if (err.name === 'ValidationError') {
        const message = 'Validation error';
        error = new AppError(message, 400);
    } else if (err.name === 'MongoServerError' && (err as any).code === 11000) {
        const field = Object.keys((err as any).keyValue)[0];
        error = new AppError(`${field} already exists`, 409);
    } else {
        error = new AppError(err.message || 'Internal server error', 500);
    }

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

    // Log security-related errors with higher priority
    if (error.statusCode === 403 || error.statusCode === 401) {
        logger.warn('Security error:', logContext);
    } else if (error.statusCode >= 500) {
        logger.error('Server error:', logContext);
    } else if (error.statusCode === 404) {
        // Enhanced 404 logging for security monitoring
        logger.warn('Resource not found:', {
            ...logContext,
            securityNote: 'Potential scanning or probing attempt'
        });
    } else {
        logger.warn('Client error:', logContext);
    }

    const response: ErrorResponse = {
        success: false,
        message: error.message,
    };

    // Include stack trace in development
    if (config.env === 'development' && error.stack) {
        response.stack = error.stack;
    }

    res.status(error.statusCode).json(response);
    return;
};

export const notFoundHandler = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    // Enhanced 404 handling with security context
    const suspiciousPathPatterns = [
        /wp-admin/i,
        /wp-includes/i,
        /wordpress/i,
        /\.php$/i,
        /admin/i,
        /phpmyadmin/i,
        /\.env$/i,
        /\.git/i,
        /config/i,
        /setup/i,
        /install/i,
        /cgi-bin/i,
        /sdk/i,
        /manager/i,
        /xmlrpc/i,
        /license\.txt$/i,
        /wlwmanifest\.xml$/i
    ];

    const isSuspiciousPath = suspiciousPathPatterns.some(pattern =>
        pattern.test(req.originalUrl)
    );

    if (isSuspiciousPath) {
        recordSuspicious404(req.ip || 'unknown', req.originalUrl, req.method, req.get('User-Agent') || 'unknown', {
            headers: req.headers,
            securityNote: 'Potential security scan or probe'
        });
    }

    const error = new AppError(`Route ${req.originalUrl} not found`, 404);
    next(error);
};

export const asyncHandler = (fn: Function) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

// Security middleware for additional protection
export const securityLogger = (req: Request, _res: Response, next: NextFunction) => {
    // Log potentially dangerous requests
    const dangerousPatterns = [
        /\.\./,  // Directory traversal
        /script/i,  // Potential XSS
        /select.*from/i,  // SQL injection
        /union.*select/i,  // SQL injection
        /exec\(/i,  // Code execution
        /eval\(/i,  // Code execution
        /system\(/i,  // System commands
        /cmd\(/i,  // Command execution
        /<script/i,  // XSS
        /javascript:/i,  // XSS
        /vbscript:/i,  // XSS
        /onload=/i,  // XSS
        /onerror=/i,  // XSS
        /alert\(/i,  // XSS
        /document\.cookie/i,  // XSS
        /\.htaccess/i,  // Server config
        /\.htpasswd/i,  // Server config
        /passwd/i,  // System files
        /shadow/i,  // System files
        /proc\/self/i,  // System files
        /etc\/passwd/i,  // System files
        /etc\/shadow/i,  // System files
    ];

    const fullUrl = req.originalUrl;
    const bodyStr = JSON.stringify(req.body);
    const queryStr = JSON.stringify(req.query);

    const isDangerous = dangerousPatterns.some(pattern =>
        pattern.test(fullUrl) || pattern.test(bodyStr) || pattern.test(queryStr)
    );

    if (isDangerous) {
        recordDangerousPattern(req.ip || 'unknown', req.originalUrl, req.method, req.get('User-Agent') || 'unknown', {
            body: req.body,
            query: req.query,
            headers: req.headers,
            securityNote: 'Potential attack attempt'
        });
    }

    next();
};