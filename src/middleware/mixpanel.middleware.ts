import { Request, Response, NextFunction } from 'express';
import { mixpanelService } from '../services/mixpanel.service';
import { logger } from '../utils/logger';

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
    // Record start time
    req.startTime = Date.now();

    // Override res.json to capture response data
    const originalJson = res.json;
    res.json = function(data: any) {
        const responseTime = Date.now() - (req.startTime || 0);
        
        // Track the API request
        trackApiRequest(req, res, responseTime, data);
        
        return originalJson.call(this, data);
    };

    next();
};

/**
 * Track API request details
 */
function trackApiRequest(req: RequestWithTiming, res: Response, responseTime: number, _responseData: any): void {
    try {
        const userId = req.user?.id;
        const endpoint = req.path;
        const method = req.method;
        const statusCode = res.statusCode;
        const success = statusCode >= 200 && statusCode < 400;

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

        // Track basic API usage
        mixpanelService.track('API Request', {
            ...requestData,
            event_type: 'api_request',
            user_id: userId,
            endpoint_category: getEndpointCategory(endpoint),
            method_category: getMethodCategory(method),
            response_category: getResponseCategory(statusCode)
        }, userId);

        // Track specific endpoint usage
        if (userId) {
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
        }

        // Track errors
        if (!success) {
            mixpanelService.trackError({
                userId,
                error: `HTTP ${statusCode}`,
                errorCode: statusCode.toString(),
                endpoint,
                severity: getErrorSeverity(statusCode)
            });
        }

        // Track performance metrics
        if (responseTime > 1000) { // Only track slow requests
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
        }

    } catch (error) {
        logger.error('Error tracking API request:', error);
    }
}

/**
 * Middleware to track user authentication events
 */
export const trackAuthEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const originalJson = res.json;
    res.json = function(data: any) {
        // Track authentication events
        if (req.path.includes('/auth') && data.success) {
            const userId = data.user?.id || data.data?.user?.id;
            const event = getAuthEvent(req.path, req.method);
            
            if (event && userId) {
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
            }
        }
        
        return originalJson.call(this, data);
    };

    next();
};

/**
 * Middleware to track analytics events
 */
export const trackAnalyticsEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const originalJson = res.json;
    res.json = function(data: any) {
        // Track analytics dashboard views and exports
        if (req.path.includes('/analytics') && data.success) {
            const userId = req.user?.id;
            const event = getAnalyticsEvent(req.path, req.method);
            
            if (event && userId) {
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
            }
        }
        
        return originalJson.call(this, data);
    };

    next();
};

/**
 * Middleware to track project events
 */
export const trackProjectEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const originalJson = res.json;
    res.json = function(data: any) {
        // Track project management events
        if (req.path.includes('/projects') && data.success) {
            const userId = req.user?.id;
            const event = getProjectEvent(req.path, req.method);
            
            if (event && userId && data.data) {
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
            }
        }
        
        return originalJson.call(this, data);
    };

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
    if (req.user?.id) {
        // Track user session activity
        mixpanelService.track('User Session Activity', {
            event_type: 'session',
            endpoint: req.path,
            method: req.method,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            timestamp: new Date().toISOString()
        }, req.user.id);

        // Update user profile with last activity
        mixpanelService.setUserProfile(req.user.id, {
            $last_seen: new Date().toISOString(),
            last_endpoint: req.path,
            last_method: req.method
        });
    }

    next();
};

/**
 * Middleware to track optimization events
 */
export const trackOptimizationEvents = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const originalJson = res.json;
    res.json = function(data: any) {
        // Track optimization events
        if (req.path.includes('/optimization') && data.success && data.data) {
            const userId = req.user?.id;
            const optimizationData = data.data;
            
            if (userId && optimizationData.savings !== undefined) {
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
            }
        }
        
        return originalJson.call(this, data);
    };

    next();
}; 