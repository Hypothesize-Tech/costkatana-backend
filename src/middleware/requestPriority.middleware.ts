import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { requestPrioritizationService, RequestPriority } from '../services/requestPrioritization.service';

/**
 * Request Priority Middleware
 * Routes requests through priority queues based on importance and system load
 */

export interface PriorityMiddlewareOptions {
    priority?: RequestPriority;
    estimatedDuration?: number;
    deadline?: number; // timestamp
    cost?: number;
    bypassQueue?: boolean; // For emergency endpoints
    queueTimeout?: number;
    priorityDetector?: (req: any) => RequestPriority;
    metadataExtractor?: (req: any) => any;
}

/**
 * Main priority middleware
 */
export function requestPriorityMiddleware(
    options: PriorityMiddlewareOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    const {
        priority = 'medium',
        estimatedDuration = 5000, // 5 seconds default
        bypassQueue = false,
        queueTimeout = 30000, // 30 seconds
        priorityDetector,
        metadataExtractor
    } = options;

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        // Skip queue for certain conditions
        if (bypassQueue || isEmergencyEndpoint(req.path) || req.systemEmergency) {
            loggingService.info('Request bypassing priority queue', {
                component: 'RequestPriorityMiddleware',
                path: req.path,
                reason: bypassQueue ? 'configured_bypass' : 'emergency_endpoint'
            });
            next();
            return;
        }

        try {
            // Determine request priority
            const requestPriority = priorityDetector ? priorityDetector(req) : determinePriority(req, priority);
            
            // Extract metadata
            const metadata = {
                userTier: getUserTier(req),
                requestType: getRequestType(req),
                estimatedDuration,
                deadline: options.deadline,
                cost: options.cost,
                retryCount: getRetryCount(req),
                ...(metadataExtractor ? metadataExtractor(req) : {})
            };

            loggingService.info('Request entering priority queue', {
                component: 'RequestPriorityMiddleware',
                path: req.path,
                method: req.method,
                priority: requestPriority,
                metadata,
                userId: req.user?.id
            });

            // Create processor function that continues the middleware chain
            const processor = async (): Promise<any> => {
                return new Promise<void>((resolve, reject) => {
                    // Set up response handling
                    const originalSend = res.send;
                    const originalJson = res.json;
                    const originalEnd = res.end;
                    let resolved = false;

                    const resolveOnce = (result?: any) => {
                        if (!resolved) {
                            resolved = true;
                            resolve(result);
                        }
                    };

                    const rejectOnce = (error: any) => {
                        if (!resolved) {
                            resolved = true;
                            reject(error);
                        }
                    };

                    // Override response methods to capture completion
                    res.send = function(data: any) {
                        const result = originalSend.call(this, data);
                        resolveOnce(data);
                        return result;
                    };

                    res.json = function(data: any) {
                        const result = originalJson.call(this, data);
                        resolveOnce(data);
                        return result;
                    };

                    res.end = function(data?: any) {
                        const result = originalEnd.call(this, data, 'utf8');
                        resolveOnce(data);
                        return result;
                    };

                    // Handle errors
                    res.on('error', rejectOnce);

                    // Set timeout for processing
                    const processingTimeout = setTimeout(() => {
                        rejectOnce(new Error('Request processing timeout'));
                    }, estimatedDuration + 10000); // Add 10s buffer

                    // Continue middleware chain
                    try {
                        next();
                        
                        // Clear timeout once middleware chain starts
                        clearTimeout(processingTimeout);
                    } catch (error) {
                        clearTimeout(processingTimeout);
                        rejectOnce(error);
                    }
                });
            };

            // Enqueue the request
            await requestPrioritizationService.enqueueRequest(
                requestPriority,
                req.path,
                req.method,
                processor,
                metadata
            );

            const queueTime = Date.now() - startTime;
            
            loggingService.info('Request completed via priority queue', {
                component: 'RequestPriorityMiddleware',
                path: req.path,
                method: req.method,
                priority: requestPriority,
                queueTime,
                totalTime: Date.now() - startTime
            });

        } catch (error) {
            const errorTime = Date.now() - startTime;
            
            loggingService.error('Request priority middleware error', {
                component: 'RequestPriorityMiddleware',
                path: req.path,
                method: req.method,
                error: error instanceof Error ? error.message : String(error),
                errorTime
            });

            // On error, continue without queuing (fail-safe)
            if (error instanceof Error && error.message.includes('Queue is full')) {
                // Queue is full - return 503 Service Unavailable
                res.status(503).json({
                    error: 'Service Temporarily Unavailable',
                    message: 'System is at capacity. Please try again later.',
                    retryAfter: 60
                });
                return;
            }

            // For other errors, continue processing
            next();
        }
    };
}

/**
 * Determine request priority based on various factors
 */
function determinePriority(req: any, defaultPriority: RequestPriority): RequestPriority {
    // Critical system endpoints
    if (isCriticalSystemEndpoint(req.path)) {
        return 'critical';
    }

    // Authentication and security endpoints
    if (isAuthenticationEndpoint(req.path)) {
        return 'high';
    }

    // API endpoints based on user tier
    const userTier = getUserTier(req);
    if (userTier === 'premium') {
        // Upgrade priority for premium users
        if (defaultPriority === 'medium') return 'high';
        if (defaultPriority === 'low') return 'medium';
    }

    // Background jobs and webhooks
    if (isBackgroundJob(req)) {
        return 'background';
    }

    // System monitoring and health checks
    if (isMonitoringEndpoint(req.path)) {
        return 'low';
    }

    return defaultPriority;
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
 * Get request type
 */
function getRequestType(req: any): 'api' | 'webhook' | 'background' | 'system' {
    if (req.path.startsWith('/api/webhook')) return 'webhook';
    if (req.path.startsWith('/api/system') || req.path.startsWith('/api/health')) return 'system';
    if (req.headers['x-background-job'] === 'true' || req.isBackgroundJob) return 'background';
    return 'api';
}

/**
 * Get retry count from request headers
 */
function getRetryCount(req: any): number {
    const retryHeader = req.headers['x-retry-count'];
    return retryHeader ? parseInt(retryHeader as string, 10) || 0 : 0;
}

/**
 * Check if endpoint is critical system endpoint
 */
function isCriticalSystemEndpoint(path: string): boolean {
    const criticalPaths = [
        '/api/auth/login',
        '/api/auth/refresh',
        '/api/emergency',
        '/api/system/shutdown',
        '/api/system/restart',
        '/api/billing/payment',
        '/api/security/alert'
    ];
    
    return criticalPaths.some(critical => path.startsWith(critical));
}

/**
 * Check if endpoint is authentication-related
 */
function isAuthenticationEndpoint(path: string): boolean {
    const authPaths = [
        '/api/auth/',
        '/api/user/profile',
        '/api/user/settings',
        '/api/security/'
    ];
    
    return authPaths.some(auth => path.startsWith(auth));
}

/**
 * Check if request is a background job
 */
function isBackgroundJob(req: any): boolean {
    return req.headers['x-background-job'] === 'true' || 
           req.isBackgroundJob === true ||
           req.path.includes('/background/') ||
           req.path.includes('/batch/') ||
           req.path.includes('/bulk/');
}

/**
 * Check if endpoint is monitoring/health check
 */
function isMonitoringEndpoint(path: string): boolean {
    const monitoringPaths = [
        '/api/health',
        '/api/status',
        '/api/metrics',
        '/api/monitoring',
        '/api/telemetry'
    ];
    
    return monitoringPaths.some(monitoring => path.startsWith(monitoring));
}

/**
 * Check if endpoint is emergency (bypasses queue)
 */
function isEmergencyEndpoint(path: string): boolean {
    const emergencyPaths = [
        '/api/emergency',
        '/api/health/critical',
        '/api/system/emergency'
    ];
    
    return emergencyPaths.some(emergency => path.startsWith(emergency));
}

/**
 * High priority middleware for critical requests
 */
export function highPriorityMiddleware(
    options: Omit<PriorityMiddlewareOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return requestPriorityMiddleware({
        ...options,
        priority: 'high'
    });
}

/**
 * Critical priority middleware for system-critical requests
 */
export function criticalPriorityMiddleware(
    options: Omit<PriorityMiddlewareOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return requestPriorityMiddleware({
        ...options,
        priority: 'critical'
    });
}

/**
 * Background priority middleware for non-urgent requests
 */
export function backgroundPriorityMiddleware(
    options: Omit<PriorityMiddlewareOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return requestPriorityMiddleware({
        ...options,
        priority: 'background',
        estimatedDuration: options.estimatedDuration || 30000 // 30s for background jobs
    });
}

/**
 * User-tier aware priority middleware
 */
export function userTierPriorityMiddleware(
    basePriority: RequestPriority = 'medium',
    options: Omit<PriorityMiddlewareOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return requestPriorityMiddleware({
        ...options,
        priorityDetector: (req) => {
            const userTier = getUserTier(req);
            
            // Adjust priority based on user tier
            if (userTier === 'premium') {
                if (basePriority === 'low') return 'medium';
                if (basePriority === 'medium') return 'high';
                if (basePriority === 'high') return 'high'; // Cap at high
            } else if (userTier === 'standard') {
                if (basePriority === 'low') return 'low';
                if (basePriority === 'medium') return 'medium';
                if (basePriority === 'high') return 'medium'; // Downgrade high to medium
            } else {
                // Free tier - downgrade priority
                if (basePriority === 'high') return 'medium';
                if (basePriority === 'medium') return 'low';
                if (basePriority === 'low') return 'background';
            }
            
            return basePriority;
        }
    });
}

/**
 * Deadline-aware priority middleware
 */
export function deadlinePriorityMiddleware(
    deadline: number,
    basePriority: RequestPriority = 'medium',
    options: Omit<PriorityMiddlewareOptions, 'priority' | 'deadline'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return requestPriorityMiddleware({
        ...options,
        priority: basePriority,
        deadline,
        priorityDetector: (req) => {
            const now = Date.now();
            const timeToDeadline = deadline - now;
            
            // Urgent if less than 30 seconds to deadline
            if (timeToDeadline < 30000) {
                return 'critical';
            }
            
            // High priority if less than 2 minutes to deadline
            if (timeToDeadline < 120000) {
                return 'high';
            }
            
            return basePriority;
        }
    });
}

/**
 * Cost-aware priority middleware
 */
export function costAwarePriorityMiddleware(
    estimatedCost: number,
    basePriority: RequestPriority = 'medium',
    options: Omit<PriorityMiddlewareOptions, 'priority' | 'cost'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return requestPriorityMiddleware({
        ...options,
        priority: basePriority,
        cost: estimatedCost,
        priorityDetector: (req) => {
            // Lower cost requests get slight priority boost
            if (estimatedCost < 0.01) { // Very cheap requests
                if (basePriority === 'low') return 'medium';
                if (basePriority === 'background') return 'low';
            }
            
            // High cost requests get deprioritized during high load
            if (estimatedCost > 1.0 && req.systemLoad?.load > 0.8) {
                if (basePriority === 'high') return 'medium';
                if (basePriority === 'medium') return 'low';
            }
            
            return basePriority;
        }
    });
}

/**
 * Get priority queue statistics
 */
export async function getPriorityQueueStats(): Promise<any> {
    try {
        return requestPrioritizationService.getDetailedStats();
    } catch (error) {
        loggingService.error('Failed to get priority queue statistics', {
            component: 'RequestPriorityMiddleware',
            error: error instanceof Error ? error.message : String(error)
        });
        return null;
    }
}

/**
 * Clear priority queues (emergency function)
 */
export function clearPriorityQueues(): void {
    try {
        requestPrioritizationService.clearQueues();
        loggingService.warn('Priority queues cleared via middleware', {
            component: 'RequestPriorityMiddleware'
        });
    } catch (error) {
        loggingService.error('Failed to clear priority queues', {
            component: 'RequestPriorityMiddleware',
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
