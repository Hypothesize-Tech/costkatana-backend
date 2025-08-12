import { Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Generic rate limiting middleware
 */
export function rateLimitMiddleware(options: {
    maxRequests: number;
    windowMs: number;
    keyGenerator?: (req: any) => string;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
    message?: string;
} = {
    maxRequests: 100,
    windowMs: 60000 // 1 minute
}): (req: any, res: Response, next: NextFunction) => void {
    const {
        maxRequests,
        windowMs,
        keyGenerator = (req) => req.user?.id || req.ip || 'unknown',
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        message = 'Too many requests, please try again later.'
    } = options;

    return (req: any, res: Response, next: NextFunction): void => {
        const key = keyGenerator(req);
        const now = Date.now();

        // Clean up expired entries
        for (const [k, v] of rateLimitStore.entries()) {
            if (v.resetTime < now) {
                rateLimitStore.delete(k);
            }
        }

        // Get or create rate limit record
        let record = rateLimitStore.get(key);
        if (!record || record.resetTime < now) {
            record = {
                count: 0,
                resetTime: now + windowMs
            };
            rateLimitStore.set(key, record);
        }

        // Check if limit exceeded
        if (record.count >= maxRequests) {
            const retryAfter = Math.ceil((record.resetTime - now) / 1000);
            
            logger.warn('Rate limit exceeded', {
                key,
                count: record.count,
                maxRequests,
                retryAfter
            });

            res.setHeader('X-RateLimit-Limit', maxRequests.toString());
            res.setHeader('X-RateLimit-Remaining', '0');
            res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
            res.setHeader('Retry-After', retryAfter.toString());

            res.status(429).json({
                error: 'Rate limit exceeded',
                message,
                retryAfter
            });
            return;
        }

        // Increment counter
        record.count++;

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', (maxRequests - record.count).toString());
        res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

        // Handle skip options
        if (skipSuccessfulRequests || skipFailedRequests) {
            const originalSend = res.send;
            res.send = function(data: any) {
                if (skipSuccessfulRequests && res.statusCode < 400) {
                    record!.count--;
                } else if (skipFailedRequests && res.statusCode >= 400) {
                    record!.count--;
                }
                return originalSend.call(this, data);
            };
        }

        next();
    };
}

/**
 * User-based rate limiting
 */
export function userRateLimit(
    maxRequests: number = 100,
    windowMs: number = 60000
): (req: any, res: Response, next: NextFunction) => void {
    return rateLimitMiddleware({
        maxRequests,
        windowMs,
        keyGenerator: (req) => req.user?.id || 'anonymous',
        message: 'User rate limit exceeded. Please try again later.'
    });
}

/**
 * IP-based rate limiting
 */
export function ipRateLimit(
    maxRequests: number = 100,
    windowMs: number = 60000
): (req: any, res: Response, next: NextFunction) => void {
    return rateLimitMiddleware({
        maxRequests,
        windowMs,
        keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
        message: 'IP rate limit exceeded. Please try again later.'
    });
}

/**
 * API key-based rate limiting
 */
export function apiKeyRateLimit(
    maxRequests: number = 1000,
    windowMs: number = 60000
): (req: any, res: Response, next: NextFunction) => void {
    return rateLimitMiddleware({
        maxRequests,
        windowMs,
        keyGenerator: (req) => {
            const apiKey = req.headers['x-api-key'] as string || 
                          req.headers['authorization']?.replace('Bearer ', '') || 
                          'no-key';
            return `api-key:${apiKey}`;
        },
        message: 'API key rate limit exceeded. Please upgrade your plan or try again later.'
    });
}

/**
 * Endpoint-specific rate limiting
 */
export function endpointRateLimit(
    endpoint: string,
    maxRequests: number = 100,
    windowMs: number = 60000
): (req: any, res: Response, next: NextFunction) => void {
    return rateLimitMiddleware({
        maxRequests,
        windowMs,
        keyGenerator: (req) => `${req.user?.id || req.ip}:${endpoint}`,
        message: `Too many requests to ${endpoint}. Please try again later.`
    });
}
