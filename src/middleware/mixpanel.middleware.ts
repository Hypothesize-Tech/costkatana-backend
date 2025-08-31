import { Request, Response, NextFunction } from 'express';
import { mixpanelService } from '../services/mixpanel.service';
import { loggingService } from '../services/logging.service';

interface RequestWithUser extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
    };
}

interface RequestWithTiming extends RequestWithUser {
    startTime?: number;
}

/**
 * Middleware to track API requests with Mixpanel
 */
export const trackApiRequests = (req: RequestWithTiming, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== MIXPANEL API TRACKING MIDDLEWARE STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequests',
        type: 'api_tracking',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Setting up API request tracking', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequests',
        type: 'api_tracking',
        step: 'setup_tracking'
    });

    // Record start time
    req.startTime = startTime;

    loggingService.info('Request start time recorded', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequests',
        type: 'api_tracking',
        step: 'start_time_recorded',
        startTime
    });

    loggingService.info('Step 2: Overriding response.json method', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequests',
        type: 'api_tracking',
        step: 'override_response'
    });

    // Override res.json to capture response data
    const originalJson = res.json;
    res.json = function(data: any) {
        const responseTime = Date.now() - (req.startTime || 0);
        
        loggingService.info('Response.json called, tracking API request', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequests',
            type: 'api_tracking',
            step: 'response_intercepted',
            responseTime,
            hasData: !!data
        });
        
        // Track the API request
        trackApiRequest(req, res, responseTime, data);
        
        return originalJson.call(this, data);
    };

    loggingService.info('Response.json method overridden successfully', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequests',
        type: 'api_tracking',
        step: 'override_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MIXPANEL API TRACKING MIDDLEWARE COMPLETED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequests',
        type: 'api_tracking',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
};

/**
 * Track API request details
 */
function trackApiRequest(req: RequestWithTiming, res: Response, responseTime: number, _responseData: any): void {
    const startTime = Date.now();
    
    loggingService.info('=== API REQUEST TRACKING STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackApiRequest',
        type: 'api_tracking',
        step: 'tracking_started'
    });

    try {
        loggingService.info('Step 1: Extracting request data', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'extract_data'
        });

        const userId = req.user?.id;
        const endpoint = req.path;
        const method = req.method;
        const statusCode = res.statusCode;
        const success = statusCode >= 200 && statusCode < 400;

        loggingService.info('Basic request data extracted', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'basic_data_extracted',
            userId,
            endpoint,
            method,
            statusCode,
            success
        });

        // Extract relevant data from request
        const requestData = {
            endpoint,
            method,
            statusCode,
            responseTime,
            success,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            queryParams: Object.keys(req.query).length,
            bodySize: req.body ? JSON.stringify(req.body).length : 0
        };

        loggingService.info('Detailed request data extracted', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'detailed_data_extracted',
            queryParams: requestData.queryParams,
            bodySize: requestData.bodySize,
            hasUserAgent: !!requestData.userAgent,
            hasIP: !!requestData.ip
        });

        loggingService.info('Step 2: Tracking basic API usage', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'track_basic_usage'
        });

        // Track basic API usage
        mixpanelService.track('API Request', {
            ...requestData,
            event_type: 'api_request',
            user_id: userId,
            endpoint_category: getEndpointCategory(endpoint),
            method_category: getMethodCategory(method),
            response_category: getResponseCategory(statusCode)
        }, userId);

        loggingService.info('Basic API usage tracked successfully', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'basic_usage_tracked',
            endpointCategory: getEndpointCategory(endpoint),
            methodCategory: getMethodCategory(method),
            responseCategory: getResponseCategory(statusCode)
        });

        // Track specific endpoint usage
        if (userId) {
            loggingService.info('Step 3: Tracking feature usage for authenticated user', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'track_feature_usage'
            });

            mixpanelService.trackFeatureUsage({
                userId,
                feature: endpoint.replace(/\//g, '_').substring(1), // Remove leading slash
                action: method.toLowerCase(),
                page: endpoint,
                component: 'api_endpoint',
                metadata: {
                    statusCode,
                    responseTime,
                    success
                }
            });

            loggingService.info('Feature usage tracked successfully', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'feature_usage_tracked',
                userId,
                feature: endpoint.replace(/\//g, '_').substring(1)
            });
        }

        // Track errors
        if (!success) {
            loggingService.info('Step 4: Tracking error event', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'track_error'
            });

            mixpanelService.trackError({
                userId,
                error: `HTTP ${statusCode}`,
                errorCode: statusCode.toString(),
                endpoint,
                severity: getErrorSeverity(statusCode)
            });

            loggingService.info('Error event tracked successfully', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'error_tracked',
                statusCode,
                severity: getErrorSeverity(statusCode)
            });
        }

        // Track performance metrics
        if (responseTime > 1000) { // Only track slow requests
            loggingService.info('Step 5: Tracking performance metrics for slow request', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'track_performance',
                responseTime,
                threshold: 1000
            });

            mixpanelService.trackPerformance({
                userId,
                metric: 'api_response_time',
                value: responseTime,
                unit: 'ms',
                context: {
                    endpoint,
                    method,
                    statusCode
                }
            });

            loggingService.info('Performance metrics tracked successfully', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'performance_tracked',
                responseTime,
                metric: 'api_response_time'
            });
        } else {
            loggingService.debug('Request performance within normal range, skipping performance tracking', {
                component: 'MixpanelMiddleware',
                operation: 'trackApiRequest',
                type: 'api_tracking',
                step: 'performance_normal',
                responseTime,
                threshold: 1000
            });
        }

        loggingService.info('API request tracking completed successfully', {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'tracking_complete',
            totalTime: `${Date.now() - startTime}ms`
        });

    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'MixpanelMiddleware',
            operation: 'trackApiRequest',
            type: 'api_tracking',
            step: 'error',
            totalTime: `${Date.now() - startTime}ms`
        });
    }
}

/**
 * Middleware to track user authentication events
 */
export const trackAuthEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== MIXPANEL AUTH TRACKING MIDDLEWARE STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackAuthEvents',
        type: 'auth_tracking',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Setting up authentication event tracking', {
        component: 'MixpanelMiddleware',
        operation: 'trackAuthEvents',
        type: 'auth_tracking',
        step: 'setup_tracking'
    });

    const originalJson = res.json;
    res.json = function(data: any) {
        const responseTime = Date.now() - startTime;
        
        loggingService.info('Response.json called, checking for auth events', {
            component: 'MixpanelMiddleware',
            operation: 'trackAuthEvents',
            type: 'auth_tracking',
            step: 'response_intercepted',
            responseTime,
            isAuthPath: req.path.includes('/auth'),
            hasSuccess: data.success
        });
        
        // Track authentication events
        if (req.path.includes('/auth') && data.success) {
            loggingService.info('Step 2: Processing authentication event', {
                component: 'MixpanelMiddleware',
                operation: 'trackAuthEvents',
                type: 'auth_tracking',
                step: 'process_auth_event'
            });

            const userId = data.user?.id || data.data?.user?.id;
            const event = getAuthEvent(req.path, req.method);
            
            loggingService.info('Authentication event details extracted', {
                component: 'MixpanelMiddleware',
                operation: 'trackAuthEvents',
                type: 'auth_tracking',
                step: 'event_details_extracted',
                userId,
                event,
                path: req.path,
                method: req.method
            });
            
            if (event && userId) {
                loggingService.info('Step 3: Tracking authentication event with Mixpanel', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackAuthEvents',
                    type: 'auth_tracking',
                    step: 'track_with_mixpanel'
                });

                mixpanelService.trackAuthEvent(event, {
                    userId,
                    method: req.method,
                    source: req.path,
                    userAgent: req.get('User-Agent') || '',
                    ip: req.ip || '',
                    success: true,
                    metadata: {
                        endpoint: req.path,
                        method: req.method
                    }
                });

                loggingService.info('Authentication event tracked successfully', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackAuthEvents',
                    type: 'auth_tracking',
                    step: 'event_tracked',
                    event,
                    userId
                });
            } else {
                loggingService.debug('No valid authentication event to track', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackAuthEvents',
                    type: 'auth_tracking',
                    step: 'no_valid_event',
                    hasEvent: !!event,
                    hasUserId: !!userId
                });
            }
        } else {
            loggingService.debug('Not an authentication endpoint or unsuccessful response', {
                component: 'MixpanelMiddleware',
                operation: 'trackAuthEvents',
                type: 'auth_tracking',
                step: 'not_auth_endpoint',
                isAuthPath: req.path.includes('/auth'),
                hasSuccess: data.success
            });
        }
        
        return originalJson.call(this, data);
    };

    loggingService.info('Authentication event tracking setup completed', {
        component: 'MixpanelMiddleware',
        operation: 'trackAuthEvents',
        type: 'auth_tracking',
        step: 'setup_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MIXPANEL AUTH TRACKING MIDDLEWARE COMPLETED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackAuthEvents',
        type: 'auth_tracking',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
};

/**
 * Middleware to track analytics events
 */
export const trackAnalyticsEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== MIXPANEL ANALYTICS TRACKING MIDDLEWARE STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackAnalyticsEvents',
        type: 'analytics_tracking',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Setting up analytics event tracking', {
        component: 'MixpanelMiddleware',
        operation: 'trackAnalyticsEvents',
        type: 'analytics_tracking',
        step: 'setup_tracking'
    });

    const originalJson = res.json;
    res.json = function(data: any) {
        const responseTime = Date.now() - startTime;
        
        loggingService.info('Response.json called, checking for analytics events', {
            component: 'MixpanelMiddleware',
            operation: 'trackAnalyticsEvents',
            type: 'analytics_tracking',
            step: 'response_intercepted',
            responseTime,
            isAnalyticsPath: req.path.includes('/analytics'),
            hasSuccess: data.success
        });
        
        // Track analytics dashboard views and exports
        if (req.path.includes('/analytics') && data.success) {
            loggingService.info('Step 2: Processing analytics event', {
                component: 'MixpanelMiddleware',
                operation: 'trackAnalyticsEvents',
                type: 'analytics_tracking',
                step: 'process_analytics_event'
            });

            const userId = req.user?.id;
            const event = getAnalyticsEvent(req.path, req.method);
            
            loggingService.info('Analytics event details extracted', {
                component: 'MixpanelMiddleware',
                operation: 'trackAnalyticsEvents',
                type: 'analytics_tracking',
                step: 'event_details_extracted',
                userId,
                event,
                path: req.path,
                method: req.method
            });
            
            if (event && userId) {
                loggingService.info('Step 3: Tracking analytics event with Mixpanel', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackAnalyticsEvents',
                    type: 'analytics_tracking',
                    step: 'track_with_mixpanel'
                });

                mixpanelService.trackAnalyticsEvent(event, {
                    userId,
                    projectId: req.query.projectId as string,
                    reportType: req.query.groupBy as string,
                    dateRange: req.query.startDate && req.query.endDate 
                        ? `${req.query.startDate}-${req.query.endDate}` 
                        : undefined,
                    filters: req.query,
                    page: req.path,
                    component: 'analytics_endpoint'
                });

                loggingService.info('Analytics event tracked successfully', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackAnalyticsEvents',
                    type: 'analytics_tracking',
                    step: 'event_tracked',
                    event,
                    userId
                });
            } else {
                loggingService.debug('No valid analytics event to track', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackAnalyticsEvents',
                    type: 'analytics_tracking',
                    step: 'no_valid_event',
                    hasEvent: !!event,
                    hasUserId: !!userId
                });
            }
        } else {
            loggingService.debug('Not an analytics endpoint or unsuccessful response', {
                component: 'MixpanelMiddleware',
                operation: 'trackAnalyticsEvents',
                type: 'analytics_tracking',
                step: 'not_analytics_endpoint',
                isAnalyticsPath: req.path.includes('/analytics'),
                hasSuccess: data.success
            });
        }
        
        return originalJson.call(this, data);
    };

    loggingService.info('Analytics event tracking setup completed', {
        component: 'MixpanelMiddleware',
        operation: 'trackAnalyticsEvents',
        type: 'analytics_tracking',
        step: 'setup_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MIXPANEL ANALYTICS TRACKING MIDDLEWARE COMPLETED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackAnalyticsEvents',
        type: 'analytics_tracking',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
};

/**
 * Middleware to track project events
 */
export const trackProjectEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== MIXPANEL PROJECT TRACKING MIDDLEWARE STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackProjectEvents',
        type: 'project_tracking',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Setting up project event tracking', {
        component: 'MixpanelMiddleware',
        operation: 'trackProjectEvents',
        type: 'project_tracking',
        step: 'setup_tracking'
    });

    const originalJson = res.json;
    res.json = function(data: any) {
        const responseTime = Date.now() - startTime;
        
        loggingService.info('Response.json called, checking for project events', {
            component: 'MixpanelMiddleware',
            operation: 'trackProjectEvents',
            type: 'project_tracking',
            step: 'response_intercepted',
            responseTime,
            isProjectPath: req.path.includes('/projects'),
            hasSuccess: data.success,
            hasData: !!data.data
        });
        
        // Track project management events
        if (req.path.includes('/projects') && data.success) {
            loggingService.info('Step 2: Processing project event', {
                component: 'MixpanelMiddleware',
                operation: 'trackProjectEvents',
                type: 'project_tracking',
                step: 'process_project_event'
            });

            const userId = req.user?.id;
            const event = getProjectEvent(req.path, req.method);
            
            loggingService.info('Project event details extracted', {
                component: 'MixpanelMiddleware',
                operation: 'trackProjectEvents',
                type: 'project_tracking',
                step: 'event_details_extracted',
                userId,
                event,
                path: req.path,
                method: req.method
            });
            
            if (event && userId && data.data) {
                loggingService.info('Step 3: Tracking project event with Mixpanel', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackProjectEvents',
                    type: 'project_tracking',
                    step: 'track_with_mixpanel'
                });

                const projectData = data.data;
                mixpanelService.trackProjectEvent(event, {
                    userId,
                    projectId: projectData._id || projectData.id,
                    projectName: projectData.name,
                    department: projectData.department,
                    team: projectData.team,
                    page: req.path,
                    component: 'project_endpoint'
                });

                loggingService.info('Project event tracked successfully', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackProjectEvents',
                    type: 'project_tracking',
                    step: 'event_tracked',
                    event,
                    userId,
                    projectId: projectData._id || projectData.id
                });
            } else {
                loggingService.debug('No valid project event to track', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackProjectEvents',
                    type: 'project_tracking',
                    step: 'no_valid_event',
                    hasEvent: !!event,
                    hasUserId: !!userId,
                    hasData: !!data.data
                });
            }
        } else {
            loggingService.debug('Not a project endpoint or unsuccessful response', {
                component: 'MixpanelMiddleware',
                operation: 'trackProjectEvents',
                type: 'project_tracking',
                step: 'not_project_endpoint',
                isProjectPath: req.path.includes('/projects'),
                hasSuccess: data.success
            });
        }
        
        return originalJson.call(this, data);
    };

    loggingService.info('Project event tracking setup completed', {
        component: 'MixpanelMiddleware',
        operation: 'trackProjectEvents',
        type: 'project_tracking',
        step: 'setup_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MIXPANEL PROJECT TRACKING MIDDLEWARE COMPLETED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackProjectEvents',
        type: 'project_tracking',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
};

/**
 * Helper functions
 */
function getEndpointCategory(endpoint: string): string {
    if (endpoint.includes('/auth')) return 'authentication';
    if (endpoint.includes('/analytics')) return 'analytics';
    if (endpoint.includes('/projects')) return 'projects';
    if (endpoint.includes('/usage')) return 'usage';
    if (endpoint.includes('/optimization')) return 'optimization';
    if (endpoint.includes('/chat')) return 'chat';
    if (endpoint.includes('/intelligence')) return 'intelligence';
    return 'other';
}

function getMethodCategory(method: string): string {
    switch (method.toUpperCase()) {
        case 'GET': return 'read';
        case 'POST': return 'create';
        case 'PUT': return 'update';
        case 'PATCH': return 'update';
        case 'DELETE': return 'delete';
        default: return 'other';
    }
}

function getResponseCategory(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) return 'success';
    if (statusCode >= 300 && statusCode < 400) return 'redirect';
    if (statusCode >= 400 && statusCode < 500) return 'client_error';
    if (statusCode >= 500) return 'server_error';
    return 'unknown';
}

function getErrorSeverity(statusCode: number): 'low' | 'medium' | 'high' | 'critical' {
    if (statusCode >= 500) return 'high';
    if (statusCode >= 400) return 'medium';
    return 'low';
}

function getAuthEvent(path: string, method: string): 'login' | 'logout' | 'register' | 'password_reset' | null {
    if (path.includes('/login') && method === 'POST') return 'login';
    if (path.includes('/logout') && method === 'POST') return 'logout';
    if (path.includes('/register') && method === 'POST') return 'register';
    if (path.includes('/password-reset') && method === 'POST') return 'password_reset';
    return null;
}

function getAnalyticsEvent(path: string, method: string): 'dashboard_viewed' | 'report_generated' | 'export_requested' | null {
    if (path.includes('/analytics') && method === 'GET') return 'dashboard_viewed';
    if (path.includes('/analytics/export') && method === 'GET') return 'export_requested';
    if (path.includes('/analytics/report') && method === 'GET') return 'report_generated';
    return null;
}

function getProjectEvent(path: string, method: string): 'created' | 'updated' | 'deleted' | 'archived' | null {
    if (path.includes('/projects') && method === 'POST') return 'created';
    if (path.includes('/projects') && (method === 'PUT' || method === 'PATCH')) return 'updated';
    if (path.includes('/projects') && method === 'DELETE') return 'deleted';
    if (path.includes('/projects/archive') && method === 'POST') return 'archived';
    return null;
}

/**
 * Middleware to track user session events
 */
export const trackUserSession = (req: RequestWithUser, _res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== MIXPANEL USER SESSION TRACKING MIDDLEWARE STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackUserSession',
        type: 'session_tracking',
        path: req.path,
        method: req.method
    });

    if (req.user?.id) {
        loggingService.info('Step 1: Tracking user session activity', {
            component: 'MixpanelMiddleware',
            operation: 'trackUserSession',
            type: 'session_tracking',
            step: 'track_session_activity'
        });

        // Track user session activity
        mixpanelService.track('User Session Activity', {
            event_type: 'session',
            endpoint: req.path,
            method: req.method,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            timestamp: new Date().toISOString()
        }, req.user.id);

        loggingService.info('Session activity tracked successfully', {
            component: 'MixpanelMiddleware',
            operation: 'trackUserSession',
            type: 'session_tracking',
            step: 'session_activity_tracked',
            userId: req.user.id
        });

        loggingService.info('Step 2: Updating user profile with last activity', {
            component: 'MixpanelMiddleware',
            operation: 'trackUserSession',
            type: 'session_tracking',
            step: 'update_user_profile'
        });

        // Update user profile with last activity
        mixpanelService.setUserProfile(req.user.id, {
            $last_seen: new Date().toISOString(),
            last_endpoint: req.path,
            last_method: req.method
        });

        loggingService.info('User profile updated successfully', {
            component: 'MixpanelMiddleware',
            operation: 'trackUserSession',
            type: 'session_tracking',
            step: 'profile_updated',
            userId: req.user.id,
            lastEndpoint: req.path,
            lastMethod: req.method
        });
    } else {
        loggingService.debug('No authenticated user, skipping session tracking', {
            component: 'MixpanelMiddleware',
            operation: 'trackUserSession',
            type: 'session_tracking',
            step: 'no_user_skip',
            hasUser: !!req.user,
            hasUserId: !!req.user?.id
        });
    }

    loggingService.info('User session tracking completed', {
        component: 'MixpanelMiddleware',
        operation: 'trackUserSession',
        type: 'session_tracking',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MIXPANEL USER SESSION TRACKING MIDDLEWARE COMPLETED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackUserSession',
        type: 'session_tracking',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    next();
};

/**
 * Middleware to track optimization events
 */
export const trackOptimizationEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    
    loggingService.info('=== MIXPANEL OPTIMIZATION TRACKING MIDDLEWARE STARTED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackOptimizationEvents',
        type: 'optimization_tracking',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Setting up optimization event tracking', {
        component: 'MixpanelMiddleware',
        operation: 'trackOptimizationEvents',
        type: 'optimization_tracking',
        step: 'setup_tracking'
    });

    const originalJson = res.json;
    res.json = function(data: any) {
        const responseTime = Date.now() - startTime;
        
        loggingService.info('Response.json called, checking for optimization events', {
            component: 'MixpanelMiddleware',
            operation: 'trackOptimizationEvents',
            type: 'optimization_tracking',
            step: 'response_intercepted',
            responseTime,
            isOptimizationPath: req.path.includes('/optimization'),
            hasSuccess: data.success,
            hasData: !!data.data
        });
        
        // Track optimization events
        if (req.path.includes('/optimization') && data.success && data.data) {
            loggingService.info('Step 2: Processing optimization event', {
                component: 'MixpanelMiddleware',
                operation: 'trackOptimizationEvents',
                type: 'optimization_tracking',
                step: 'process_optimization_event'
            });

            const userId = req.user?.id;
            const optimizationData = data.data;
            
            loggingService.info('Optimization event details extracted', {
                component: 'MixpanelMiddleware',
                operation: 'trackOptimizationEvents',
                type: 'optimization_tracking',
                step: 'event_details_extracted',
                userId,
                hasSavings: optimizationData.savings !== undefined,
                path: req.path,
                method: req.method
            });
            
            if (userId && optimizationData.savings !== undefined) {
                loggingService.info('Step 3: Tracking optimization event with Mixpanel', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackOptimizationEvents',
                    type: 'optimization_tracking',
                    step: 'track_with_mixpanel'
                });

                mixpanelService.trackOptimization({
                    userId,
                    projectId: optimizationData.projectId,
                    optimizationType: optimizationData.type || 'cost_analysis',
                    originalCost: optimizationData.originalCost || 0,
                    optimizedCost: optimizationData.optimizedCost || 0,
                    savings: optimizationData.savings || 0,
                    success: optimizationData.success !== false,
                    page: req.path,
                    component: 'optimization_endpoint'
                });

                loggingService.info('Optimization event tracked successfully', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackOptimizationEvents',
                    type: 'optimization_tracking',
                    step: 'event_tracked',
                    userId,
                    savings: optimizationData.savings,
                    optimizationType: optimizationData.type || 'cost_analysis'
                });
            } else {
                loggingService.debug('No valid optimization event to track', {
                    component: 'MixpanelMiddleware',
                    operation: 'trackOptimizationEvents',
                    type: 'optimization_tracking',
                    step: 'no_valid_event',
                    hasUserId: !!userId,
                    hasSavings: optimizationData.savings !== undefined
                });
            }
        } else {
            loggingService.debug('Not an optimization endpoint or unsuccessful response', {
                component: 'MixpanelMiddleware',
                operation: 'trackOptimizationEvents',
                type: 'optimization_tracking',
                step: 'not_optimization_endpoint',
                isOptimizationPath: req.path.includes('/optimization'),
                hasSuccess: data.success,
                hasData: !!data.data
            });
        }
        
        return originalJson.call(this, data);
    };

    loggingService.info('Optimization event tracking setup completed', {
        component: 'MixpanelMiddleware',
        operation: 'trackOptimizationEvents',
        type: 'optimization_tracking',
        step: 'setup_complete',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MIXPANEL OPTIMIZATION TRACKING MIDDLEWARE COMPLETED ===', {
        component: 'MixpanelMiddleware',
        operation: 'trackOptimizationEvents',
        type: 'optimization_tracking',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });

    next();
}; 