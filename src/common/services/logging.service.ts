import { Injectable, Logger } from '@nestjs/common';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';

export interface LogContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
  source?: string;
  component?: string;
  operation?: string;
  [key: string]: any;
}

export interface MetricData {
  namespace: string;
  metricName: string;
  value: number;
  unit?: string;
  dimensions?: Record<string, string>;
  timestamp?: Date;
}

export interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SecurityEvent {
  event: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: string;
  target?: string;
  metadata?: Record<string, any>;
}

export interface BusinessEvent {
  event: string;
  category: string;
  value?: number;
  currency?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);
  private cloudWatchClient: CloudWatchClient;
  private metricBuffer: MetricData[] = [];
  private flushInterval: NodeJS.Timeout;

  constructor() {
    this.cloudWatchClient = new CloudWatchClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    // Flush metrics every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushMetrics();
    }, 30000);

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  // ===== BASIC LOGGING METHODS =====

  info(message: string, context: LogContext = {}): void {
    this.logger.log(message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.logger.error(message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.logger.warn(message, context);
  }

  debug(message: string, context: LogContext = {}): void {
    this.logger.debug(message, context);
  }

  verbose(message: string, context: LogContext = {}): void {
    this.logger.verbose(message, context);
  }

  // ===== SPECIALIZED LOGGING METHODS =====

  logError(error: Error, context: LogContext = {}): void {
    this.error(error.message, {
      ...context,
      stack: error.stack,
      error: error.name,
    });
  }

  logPerformance(metric: PerformanceMetric, context: LogContext = {}): void {
    this.info(`Performance: ${metric.operation}`, {
      ...context,
      operation: metric.operation,
      duration: metric.duration,
      success: metric.success,
      error: metric.error,
      ...metric.metadata,
    });

    // Send performance metrics to CloudWatch
    this.addMetric({
      namespace: 'Performance',
      metricName: 'Duration',
      value: metric.duration,
      unit: 'Milliseconds',
      dimensions: {
        Operation: metric.operation,
        Success: metric.success.toString(),
        Environment: process.env.NODE_ENV || 'development',
        ...metric.metadata,
      },
    });

    // Send success/failure metrics
    this.addMetric({
      namespace: 'Performance',
      metricName: 'SuccessRate',
      value: metric.success ? 1 : 0,
      unit: 'Count',
      dimensions: {
        Operation: metric.operation,
        Environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  logSecurity(event: SecurityEvent, context: LogContext = {}): void {
    this.warn(`Security Event: ${event.event}`, {
      ...context,
      event: event.event,
      severity: event.severity,
      source: event.source,
      target: event.target,
      ...event.metadata,
    });

    // Send security metrics to CloudWatch
    this.addMetric({
      namespace: 'Security',
      metricName: 'EventCount',
      value: 1,
      unit: 'Count',
      dimensions: {
        EventType: event.event,
        Severity: event.severity,
        Source: event.source,
        Environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  logBusiness(event: BusinessEvent, context: LogContext = {}): void {
    this.info(`Business Event: ${event.event}`, {
      ...context,
      event: event.event,
      category: event.category,
      value: event.value,
      currency: event.currency,
      ...event.metadata,
    });

    // Send business metrics to CloudWatch
    if (event.value !== undefined) {
      this.addMetric({
        namespace: 'Business',
        metricName: event.event,
        value: event.value,
        unit: event.currency || 'Count',
        dimensions: {
          Category: event.category,
          Environment: process.env.NODE_ENV || 'development',
          ...event.metadata,
        },
      });
    }

    // Send event count metrics
    this.addMetric({
      namespace: 'Business',
      metricName: 'EventCount',
      value: 1,
      unit: 'Count',
      dimensions: {
        EventType: event.event,
        Category: event.category,
        Environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  // ===== HTTP REQUEST/RESPONSE LOGGING =====

  logRequest(method: string, endpoint: string, context: LogContext = {}): void {
    this.info(`Request: ${method} ${endpoint}`, {
      ...context,
      request: {
        method,
        endpoint,
        type: 'incoming',
      },
    });
  }

  logResponse(
    method: string,
    endpoint: string,
    statusCode: number,
    responseTime: number,
    context: LogContext = {},
  ): void {
    const level =
      statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
    const message = `Response: ${method} ${endpoint} ${statusCode} ${responseTime}ms`;

    if (level === 'error') {
      this.error(message, {
        ...context,
        response: {
          method,
          endpoint,
          statusCode,
          responseTime,
          type: 'outgoing',
        },
      });
    } else if (level === 'warn') {
      this.warn(message, {
        ...context,
        response: {
          method,
          endpoint,
          statusCode,
          responseTime,
          type: 'outgoing',
        },
      });
    } else {
      this.info(message, {
        ...context,
        response: {
          method,
          endpoint,
          statusCode,
          responseTime,
          type: 'outgoing',
        },
      });
    }

    // Send HTTP metrics to CloudWatch
    this.addMetric({
      namespace: 'HTTP',
      metricName: 'ResponseTime',
      value: responseTime,
      unit: 'Milliseconds',
      dimensions: {
        Method: method,
        Endpoint: endpoint,
        StatusCode: statusCode.toString(),
        Environment: process.env.NODE_ENV || 'development',
      },
    });

    this.addMetric({
      namespace: 'HTTP',
      metricName: 'RequestCount',
      value: 1,
      unit: 'Count',
      dimensions: {
        Method: method,
        Endpoint: endpoint,
        StatusCode: statusCode.toString(),
        Environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  // ===== DATABASE LOGGING =====

  logDatabaseOperation(
    operation: string,
    collection: string,
    duration: number,
    success: boolean,
    context: LogContext = {},
  ): void {
    this.info(`Database ${operation} on ${collection}`, {
      ...context,
      operation,
      collection,
      duration,
      success,
      type: 'database',
    });

    // Send database metrics to CloudWatch
    this.addMetric({
      namespace: 'Database',
      metricName: 'OperationDuration',
      value: duration,
      unit: 'Milliseconds',
      dimensions: {
        Operation: operation,
        Collection: collection,
        Success: success.toString(),
        Environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  // ===== EXTERNAL API LOGGING =====

  logExternalAPI(
    provider: string,
    endpoint: string,
    duration: number,
    success: boolean,
    statusCode?: number,
    context: LogContext = {},
  ): void {
    this.info(`External API call to ${provider}`, {
      ...context,
      provider,
      endpoint,
      duration,
      success,
      statusCode,
      type: 'external-api',
    });

    // Send external API metrics to CloudWatch
    this.addMetric({
      namespace: 'ExternalAPI',
      metricName: 'ResponseTime',
      value: duration,
      unit: 'Milliseconds',
      dimensions: {
        Provider: provider,
        Endpoint: endpoint,
        Success: success.toString(),
        StatusCode: statusCode?.toString() || 'unknown',
        Environment: process.env.NODE_ENV || 'development',
      },
    });
  }

  // ===== CACHE LOGGING =====

  logCacheOperation(
    operation: 'hit' | 'miss' | 'set' | 'delete',
    key: string,
    duration?: number,
    context: LogContext = {},
  ): void {
    this.info(`Cache ${operation} for key: ${key}`, {
      ...context,
      operation,
      key,
      duration,
      type: 'cache',
    });

    // Send cache metrics to CloudWatch
    this.addMetric({
      namespace: 'Cache',
      metricName: 'OperationCount',
      value: 1,
      unit: 'Count',
      dimensions: {
        Operation: operation,
        Environment: process.env.NODE_ENV || 'development',
      },
    });

    if (duration !== undefined) {
      this.addMetric({
        namespace: 'Cache',
        metricName: 'OperationDuration',
        value: duration,
        unit: 'Milliseconds',
        dimensions: {
          Operation: operation,
          Environment: process.env.NODE_ENV || 'development',
        },
      });
    }
  }

  // ===== METRIC MANAGEMENT =====

  private addMetric(metric: MetricData): void {
    this.metricBuffer.push(metric);

    // Flush immediately if buffer is getting large
    if (this.metricBuffer.length >= 20) {
      this.flushMetrics();
    }
  }

  private async flushMetrics(): Promise<void> {
    if (this.metricBuffer.length === 0) return;

    const metricsToSend = [...this.metricBuffer];
    this.metricBuffer = [];

    try {
      // Group metrics by namespace
      const metricsByNamespace = this.groupMetricsByNamespace(metricsToSend);

      // Send metrics for each namespace
      for (const [namespace, metrics] of Object.entries(metricsByNamespace)) {
        const command = new PutMetricDataCommand({
          Namespace: `AI-Cost-Optimizer/${namespace}`,
          MetricData: metrics.map((metric) => ({
            MetricName: metric.metricName,
            Value: metric.value,
            Unit: (metric.unit || 'Count') as any,
            Dimensions: Object.entries(metric.dimensions || {}).map(
              ([Name, Value]) => ({ Name, Value }),
            ),
            Timestamp: metric.timestamp || new Date(),
          })),
        });

        await this.cloudWatchClient.send(command);
      }
    } catch (error) {
      this.logger.error('Failed to send metrics to CloudWatch:', error);
      // Re-add metrics to buffer for retry
      this.metricBuffer.unshift(...metricsToSend);
    }
  }

  private groupMetricsByNamespace(
    metrics: MetricData[],
  ): Record<string, MetricData[]> {
    return metrics.reduce(
      (acc, metric) => {
        if (!acc[metric.namespace]) {
          acc[metric.namespace] = [];
        }
        acc[metric.namespace].push(metric);
        return acc;
      },
      {} as Record<string, MetricData[]>,
    );
  }

  // ===== UTILITY METHODS =====

  setRequestContext(requestId: string, userId?: string): void {
    this.info('Setting request context', {
      requestId,
      userId,
      component: 'LoggingService',
      operation: 'setRequestContext',
    });
  }

  clearRequestContext(): void {
    // Context clearing is handled by request-scoped loggers
    this.debug('Request context cleared', {
      component: 'LoggingService',
      operation: 'clearRequestContext',
    });
  }

  // ===== SHUTDOWN =====

  private async shutdown(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flushMetrics();
  }
}

/**
 * Singleton instance for use outside Nest DI (e.g. config bootstrap).
 * Prefer injecting LoggingService inside Nest modules.
 */
export const loggingService = new LoggingService();
