import { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import { setUserContext, setRequestContext, setBusinessContext, addBreadcrumb } from '../config/sentry';
import { loggingService } from '../services/logging.service';

/**
 * Sentry Context Middleware
 *
 * This middleware captures and sets Sentry context for each request,
 * including user information, request details, and business context.
 * It enhances error tracking with rich contextual data.
 */
export const sentryContextMiddleware = (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();

  try {
    // Set user context if user is authenticated
    if (req.user) {
      setUserContext({
        id: req.user.id || req.user._id,
        email: req.user.email,
        username: req.user.username,
        role: req.user.role,
        organization: req.user.organizationId || req.user.organization
      });

      // Add breadcrumb for authenticated user action
      addBreadcrumb(
        `User ${req.user.email || req.user.id} accessing ${req.method} ${req.path}`,
        'auth',
        'info',
        {
          userId: req.user.id || req.user._id,
          userRole: req.user.role,
          userEmail: req.user.email
        }
      );
    } else {
      // Add breadcrumb for anonymous access
      addBreadcrumb(
        `Anonymous access to ${req.method} ${req.path}`,
        'auth',
        'info',
        {
          userAgent: req.get('User-Agent'),
          ip: req.ip
        }
      );
    }

    // Set request context for all requests
    setRequestContext({
      method: req.method,
      url: req.originalUrl,
      headers: req.headers as Record<string, string>,
      query: req.query as Record<string, any>,
      params: req.params,
      body: req.method !== 'GET' ? req.body : undefined // Don't log body for GET requests
    });

    // Set business context based on route patterns
    setBusinessContextFromRoute(req);

    // Set custom tags based on request characteristics
    setCustomTags(req);

    // Add breadcrumb for request start
    addBreadcrumb(
      `Request started: ${req.method} ${req.originalUrl}`,
      'http',
      'info',
      {
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type'),
        contentLength: req.get('Content-Length')
      }
    );

    // Store original response methods to intercept
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;

    // Intercept response to add completion breadcrumb
    const addResponseBreadcrumb = () => {
      const duration = Date.now() - startTime;
      addBreadcrumb(
        `Request completed: ${req.method} ${req.originalUrl} (${res.statusCode})`,
        'http',
        res.statusCode >= 400 ? 'warning' : 'info',
        {
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          responseSize: res.get('Content-Length')
        }
      );
    };

    // Wrap response methods to capture completion
    res.send = function(data: any) {
      addResponseBreadcrumb();
      return originalSend.call(this, data);
    };

    res.json = function(data: any) {
      addResponseBreadcrumb();
      return originalJson.call(this, data);
    };

    res.end = function(chunk?: any, encoding?: any, callback?: any) {
      addResponseBreadcrumb();
      return originalEnd.call(this, chunk, encoding, callback);
    };

  } catch (error) {
    // Log middleware errors but don't break the request
    loggingService.warn('Sentry context middleware error', {
      component: 'SentryMiddleware',
      operation: 'sentryContextMiddleware',
      type: 'middleware_error',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }

  next();
};

/**
 * Set business context based on route patterns
 */
function setBusinessContextFromRoute(req: Request & { user?: any }): void {
  const path = req.path;
  const method = req.method;

  // Extract business context from route patterns
  let operation = 'unknown';
  let component = 'unknown';
  let feature = 'unknown';

  // Authentication routes
  if (path.includes('/auth') || path.includes('/login') || path.includes('/register')) {
    operation = method === 'POST' ? 'authentication' : 'auth_check';
    component = 'authentication';
    feature = 'user_access';
  }
  // User management
  else if (path.includes('/users') || path.includes('/profile')) {
    operation = getCrudOperation(method);
    component = 'user_management';
    feature = 'user_profiles';
  }
  // Project management
  else if (path.includes('/projects')) {
    operation = getCrudOperation(method);
    component = 'project_management';
    feature = 'projects';
  }
  // Cost optimization
  else if (path.includes('/optimization') || path.includes('/cost')) {
    operation = getCrudOperation(method);
    component = 'cost_optimization';
    feature = 'optimization';
  }
  // AI operations
  else if (path.includes('/ai') || path.includes('/intelligence') || path.includes('/chat')) {
    operation = 'ai_interaction';
    component = 'ai_services';
    feature = 'ai_interactions';
  }
  // Analytics and reporting
  else if (path.includes('/analytics') || path.includes('/metrics') || path.includes('/reports')) {
    operation = 'data_analysis';
    component = 'analytics';
    feature = 'reporting';
  }
  // API keys and security
  else if (path.includes('/keys') || path.includes('/security') || path.includes('/apikey')) {
    operation = getCrudOperation(method);
    component = 'security';
    feature = 'api_keys';
  }
  // Webhooks
  else if (path.includes('/webhook')) {
    operation = method === 'POST' ? 'webhook_delivery' : 'webhook_management';
    component = 'webhooks';
    feature = 'integrations';
  }
  // Health checks
  else if (path.includes('/health')) {
    operation = 'health_check';
    component = 'monitoring';
    feature = 'health';
  }

  setBusinessContext({
    operation,
    component,
    feature,
    userId: req.user?.id || req.user?._id,
        projectId: req.params?.projectId || (req.query?.projectId as string),
    costOptimizationId: req.params?.optimizationId || req.params?.id
  });
}

/**
 * Convert HTTP method to CRUD operation
 */
function getCrudOperation(method: string): string {
  switch (method) {
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
      return method.toLowerCase();
  }
}

/**
 * Set custom tags based on request characteristics
 */
function setCustomTags(req: Request & { user?: any }): void {
  const tags: Record<string, string> = {};

  // Request type tags
  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
    tags['request.type'] = 'ajax';
  } else {
    tags['request.type'] = 'regular';
  }

  // User type tags
  if (req.user) {
    tags['user.type'] = 'authenticated';
    tags['user.role'] = req.user.role || 'unknown';

    // Organization context
    if (req.user.organizationId || req.user.organization) {
      tags['organization.present'] = 'true';
    }
  } else {
    tags['user.type'] = 'anonymous';
  }

  // API version detection (if applicable)
  const apiVersion = req.path.match(/^\/api\/v(\d+)/)?.[1];
  if (apiVersion) {
    tags['api.version'] = apiVersion;
  }

    // Content type
    const contentType = req.get('Content-Type');
    if (contentType) {
      if (contentType.includes('application/json')) {
        tags['content.type'] = 'json';
      } else if (contentType.includes('multipart/form-data')) {
        tags['content.type'] = 'multipart';
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        tags['content.type'] = 'form-urlencoded';
      } else {
        tags['content.type'] = 'other';
      }
    }

    // Request size
    const contentLength = req.get('Content-Length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > 1024 * 1024) { // > 1MB
        tags['request.size'] = 'large';
      } else if (size > 1024 * 100) { // > 100KB
        tags['request.size'] = 'medium';
      } else {
        tags['request.size'] = 'small';
      }
    }

  // Set all tags
  Object.entries(tags).forEach(([key, value]) => {
    Sentry.setTag(key, value);
  });
}

/**
 * Performance monitoring middleware for critical operations
 * Note: Using Sentry's automatic HTTP instrumentation instead
 */
export const sentryPerformanceMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Sentry automatically instruments HTTP requests
  // This middleware is kept for future custom instrumentation if needed
  next();
};


/**
 * Middleware to capture business logic errors and send to Sentry
 */
export const sentryBusinessErrorMiddleware = (
  error: Error,
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) => {
  // Only capture business logic errors, not validation or auth errors
  if (error && !isValidationError(error) && !isAuthError(error)) {
    const businessContext = {
      operation: req.path.split('/').pop() || 'unknown',
      component: req.path.split('/')[2] || 'unknown', // Extract from /api/component/...
      feature: getFeatureFromPath(req.path),
      userId: req.user?.id || req.user?._id,
      projectId: req.params?.projectId,
      costOptimizationId: req.params?.optimizationId
    };

    // Import here to avoid circular dependencies
    const { captureError } = require('../config/sentry');

    captureError(error, {
      user: req.user ? {
        id: req.user.id || req.user._id,
        email: req.user.email,
        role: req.user.role,
        organization: req.user.organizationId || req.user.organization
      } : undefined,
                request: {
                    method: req.method,
                    url: req.originalUrl,
                    query: req.query as Record<string, any>,
                    params: req.params as Record<string, any>
                },
      business: businessContext,
      tags: {
        'error.type': 'business_logic',
        'http.method': req.method,
        'http.url': req.originalUrl
      }
    });
  }

  next(error);
};

/**
 * Check if error is a validation error
 */
function isValidationError(error: any): boolean {
  if (!error) return false;
  
  // Handle Error objects
  if (error instanceof Error) {
    if (error.name === 'ValidationError') return true;
    const message = error.message || '';
    if (message && typeof message === 'string') {
      return message.includes('validation') || message.includes('Validation');
    }
    return false;
  }
  
  // Handle plain objects
  if (typeof error === 'object') {
    if (error.name === 'ValidationError') return true;
    const message = error.message || error.error?.message || '';
    if (message && typeof message === 'string') {
      return message.includes('validation') || message.includes('Validation');
    }
  }
  
  // Handle strings
  if (typeof error === 'string') {
    return error.toLowerCase().includes('validation');
  }
  
  return false;
}

/**
 * Check if error is an authentication/authorization error
 */
function isAuthError(error: any): boolean {
  if (!error) return false;
  
  // Handle Error objects
  if (error instanceof Error) {
    if (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError') return true;
    const message = error.message || '';
    if (message && typeof message === 'string') {
      return message.includes('unauthorized') ||
             message.includes('forbidden') ||
             message.includes('authentication') ||
             message.includes('authorization');
    }
    return false;
  }
  
  // Handle plain objects
  if (typeof error === 'object') {
    if (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError') return true;
    const message = error.message || error.error?.message || '';
    if (message && typeof message === 'string') {
      return message.includes('unauthorized') ||
             message.includes('forbidden') ||
             message.includes('authentication') ||
             message.includes('authorization');
    }
  }
  
  // Handle strings
  if (typeof error === 'string') {
    const lowerError = error.toLowerCase();
    return lowerError.includes('unauthorized') ||
           lowerError.includes('forbidden') ||
           lowerError.includes('authentication') ||
           lowerError.includes('authorization');
  }
  
  return false;
}

/**
 * Extract feature name from request path
 */
function getFeatureFromPath(path: string): string {
  const pathParts = path.split('/').filter(Boolean);

  // Map common path patterns to features
  if (pathParts.includes('projects')) return 'projects';
  if (pathParts.includes('optimization') || pathParts.includes('cost')) return 'cost_optimization';
  if (pathParts.includes('ai') || pathParts.includes('intelligence')) return 'ai_services';
  if (pathParts.includes('analytics') || pathParts.includes('metrics')) return 'analytics';
  if (pathParts.includes('users') || pathParts.includes('profile')) return 'user_management';
  if (pathParts.includes('auth')) return 'authentication';
  if (pathParts.includes('webhook')) return 'webhooks';
  if (pathParts.includes('security') || pathParts.includes('keys')) return 'security';

  return 'unknown';
}
