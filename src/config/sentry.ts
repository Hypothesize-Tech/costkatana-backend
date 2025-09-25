import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Environment variables for Sentry configuration
const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
const SENTRY_RELEASE = process.env.SENTRY_RELEASE || process.env.npm_package_version;
const SENTRY_SAMPLE_RATE = parseFloat(process.env.SENTRY_SAMPLE_RATE || '1.0');
const SENTRY_TRACES_SAMPLE_RATE = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1');
const SENTRY_PROFILES_SAMPLE_RATE = parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1');
const SENTRY_DEBUG = process.env.SENTRY_DEBUG === 'true';
const SENTRY_SERVER_NAME = process.env.SENTRY_SERVER_NAME || 'cost-katana-backend';

// Performance monitoring configuration
const SENTRY_ENABLE_PERFORMANCE_MONITORING = process.env.SENTRY_ENABLE_PERFORMANCE_MONITORING !== 'false';
const SENTRY_ENABLE_PROFILING = process.env.SENTRY_ENABLE_PROFILING !== 'false';

// Error filtering and sampling
const SENTRY_ENABLE_ERROR_FILTERING = process.env.SENTRY_ENABLE_ERROR_FILTERING !== 'false';

// Custom Sentry configuration
export const sentryConfig = {
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  release: SENTRY_RELEASE,
  sampleRate: SENTRY_SAMPLE_RATE,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  profilesSampleRate: SENTRY_PROFILES_SAMPLE_RATE,
  debug: SENTRY_DEBUG,
  serverName: SENTRY_SERVER_NAME,
  enablePerformanceMonitoring: SENTRY_ENABLE_PERFORMANCE_MONITORING,
  enableProfiling: SENTRY_ENABLE_PROFILING,
  enableErrorFiltering: SENTRY_ENABLE_ERROR_FILTERING,
};

/**
 * Initialize Sentry with comprehensive configuration
 */
export function initializeSentry(): void {
  // Skip initialization if DSN is not provided
  if (!SENTRY_DSN) {
    console.warn('Sentry DSN not provided. Skipping Sentry initialization.');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    sampleRate: SENTRY_SAMPLE_RATE,
    debug: SENTRY_DEBUG,
    serverName: SENTRY_SERVER_NAME,

    // Profiling integration
    integrations: [
      ...(SENTRY_ENABLE_PROFILING ? [nodeProfilingIntegration()] : []),

      // HTTP integration for automatic HTTP request tracing
      Sentry.httpIntegration(),

      // MongoDB integration for database operation tracing
      Sentry.mongoIntegration(),

      // GraphQL integration (if used)
      Sentry.graphqlIntegration(),

      // Native Node.js integration
      Sentry.nativeNodeFetchIntegration(),

      // Console integration for capturing console logs as breadcrumbs
      Sentry.consoleIntegration(),

      // OnUncaughtException integration
      Sentry.onUncaughtExceptionIntegration(),

      // OnUnhandledRejection integration
      Sentry.onUnhandledRejectionIntegration(),

      // ContextLines integration for better stack traces
      Sentry.contextLinesIntegration(),
    ],
    // Before sending events, filter and enrich them
    beforeSend: (event: Sentry.ErrorEvent, hint: Sentry.EventHint): Sentry.ErrorEvent | null => {
      return beforeSendHook(event, hint) as Sentry.ErrorEvent | null;
    },

    // Global context and tags
    initialScope: {
      tags: {
        component: 'backend',
        service: 'cost-katana-api',
        version: SENTRY_RELEASE,
      },
      contexts: {
        runtime: {
          name: 'node',
          version: process.version,
        },
        application: {
          name: 'Cost Katana Backend',
          version: SENTRY_RELEASE,
          environment: SENTRY_ENVIRONMENT,
        }
      }
    },

    // Performance monitoring options
    tracesSampleRate: SENTRY_ENABLE_PERFORMANCE_MONITORING ? SENTRY_TRACES_SAMPLE_RATE : 0,

    // Error sampling and filtering
    ignoreErrors: [
      // Ignore common harmless errors
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
      'Network Error',
      'Request aborted',
      'aborted',
      'timeout of',
      // Ignore helmet security-related errors that are handled
      'Blocked by CSP',
      'Blocked by X-Frame-Options',
    ],

    // Ignore specific URLs for error tracking
    denyUrls: [
      // Development and testing URLs
      /localhost/,
      /127\.0\.0\.1/,
      /0\.0\.0\.0/,
      // Health check endpoints
      /\/health$/,
      // Static assets
      /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/,
    ],

    // Max breadcrumbs to keep
    maxBreadcrumbs: 100,

    // Attach stack traces to warnings
    attachStacktrace: true,

    // Normalize depth for large objects
    normalizeDepth: 5,

    // Max value length for string truncation
    maxValueLength: 1000,
  });

  console.log(`✅ Sentry initialized for environment: ${SENTRY_ENVIRONMENT}, release: ${SENTRY_RELEASE}`);
}

/**
 * Hook to filter and enrich events before sending to Sentry
 */
function beforeSendHook(event: Sentry.ErrorEvent, hint: Sentry.EventHint): Sentry.ErrorEvent | null {
  // Skip events in development unless explicitly enabled
  if (SENTRY_ENVIRONMENT === 'development' && !SENTRY_DEBUG) {
    return null;
  }

  // Filter out health check errors
  if (event.request?.url?.includes('/health')) {
    return null;
  }

  // Filter out rate limit errors (429) unless they're critical
  if (event.exception && event.tags?.['http.status_code'] === '429') {
    const exception = event.exception.values?.[0];
    if (exception?.value?.includes('rate limit')) {
      return null;
    }
  }

  // Enrich event with additional context
  event.tags = {
    ...event.tags,
    'service.name': 'cost-katana-backend',
    'service.version': SENTRY_RELEASE,
    'node.version': process.version,
    'platform': process.platform,
  };

  // Add custom fingerprinting for better error grouping
  if (event.exception) {
    const exception = event.exception.values?.[0];
    if (exception?.stacktrace?.frames) {
      // Custom fingerprinting logic can be added here
      event.fingerprint = generateCustomFingerprint(event);
    }
  }

  return event;
}

/**
 * Generate custom fingerprint for better error grouping
 */
function generateCustomFingerprint(event: Sentry.Event): string[] {
  const exception = event.exception?.values?.[0];
  const message = exception?.value || '';
  const stacktrace = exception?.stacktrace;

  // Default fingerprint
  const fingerprint = ['{{ default }}'];

  // Custom fingerprinting based on error patterns
  if (message.includes('ValidationError')) {
    fingerprint.push('validation-error');
  } else if (message.includes('MongoError') || message.includes('MongoServerError')) {
    fingerprint.push('database-error');
  } else if (message.includes('JWT') || message.includes('Unauthorized')) {
    fingerprint.push('authentication-error');
  } else if (message.includes('rate limit')) {
    fingerprint.push('rate-limit-error');
  }

  // Add filename and function name if available
  if (stacktrace?.frames?.length) {
    const frame = stacktrace.frames[stacktrace.frames.length - 1];
    if (frame.filename) {
      fingerprint.push(frame.filename);
    }
    if (frame.function) {
      fingerprint.push(frame.function);
    }
  }

  return fingerprint;
}

/**
 * Set user context for error tracking
 */
export function setUserContext(user: {
  id?: string;
  email?: string;
  username?: string;
  role?: string;
  organization?: string;
}): void {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    organization: user.organization,
  });

  // Add user tags for better filtering
  Sentry.setTag('user.id', user.id || 'anonymous');
  Sentry.setTag('user.role', user.role || 'unknown');
  Sentry.setTag('user.organization', user.organization || 'unknown');
}

/**
 * Set request context for error tracking
 */
export function setRequestContext(request: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: Record<string, any>;
  query?: any;
  params?: Record<string, any>;
}): void {
  Sentry.setContext('request', {
    method: request.method,
    url: request.url,
    headers: sanitizeHeaders(request.headers),
    body: sanitizeRequestBody(request.body),
    query: request.query as Record<string, any>,
    params: request.params,
  });
}

/**
 * Set business context for better error categorization
 */
export function setBusinessContext(context: {
  operation?: string;
  component?: string;
  feature?: string;
  userId?: string;
  projectId?: string;
  costOptimizationId?: string;
}): void {
  Sentry.setContext('business', context);

  // Set tags for filtering
  if (context.operation) Sentry.setTag('operation', context.operation);
  if (context.component) Sentry.setTag('component', context.component);
  if (context.feature) Sentry.setTag('feature', context.feature);
  if (context.userId) Sentry.setTag('business.user_id', context.userId);
  if (context.projectId) Sentry.setTag('business.project_id', context.projectId);
  if (context.costOptimizationId) Sentry.setTag('business.optimization_id', context.costOptimizationId);
}

/**
 * Add custom breadcrumb for tracking user actions
 */
export function addBreadcrumb(message: string, category: string, level: Sentry.SeverityLevel = 'info', data?: any): void {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Capture custom error with additional context
 */
export function captureError(error: Error, context?: {
  user?: any;
  request?: any;
  business?: any;
  tags?: Record<string, string>;
  extra?: Record<string, any>;
}): void {
  // Set contexts before capturing
  if (context?.user) setUserContext(context.user);
  if (context?.request) setRequestContext(context.request);
  if (context?.business) setBusinessContext(context.business);

  // Set additional tags
  if (context?.tags) {
    Object.entries(context.tags).forEach(([key, value]) => {
      Sentry.setTag(key, value);
    });
  }

  // Set extra data
  if (context?.extra) {
    Sentry.setContext('extra', context.extra);
  }

  // Capture the error
  Sentry.captureException(error);

  // Clear context after capturing to prevent pollution
  Sentry.setUser(null);
  Sentry.setContext('business', null);
  Sentry.setContext('request', null);
  Sentry.setContext('extra', null);
}

/**
 * Start a performance span
 */
export function startSpan(name: string, op: string) {
  return Sentry.startSpan({
    name,
    op,
  }, (span) => {
    return span;
  });
}

/**
 * Sanitize headers to remove sensitive information
 */
function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;

  const sanitized = { ...headers };
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

  sensitiveHeaders.forEach(header => {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Sanitize request body to remove sensitive information
 */
function sanitizeRequestBody(body?: any): any {
  if (!body) return undefined;

  // Deep clone to avoid modifying original
  const sanitized = JSON.parse(JSON.stringify(body));

  // Remove sensitive fields
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'apiKey', 'authToken'];

  function sanitizeObject(obj: any): void {
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        if (sensitiveFields.includes(key.toLowerCase())) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
    }
  }

  sanitizeObject(sanitized);
  return sanitized;
}

/**
 * Flush pending events (useful for graceful shutdown)
 */
export async function flushSentry(timeout: number = 2000): Promise<boolean> {
  return await Sentry.flush(timeout);
}

/**
 * Close Sentry connection (useful for graceful shutdown)
 */
export async function closeSentry(timeout: number = 2000): Promise<boolean> {
  return await Sentry.close(timeout);
}

/**
 * Get current Sentry configuration (for debugging)
 */
export function getSentryConfig(): typeof sentryConfig {
  return { ...sentryConfig };
}

/**
 * Check if Sentry is enabled and properly configured
 */
export function isSentryEnabled(): boolean {
  return !!SENTRY_DSN && Sentry.getCurrentScope() !== undefined;
}
