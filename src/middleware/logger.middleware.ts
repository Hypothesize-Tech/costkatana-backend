import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CustomLoggerService } from '../services/logger.service';

// Extend Express Request interface to include logging context
declare global {
    namespace Express {
        interface Request {
            requestId?: string;
            startTime?: number;
            logger?: CustomLoggerService;
        }
    }
}

/**
 * Logger Middleware
 * 
 * Features:
 * - Intercepts all HTTP requests (except root /)
 * - Generates unique request IDs using UUID
 * - Tracks execution time from request start to response finish
 * - Logs request details: method, URL, params, query, body, response status, user info, IP, execution time
 * - Controlled by ENABLE_REQUEST_LOGGING environment variable
 */
export const loggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    // Check if request logging is enabled
    const isLoggingEnabled = process.env.ENABLE_REQUEST_LOGGING !== 'false';
    
    if (!isLoggingEnabled) {
        return next();
    }

    // Skip logging for root path and health checks
    if (req.path === '/' || req.path === '/health' || req.path.startsWith('/api/health')) {
        return next();
    }

    // Generate unique request ID
    const requestId = uuidv4();
    const startTime = Date.now();
    
    // Attach to request object
    req.requestId = requestId;
    req.startTime = startTime;
    
    // Create request-scoped logger instance
    req.logger = new CustomLoggerService(requestId);
    
    // Extract user information if available
    const userId = (req as any).user?.id || (req as any).user?._id || undefined;
    const userEmail = (req as any).user?.email || undefined;
    
    // Set request context in logger
    req.logger.setRequestContext(requestId, userId);
    
    // Log incoming request
    req.logger.logRequest(req.method, req.originalUrl, {
        requestId,
        userId,
        userEmail,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        params: req.params,
        query: req.query,
        body: sanitizeRequestBody(req.body),
        headers: sanitizeHeaders(req.headers),
        timestamp: new Date().toISOString()
    });

    // Intercept response to log completion
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;

    // Override res.send
    res.send = function(data: any) {
        logResponse();
        return originalSend.call(this, data);
    };

    // Override res.json
    res.json = function(data: any) {
        logResponse();
        return originalJson.call(this, data);
    };

    // Override res.end
    res.end = function(chunk?: any, encoding?: any) {
        logResponse();
        return originalEnd.call(this, chunk, encoding);
    };

    // Function to log response (called only once)
    let responseLogged = false;
    const logResponse = () => {
        if (responseLogged || !req.logger) return;
        responseLogged = true;

        const endTime = Date.now();
        const executionTime = endTime - startTime;

        req.logger.logResponse(req.method, req.originalUrl, res.statusCode, executionTime, {
            requestId,
            userId,
            userEmail,
            ip: req.ip || req.connection.remoteAddress,
            statusCode: res.statusCode,
            executionTime,
            responseTime: `${executionTime}ms`,
            timestamp: new Date().toISOString(),
            success: res.statusCode < 400
        });

        // Log performance metrics
        req.logger.logPerformance(`${req.method} ${req.originalUrl}`, executionTime, {
            requestId,
            statusCode: res.statusCode,
            success: res.statusCode < 400
        });

        // Clear request context
        req.logger.clearRequestContext();
    };

    // Handle connection close/error
    req.on('close', () => {
        if (!responseLogged && req.logger) {
            req.logger.warn('Request closed before response', {
                requestId,
                method: req.method,
                url: req.originalUrl,
                executionTime: Date.now() - startTime
            });
        }
    });

    next();
};

/**
 * Sanitize request body to remove sensitive information
 */
function sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== 'object') {
        return body;
    }

    const sensitiveFields = [
        'password', 'token', 'secret', 'key', 'auth', 'authorization',
        'apiKey', 'api_key', 'accessToken', 'access_token', 'refreshToken',
        'refresh_token', 'sessionId', 'session_id', 'credit_card', 'creditCard',
        'ssn', 'social_security', 'pin', 'cvv', 'cvc'
    ];

    const sanitized = { ...body };

    const sanitizeObject = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map(item => sanitizeObject(item));
        }
        
        if (obj && typeof obj === 'object') {
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                const lowerKey = key.toLowerCase();
                if (sensitiveFields.some(field => lowerKey.includes(field))) {
                    result[key] = '[REDACTED]';
                } else if (typeof value === 'object') {
                    result[key] = sanitizeObject(value);
                } else {
                    result[key] = value;
                }
            }
            return result;
        }
        
        return obj;
    };

    return sanitizeObject(sanitized);
}

/**
 * Sanitize headers to remove sensitive information
 */
function sanitizeHeaders(headers: any): any {
    const sensitiveHeaders = [
        'authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token',
        'x-access-token', 'x-refresh-token', 'x-session-id'
    ];

    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveHeaders.includes(lowerKey)) {
            sanitized[key] = '[REDACTED]';
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Middleware to skip logging for specific routes
 */
export const skipLogging = (req: Request, _res: Response, next: NextFunction): void => {
    req.skipLogging = true;
    next();
};

// Extend Request interface for skipLogging flag
declare global {
    namespace Express {
        interface Request {
            skipLogging?: boolean;
        }
    }
}
