import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { cacheService } from '../services/cache.service';
import { adaptiveRateLimitService, AdaptiveRateLimitConfig } from '../services/adaptiveRateLimit.service';

/**
 * Enhanced Adaptive Rate Limiting Middleware
 * Provides sophisticated traffic management with system load awareness
 */

export interface AdaptiveRateLimitOptions extends Partial<AdaptiveRateLimitConfig> {
    keyGenerator?: (req: any) => string;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
    message?: string;
    priority?: 'high' | 'medium' | 'low';
    endpoint?: string;
    enableGracefulDegradation?: boolean;
    degradationMode?: 'reduce_features' | 'cache_only' | 'essential_only';
}

/**
 * Adaptive rate limiting middleware with system load awareness
 */
export function adaptiveRateLimitMiddleware(options: AdaptiveRateLimitOptions = {}): (req: any, res: Response, next: NextFunction) => void {
    const {
        keyGenerator = (req) => req.user?.id || req.ip || 'unknown',
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        message = 'Rate limit exceeded. System is under high load.',
        priority = 'medium',
        endpoint = 'unknown',
        enableGracefulDegradation = true,
        degradationMode = 'reduce_features',
        ...rateLimitConfig
    } = options;

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        loggingService.info('=== ADAPTIVE RATE LIMIT MIDDLEWARE STARTED ===', {
            component: 'AdaptiveRateLimitMiddleware',
            operation: 'adaptiveRateLimitMiddleware',
            type: 'adaptive_rate_limit',
            path: req.path,
            method: req.method,
            priority,
            endpoint
        });

        try {
            const key = keyGenerator(req);
            const cacheKey = `adaptive_rate_limit:${key}`;
            
            // Check adaptive rate limit
            const decision = await adaptiveRateLimitService.checkRateLimit(
                key,
                rateLimitConfig,
                { 
                    userId: req.user?.id,
                    endpoint,
                    priority
                }
            );

            // Log the decision
            loggingService.info('Adaptive rate limit decision made', {
                component: 'AdaptiveRateLimitMiddleware',
                key,
                decision,
                systemLoad: decision.systemLoad,
                trafficPressure: decision.trafficPressure
            });

            // Set response headers
            res.setHeader('X-RateLimit-Limit', decision.currentLimit.toString());
            res.setHeader('X-RateLimit-Adaptive-Limit', decision.adjustedLimit.toString());
            res.setHeader('X-RateLimit-System-Load', decision.systemLoad.toFixed(2));
            res.setHeader('X-RateLimit-Traffic-Pressure', decision.trafficPressure.toFixed(2));

            if (!decision.allowed) {
                // Handle rate limit exceeded
                if (enableGracefulDegradation && priority !== 'high') {
                    // Try graceful degradation instead of hard rejection
                    const degradationResult = await handleGracefulDegradation(req, res, degradationMode);
                    
                    if (degradationResult.handled) {
                        loggingService.info('Request handled via graceful degradation', {
                            component: 'AdaptiveRateLimitMiddleware',
                            key,
                            degradationMode,
                            reason: degradationResult.reason
                        });
                        return;
                    }
                }

                // Hard rate limit - reject request
                const retryAfter = decision.retryAfter || 60;
                
                res.setHeader('X-RateLimit-Remaining', '0');
                res.setHeader('Retry-After', retryAfter.toString());
                res.setHeader('X-RateLimit-Reset', new Date(Date.now() + (retryAfter * 1000)).toISOString());
                res.setHeader('X-RateLimit-Reason', decision.reason);

                loggingService.warn('Adaptive rate limit exceeded', {
                    component: 'AdaptiveRateLimitMiddleware',
                    key,
                    systemLoad: decision.systemLoad,
                    trafficPressure: decision.trafficPressure,
                    adjustedLimit: decision.adjustedLimit,
                    retryAfter,
                    reason: decision.reason
                });

                res.status(429).json({
                    error: 'Rate limit exceeded',
                    message,
                    retryAfter,
                    systemLoad: decision.systemLoad,
                    reason: decision.reason,
                    adaptiveLimit: decision.adjustedLimit
                });

                return;
            }

            // Update usage counter
            await updateUsageCounter(cacheKey, decision.adjustedLimit);

            // Calculate remaining requests
            const currentUsage = await getCurrentUsage(cacheKey);
            const remaining = Math.max(0, decision.adjustedLimit - currentUsage);
            
            res.setHeader('X-RateLimit-Remaining', remaining.toString());
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 60000).toISOString());

            // Handle skip logic for successful/failed requests
            if (skipSuccessfulRequests || skipFailedRequests) {
                setupSkipLogic(req, res, cacheKey, skipSuccessfulRequests, skipFailedRequests);
            }

            // Add system load information to request for downstream middleware
            req.systemLoad = {
                load: decision.systemLoad,
                trafficPressure: decision.trafficPressure,
                adaptedLimit: decision.adjustedLimit
            };

            loggingService.info('Adaptive rate limit check passed', {
                component: 'AdaptiveRateLimitMiddleware',
                key,
                remaining,
                systemLoad: decision.systemLoad,
                trafficPressure: decision.trafficPressure,
                totalTime: `${Date.now() - startTime}ms`
            });

            next();

        } catch (error) {
            loggingService.error('Adaptive rate limit middleware error', {
                component: 'AdaptiveRateLimitMiddleware',
                error: error instanceof Error ? error.message : String(error),
                path: req.path,
                method: req.method,
                totalTime: `${Date.now() - startTime}ms`
            });

            // Fallback to allowing request on error
            next();
        }
    };
}

/**
 * Handle graceful degradation when rate limits are exceeded
 */
async function handleGracefulDegradation(
    req: any,
    res: Response,
    mode: 'reduce_features' | 'cache_only' | 'essential_only',
): Promise<{ handled: boolean; reason?: string }> {
    try {
        switch (mode) {
            case 'cache_only':
                // Try to serve from cache if available
                const cacheResult = await tryServeFromCache(req);
                if (cacheResult.success) {
                    res.setHeader('X-Served-From', 'cache-degradation');
                    res.setHeader('X-Degradation-Mode', 'cache_only');
                    res.json(cacheResult.data);
                    return { handled: true, reason: 'Served from cache during high load' };
                }
                break;

            case 'reduce_features':
                // Set flag for reduced functionality
                req.degradationMode = 'reduce_features';
                req.systemOverload = true;
                res.setHeader('X-Degradation-Mode', 'reduce_features');
                res.setHeader('X-System-Load-Warning', 'true');
                return { handled: false }; // Continue processing but with reduced features

            case 'essential_only':
                // Only allow essential endpoints
                if (isEssentialEndpoint(req.path)) {
                    req.degradationMode = 'essential_only';
                    res.setHeader('X-Degradation-Mode', 'essential_only');
                    return { handled: false }; // Continue processing
                }
                break;
        }

        return { handled: false };

    } catch (error) {
        loggingService.warn('Graceful degradation failed', {
            component: 'AdaptiveRateLimitMiddleware',
            mode,
            error: error instanceof Error ? error.message : String(error)
        });
        return { handled: false };
    }
}

/**
 * Try to serve request from cache
 */
async function tryServeFromCache(req: any): Promise<{ success: boolean; data?: any }> {
    try {
        const cacheKey = `degradation_cache:${req.path}:${JSON.stringify(req.query)}`;
        const cachedData = await cacheService.get(cacheKey);
        
        if (cachedData) {
            return { success: true, data: cachedData };
        }
        
        return { success: false };
    } catch (error) {
        return { success: false };
    }
}

/**
 * Check if endpoint is essential and should be allowed during degradation
 */
function isEssentialEndpoint(path: string): boolean {
    const essentialPaths = [
        '/api/health',
        '/api/status',
        '/api/auth/logout',
        '/api/emergency',
        '/api/system/status'
    ];
    
    return essentialPaths.some(essential => path.startsWith(essential));
}

/**
 * Update usage counter
 */
async function updateUsageCounter(cacheKey: string, limit: number): Promise<void> {
    try {
        const now = Date.now();
        const windowMs = 60000; // 1 minute window
        
        let record = await cacheService.get(cacheKey);
        if (!record) {
            record = { count: 0, resetTime: now + windowMs };
        }

        const recordData = record as any;
        
        // Check if window has expired
        if (recordData.resetTime < now) {
            recordData.count = 0;
            recordData.resetTime = now + windowMs;
        }

        recordData.count++;
        
        const ttl = Math.ceil((recordData.resetTime - now) / 1000);
        await cacheService.set(cacheKey, recordData, ttl);
        
    } catch (error) {
        loggingService.warn('Failed to update usage counter', {
            component: 'AdaptiveRateLimitMiddleware',
            cacheKey,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

/**
 * Get current usage for a key
 */
async function getCurrentUsage(cacheKey: string): Promise<number> {
    try {
        const record = await cacheService.get(cacheKey);
        if (!record) return 0;
        
        const recordData = record as any;
        const now = Date.now();
        
        // Check if window has expired
        if (recordData.resetTime < now) {
            return 0;
        }
        
        return recordData.count || 0;
    } catch (error) {
        return 0;
    }
}

/**
 * Setup skip logic for successful/failed requests
 */
function setupSkipLogic(
    req: any,
    res: Response,
    cacheKey: string,
    skipSuccessfulRequests: boolean,
    skipFailedRequests: boolean
): void {
    const originalSend = res.send;
    
    res.send = function(data: any) {
        // Handle skip logic asynchronously
        const handleSkipLogic = async () => {
            try {
                let shouldDecrement = false;
                
                if (skipSuccessfulRequests && res.statusCode < 400) {
                    shouldDecrement = true;
                    loggingService.debug('Successful request skipped from adaptive rate limit count', {
                        component: 'AdaptiveRateLimitMiddleware',
                        cacheKey,
                        statusCode: res.statusCode
                    });
                } else if (skipFailedRequests && res.statusCode >= 400) {
                    shouldDecrement = true;
                    loggingService.debug('Failed request skipped from adaptive rate limit count', {
                        component: 'AdaptiveRateLimitMiddleware',
                        cacheKey,
                        statusCode: res.statusCode
                    });
                }
                
                if (shouldDecrement) {
                    const record = await cacheService.get(cacheKey);
                    if (record) {
                        const recordData = record as any;
                        recordData.count = Math.max(0, recordData.count - 1);
                        
                        const now = Date.now();
                        const ttl = Math.ceil((recordData.resetTime - now) / 1000);
                        if (ttl > 0) {
                            await cacheService.set(cacheKey, recordData, ttl);
                        }
                    }
                }
            } catch (error) {
                loggingService.debug('Skip logic handling failed', {
                    component: 'AdaptiveRateLimitMiddleware',
                    cacheKey,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        };

        // Execute skip logic asynchronously
        handleSkipLogic().catch(error => {
            loggingService.error('Error in adaptive rate limit skip logic', {
                component: 'AdaptiveRateLimitMiddleware',
                cacheKey,
                error: error instanceof Error ? error.message : String(error)
            });
        });

        return originalSend.call(this, data);
    };
}

/**
 * User-based adaptive rate limiting
 */
export function userAdaptiveRateLimit(
    config: Partial<AdaptiveRateLimitConfig> = {},
    options: Omit<AdaptiveRateLimitOptions, keyof AdaptiveRateLimitConfig> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return adaptiveRateLimitMiddleware({
        ...config,
        ...options,
        keyGenerator: (req) => req.user?.id || 'anonymous',
        priority: options.priority || 'medium'
    });
}

/**
 * IP-based adaptive rate limiting
 */
export function ipAdaptiveRateLimit(
    config: Partial<AdaptiveRateLimitConfig> = {},
    options: Omit<AdaptiveRateLimitOptions, keyof AdaptiveRateLimitConfig> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return adaptiveRateLimitMiddleware({
        ...config,
        ...options,
        keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
        priority: options.priority || 'low'
    });
}

/**
 * API key-based adaptive rate limiting
 */
export function apiKeyAdaptiveRateLimit(
    config: Partial<AdaptiveRateLimitConfig> = {},
    options: Omit<AdaptiveRateLimitOptions, keyof AdaptiveRateLimitConfig> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return adaptiveRateLimitMiddleware({
        ...config,
        ...options,
        keyGenerator: (req) => {
            const apiKey = req.headers['x-api-key'] as string || 
                          req.headers['authorization']?.replace('Bearer ', '') || 
                          'no-key';
            return `api-key:${apiKey}`;
        },
        priority: options.priority || 'high'
    });
}

/**
 * Critical endpoint adaptive rate limiting (higher priority)
 */
export function criticalEndpointAdaptiveRateLimit(
    endpoint: string,
    config: Partial<AdaptiveRateLimitConfig> = {},
    options: Omit<AdaptiveRateLimitOptions, keyof AdaptiveRateLimitConfig> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return adaptiveRateLimitMiddleware({
        ...config,
        ...options,
        keyGenerator: (req) => `${req.user?.id || req.ip}:critical:${endpoint}`,
        priority: 'high',
        endpoint,
        enableGracefulDegradation: false // Critical endpoints don't degrade
    });
}

/**
 * Background job adaptive rate limiting (lower priority)
 */
export function backgroundJobAdaptiveRateLimit(
    config: Partial<AdaptiveRateLimitConfig> = {},
    options: Omit<AdaptiveRateLimitOptions, keyof AdaptiveRateLimitConfig> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return adaptiveRateLimitMiddleware({
        ...config,
        ...options,
        keyGenerator: (req) => `${req.user?.id || req.ip}:background`,
        priority: 'low',
        enableGracefulDegradation: true,
        degradationMode: 'essential_only',
        // More aggressive limits for background jobs
        baseLimit: config.baseLimit ? Math.floor(config.baseLimit * 0.5) : 50,
        scalingFactor: config.scalingFactor || 0.9 // More aggressive scaling
    });
}

/**
 * Get adaptive rate limiting statistics
 */
export async function getAdaptiveRateLimitStats(): Promise<any> {
    try {
        return await adaptiveRateLimitService.getStatistics();
    } catch (error) {
        loggingService.error('Failed to get adaptive rate limit statistics', {
            component: 'AdaptiveRateLimitMiddleware',
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}
