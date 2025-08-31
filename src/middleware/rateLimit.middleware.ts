import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { cacheService } from '../services/cache.service';

/**
 * Generic rate limiting middleware with Redis primary and in-memory fallback
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

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        loggingService.info('=== RATE LIMIT MIDDLEWARE STARTED ===', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            path: req.path,
            method: req.method,
            maxRequests,
            windowMs
        });

        loggingService.info('Step 1: Generating rate limit key', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'generate_key'
        });

        const key = keyGenerator(req);
        const now = Date.now();
        const cacheKey = `rate_limit:${key}`;

        loggingService.info('Rate limit key generated', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'key_generated',
            key,
            cacheKey,
            hasUser: !!req.user?.id,
            hasIP: !!req.ip,
            timestamp: now
        });

        loggingService.info('Step 2: Retrieving rate limit record from cache', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'retrieve_record'
        });

        // Get rate limit record from Redis/in-memory cache
        let record: { count: number; resetTime: number } | null = null;
        try {
            const cachedRecord = await cacheService.get(cacheKey);
            if (cachedRecord) {
                record = cachedRecord as { count: number; resetTime: number };
                
                loggingService.info('Rate limit record retrieved from cache', {
                    component: 'RateLimitMiddleware',
                    operation: 'rateLimitMiddleware',
                    type: 'rate_limit',
                    step: 'record_retrieved',
                    key,
                    cacheKey,
                    currentCount: record.count,
                    resetTime: new Date(record.resetTime).toISOString(),
                    timeUntilReset: record.resetTime - now
                });
            }
        } catch (error) {
            loggingService.warn('Failed to retrieve rate limit record from cache', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'cache_retrieve_failed',
                key,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Step 3: Processing rate limit record', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'process_record'
        });

        // Check if record exists and is still valid
        if (!record || record.resetTime < now) {
            // Create new record
            record = {
                count: 0,
                resetTime: now + windowMs
            };
            
            loggingService.info('New rate limit record created', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'record_created',
                key,
                cacheKey,
                resetTime: new Date(record.resetTime).toISOString(),
                windowMs
            });
        } else {
            loggingService.info('Existing rate limit record found and valid', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'record_valid',
                key,
                cacheKey,
                currentCount: record.count,
                resetTime: new Date(record.resetTime).toISOString(),
                timeUntilReset: record.resetTime - now
            });
        }

        loggingService.info('Step 4: Checking rate limit status', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'check_limit'
        });

        // Check if limit exceeded
        if (record.count >= maxRequests) {
            const retryAfter = Math.ceil((record.resetTime - now) / 1000);
            
            loggingService.warn('Rate limit exceeded', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'limit_exceeded',
                key,
                cacheKey,
                count: record.count,
                maxRequests,
                retryAfter,
                resetTime: new Date(record.resetTime).toISOString()
            });

            loggingService.info('Step 4a: Setting rate limit response headers', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'set_limit_headers'
            });

            res.setHeader('X-RateLimit-Limit', maxRequests.toString());
            res.setHeader('X-RateLimit-Remaining', '0');
            res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
            res.setHeader('Retry-After', retryAfter.toString());

            loggingService.info('Rate limit response headers set', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'headers_set',
                limitHeader: maxRequests.toString(),
                remainingHeader: '0',
                resetHeader: new Date(record.resetTime).toISOString(),
                retryAfterHeader: retryAfter.toString()
            });

            loggingService.info('Step 4b: Sending rate limit exceeded response', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'send_limit_response'
            });

            res.status(429).json({
                error: 'Rate limit exceeded',
                message,
                retryAfter
            });

            loggingService.info('Rate limit exceeded response sent', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'response_sent',
                statusCode: 429,
                retryAfter,
                totalTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== RATE LIMIT MIDDLEWARE COMPLETED (LIMIT EXCEEDED) ===', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'completed_limit_exceeded',
                totalTime: `${Date.now() - startTime}ms`
            });

            return;
        }

        loggingService.info('Step 5: Incrementing rate limit counter', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'increment_counter'
        });

        // Increment counter
        record.count++;

        loggingService.info('Rate limit counter incremented', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'counter_incremented',
            key,
            cacheKey,
            newCount: record.count,
            remaining: maxRequests - record.count
        });

        loggingService.info('Step 6: Storing updated rate limit record in cache', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'store_record'
        });

        // Store updated record in cache
        try {
            const ttl = Math.ceil((record.resetTime - now) / 1000);
            await cacheService.set(cacheKey, record, ttl, {
                type: 'rate_limit',
                key,
                maxRequests,
                windowMs
            });
            
            loggingService.info('Rate limit record stored in cache successfully', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'record_stored',
                key,
                cacheKey,
                ttl,
                count: record.count,
                resetTime: new Date(record.resetTime).toISOString()
            });
        } catch (error) {
            loggingService.warn('Failed to store rate limit record in cache', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'cache_store_failed',
                key,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Step 7: Setting rate limit response headers', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'set_response_headers'
        });

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', (maxRequests - record.count).toString());
        res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

        loggingService.info('Rate limit response headers set successfully', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'response_headers_set',
            limitHeader: maxRequests.toString(),
            remainingHeader: (maxRequests - record.count).toString(),
            resetHeader: new Date(record.resetTime).toISOString()
        });

        // Handle skip options
        if (skipSuccessfulRequests || skipFailedRequests) {
            loggingService.info('Step 8: Setting up skip logic for response handling', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'setup_skip_logic',
                skipSuccessfulRequests,
                skipFailedRequests
            });

            const originalSend = res.send;
            res.send = function(data: any) {
                // Handle skip logic asynchronously without blocking response
                const handleSkipLogic = async () => {
                    if (skipSuccessfulRequests && res.statusCode < 400) {
                        record!.count--;
                        
                        loggingService.debug('Successful request skipped from rate limit count', {
                            component: 'RateLimitMiddleware',
                            operation: 'rateLimitMiddleware',
                            type: 'rate_limit',
                            step: 'success_skipped',
                            key,
                            cacheKey,
                            newCount: record!.count,
                            statusCode: res.statusCode
                        });
                        
                        // Update cache with decremented count
                        try {
                            const ttl = Math.ceil((record!.resetTime - Date.now()) / 1000);
                            if (ttl > 0) {
                                await cacheService.set(cacheKey, record!, ttl);
                            }
                        } catch (error) {
                            loggingService.debug('Failed to update cache after skip', {
                                component: 'RateLimitMiddleware',
                                operation: 'rateLimitMiddleware',
                                type: 'rate_limit',
                                step: 'skip_cache_update_failed',
                                key,
                                cacheKey,
                                error: error instanceof Error ? error.message : 'Unknown error'
                            });
                        }
                    } else if (skipFailedRequests && res.statusCode >= 400) {
                        record!.count--;
                        
                        loggingService.debug('Failed request skipped from rate limit count', {
                            component: 'RateLimitMiddleware',
                            operation: 'rateLimitMiddleware',
                            type: 'rate_limit',
                            step: 'failure_skipped',
                            key,
                            cacheKey,
                            newCount: record!.count,
                            statusCode: res.statusCode
                        });
                        
                        // Update cache with decremented count
                        try {
                            const ttl = Math.ceil((record!.resetTime - Date.now()) / 1000);
                            if (ttl > 0) {
                                await cacheService.set(cacheKey, record!, ttl);
                            }
                        } catch (error) {
                            loggingService.debug('Failed to update cache after skip', {
                                component: 'RateLimitMiddleware',
                                operation: 'rateLimitMiddleware',
                                type: 'rate_limit',
                                step: 'skip_cache_update_failed',
                                key,
                                cacheKey,
                                error: error instanceof Error ? error.message : 'Unknown error'
                            });
                        }
                    }
                };

                // Execute skip logic asynchronously
                handleSkipLogic().catch(error => {
                    loggingService.error('Error in skip logic handling', {
                        component: 'RateLimitMiddleware',
                        operation: 'rateLimitMiddleware',
                        type: 'rate_limit',
                        step: 'skip_logic_error',
                        key,
                        cacheKey,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                });

                return originalSend.call(this, data);
            };

            loggingService.info('Skip logic setup completed', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'skip_logic_setup_complete',
                skipSuccessfulRequests,
                skipFailedRequests
            });
        } else {
            loggingService.debug('No skip logic configured', {
                component: 'RateLimitMiddleware',
                operation: 'rateLimitMiddleware',
                type: 'rate_limit',
                step: 'no_skip_logic',
                skipSuccessfulRequests,
                skipFailedRequests
            });
        }

        loggingService.info('Rate limit check completed successfully', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'check_complete',
            key,
            cacheKey,
            currentCount: record.count,
            maxRequests,
            remaining: maxRequests - record.count,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== RATE LIMIT MIDDLEWARE COMPLETED ===', {
            component: 'RateLimitMiddleware',
            operation: 'rateLimitMiddleware',
            type: 'rate_limit',
            step: 'completed',
            key,
            totalTime: `${Date.now() - startTime}ms`
        });

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
    loggingService.info('User-based rate limit middleware created', {
        component: 'RateLimitMiddleware',
        operation: 'userRateLimit',
        type: 'rate_limit',
        step: 'middleware_created',
        maxRequests,
        windowMs,
        keyType: 'user_id'
    });

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
    loggingService.info('IP-based rate limit middleware created', {
        component: 'RateLimitMiddleware',
        operation: 'ipRateLimit',
        type: 'rate_limit',
        step: 'middleware_created',
        maxRequests,
        windowMs,
        keyType: 'ip_address'
    });

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
    loggingService.info('API key-based rate limit middleware created', {
        component: 'RateLimitMiddleware',
        operation: 'apiKeyRateLimit',
        type: 'rate_limit',
        step: 'middleware_created',
        maxRequests,
        windowMs,
        keyType: 'api_key'
    });

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
    loggingService.info('Endpoint-specific rate limit middleware created', {
        component: 'RateLimitMiddleware',
        operation: 'endpointRateLimit',
        type: 'rate_limit',
        step: 'middleware_created',
        endpoint,
        maxRequests,
        windowMs,
        keyType: 'endpoint_specific'
    });

    return rateLimitMiddleware({
        maxRequests,
        windowMs,
        keyGenerator: (req) => `${req.user?.id || req.ip}:${endpoint}`,
        message: `Too many requests to ${endpoint}. Please try again later.`
    });
}
