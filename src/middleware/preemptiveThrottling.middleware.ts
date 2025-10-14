import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { preemptiveThrottlingService, ThrottlingPhase } from '../services/preemptiveThrottling.service';

/**
 * Preemptive Throttling Middleware
 * Implements early warning and gradual throttling before hitting hard limits
 */

export interface PreemptiveThrottlingOptions {
    enableThrottling?: boolean;
    priority?: 'high' | 'medium' | 'low';
    estimatedCost?: number;
    bypassThrottling?: boolean;
    customDelayHandler?: (delayMs: number, req: any, res: Response) => Promise<boolean>;
    warningHeadersOnly?: boolean; // Only set warning headers, don't delay
    maxDelayMs?: number; // Maximum delay to apply
}

/**
 * Main preemptive throttling middleware
 */
export function preemptiveThrottlingMiddleware(
    options: PreemptiveThrottlingOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    const {
        enableThrottling = true,
        priority = 'medium',
        estimatedCost = 0.1,
        bypassThrottling = false,
        customDelayHandler,
        warningHeadersOnly = false,
        maxDelayMs = 10000 // 10 seconds max delay
    } = options;

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();

        try {
            // Skip throttling for certain conditions
            if (!enableThrottling || bypassThrottling || isEmergencyEndpoint(req.path)) {
                loggingService.debug('Bypassing preemptive throttling', {
                    component: 'PreemptiveThrottlingMiddleware',
                    path: req.path,
                    reason: !enableThrottling ? 'disabled' : bypassThrottling ? 'bypass_flag' : 'emergency_endpoint'
                });
                next();
                return;
            }

            // Get user tier for priority adjustment
            const userTier = getUserTier(req);
            
            // Prepare request metadata
            const requestMetadata = {
                endpoint: req.path,
                priority,
                user_tier: userTier,
                estimated_cost: estimatedCost
            };

            // Check throttling decision
            const decision = await preemptiveThrottlingService.checkThrottling(requestMetadata);

            // Set throttling headers
            setThrottlingHeaders(res, decision);

            // Add throttling info to request
            req.throttling = {
                phase: decision.phase,
                action: decision.action,
                throttling_factor: decision.throttling_factor,
                delay_applied: decision.delay_ms,
                reasons: decision.reasons
            };

            loggingService.debug('Preemptive throttling check completed', {
                component: 'PreemptiveThrottlingMiddleware',
                path: req.path,
                phase: decision.phase,
                action: decision.action,
                allowed: decision.allowed,
                delay_ms: decision.delay_ms,
                throttling_factor: decision.throttling_factor
            });

            // Handle decision
            if (!decision.allowed) {
                // Request blocked
                const retryAfter = decision.retry_after || 60;
                
                loggingService.warn('Request blocked by preemptive throttling', {
                    component: 'PreemptiveThrottlingMiddleware',
                    path: req.path,
                    phase: decision.phase,
                    action: decision.action,
                    retry_after: retryAfter,
                    reasons: decision.reasons
                });

                res.status(503).json({
                    error: 'Service Temporarily Overloaded',
                    message: decision.warning_message || 'System is experiencing high load. Please try again later.',
                    phase: decision.phase,
                    throttling: {
                        active: true,
                        level: decision.phase,
                        retry_after: retryAfter,
                        reasons: decision.reasons
                    }
                });
                return;
            }

            // Apply delay if needed
            if (decision.delay_ms > 0 && !warningHeadersOnly) {
                const actualDelay = Math.min(decision.delay_ms, maxDelayMs);
                
                if (customDelayHandler) {
                    // Use custom delay handler
                    const handled = await customDelayHandler(actualDelay, req, res);
                    if (handled) {
                        return; // Custom handler took care of the response
                    }
                } else {
                    // Apply standard delay
                    await applyThrottlingDelay(actualDelay, decision, req);
                }

                loggingService.info('Preemptive throttling delay applied', {
                    component: 'PreemptiveThrottlingMiddleware',
                    path: req.path,
                    delay_ms: actualDelay,
                    original_delay: decision.delay_ms,
                    phase: decision.phase,
                    action: decision.action
                });
            }

            // Add warning information for monitoring
            if (decision.warning_message) {
                res.setHeader('X-System-Warning', decision.warning_message);
                res.setHeader('X-Warning-Reasons', decision.reasons.join(', '));
            }

            // Continue to next middleware
            const totalTime = Date.now() - startTime;
            
            loggingService.debug('Preemptive throttling middleware completed', {
                component: 'PreemptiveThrottlingMiddleware',
                path: req.path,
                phase: decision.phase,
                total_time: totalTime,
                delay_applied: decision.delay_ms
            });

            next();

        } catch (error) {
            const errorTime = Date.now() - startTime;
            
            loggingService.error('Preemptive throttling middleware error', {
                component: 'PreemptiveThrottlingMiddleware',
                path: req.path,
                error: error instanceof Error ? error.message : String(error),
                error_time: errorTime
            });

            // On error, continue without throttling (fail-safe)
            next();
        }
    };
}

/**
 * Set throttling headers on response
 */
function setThrottlingHeaders(res: Response, decision: any): void {
    res.setHeader('X-Throttling-Phase', decision.phase);
    res.setHeader('X-Throttling-Action', decision.action);
    res.setHeader('X-Throttling-Factor', decision.throttling_factor.toFixed(3));
    
    if (decision.delay_ms > 0) {
        res.setHeader('X-Throttling-Delay', decision.delay_ms.toString());
    }
    
    if (decision.retry_after) {
        res.setHeader('Retry-After', decision.retry_after.toString());
    }
    
    // System load indicators
    res.setHeader('X-System-CPU', decision.metrics.cpu_usage.toFixed(1));
    res.setHeader('X-System-Memory', decision.metrics.memory_usage.toFixed(1));
    res.setHeader('X-System-Response-Time', decision.metrics.response_time.toString());
    res.setHeader('X-System-Error-Rate', decision.metrics.error_rate.toFixed(2));
}

/**
 * Apply throttling delay
 */
async function applyThrottlingDelay(delayMs: number, _decision: any, _req: any): Promise<void> {
    if (delayMs <= 0) return;
    
    return new Promise((resolve) => {
        // Add some jitter to prevent thundering herd
        const jitter = Math.random() * Math.min(delayMs * 0.1, 100); // Up to 10% jitter or 100ms
        const actualDelay = delayMs + jitter;
        
        setTimeout(() => {
            resolve();
        }, actualDelay);
    });
}

/**
 * Get user tier from request
 */
function getUserTier(req: any): 'premium' | 'standard' | 'free' {
    if (req.user?.subscription?.tier) {
        return req.user.subscription.tier;
    }
    
    if (req.user?.plan) {
        const plan = req.user.plan.toLowerCase();
        if (plan.includes('premium') || plan.includes('pro')) return 'premium';
        if (plan.includes('standard') || plan.includes('plus')) return 'standard';
    }
    
    return 'free';
}

/**
 * Check if endpoint is emergency (bypasses throttling)
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
 * Specialized throttling middlewares
 */

/**
 * High priority throttling middleware (reduced delays)
 */
export function highPriorityThrottlingMiddleware(
    options: Omit<PreemptiveThrottlingOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return preemptiveThrottlingMiddleware({
        ...options,
        priority: 'high',
        maxDelayMs: options.maxDelayMs || 5000 // Reduced max delay for high priority
    });
}

/**
 * Critical system throttling middleware (minimal delays)
 */
export function criticalSystemThrottlingMiddleware(
    options: Omit<PreemptiveThrottlingOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return preemptiveThrottlingMiddleware({
        ...options,
        priority: 'high',
        maxDelayMs: options.maxDelayMs || 2000, // Very low max delay
        warningHeadersOnly: options.warningHeadersOnly ?? true // Default to headers only
    });
}

/**
 * Background job throttling middleware (higher delays allowed)
 */
export function backgroundJobThrottlingMiddleware(
    options: Omit<PreemptiveThrottlingOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return preemptiveThrottlingMiddleware({
        ...options,
        priority: 'low',
        maxDelayMs: options.maxDelayMs || 30000 // Higher max delay for background jobs
    });
}

/**
 * API endpoint throttling with user tier awareness
 */
export function apiEndpointThrottlingMiddleware(
    estimatedCost: number = 0.1,
    options: Omit<PreemptiveThrottlingOptions, 'estimatedCost'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return preemptiveThrottlingMiddleware({
        ...options,
        estimatedCost,
        priority: options.priority || 'medium'
    });
}

/**
 * File upload throttling middleware
 */
export function fileUploadThrottlingMiddleware(
    maxFileSize: number = 10 * 1024 * 1024, // 10MB default
    options: Omit<PreemptiveThrottlingOptions, 'estimatedCost'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return preemptiveThrottlingMiddleware({
        ...options,
        estimatedCost: (maxFileSize / (1024 * 1024)) * 0.01, // $0.01 per MB estimate
        priority: 'low', // File uploads are lower priority
        maxDelayMs: options.maxDelayMs || 15000 // Allow longer delays for uploads
    });
}

/**
 * AI processing throttling middleware
 */
export function aiProcessingThrottlingMiddleware(
    modelComplexity: 'simple' | 'medium' | 'complex' = 'medium',
    options: Omit<PreemptiveThrottlingOptions, 'estimatedCost'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    const costEstimates = {
        simple: 0.05,
        medium: 0.2,
        complex: 1.0
    };
    
    return preemptiveThrottlingMiddleware({
        ...options,
        estimatedCost: costEstimates[modelComplexity],
        priority: options.priority || 'medium',
        maxDelayMs: options.maxDelayMs || 20000 // Allow longer delays for AI processing
    });
}

/**
 * Webhook throttling middleware
 */
export function webhookThrottlingMiddleware(
    options: PreemptiveThrottlingOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    return preemptiveThrottlingMiddleware({
        ...options,
        priority: 'low', // Webhooks are typically lower priority
        estimatedCost: options.estimatedCost || 0.02,
        maxDelayMs: options.maxDelayMs || 5000 // Keep webhook delays reasonable
    });
}

/**
 * Database operation throttling middleware
 */
export function databaseThrottlingMiddleware(
    operationType: 'read' | 'write' | 'complex' = 'read',
    options: Omit<PreemptiveThrottlingOptions, 'estimatedCost' | 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    const configs = {
        read: { cost: 0.01, priority: 'medium' as const },
        write: { cost: 0.05, priority: 'high' as const },
        complex: { cost: 0.1, priority: 'low' as const }
    };
    
    const config = configs[operationType];
    
    return preemptiveThrottlingMiddleware({
        ...options,
        estimatedCost: config.cost,
        priority: config.priority,
        maxDelayMs: options.maxDelayMs || 8000
    });
}

/**
 * Custom throttling with dynamic cost calculation
 */
export function dynamicThrottlingMiddleware(
    costCalculator: (req: any) => number,
    priorityCalculator: (req: any) => 'high' | 'medium' | 'low',
    options: Omit<PreemptiveThrottlingOptions, 'estimatedCost' | 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        try {
            const estimatedCost = costCalculator(req);
            const priority = priorityCalculator(req);
            
            const middleware = preemptiveThrottlingMiddleware({
                ...options,
                estimatedCost,
                priority
            });
            
            return middleware(req, res, next);
        } catch (error) {
            loggingService.error('Dynamic throttling calculation failed', {
                component: 'PreemptiveThrottlingMiddleware',
                path: req.path,
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to default throttling
            const fallbackMiddleware = preemptiveThrottlingMiddleware(options);
            return fallbackMiddleware(req, res, next);
        }
    };
}

/**
 * Get current throttling status
 */
export function getCurrentThrottlingStatus(): any {
    return preemptiveThrottlingService.getStatus();
}

/**
 * Force throttling phase change (for testing/emergency)
 */
export async function forceThrottlingPhase(
    phase: ThrottlingPhase, 
    reason: string = 'Manual override'
): Promise<void> {
    return preemptiveThrottlingService.forcePhaseChange(phase, reason);
}

/**
 * Middleware to add throttling status to response headers
 */
export function throttlingStatusMiddleware(): (req: any, res: Response, next: NextFunction) => void {
    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        try {
            const status = preemptiveThrottlingService.getStatus();
            
            res.setHeader('X-System-Throttling-Phase', status.phase);
            res.setHeader('X-System-Throttling-Action', status.action);
            res.setHeader('X-System-Load-Factor', status.throttling_factor.toFixed(3));
            res.setHeader('X-System-Phase-Duration', status.phase_duration.toString());
            
            next();
        } catch (error) {
            // Don't fail the request if status check fails
            next();
        }
    };
}

/**
 * Response time tracking middleware for throttling metrics
 */
export function responseTimeTrackingMiddleware(): (req: any, res: Response, next: NextFunction) => void {
    return (req: any, res: Response, next: NextFunction): void => {
        const startTime = Date.now();
        
        // Override response methods to capture completion time
        const originalSend = res.send;
        const originalJson = res.json;
        const originalEnd = res.end;
        
        const recordResponseTime = () => {
            const responseTime = Date.now() - startTime;
            res.setHeader('X-Response-Time', responseTime.toString());
            
            // Store in request for potential use by other middleware
            req.responseTime = responseTime;
        };
        
        res.send = function(data: any) {
            recordResponseTime();
            return originalSend.call(this, data);
        };
        
        res.json = function(data: any) {
            recordResponseTime();
            return originalJson.call(this, data);
        };
        
        res.end = function(data?: any) {
            recordResponseTime();
            return originalEnd.call(this, data, 'utf8');
        };
        
        next();
    };
}
