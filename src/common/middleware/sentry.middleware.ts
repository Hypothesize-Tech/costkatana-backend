import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';

@Injectable()
export class SentryMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SentryMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      this.logger.debug('Sentry context setup initiated', {
        component: 'SentryMiddleware',
        operation: 'use',
        type: 'sentry_setup',
        requestId,
        method: req.method,
        url: req.originalUrl,
      });

      // Configure Sentry scope for this request
      Sentry.withScope((scope) => {
        // Set request context
        scope.setContext('request', {
          method: req.method,
          url: req.originalUrl,
          headers: this.sanitizeHeaders(req.headers),
          query: req.query as Record<string, any>,
          params: req.params as Record<string, any>,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString(),
        });

        // Set user context if authenticated
        const user = (req as any).user;
        if (user) {
          scope.setUser({
            id: user.id || user._id,
            email: user.email,
            username: user.username,
            role: user.role,
            organization: user.organizationId || user.organization,
          });

          scope.setContext('user', {
            id: user.id || user._id,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
            sessionId: user.sessionId,
            apiKeyId: user.apiKeyId,
          });
        }

        // Set business context
        const businessContext = this.extractBusinessContext(req);
        scope.setContext('business', businessContext);

        // Set tags for better error categorization
        scope.setTags({
          'http.method': req.method,
          'http.url': req.originalUrl,
          'http.status_code': res.statusCode,
          'request.id': requestId,
          'user.authenticated': !!user,
          'business.operation': businessContext.operation,
          'business.component': businessContext.component,
          'business.feature': businessContext.feature,
        });

        // Set extras
        scope.setExtras({
          requestId,
          duration: `${Date.now() - startTime}ms`,
          environment: process.env.NODE_ENV || 'development',
          version: process.env.npm_package_version || 'unknown',
        });
      });

      // Store request ID in Sentry for correlation
      Sentry.setTag('request.id', requestId);

      this.logger.debug('Sentry context setup completed', {
        component: 'SentryMiddleware',
        operation: 'use',
        type: 'sentry_setup_completed',
        requestId,
        hasUser: !!(req as any).user,
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      this.logger.error('Sentry middleware setup error', {
        component: 'SentryMiddleware',
        operation: 'use',
        type: 'sentry_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      // Continue processing even if Sentry setup fails
      next();
    }
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...(headers ?? {}) };

    // Remove sensitive headers
    const sensitiveHeaders = [
      'authorization',
      'x-api-key',
      'cookie',
      'x-mfa-token',
      'proxy-authorization',
      'x-forwarded-for',
      'x-real-ip',
    ];

    sensitiveHeaders.forEach((header) => {
      const lowerHeader = header.toLowerCase();
      if (sanitized[lowerHeader]) {
        sanitized[lowerHeader] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  private extractBusinessContext(req: Request & { user?: any }): {
    operation?: string;
    component?: string;
    feature?: string;
    userId?: string;
    projectId?: string;
    costOptimizationId?: string;
  } {
    const path = req.path;
    const method = req.method;

    let operation = 'unknown';
    let component = 'unknown';
    let feature = 'unknown';

    // Authentication routes
    if (
      path.includes('/auth') ||
      path.includes('/login') ||
      path.includes('/register')
    ) {
      operation = method === 'POST' ? 'authentication' : 'auth_check';
      component = 'authentication';
      feature = 'user_access';
    }
    // User management
    else if (path.includes('/users') || path.includes('/profile')) {
      operation =
        method === 'GET'
          ? 'read'
          : method === 'POST'
            ? 'create'
            : method === 'PUT'
              ? 'update'
              : method === 'DELETE'
                ? 'delete'
                : method.toLowerCase();
      component = 'user_management';
      feature = 'user_profiles';
    }
    // Project management
    else if (path.includes('/projects')) {
      operation =
        method === 'GET'
          ? 'read'
          : method === 'POST'
            ? 'create'
            : method === 'PUT'
              ? 'update'
              : method === 'DELETE'
                ? 'delete'
                : method.toLowerCase();
      component = 'project_management';
      feature = 'projects';
    }
    // Cost optimization
    else if (path.includes('/optimization') || path.includes('/cost')) {
      operation =
        method === 'GET'
          ? 'read'
          : method === 'POST'
            ? 'create'
            : method === 'PUT'
              ? 'update'
              : method === 'DELETE'
                ? 'delete'
                : method.toLowerCase();
      component = 'cost_optimization';
      feature = 'optimization';
    }
    // AI operations
    else if (
      path.includes('/ai') ||
      path.includes('/intelligence') ||
      path.includes('/chat')
    ) {
      operation = 'ai_interaction';
      component = 'ai_services';
      feature = 'ai_interactions';
    }
    // Analytics and reporting
    else if (
      path.includes('/analytics') ||
      path.includes('/metrics') ||
      path.includes('/reports')
    ) {
      operation = 'data_analysis';
      component = 'analytics';
      feature = 'reporting';
    }
    // Webhook operations
    else if (path.includes('/webhooks') || path.includes('/webhook')) {
      operation = method === 'POST' ? 'webhook_receive' : 'webhook_management';
      component = 'webhook_service';
      feature = 'integrations';
    }
    // Billing and payments
    else if (
      path.includes('/billing') ||
      path.includes('/payment') ||
      path.includes('/subscription')
    ) {
      operation =
        method === 'GET'
          ? 'read'
          : method === 'POST'
            ? 'create'
            : method === 'PUT'
              ? 'update'
              : method === 'DELETE'
                ? 'delete'
                : method.toLowerCase();
      component = 'billing_service';
      feature = 'billing';
    }

    return {
      operation,
      component,
      feature,
      userId: req.user?.id || req.user?._id,
      projectId: req.params?.projectId,
      costOptimizationId: req.params?.optimizationId,
    };
  }
}
