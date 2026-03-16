import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { MongoError } from 'mongodb';
import * as Sentry from '@sentry/node';

interface ErrorResponse {
  success: false;
  message: string;
  errors?: any;
  stack?: string;
}

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const startTime = Date.now();

    this.logger.log('=== HTTP EXCEPTION FILTER STARTED ===', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      path: request.originalUrl,
      method: request.method,
    });

    this.logger.log('Step 1: Analyzing exception type and context', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'analyze_exception',
      exceptionName: exception instanceof Error ? exception.name : 'Unknown',
      exceptionMessage:
        exception instanceof Error ? exception.message : 'Unknown error',
      hasStack: exception instanceof Error && !!exception.stack,
    });

    let error: AppError;
    let statusCode: number;
    let errors: any;

    // Handle different exception types
    if (exception instanceof AppError) {
      this.logger.log('AppError instance detected', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'app_error_detected',
        statusCode: exception.statusCode,
        message: exception.message,
        isOperational: exception.isOperational,
      });
      error = exception;
      statusCode = exception.statusCode;
    } else if (exception instanceof ZodError) {
      const zodErrors = Array.isArray(exception.errors) ? exception.errors : [];
      this.logger.log('ZodError validation error detected', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'zod_error_detected',
        errorCount: zodErrors.length,
      });

      const message = 'Validation error';
      errors = zodErrors.map((e) => ({
        field: Array.isArray(e.path) ? e.path.join('.') : String(e.path),
        message: e.message,
      }));

      this.logger.log('Validation errors processed', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'validation_errors_processed',
        errorCount: errors?.length ?? 0,
        fields: (errors ?? []).map((e: any) => e.field),
      });

      error = new AppError(message, 400);
      statusCode = 400;
    } else if (exception instanceof HttpException) {
      const httpException = exception;
      statusCode = httpException.getStatus();
      const response = httpException.getResponse();

      if (typeof response === 'string') {
        error = new AppError(response, statusCode);
      } else if (typeof response === 'object' && response !== null) {
        const errorResponse = response as any;
        error = new AppError(
          errorResponse.message || errorResponse.error || 'HTTP Exception',
          statusCode,
        );
        if (errorResponse.errors) {
          errors = errorResponse.errors;
        }
      } else {
        error = new AppError('HTTP Exception', statusCode);
      }
    } else if (exception instanceof MongoError) {
      const mongoError = exception;

      if (mongoError.name === 'CastError') {
        this.logger.log('MongoDB CastError detected', {
          component: 'HttpExceptionFilter',
          operation: 'catch',
          type: 'error_handling',
          step: 'cast_error_detected',
          errorName: mongoError.name,
          originalMessage: mongoError.message,
        });
        error = new AppError('Invalid ID format', 400);
        statusCode = 400;
      } else if (mongoError.name === 'ValidationError') {
        this.logger.log('MongoDB ValidationError detected', {
          component: 'HttpExceptionFilter',
          operation: 'catch',
          type: 'error_handling',
          step: 'validation_error_detected',
          errorName: mongoError.name,
          originalMessage: mongoError.message,
        });
        error = new AppError('Validation error', 400);
        statusCode = 400;
      } else if (mongoError.code === 11000) {
        this.logger.log('MongoDB duplicate key error detected', {
          component: 'HttpExceptionFilter',
          operation: 'catch',
          type: 'error_handling',
          step: 'duplicate_key_error_detected',
          errorName: mongoError.name,
          errorCode: mongoError.code,
          keyValue: (mongoError as any).keyValue,
        });
        const field = Object.keys((mongoError as any).keyValue || {})[0];
        error = new AppError(`${field} already exists`, 409);
        statusCode = 409;
      } else {
        error = new AppError(mongoError.message || 'Database error', 500);
        statusCode = 500;
      }
    } else if (exception instanceof Error) {
      this.logger.log('Generic error detected, creating AppError', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'generic_error_detected',
        errorName: exception.name,
        originalMessage: exception.message,
      });
      error = new AppError(exception.message || 'Internal server error', 500);
      statusCode = 500;
    } else {
      error = new AppError('Unknown error occurred', 500);
      statusCode = 500;
    }

    this.logger.log('Step 2: Building comprehensive error context', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'build_context',
    });

    // Enhanced logging with security context
    const logContext = {
      error: {
        message: error.message,
        statusCode: error.statusCode,
        stack: error.stack,
        name: exception instanceof Error ? exception.name : 'Unknown',
      },
      request: {
        method: request.method,
        url: request.url,
        originalUrl: request.originalUrl,
        headers: request.headers,
        body: request.body,
        query: request.query,
        params: request.params,
        ip: request.ip,
        user: (request as any).user,
        userAgent: request.get('User-Agent'),
        timestamp: new Date().toISOString(),
      },
    };

    this.logger.log('Error context built successfully', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'context_built',
      statusCode: error.statusCode,
      hasUser: !!(request as any).user,
      hasStack: !!error.stack,
    });

    this.logger.log(
      'Step 3: Determining logging priority and Sentry reporting',
      {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'determine_priority',
      },
    );

    // Send critical errors to Sentry
    const shouldSendToSentry =
      statusCode >= 500 || // Server errors
      exception instanceof MongoError ||
      exception instanceof ZodError ||
      error.isOperational === false; // Unexpected errors

    if (shouldSendToSentry) {
      this.logger.log('Sending error to Sentry for tracking', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'sentry_reporting',
        statusCode: error.statusCode,
        errorName: exception instanceof Error ? exception.name : 'Unknown',
      });

      try {
        // Set Sentry context before capturing error
        const user = (request as any).user;
        if (user) {
          Sentry.setUser({
            id: user.id || user._id,
            email: user.email,
            username: user.username,
            role: user.role,
            organization: user.organizationId || user.organization,
          });
        }

        Sentry.setContext('request', {
          method: request.method,
          url: request.originalUrl,
          headers: request.headers,
          query: request.query as Record<string, any>,
          params: request.params as Record<string, any>,
        });

        // Extract business context from request
        const businessContext = this.extractBusinessContext(request);
        Sentry.setContext('business', businessContext);

        // Capture error with enhanced context
        Sentry.captureException(exception, {
          tags: {
            'http.status_code': statusCode.toString(),
            'http.method': request.method,
            'http.url': request.originalUrl,
            'error.type':
              exception instanceof Error ? exception.name : 'Unknown',
            'error.operational': error.isOperational?.toString() || 'true',
          },
          extra: {
            stack: error.stack,
            userAgent: request.get('User-Agent'),
            ip: request.ip,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (sentryError) {
        this.logger.warn('Failed to send error to Sentry', {
          component: 'HttpExceptionFilter',
          operation: 'catch',
          type: 'error_handling',
          step: 'sentry_error',
          sentryError:
            sentryError instanceof Error
              ? sentryError.message
              : 'Unknown Sentry error',
        });
      }
    }

    // Log security-related errors with higher priority
    if (statusCode === 403 || statusCode === 401) {
      this.logger.log('Security error detected, logging with high priority', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'security_error_logging',
        statusCode: statusCode,
        securityType: statusCode === 401 ? 'Unauthorized' : 'Forbidden',
      });
      this.logger.warn('Security error:', logContext);
    } else if (statusCode >= 500) {
      this.logger.log('Server error detected, logging as error', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'server_error_logging',
        statusCode: statusCode,
        severity: 'high',
      });
      this.logger.error('Server error:', logContext);
    } else if (statusCode === 404) {
      this.logger.log(
        'Resource not found error detected, enhanced security logging',
        {
          component: 'HttpExceptionFilter',
          operation: 'catch',
          type: 'error_handling',
          step: 'not_found_logging',
          statusCode: statusCode,
          securityNote: 'Potential scanning or probing attempt',
        },
      );
      // Enhanced 404 logging for security monitoring
      this.logger.warn('Resource not found:', {
        ...logContext,
        securityNote: 'Potential scanning or probing attempt',
      });
    } else {
      this.logger.log('Client error detected, standard warning logging', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'client_error_logging',
        statusCode: statusCode,
        severity: 'medium',
      });
      this.logger.warn('Client error:', logContext);
    }

    this.logger.log('Step 4: Preparing error response', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'prepare_response',
    });

    const errorResponse: ErrorResponse = {
      success: false,
      message: error.message,
    };

    // Include validation errors if present
    if (errors) {
      errorResponse.errors = errors;
    }

    // Include stack trace in development
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (isDevelopment && error.stack) {
      this.logger.log('Development mode: Including stack trace in response', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'include_stack_trace',
        environment: process.env.NODE_ENV,
        hasStack: !!error.stack,
      });
      errorResponse.stack = error.stack;
    } else {
      this.logger.log('Production mode: Stack trace excluded from response', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'exclude_stack_trace',
        environment: process.env.NODE_ENV,
      });
    }

    this.logger.log('Error response prepared successfully', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'response_prepared',
      statusCode: statusCode,
      hasStack: !!errorResponse.stack,
      responseSize: JSON.stringify(errorResponse).length,
    });

    this.logger.log('Step 5: Sending error response to client', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'send_response',
    });

    // Do not send if response was already sent (e.g. success response already flushed)
    if (response.headersSent) {
      this.logger.warn('Response already sent, skipping error response', {
        component: 'HttpExceptionFilter',
        operation: 'catch',
        type: 'error_handling',
        step: 'response_already_sent',
        path: request.url,
      });
      return;
    }

    // Add CORS headers to error response
    const origin = request.headers.origin;
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Ensure JSON content type
    response.setHeader('Content-Type', 'application/json');

    response.status(statusCode).json(errorResponse);

    this.logger.log('Error response sent successfully', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'response_sent',
      statusCode: statusCode,
      responseTime: `${Date.now() - startTime}ms`,
    });

    this.logger.log('=== HTTP EXCEPTION FILTER COMPLETED ===', {
      component: 'HttpExceptionFilter',
      operation: 'catch',
      type: 'error_handling',
      step: 'completed',
      statusCode: statusCode,
      totalTime: `${Date.now() - startTime}ms`,
    });
  }

  private extractBusinessContext(request: Request & { user?: any }): {
    operation?: string;
    component?: string;
    feature?: string;
    userId?: string;
    projectId?: string;
    costOptimizationId?: string;
  } {
    const path = request.path;
    const method = request.method;

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
      userId: request.user?.id || request.user?._id,
      projectId: request.params?.projectId,
      costOptimizationId: request.params?.optimizationId,
    };
  }
}
