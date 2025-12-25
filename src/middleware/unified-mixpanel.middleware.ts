import { Request, Response, NextFunction } from 'express';
import { mixpanelService } from '../services/mixpanel.service';
import { loggingService } from '../services/logging.service';

interface RequestWithUser extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
    };
    startTime?: number;
}

interface TrackingContext {
    req: RequestWithUser;
    res: Response;
    data: any;
    responseTime: number;
    trackingTypes: {
        api: boolean;
        auth: boolean;
        analytics: boolean;
        project: boolean;
        optimization: boolean;
        session: boolean;
    };
}

/**
 * Unified Mixpanel Tracking Middleware - consolidates all tracking types
 */
export const unifiedMixpanelTracking = (req: RequestWithUser, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    req.startTime = startTime;

    loggingService.debug('Unified Mixpanel tracking middleware activated', {
        component: 'UnifiedMixpanelMiddleware',
        path: req.path,
        method: req.method
    });

    const originalJson = res.json;
    
    res.json = function(data: any) {
        const responseTime = Date.now() - startTime;
        
        // Determine tracking types needed based on path
        const trackingTypes = {
            api: true, // Always track API requests
            auth: req.path.includes('/auth'),
            analytics: req.path.includes('/analytics'),
            project: req.path.includes('/projects'),
            optimization: req.path.includes('/optimization'),
            session: !!req.user
        };

        // Handle tracking
        handleTracking({
            req,
            res,
            data,
            responseTime,
            trackingTypes
        });

        return originalJson.call(this, data);
    };

    next();
};

/**
 * Centralized tracking handler
 */
function handleTracking(context: TrackingContext): void {
    const { req, res, data, responseTime, trackingTypes } = context;

    try {
        // 1. Track basic API request
        if (trackingTypes.api) {
            trackApiRequest(req, res, responseTime);
        }

        // 2. Track authentication events
        if (trackingTypes.auth && data.success) {
            trackAuthenticationEvent(req, data);
        }

        // 3. Track analytics events
        if (trackingTypes.analytics && data.success) {
            trackAnalyticsEvent(req, data);
        }

        // 4. Track project events
        if (trackingTypes.project && data.success && data.data) {
            trackProjectEvent(req, data);
        }

        // 5. Track optimization events
        if (trackingTypes.optimization && data.success && data.data) {
            trackOptimizationEvent(req, data);
        }

        // 6. Track session activity
        if (trackingTypes.session) {
            trackSessionActivity(req);
        }

        // 7. Track errors
        if (!data.success || res.statusCode >= 400) {
            trackErrorEvent(req, res, data);
        }

        // 8. Track performance (slow requests)
        if (responseTime > 1000) {
            trackPerformanceEvent(req, responseTime);
        }

    } catch (error) {
        loggingService.logError(error as Error, {
            component: 'UnifiedMixpanelMiddleware',
            operation: 'handleTracking'
        });
    }
}

/**
 * Track basic API request
 */
function trackApiRequest(req: RequestWithUser, res: Response, responseTime: number): void {
    const userId = req.user?.id;
    const endpoint = req.path;
    const method = req.method;
    const statusCode = res.statusCode;
    const success = statusCode >= 200 && statusCode < 400;

    mixpanelService.track('API Request', {
        endpoint,
        method,
        statusCode,
        responseTime,
        success,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        queryParams: Object.keys(req.query).length,
        bodySize: req.body ? JSON.stringify(req.body).length : 0,
        event_type: 'api_request',
        endpoint_category: getEndpointCategory(endpoint),
        method_category: getMethodCategory(method),
        response_category: getResponseCategory(statusCode)
    }, userId);

    // Track feature usage
    if (userId) {
        mixpanelService.trackFeatureUsage({
            userId,
            feature: endpoint.replace(/\//g, '_').substring(1),
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
}

/**
 * Track authentication event
 */
function trackAuthenticationEvent(req: RequestWithUser, data: any): void {
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

/**
 * Track analytics event
 */
function trackAnalyticsEvent(req: RequestWithUser, data: Record<string, any>): void {
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
            component: 'analytics_endpoint',
            metadata: {
                has_data: !!data.data,
                data_type: data.data ? typeof data.data : undefined,
                record_count: Array.isArray(data.data) ? data.data.length : undefined,
                summary_metrics: data.summary || data.data?.summary,
                response_success: data.success
            }
        });
    }
}

/**
 * Track project event
 */
function trackProjectEvent(req: RequestWithUser, data: any): void {
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

/**
 * Track optimization event
 */
function trackOptimizationEvent(req: RequestWithUser, data: any): void {
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

/**
 * Track session activity
 */
function trackSessionActivity(req: RequestWithUser): void {
    if (req.user?.id) {
        mixpanelService.track('User Session Activity', {
            event_type: 'session',
            endpoint: req.path,
            method: req.method,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            timestamp: new Date().toISOString()
        }, req.user.id);

        mixpanelService.setUserProfile(req.user.id, {
            $last_seen: new Date().toISOString(),
            last_endpoint: req.path,
            last_method: req.method
        });
    }
}

/**
 * Track error event
 */
function trackErrorEvent(req: RequestWithUser, res: Response, data: any): void {
    const userId = req.user?.id;
    const statusCode = res.statusCode;

    mixpanelService.trackError({
        userId,
        error: `HTTP ${statusCode}`,
        errorCode: statusCode.toString(),
        endpoint: req.path,
        severity: getErrorSeverity(statusCode),
        metadata: {
            message: data.message,
            path: req.path,
            method: req.method
        }
    });
}

/**
 * Track performance event
 */
function trackPerformanceEvent(req: RequestWithUser, responseTime: number): void {
    const userId = req.user?.id;

    mixpanelService.trackPerformance({
        userId,
        metric: 'api_response_time',
        value: responseTime,
        unit: 'ms',
        context: {
            endpoint: req.path,
            method: req.method
        }
    });
}

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

