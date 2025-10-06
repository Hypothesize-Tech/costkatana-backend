import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { trafficManagementService } from '../services/trafficManagement.service';
import { adaptiveRateLimitService } from '../services/adaptiveRateLimit.service';
import { requestPrioritizationService, RequestPriority } from '../services/requestPrioritization.service';
import { gracefulDegradationService } from '../services/gracefulDegradation.service';
import { preemptiveThrottlingService } from '../services/preemptiveThrottling.service';
import { servicePrioritizationService } from '../services/servicePrioritization.service';

/**
 * Enterprise Traffic Management Middleware
 * Integrates all traffic management systems for comprehensive protection
 */

export interface EnterpriseTrafficOptions {
    enableAdaptiveRateLimit?: boolean;
    enableRequestPrioritization?: boolean;
    enableGracefulDegradation?: boolean;
    enablePreemptiveThrottling?: boolean;
    enableServicePrioritization?: boolean;
    
    // Request classification
    priority?: RequestPriority;
    estimatedCost?: number;
    estimatedDuration?: number;
    userTier?: 'premium' | 'standard' | 'free';
    
    // Bypass options
    bypassAllProtections?: boolean;
    bypassSpecificProtections?: string[];
    
    // Custom handlers
    customRateLimitHandler?: (req: any, res: Response, decision: any) => Promise<boolean>;
    customDegradationHandler?: (req: any, res: Response, level: string) => Promise<boolean>;
    customOverloadHandler?: (req: any, res: Response, overload: string) => Promise<boolean>;
    
    // Monitoring
    enableDetailedLogging?: boolean;
    enablePerformanceTracking?: boolean;
}

/**
 * Main enterprise traffic management middleware
 */
export function enterpriseTrafficManagementMiddleware(
    options: EnterpriseTrafficOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    const {
        enableAdaptiveRateLimit = true,
        enableRequestPrioritization = true,
        enableGracefulDegradation = true,
        enablePreemptiveThrottling = true,
        enableServicePrioritization = true,
        
        priority = 'medium',
        estimatedCost = 0.1,
        estimatedDuration = 5000,
        userTier = 'standard',
        
        bypassAllProtections = false,
        bypassSpecificProtections = [],
        
        customRateLimitHandler,
        customDegradationHandler,
        customOverloadHandler,
        
        enableDetailedLogging = false,
        enablePerformanceTracking = true
    } = options;

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Set request ID for tracking
        req.requestId = requestId;
        res.setHeader('X-Request-ID', requestId);

        if (enableDetailedLogging) {
            loggingService.info('=== ENTERPRISE TRAFFIC MANAGEMENT STARTED ===', {
                component: 'EnterpriseTrafficManagement',
                requestId,
                path: req.path,
                method: req.method,
                userAgent: req.headers['user-agent']
            });
        }

        try {
            // Skip all protections if bypassed or emergency endpoint
            if (bypassAllProtections || isEmergencyEndpoint(req.path)) {
                if (enableDetailedLogging) {
                    loggingService.info('Bypassing all traffic protections', {
                        component: 'EnterpriseTrafficManagement',
                        requestId,
                        reason: bypassAllProtections ? 'bypass_flag' : 'emergency_endpoint'
                    });
                }
                next();
                return;
            }

            // Get current system status
            const systemStatus = trafficManagementService.getStatus();
            
            // Record traffic data for prediction
            await recordTrafficData(req, systemStatus);

            // Determine request metadata
            const requestMetadata = {
                endpoint: req.path,
                method: req.method,
                priority,
                user_tier: userTier,
                estimated_cost: estimatedCost,
                estimated_duration: estimatedDuration,
                user_id: req.user?.id,
                ip: req.ip,
                request_id: requestId
            };

            // Add system status to request for downstream middleware
            req.systemStatus = systemStatus;
            req.trafficMetadata = requestMetadata;

            // 1. Service-Level Prioritization Check
            if (enableServicePrioritization && !bypassSpecificProtections.includes('service_prioritization')) {
                const servicePriority = servicePrioritizationService.getServicePriority(req.path);
                
                if (servicePriority.should_degrade && customOverloadHandler) {
                    const handled = await customOverloadHandler(req, res, systemStatus.current_state.service_prioritization?.overload_level || 'normal');
                    if (handled) return;
                }
                
                // Update request metadata with service priority
                const mappedPriority = mapServiceTierToPriority(servicePriority.tier);
                requestMetadata.priority = mappedPriority;
                req.servicePriority = servicePriority;
                
                // Set service priority headers
                res.setHeader('X-Service-Tier', servicePriority.tier);
                res.setHeader('X-Service-Priority-Score', servicePriority.priority_score.toFixed(3));
            }

            // 2. Adaptive Rate Limiting
            if (enableAdaptiveRateLimit && !bypassSpecificProtections.includes('adaptive_rate_limit')) {
                // Create compatible metadata for adaptive rate limiting
                const rateLimitMetadata = {
                    userId: requestMetadata.user_id,
                    endpoint: requestMetadata.endpoint,
                    priority: requestMetadata.priority === 'critical' ? 'high' : 
                             requestMetadata.priority === 'background' ? 'low' : 
                             requestMetadata.priority as 'high' | 'medium' | 'low'
                };
                
                const rateLimitDecision = await adaptiveRateLimitService.checkRateLimit(
                    generateRateLimitKey(req),
                    {
                        baseLimit: calculateBaseLimit(userTier, priority),
                        scalingFactor: 0.8
                    },
                    rateLimitMetadata
                );

                if (!rateLimitDecision.allowed) {
                    if (customRateLimitHandler) {
                        const handled = await customRateLimitHandler(req, res, rateLimitDecision);
                        if (handled) return;
                    }

                    // Standard rate limit response
                    res.setHeader('X-RateLimit-Adaptive', 'true');
                    res.setHeader('X-RateLimit-Reason', rateLimitDecision.reason);
                    res.setHeader('Retry-After', rateLimitDecision.retryAfter?.toString() || '60');

                    res.status(429).json({
                        error: 'Adaptive Rate Limit Exceeded',
                        message: 'System is under high load. Please try again later.',
                        adaptive_limit: rateLimitDecision.adjustedLimit,
                        system_load: rateLimitDecision.systemLoad,
                        traffic_pressure: rateLimitDecision.trafficPressure,
                        retry_after: rateLimitDecision.retryAfter || 60
                    });
                    return;
                }

                // Add rate limit info to request
                req.rateLimitInfo = rateLimitDecision;
            }

            // 3. Preemptive Throttling
            if (enablePreemptiveThrottling && !bypassSpecificProtections.includes('preemptive_throttling')) {
                // Create compatible metadata for throttling service
                const throttlingMetadata = {
                    endpoint: requestMetadata.endpoint,
                    priority: requestMetadata.priority === 'critical' ? 'high' : 
                             requestMetadata.priority === 'background' ? 'low' : 
                             requestMetadata.priority as 'high' | 'medium' | 'low',
                    user_tier: requestMetadata.user_tier,
                    estimated_cost: requestMetadata.estimated_cost
                };
                
                const throttlingDecision = await preemptiveThrottlingService.checkThrottling(throttlingMetadata);

                if (!throttlingDecision.allowed) {
                    res.setHeader('X-Throttling-Phase', throttlingDecision.phase);
                    res.setHeader('X-Throttling-Reason', throttlingDecision.reasons.join(', '));
                    res.setHeader('Retry-After', throttlingDecision.retry_after?.toString() || '60');

                    res.status(503).json({
                        error: 'System Temporarily Overloaded',
                        message: throttlingDecision.warning_message || 'System is experiencing high load.',
                        phase: throttlingDecision.phase,
                        retry_after: throttlingDecision.retry_after || 60,
                        reasons: throttlingDecision.reasons
                    });
                    return;
                }

                // Apply delay if needed
                if (throttlingDecision.delay_ms > 0) {
                    await applyDelay(throttlingDecision.delay_ms);
                }

                req.throttlingInfo = throttlingDecision;
            }

            // 4. Graceful Degradation
            if (enableGracefulDegradation && !bypassSpecificProtections.includes('graceful_degradation')) {
                const degradationStatus = gracefulDegradationService.getStatus();
                
                if (degradationStatus.level !== 'none') {
                    // Check if request should be processed
                    const shouldProcess = gracefulDegradationService.shouldProcessRequest(
                        getRequestSize(req),
                        estimatedDuration
                    );

                    if (!shouldProcess.allowed) {
                        if (customDegradationHandler) {
                            const handled = await customDegradationHandler(req, res, degradationStatus.level);
                            if (handled) return;
                        }

                        // Try fallback response
                        const fallbackResponse = await gracefulDegradationService.getFallbackResponse(
                            req.path,
                            req.method,
                            { query: req.query, body: req.body }
                        );

                        if (fallbackResponse.success) {
                            res.setHeader('X-Degradation-Level', degradationStatus.level);
                            res.setHeader('X-Response-Source', fallbackResponse.source);
                            res.setHeader('X-Degradation-Reason', shouldProcess.reason || 'System degraded');

                            res.json({
                                success: true,
                                data: fallbackResponse.data,
                                metadata: {
                                    degradation: {
                                        level: degradationStatus.level,
                                        mode: degradationStatus.mode,
                                        source: fallbackResponse.source
                                    }
                                }
                            });
                            return;
                        }

                        // No fallback available
                        res.status(503).json({
                            error: 'Service Temporarily Degraded',
                            message: shouldProcess.reason,
                            degradation: {
                                level: degradationStatus.level,
                                mode: degradationStatus.mode,
                                suggestion: shouldProcess.fallback
                            },
                            retry_after: 120
                        });
                        return;
                    }

                    req.degradationInfo = degradationStatus;
                }
            }

            // 5. Request Prioritization
            if (enableRequestPrioritization && !bypassSpecificProtections.includes('request_prioritization')) {
                // Create processor function for the request
                const processor = async (): Promise<any> => {
                    return new Promise<void>((resolve, reject) => {
                        const originalSend = res.send;
                        const originalJson = res.json;
                        let resolved = false;

                        const resolveOnce = () => {
                            if (!resolved) {
                                resolved = true;
                                resolve();
                            }
                        };

                        res.send = function(data: any) {
                            const result = originalSend.call(this, data);
                            resolveOnce();
                            return result;
                        };

                        res.json = function(data: any) {
                            const result = originalJson.call(this, data);
                            resolveOnce();
                            return result;
                        };

                        res.on('error', (error) => {
                            if (!resolved) {
                                resolved = true;
                                reject(error);
                            }
                        });

                        // Continue to next middleware
                        next();
                    });
                };

                // Enqueue the request
                try {
                    await requestPrioritizationService.enqueueRequest(
                        requestMetadata.priority,
                        req.path,
                        req.method,
                        processor,
                        {
                            userTier: requestMetadata.user_tier,
                            requestType: 'api',
                            estimatedDuration: requestMetadata.estimated_duration,
                            cost: requestMetadata.estimated_cost
                        }
                    );

                    // Request completed via priority queue
                    return;

                } catch (error) {
                    // Queue error - continue without prioritization
                    loggingService.warn('Request prioritization failed, continuing without queue', {
                        component: 'EnterpriseTrafficManagement',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // Set comprehensive headers
            setComprehensiveHeaders(res, systemStatus, req);

            // Track performance if enabled
            if (enablePerformanceTracking) {
                trackRequestPerformance(req, res, startTime);
            }

            // Continue to next middleware
            const middlewareTime = Date.now() - startTime;
            
            if (enableDetailedLogging) {
                loggingService.info('Enterprise traffic management completed', {
                    component: 'EnterpriseTrafficManagement',
                    requestId,
                    path: req.path,
                    middleware_time: middlewareTime,
                    system_health: systemStatus.overall_health,
                    protections_applied: systemStatus.active_protections.length
                });
            }

            next();

        } catch (error) {
            const errorTime = Date.now() - startTime;
            
            loggingService.error('Enterprise traffic management error', {
                component: 'EnterpriseTrafficManagement',
                requestId,
                path: req.path,
                error: error instanceof Error ? error.message : String(error),
                error_time: errorTime
            });

            // Continue without protection on error (fail-safe)
            next();
        }
    };
}

/**
 * Record traffic data for prediction service
 */
function recordTrafficData(_req: any, _systemStatus: any): void {
    try {
        // This would integrate with the traffic prediction service
        // For now, we'll just log the data point
        const _dataPoint = {
            timestamp: Date.now(),
            requests_per_second: 1, // Would be calculated from actual metrics
            unique_users: 1,
            response_time: _systemStatus.performance_metrics.average_response_time,
            error_rate: _systemStatus.performance_metrics.error_rate,
            cpu_usage: _systemStatus.performance_metrics.cpu_usage,
            memory_usage: _systemStatus.performance_metrics.memory_usage,
            endpoint_distribution: { [_req.path]: 1 },
            user_tier_distribution: { [_req.user?.tier || 'free']: 1 },
            geographic_distribution: { [_req.headers['x-forwarded-for'] || 'unknown']: 1 }
        };

        // Record would happen here - simplified for this implementation
    } catch (error) {
        // Non-critical error
    }
}

/**
 * Generate rate limit key for user/IP
 */
function generateRateLimitKey(req: any): string {
    return req.user?.id || req.ip || 'anonymous';
}

/**
 * Calculate base rate limit based on user tier and priority
 */
function calculateBaseLimit(userTier: string, priority: string): number {
    const tierMultipliers = {
        premium: 2.0,
        standard: 1.0,
        free: 0.5
    };

    const priorityMultipliers = {
        high: 1.5,
        medium: 1.0,
        low: 0.7
    };

    const baseLimit = 100; // Base requests per minute
    const tierMultiplier = tierMultipliers[userTier as keyof typeof tierMultipliers] || 1.0;
    const priorityMultiplier = priorityMultipliers[priority as keyof typeof priorityMultipliers] || 1.0;

    return Math.floor(baseLimit * tierMultiplier * priorityMultiplier);
}

/**
 * Map service tier to request priority
 */
function mapServiceTierToPriority(tier: string): RequestPriority {
    const mapping: Record<string, RequestPriority> = {
        critical: 'critical',
        essential: 'high',
        important: 'medium',
        standard: 'medium',
        optional: 'low'
    };

    return mapping[tier] || 'medium';
}

/**
 * Check if endpoint is emergency (bypasses all protections)
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
 * Apply throttling delay
 */
async function applyDelay(delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

/**
 * Get request size estimate
 */
function getRequestSize(req: any): number {
    let size = 0;
    
    if (req.headers) size += JSON.stringify(req.headers).length;
    if (req.query) size += JSON.stringify(req.query).length;
    if (req.body) size += JSON.stringify(req.body).length;
    
    return size;
}

/**
 * Set comprehensive response headers
 */
function setComprehensiveHeaders(res: Response, systemStatus: any, _req: any): void {
    // System status headers
    res.setHeader('X-System-Health', systemStatus.overall_health);
    res.setHeader('X-System-Load', (systemStatus.system_load * 100).toFixed(1));
    res.setHeader('X-Active-Protections', systemStatus.active_protections.join(', '));
    
    // Performance headers
    res.setHeader('X-System-CPU', systemStatus.performance_metrics.cpu_usage.toFixed(1));
    res.setHeader('X-System-Memory', systemStatus.performance_metrics.memory_usage.toFixed(1));
    res.setHeader('X-System-Response-Time', systemStatus.performance_metrics.average_response_time.toString());
    res.setHeader('X-System-Error-Rate', systemStatus.performance_metrics.error_rate.toFixed(2));
    
    // Protection status headers
    if (systemStatus.current_state.graceful_degradation?.level !== 'none') {
        res.setHeader('X-Degradation-Active', 'true');
        res.setHeader('X-Degradation-Level', systemStatus.current_state.graceful_degradation.level);
    }
    
    if (systemStatus.current_state.preemptive_throttling?.phase !== 'normal') {
        res.setHeader('X-Throttling-Active', 'true');
        res.setHeader('X-Throttling-Phase', systemStatus.current_state.preemptive_throttling.phase);
    }
    
    // Request tracking
    res.setHeader('X-Protected-By', 'Enterprise-Traffic-Management');
    res.setHeader('X-Processing-Time', Date.now().toString());
}

/**
 * Track request performance
 */
function trackRequestPerformance(req: any, res: Response, startTime: number): void {
    const originalSend = res.send;
    const originalJson = res.json;
    
    const trackCompletion = () => {
        const duration = Date.now() - startTime;
        res.setHeader('X-Request-Duration', duration.toString());
        
        // Log performance metrics
        loggingService.debug('Request performance tracked', {
            component: 'EnterpriseTrafficManagement',
            requestId: req.requestId,
            path: req.path,
            method: req.method,
            duration,
            status_code: res.statusCode,
            user_tier: req.trafficMetadata?.user_tier
        });
    };
    
    res.send = function(data: any) {
        trackCompletion();
        return originalSend.call(this, data);
    };
    
    res.json = function(data: any) {
        trackCompletion();
        return originalJson.call(this, data);
    };
}

/**
 * Specialized middleware factories
 */

/**
 * High-priority API endpoints
 */
export function highPriorityTrafficManagement(
    options: Omit<EnterpriseTrafficOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return enterpriseTrafficManagementMiddleware({
        ...options,
        priority: 'high',
        estimatedCost: options.estimatedCost || 0.2
    });
}

/**
 * Background job endpoints
 */
export function backgroundJobTrafficManagement(
    options: Omit<EnterpriseTrafficOptions, 'priority'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return enterpriseTrafficManagementMiddleware({
        ...options,
        priority: 'low',
        estimatedDuration: options.estimatedDuration || 30000, // 30 seconds
        enableRequestPrioritization: true // Always use prioritization for background jobs
    });
}

/**
 * AI processing endpoints
 */
export function aiProcessingTrafficManagement(
    modelComplexity: 'simple' | 'medium' | 'complex' = 'medium',
    options: Omit<EnterpriseTrafficOptions, 'estimatedCost' | 'estimatedDuration'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    const costMap = { simple: 0.1, medium: 0.5, complex: 2.0 };
    const durationMap = { simple: 2000, medium: 10000, complex: 30000 };
    
    return enterpriseTrafficManagementMiddleware({
        ...options,
        priority: options.priority || 'medium',
        estimatedCost: costMap[modelComplexity],
        estimatedDuration: durationMap[modelComplexity],
        enableGracefulDegradation: true // AI endpoints should degrade gracefully
    });
}

/**
 * File upload endpoints
 */
export function fileUploadTrafficManagement(
    maxFileSize: number = 10 * 1024 * 1024, // 10MB
    options: Omit<EnterpriseTrafficOptions, 'estimatedCost' | 'estimatedDuration'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return enterpriseTrafficManagementMiddleware({
        ...options,
        priority: 'low',
        estimatedCost: (maxFileSize / (1024 * 1024)) * 0.01, // $0.01 per MB
        estimatedDuration: Math.min(maxFileSize / 1000, 60000), // Estimate based on size, max 60s
        enableRequestPrioritization: true
    });
}

/**
 * Get current traffic management status
 */
export function getTrafficManagementStatus(): any {
    return trafficManagementService.getStatus();
}

/**
 * Get traffic management statistics
 */
export function getTrafficManagementStatistics(): any {
    return trafficManagementService.getStatistics();
}

/**
 * Trigger emergency mode
 */
export async function triggerEmergencyMode(reason: string): Promise<void> {
    return trafficManagementService.emergencyMode(reason);
}

/**
 * Attempt system recovery
 */
export async function attemptSystemRecovery(): Promise<boolean> {
    return trafficManagementService.attemptRecovery();
}
