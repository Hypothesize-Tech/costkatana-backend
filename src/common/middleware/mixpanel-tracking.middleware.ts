import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import * as Mixpanel from 'mixpanel';

/**
 * Mixpanel Tracking Middleware
 * Tracks user events and page views for analytics using the official Mixpanel SDK
 * Integrates with Mixpanel for comprehensive user behavior analysis
 */
@Injectable()
export class MixpanelTrackingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MixpanelTrackingMiddleware.name);
  private mixpanelEnabled = false;
  private mixpanelToken = '';
  private mixpanel: Mixpanel.Mixpanel | null = null;

  constructor(private configService: ConfigService) {
    try {
      const enabled = this.configService?.get?.('MIXPANEL_ENABLED', 'false');
      this.mixpanelEnabled = enabled === 'true';
      this.mixpanelToken =
        this.configService?.get?.('MIXPANEL_TOKEN', '') ?? '';

      // Initialize Mixpanel SDK
      if (this.mixpanelEnabled && this.mixpanelToken) {
        try {
          this.mixpanel = Mixpanel.init(this.mixpanelToken, {
            protocol: 'https',
            keepAlive: false,
          });
          this.logger.log('Mixpanel SDK initialized successfully');
        } catch (error) {
          this.logger.error('Failed to initialize Mixpanel SDK', error);
          this.mixpanelEnabled = false;
        }
      } else {
        this.logger.warn('Mixpanel tracking disabled or token not configured');
      }
    } catch (error) {
      this.mixpanelEnabled = false;
      this.mixpanel = null;
      this.logger.warn(
        'Mixpanel tracking disabled (config unavailable or init failed)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Fail silently if not enabled or config missing (e.g. optional .env)
    if (!this?.mixpanelEnabled || !this?.mixpanel) {
      return next();
    }

    const startTime = Date.now();
    const userId = (req as any).user?.id;
    const sessionId = (req as any).user?.sessionId;
    const distinctId = userId || req.ip || 'anonymous';

    // Store original response.json to intercept response data
    const originalJson = res.json.bind(res);
    let responseData: any = null;

    res.json = (data: any) => {
      responseData = data;
      return originalJson(data);
    };

    // Track response when finished
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Determine tracking types based on path
      const trackingTypes = {
        api: true, // Always track API requests
        auth: req.path.includes('/auth'),
        analytics: req.path.includes('/analytics'),
        project: req.path.includes('/projects'),
        optimization: req.path.includes('/optimization'),
        session: !!userId,
      };

      // Handle all tracking types
      this.handleTracking({
        req: req as any,
        res,
        data: responseData,
        responseTime,
        trackingTypes,
        userId,
        sessionId,
        distinctId,
        statusCode,
      });
    });

    next();
  }

  /**
   * Centralized tracking handler
   */
  private handleTracking(context: {
    req: any;
    res: Response;
    data: any;
    responseTime: number;
    trackingTypes: any;
    userId?: string;
    sessionId?: string;
    distinctId: string;
    statusCode: number;
  }): void {
    const {
      req,
      res,
      data,
      responseTime,
      trackingTypes,
      userId,
      sessionId,
      distinctId,
      statusCode,
    } = context;

    try {
      // 1. Track basic API request
      if (trackingTypes.api) {
        this.trackApiRequest(
          req,
          res,
          responseTime,
          userId,
          sessionId,
          distinctId,
        );
      }

      // 2. Track authentication events
      if (trackingTypes.auth && data?.success) {
        this.trackAuthenticationEvent(req, data, distinctId);
      }

      // 3. Track analytics events
      if (trackingTypes.analytics && data?.success) {
        this.trackAnalyticsEventFromRequest(req, data, distinctId);
      }

      // 4. Track project events
      if (trackingTypes.project && data?.success && data?.data) {
        this.trackProjectEventFromRequest(req, data, distinctId);
      }

      // 5. Track optimization events
      if (trackingTypes.optimization && data?.success && data?.data) {
        this.trackOptimizationEvent(req, data, distinctId);
      }

      // 6. Track session activity
      if (trackingTypes.session) {
        this.trackSessionActivity(req, distinctId);
      }

      // 7. Track errors
      if (!data?.success || statusCode >= 400) {
        this.trackErrorEvent(req, res, data, distinctId);
      }

      // 8. Track performance (slow requests)
      if (responseTime > 1000) {
        this.trackPerformanceEvent(req, responseTime, distinctId);
      }
    } catch (error) {
      this.logger.error('Failed to handle Mixpanel tracking', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track basic API request
   */
  private trackApiRequest(
    req: any,
    res: Response,
    responseTime: number,
    userId?: string,
    sessionId?: string,
    distinctId?: string,
  ): void {
    const endpoint = req.path;
    const method = req.method;
    const statusCode = res.statusCode;
    const success = statusCode >= 200 && statusCode < 400;

    const properties = {
      endpoint,
      method,
      statusCode,
      responseTime,
      success,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      queryParams: Object.keys(req.query).length,
      bodySize: req.body ? JSON.stringify(req.body).length : 0,
      event_type: 'api_request',
      endpoint_category: this.getEndpointCategory(endpoint),
      method_category: this.getMethodCategory(method),
      response_category: this.getResponseCategory(statusCode),
      session_id: sessionId,
    };

    this.trackEvent('API Request', distinctId!, properties);

    // Track feature usage
    if (userId) {
      this.trackFeatureUsage({
        userId,
        feature: endpoint.replace(/\//g, '_').substring(1),
        action: method.toLowerCase(),
        page: endpoint,
        component: 'api_endpoint',
        metadata: {
          statusCode,
          responseTime,
          success,
        },
      });
    }
  }

  /**
   * Track authentication event
   */
  private trackAuthenticationEvent(
    req: any,
    data: any,
    distinctId: string,
  ): void {
    const userId = data.user?.id || data.data?.user?.id;
    const event = this.getAuthEvent(req.path, req.method);

    if (event && userId) {
      this.trackAuthEvent(event, {
        userId,
        method: req.method,
        source: req.path,
        userAgent: req.headers['user-agent'] || '',
        ip: req.ip || '',
        success: true,
        metadata: {
          endpoint: req.path,
          method: req.method,
        },
      });
    }
  }

  /**
   * Track analytics event (from request context)
   */
  private trackAnalyticsEventFromRequest(
    req: any,
    data: any,
    distinctId: string,
  ): void {
    const userId = req.user?.id;
    const event = this.getAnalyticsEvent(req.path, req.method);

    if (event && userId) {
      this.trackAnalyticsEvent(event, {
        userId,
        projectId: req.query.projectId as string,
        reportType: req.query.groupBy as string,
        dateRange:
          req.query.startDate && req.query.endDate
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
          response_success: data.success,
        },
      });
    }
  }

  /**
   * Track project event (from request context)
   */
  private trackProjectEventFromRequest(
    req: any,
    data: any,
    distinctId: string,
  ): void {
    const userId = req.user?.id;
    const event = this.getProjectEvent(req.path, req.method);

    if (event && userId && data.data) {
      const projectData = data.data;
      this.trackProjectEvent(event, {
        userId,
        projectId: projectData._id || projectData.id,
        projectName: projectData.name,
        department: projectData.department,
        team: projectData.team,
        page: req.path,
        component: 'project_endpoint',
      });
    }
  }

  /**
   * Track optimization event
   */
  private trackOptimizationEvent(
    req: any,
    data: any,
    distinctId: string,
  ): void {
    const userId = req.user?.id;
    const optimizationData = data.data;

    if (userId && optimizationData.savings !== undefined) {
      this.trackOptimization({
        userId,
        projectId: optimizationData.projectId,
        optimizationType: optimizationData.type || 'cost_analysis',
        originalCost: optimizationData.originalCost || 0,
        optimizedCost: optimizationData.optimizedCost || 0,
        savings: optimizationData.savings || 0,
        success: optimizationData.success !== false,
        page: req.path,
        component: 'optimization_endpoint',
      });
    }
  }

  /**
   * Track session activity
   */
  private trackSessionActivity(req: any, distinctId: string): void {
    const userId = req.user?.id;
    if (userId) {
      this.trackEvent('User Session Activity', distinctId, {
        event_type: 'session',
        endpoint: req.path,
        method: req.method,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      this.updateUserProfile(userId, {
        $last_seen: new Date().toISOString(),
        last_endpoint: req.path,
        last_method: req.method,
      });
    }
  }

  /**
   * Track error event
   */
  private trackErrorEvent(
    req: any,
    res: Response,
    data: any,
    distinctId: string,
  ): void {
    const userId = req.user?.id;
    const statusCode = res.statusCode;

    this.trackError({
      userId,
      error: `HTTP ${statusCode}`,
      errorCode: statusCode.toString(),
      endpoint: req.path,
      severity: this.getErrorSeverity(statusCode),
      metadata: {
        message: data?.message,
        path: req.path,
        method: req.method,
      },
    });
  }

  /**
   * Track performance event
   */
  private trackPerformanceEvent(
    req: any,
    responseTime: number,
    distinctId: string,
  ): void {
    const userId = req.user?.id;

    this.trackPerformance({
      userId,
      metric: 'api_response_time',
      value: responseTime,
      unit: 'ms',
      context: {
        endpoint: req.path,
        method: req.method,
      },
    });
  }

  /**
   * Track an event to Mixpanel
   */
  private trackEvent(
    eventName: string,
    distinctId: string,
    properties: Record<string, any>,
  ) {
    if (!this.mixpanel) return;

    try {
      this.mixpanel.track(eventName, {
        distinct_id: distinctId,
        ...properties,
        time: Date.now(),
      });

      this.logger.debug(`Mixpanel event tracked: ${eventName}`, {
        distinctId,
        eventName,
      });
    } catch (error) {
      this.logger.error('Failed to track Mixpanel event', {
        eventName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Update user profile in Mixpanel
   */
  private updateUserProfile(
    distinctId: string,
    properties: Record<string, any>,
  ) {
    if (!this.mixpanel) return;

    try {
      this.mixpanel.people.set(distinctId, properties);

      this.logger.debug(`Mixpanel profile updated for ${distinctId}`);
    } catch (error) {
      this.logger.error('Failed to update Mixpanel profile', {
        distinctId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track page view (for specific routes)
   */
  public trackPageView(
    distinctId: string,
    pageName: string,
    properties?: Record<string, any>,
  ) {
    this.trackEvent('page_view', distinctId, {
      page_name: pageName,
      ...properties,
    });
  }

  /**
   * Track custom event
   */
  public trackCustomEvent(
    eventName: string,
    distinctId: string,
    properties?: Record<string, any>,
  ) {
    this.trackEvent(eventName, distinctId, properties || {});
  }

  /**
   * Identify user (set user properties)
   */
  public identifyUser(userId: string, properties: Record<string, any>) {
    if (!this.mixpanel) return;

    try {
      this.mixpanel.people.set(userId, {
        $distinct_id: userId,
        ...properties,
      });

      this.logger.log(`User identified in Mixpanel: ${userId}`);
    } catch (error) {
      this.logger.error('Failed to identify user in Mixpanel', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track user signup
   */
  public trackSignup(userId: string, properties?: Record<string, any>) {
    this.trackEvent('user_signup', userId, properties || {});
    this.mixpanel?.people.set(userId, {
      $created: new Date().toISOString(),
      ...properties,
    });
  }

  /**
   * Increment user property
   */
  public incrementProperty(
    userId: string,
    property: string,
    value: number = 1,
  ) {
    if (!this.mixpanel) return;

    try {
      this.mixpanel.people.increment(userId, property, value);
    } catch (error) {
      this.logger.error('Failed to increment Mixpanel property', {
        userId,
        property,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track authentication event
   */
  public trackAuthEvent(
    event: 'login' | 'logout' | 'register' | 'password_reset',
    properties: any,
  ) {
    this.trackEvent(
      `User ${event.replace('_', ' ')}`,
      properties.userId,
      properties,
    );
  }

  /**
   * Track analytics event
   */
  public trackAnalyticsEvent(
    event: 'dashboard_viewed' | 'report_generated' | 'export_requested',
    properties: any,
  ) {
    this.trackEvent(
      `Analytics ${event.replace('_', ' ')}`,
      properties.userId,
      properties,
    );
  }

  /**
   * Track project event
   */
  public trackProjectEvent(
    event: 'created' | 'updated' | 'deleted' | 'archived',
    properties: any,
  ) {
    this.trackEvent(`Project ${event}`, properties.userId, properties);
  }

  /**
   * Track optimization event
   */
  public trackOptimization(properties: any) {
    this.trackEvent('Optimization Applied', properties.userId, properties);
  }

  /**
   * Track error event
   */
  public trackError(properties: any) {
    this.trackEvent(
      'Error Occurred',
      properties.userId || 'anonymous',
      properties,
    );
  }

  /**
   * Track performance event
   */
  public trackPerformance(properties: any) {
    this.trackEvent(
      'Performance Metric',
      properties.userId || 'anonymous',
      properties,
    );
  }

  /**
   * Track feature usage
   */
  public trackFeatureUsage(properties: any) {
    this.trackEvent('Feature Used', properties.userId, properties);
  }

  /**
   * Helper functions
   */
  private getEndpointCategory(endpoint: string): string {
    if (endpoint.includes('/auth')) return 'authentication';
    if (endpoint.includes('/analytics')) return 'analytics';
    if (endpoint.includes('/projects')) return 'projects';
    if (endpoint.includes('/usage')) return 'usage';
    if (endpoint.includes('/optimization')) return 'optimization';
    if (endpoint.includes('/chat')) return 'chat';
    if (endpoint.includes('/intelligence')) return 'intelligence';
    return 'other';
  }

  private getMethodCategory(method: string): string {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'read';
      case 'POST':
        return 'create';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'other';
    }
  }

  private getResponseCategory(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) return 'success';
    if (statusCode >= 300 && statusCode < 400) return 'redirect';
    if (statusCode >= 400 && statusCode < 500) return 'client_error';
    if (statusCode >= 500) return 'server_error';
    return 'unknown';
  }

  private getErrorSeverity(
    statusCode: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (statusCode >= 500) return 'high';
    if (statusCode >= 400) return 'medium';
    return 'low';
  }

  private getAuthEvent(
    path: string,
    method: string,
  ): 'login' | 'logout' | 'register' | 'password_reset' | null {
    if (path.includes('/login') && method === 'POST') return 'login';
    if (path.includes('/logout') && method === 'POST') return 'logout';
    if (path.includes('/register') && method === 'POST') return 'register';
    if (path.includes('/password-reset') && method === 'POST')
      return 'password_reset';
    return null;
  }

  private getAnalyticsEvent(
    path: string,
    method: string,
  ): 'dashboard_viewed' | 'report_generated' | 'export_requested' | null {
    if (path.includes('/analytics') && method === 'GET')
      return 'dashboard_viewed';
    if (path.includes('/analytics/export') && method === 'GET')
      return 'export_requested';
    if (path.includes('/analytics/report') && method === 'GET')
      return 'report_generated';
    return null;
  }

  private getProjectEvent(
    path: string,
    method: string,
  ): 'created' | 'updated' | 'deleted' | 'archived' | null {
    if (path.includes('/projects') && method === 'POST') return 'created';
    if (path.includes('/projects') && (method === 'PUT' || method === 'PATCH'))
      return 'updated';
    if (path.includes('/projects') && method === 'DELETE') return 'deleted';
    if (path.includes('/projects/archive') && method === 'POST')
      return 'archived';
    return null;
  }
}
