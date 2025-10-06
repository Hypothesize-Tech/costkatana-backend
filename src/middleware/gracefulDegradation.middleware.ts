import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { gracefulDegradationService, DegradationLevel, ServiceMode } from '../services/gracefulDegradation.service';

/**
 * Graceful Degradation Middleware
 * Applies degradation strategies and fallback mechanisms based on system load
 */

export interface DegradationMiddlewareOptions {
    enableDegradation?: boolean;
    requiredFeatures?: string[];
    fallbackMode?: 'cache' | 'simplified' | 'static' | 'offline';
    bypassDegradation?: boolean;
    customFallback?: (req: any, res: Response, degradationLevel: DegradationLevel) => Promise<boolean>;
    estimatedProcessingTime?: number;
    maxRequestSize?: number;
}

/**
 * Main graceful degradation middleware
 */
export function gracefulDegradationMiddleware(
    options: DegradationMiddlewareOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    const {
        enableDegradation = true,
        requiredFeatures = [],
        fallbackMode = 'cache',
        bypassDegradation = false,
        customFallback,
        estimatedProcessingTime = 5000,
        maxRequestSize = 10 * 1024 * 1024 // 10MB
    } = options;

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();

        try {
            // Skip degradation for certain conditions
            if (!enableDegradation || bypassDegradation || isEmergencyEndpoint(req.path)) {
                loggingService.debug('Bypassing graceful degradation', {
                    component: 'GracefulDegradationMiddleware',
                    path: req.path,
                    reason: !enableDegradation ? 'disabled' : bypassDegradation ? 'bypass_flag' : 'emergency_endpoint'
                });
                next();
                return;
            }

            // Get current degradation status
            const status = gracefulDegradationService.getStatus();
            const currentLevel = status.level;
            const currentMode = status.mode;

            loggingService.debug('Checking graceful degradation', {
                component: 'GracefulDegradationMiddleware',
                path: req.path,
                method: req.method,
                currentLevel,
                currentMode,
                requiredFeatures
            });

            // Add degradation info to request
            req.degradation = {
                level: currentLevel,
                mode: currentMode,
                strategy: status.strategy
            };

            // Check if required features are available
            if (requiredFeatures.length > 0) {
                const unavailableFeatures = requiredFeatures.filter(
                    feature => !gracefulDegradationService.isFeatureEnabled(feature as any)
                );

                if (unavailableFeatures.length > 0) {
                    loggingService.info('Required features unavailable due to degradation', {
                        component: 'GracefulDegradationMiddleware',
                        path: req.path,
                        unavailableFeatures,
                        currentLevel
                    });

                    const fallbackHandled = await handleFeatureFallback(
                        req, res, unavailableFeatures, currentLevel, customFallback
                    );

                    if (fallbackHandled) {
                        return;
                    }
                }
            }

            // Check request limits
            const requestSize = getRequestSize(req);
            const shouldProcess = gracefulDegradationService.shouldProcessRequest(
                requestSize, 
                estimatedProcessingTime
            );

            if (!shouldProcess.allowed) {
                loggingService.info('Request rejected due to degradation limits', {
                    component: 'GracefulDegradationMiddleware',
                    path: req.path,
                    reason: shouldProcess.reason,
                    requestSize,
                    estimatedTime: estimatedProcessingTime,
                    currentLevel
                });

                // Try fallback response
                const fallbackResponse = await gracefulDegradationService.getFallbackResponse(
                    req.path,
                    req.method,
                    { query: req.query, body: req.body }
                );

                if (fallbackResponse.success) {
                    res.setHeader('X-Degradation-Mode', currentMode);
                    res.setHeader('X-Degradation-Level', currentLevel);
                    res.setHeader('X-Response-Source', fallbackResponse.source);
                    res.setHeader('X-Degradation-Reason', shouldProcess.reason || 'Request limits exceeded');

                    res.json({
                        success: true,
                        data: fallbackResponse.data,
                        metadata: {
                            degradation: {
                                level: currentLevel,
                                mode: currentMode,
                                source: fallbackResponse.source,
                                reason: shouldProcess.reason
                            }
                        }
                    });
                    return;
                }

                // No fallback available - return error
                res.status(503).json({
                    error: 'Service Temporarily Degraded',
                    message: shouldProcess.reason,
                    degradation: {
                        level: currentLevel,
                        mode: currentMode,
                        suggestion: shouldProcess.fallback
                    },
                    retryAfter: calculateRetryAfter(currentLevel)
                });
                return;
            }

            // Apply degradation-specific modifications to request
            applyDegradationModifications(req, status.strategy);

            // Set degradation headers
            res.setHeader('X-Degradation-Mode', currentMode);
            res.setHeader('X-Degradation-Level', currentLevel);
            res.setHeader('X-Features-Available', Object.entries(status.strategy.features)
                .filter(([_, enabled]) => enabled)
                .map(([feature, _]) => feature)
                .join(','));

            // Override response methods to apply degradation
            setupResponseOverrides(req, res, status);

            loggingService.debug('Graceful degradation check completed', {
                component: 'GracefulDegradationMiddleware',
                path: req.path,
                currentLevel,
                currentMode,
                processingAllowed: true,
                totalTime: Date.now() - startTime
            });

            next();

        } catch (error) {
            loggingService.error('Graceful degradation middleware error', {
                component: 'GracefulDegradationMiddleware',
                path: req.path,
                error: error instanceof Error ? error.message : String(error),
                totalTime: Date.now() - startTime
            });

            // On error, continue without degradation (fail-safe)
            next();
        }
    };
}

/**
 * Handle fallback when required features are unavailable
 */
async function handleFeatureFallback(
    req: any,
    res: Response,
    unavailableFeatures: string[],
    currentLevel: DegradationLevel,
    customFallback?: (req: any, res: Response, degradationLevel: DegradationLevel) => Promise<boolean>
): Promise<boolean> {
    // Try custom fallback first
    if (customFallback) {
        try {
            const handled = await customFallback(req, res, currentLevel);
            if (handled) return true;
        } catch (error) {
            loggingService.warn('Custom fallback failed', {
                component: 'GracefulDegradationMiddleware',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Default fallback responses for specific features
    const featureFallbacks: Record<string, any> = {
        ai_processing: {
            error: 'AI Processing Temporarily Unavailable',
            message: 'AI processing is disabled due to high system load. Please try again later.',
            fallback_data: { status: 'unavailable', reason: 'system_load' }
        },
        real_time_updates: {
            error: 'Real-time Updates Disabled',
            message: 'Real-time updates are temporarily disabled. Data may be cached.',
            fallback_data: { update_mode: 'polling', interval: 60000 }
        },
        complex_queries: {
            error: 'Complex Queries Disabled',
            message: 'Complex queries are temporarily disabled. Try a simpler query.',
            fallback_data: { suggestion: 'Use basic filters only' }
        },
        file_uploads: {
            error: 'File Uploads Disabled',
            message: 'File uploads are temporarily disabled due to system load.',
            fallback_data: { max_size: 0, retry_after: 300 }
        },
        notifications: {
            error: 'Notifications Disabled',
            message: 'Notifications are temporarily disabled. Check back later for updates.',
            fallback_data: { delivery_mode: 'none' }
        },
        webhooks: {
            error: 'Webhooks Disabled',
            message: 'Webhook delivery is temporarily disabled. Events will be queued.',
            fallback_data: { delivery_status: 'queued' }
        }
    };

    // Find the most relevant fallback
    for (const feature of unavailableFeatures) {
        if (featureFallbacks[feature]) {
            const fallback = featureFallbacks[feature];
            
            res.setHeader('X-Degradation-Level', currentLevel);
            res.setHeader('X-Unavailable-Features', unavailableFeatures.join(','));
            res.setHeader('Retry-After', calculateRetryAfter(currentLevel).toString());

            res.status(503).json({
                ...fallback,
                degradation: {
                    level: currentLevel,
                    unavailable_features: unavailableFeatures,
                    retry_after: calculateRetryAfter(currentLevel)
                }
            });
            
            return true;
        }
    }

    return false;
}

/**
 * Apply degradation-specific modifications to request
 */
function applyDegradationModifications(req: any, strategy: any): void {
    // Modify request based on degradation strategy
    
    // Reduce query complexity
    if (!strategy.features.complex_queries && req.query) {
        // Remove complex query parameters
        const complexParams = ['sort', 'group_by', 'aggregate', 'join'];
        complexParams.forEach(param => delete req.query[param]);
        
        // Limit result size
        if (req.query.limit && parseInt(req.query.limit) > 100) {
            req.query.limit = '100';
        }
    }

    // Disable real-time features
    if (!strategy.features.real_time_updates) {
        req.headers['x-disable-realtime'] = 'true';
        req.disableRealtime = true;
    }

    // Set cache preferences
    if (strategy.fallbacks.use_cache) {
        req.headers['x-prefer-cache'] = 'true';
        req.preferCache = true;
        
        // Extend cache TTL
        req.cacheTTLMultiplier = strategy.limits.cache_ttl_multiplier;
    }

    // Mark request as degraded
    req.isDegraded = true;
    req.degradationLevel = strategy.level;
}

/**
 * Setup response overrides for degradation
 */
function setupResponseOverrides(req: any, res: Response, status: any): void {
    const originalJson = res.json;
    const originalSend = res.send;

    // Override json method to apply degradation
    res.json = function(data: any) {
        // Apply response modifications based on degradation
        if (status.strategy.fallbacks.simplified_responses) {
            data = simplifyResponseData(data, status.level);
        }

        // Add degradation metadata
        if (typeof data === 'object' && data !== null) {
            data._degradation = {
                level: status.level,
                mode: status.mode,
                simplified: status.strategy.fallbacks.simplified_responses,
                cache_enhanced: status.strategy.fallbacks.use_cache
            };
        }

        return originalJson.call(this, data);
    };

    // Override send method
    res.send = function(data: any) {
        // Set degradation headers
        this.setHeader('X-Response-Degraded', 'true');
        this.setHeader('X-Degradation-Level', status.level);
        
        return originalSend.call(this, data);
    };
}

/**
 * Simplify response data based on degradation level
 */
function simplifyResponseData(data: any, level: DegradationLevel): any {
    if (!data || typeof data !== 'object') {
        return data;
    }

    const simplified = { ...data };

    switch (level) {
        case 'minimal':
            // Remove non-essential fields
            delete simplified.analytics;
            delete simplified.detailed_stats;
            delete simplified.metadata?.extended;
            break;

        case 'moderate':
            // Keep only essential data
            const essentialFields = ['id', 'name', 'status', 'message', 'data', 'results'];
            const filtered: any = {};
            essentialFields.forEach(field => {
                if (simplified[field] !== undefined) {
                    filtered[field] = simplified[field];
                }
            });
            return { ...filtered, _simplified: true };

        case 'aggressive':
            // Minimal data only
            return {
                status: simplified.status || 'ok',
                message: simplified.message || 'Request processed in degraded mode',
                _minimal: true
            };

        case 'emergency':
            // Absolute minimum
            return {
                status: 'degraded',
                message: 'Service in emergency mode',
                _emergency: true
            };
    }

    return simplified;
}

/**
 * Calculate retry after time based on degradation level
 */
function calculateRetryAfter(level: DegradationLevel): number {
    const retryTimes: Record<DegradationLevel, number> = {
        none: 0,
        minimal: 60,      // 1 minute
        moderate: 180,    // 3 minutes
        aggressive: 300,  // 5 minutes
        emergency: 600    // 10 minutes
    };

    return retryTimes[level] || 60;
}

/**
 * Get request size estimate
 */
function getRequestSize(req: any): number {
    let size = 0;
    
    // Headers
    if (req.headers) {
        size += JSON.stringify(req.headers).length;
    }
    
    // Query parameters
    if (req.query) {
        size += JSON.stringify(req.query).length;
    }
    
    // Body
    if (req.body) {
        size += JSON.stringify(req.body).length;
    }
    
    // Files
    if (req.files) {
        size += Array.isArray(req.files) 
            ? req.files.reduce((total: number, file: any) => total + (file.size || 0), 0)
            : Object.values(req.files).reduce((total: number, file: any) => total + (file.size || 0), 0);
    }
    
    return size;
}

/**
 * Check if endpoint is emergency (bypasses degradation)
 */
function isEmergencyEndpoint(path: string): boolean {
    const emergencyPaths = [
        '/api/emergency',
        '/api/health/critical',
        '/api/system/emergency',
        '/api/auth/emergency'
    ];
    
    return emergencyPaths.some(emergency => path.startsWith(emergency));
}

/**
 * Feature-specific degradation middlewares
 */

/**
 * AI Processing degradation middleware
 */
export function aiProcessingDegradationMiddleware(
    fallbackResponse?: any
): (req: any, res: Response, next: NextFunction) => void {
    return gracefulDegradationMiddleware({
        requiredFeatures: ['ai_processing'],
        customFallback: async (req, res, level) => {
            if (fallbackResponse) {
                res.setHeader('X-AI-Processing-Disabled', 'true');
                res.json(fallbackResponse);
                return true;
            }
            return false;
        }
    });
}

/**
 * File upload degradation middleware
 */
export function fileUploadDegradationMiddleware(
    maxSizeOverride?: number
): (req: any, res: Response, next: NextFunction) => void {
    return gracefulDegradationMiddleware({
        requiredFeatures: ['file_uploads'],
        maxRequestSize: maxSizeOverride,
        customFallback: async (req, res, level) => {
            res.status(503).json({
                error: 'File Uploads Temporarily Disabled',
                message: 'File upload functionality is temporarily disabled due to system load.',
                degradation: { level, retry_after: calculateRetryAfter(level) }
            });
            return true;
        }
    });
}

/**
 * Real-time updates degradation middleware
 */
export function realtimeDegradationMiddleware(): (req: any, res: Response, next: NextFunction) => void {
    return gracefulDegradationMiddleware({
        requiredFeatures: ['real_time_updates'],
        customFallback: async (req, res, level) => {
            res.setHeader('X-Realtime-Disabled', 'true');
            res.json({
                message: 'Real-time updates disabled, using cached data',
                update_mode: 'polling',
                poll_interval: 60000,
                degradation: { level }
            });
            return true;
        }
    });
}

/**
 * Complex query degradation middleware
 */
export function complexQueryDegradationMiddleware(): (req: any, res: Response, next: NextFunction) => void {
    return gracefulDegradationMiddleware({
        requiredFeatures: ['complex_queries'],
        customFallback: async (req, res, level) => {
            res.status(503).json({
                error: 'Complex Queries Temporarily Disabled',
                message: 'Complex query operations are temporarily disabled. Please use simpler queries.',
                suggestion: 'Remove sorting, grouping, and aggregation parameters',
                degradation: { level, retry_after: calculateRetryAfter(level) }
            });
            return true;
        }
    });
}

/**
 * Get degradation status
 */
export function getDegradationStatus(): any {
    return gracefulDegradationService.getStatus();
}

/**
 * Force degradation level (for testing/emergency)
 */
export async function forceDegradationLevel(level: DegradationLevel, reason: string = 'Manual override'): Promise<void> {
    return gracefulDegradationService.setDegradationLevel(level, reason);
}
