import { BasicLoggerService } from './basic-logger.service';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { addBreadcrumb, captureError } from '../config/sentry';
import * as Sentry from '@sentry/node';

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

export class LoggingService {
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
        BasicLoggerService.info(message, context);
        this.addSentryBreadcrumb(message, 'info', 'log', context);
    }

    error(message: string, context: LogContext = {}): void {
        BasicLoggerService.error(message, context);
        this.addSentryBreadcrumb(message, 'error', 'log', context);
    }

    warn(message: string, context: LogContext = {}): void {
        BasicLoggerService.warn(message, context);
        this.addSentryBreadcrumb(message, 'warning', 'log', context);
    }

    debug(message: string, context: LogContext = {}): void {
        BasicLoggerService.debug(message, context);
        this.addSentryBreadcrumb(message, 'debug', 'log', context);
    }

    verbose(message: string, context: LogContext = {}): void {
        BasicLoggerService.verbose(message, context);
    }

    // ===== SPECIALIZED LOGGING METHODS =====

    logError(error: Error, context: LogContext = {}): void {
        BasicLoggerService.logError(error, context);
    }

    logPerformance(metric: PerformanceMetric, context: LogContext = {}): void {
        BasicLoggerService.logPerformance(metric.operation, metric.duration, {
            ...context,
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
        BasicLoggerService.logSecurity(event.event, {
            ...context,
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
        BasicLoggerService.logBusiness(event.event, {
            ...context,
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
        BasicLoggerService.info(`Request: ${method} ${endpoint}`, {
            ...context,
            request: {
                method,
                endpoint,
                type: 'incoming'
            }
        });
    }

    logResponse(method: string, endpoint: string, statusCode: number, responseTime: number, context: LogContext = {}): void {
        const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
        const message = `Response: ${method} ${endpoint} ${statusCode} ${responseTime}ms`;
        
        if (level === 'error') {
            BasicLoggerService.error(message, {
                ...context,
                response: { method, endpoint, statusCode, responseTime, type: 'outgoing' }
            });
        } else if (level === 'warn') {
            BasicLoggerService.warn(message, {
                ...context,
                response: { method, endpoint, statusCode, responseTime, type: 'outgoing' }
            });
        } else {
            BasicLoggerService.info(message, {
                ...context,
                response: { method, endpoint, statusCode, responseTime, type: 'outgoing' }
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

    logDatabaseOperation(operation: string, collection: string, duration: number, success: boolean, context: LogContext = {}): void {
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

    logExternalAPI(provider: string, endpoint: string, duration: number, success: boolean, statusCode?: number, context: LogContext = {}): void {
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

    logCacheOperation(operation: 'hit' | 'miss' | 'set' | 'delete', key: string, duration?: number, context: LogContext = {}): void {
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
                    MetricData: metrics.map(metric => ({
                        MetricName: metric.metricName,
                        Value: metric.value,
                        Unit: (metric.unit || 'Count') as any,
                        Dimensions: Object.entries(metric.dimensions || {}).map(([Name, Value]) => ({ Name, Value })),
                        Timestamp: metric.timestamp || new Date(),
                    })),
                });

                await this.cloudWatchClient.send(command);
            }
        } catch (error) {
            console.error('Failed to send metrics to CloudWatch:', error);
            // Re-add metrics to buffer for retry
            this.metricBuffer.unshift(...metricsToSend);
        }
    }

    private groupMetricsByNamespace(metrics: MetricData[]): Record<string, MetricData[]> {
        return metrics.reduce((acc, metric) => {
            if (!acc[metric.namespace]) {
                acc[metric.namespace] = [];
            }
            acc[metric.namespace].push(metric);
            return acc;
        }, {} as Record<string, MetricData[]>);
    }

    // ===== UTILITY METHODS =====

    setRequestContext(requestId: string, userId?: string): void {
        BasicLoggerService.info('Setting request context', { 
            requestId, 
            userId,
            component: 'LoggingService',
            operation: 'setRequestContext'
        });
    }

    clearRequestContext(): void {
        // Context clearing is handled by request-scoped loggers
        BasicLoggerService.debug('Request context cleared', {
            component: 'LoggingService',
            operation: 'clearRequestContext'
        });
    }

    // ===== SENTRY INTEGRATION =====

    private addSentryBreadcrumb(
        message: string,
        level: Sentry.SeverityLevel,
        category: string,
        data?: LogContext
    ): void {
        try {
            // Only add breadcrumbs for significant log levels
            if (level === 'debug' && process.env.NODE_ENV === 'production') {
                return; // Skip debug logs in production
            }

            // Filter out health check and other noisy logs
            if (message.includes('health') || message.includes('Health')) {
                return;
            }

            // Prepare breadcrumb data
            const breadcrumbData: any = { ...data };

            // Remove sensitive information
            delete breadcrumbData.password;
            delete breadcrumbData.token;
            delete breadcrumbData.secret;
            delete breadcrumbData.apiKey;

            // Limit data size to prevent performance issues
            const dataString = JSON.stringify(breadcrumbData);
            if (dataString.length > 1000) {
                breadcrumbData._truncated = true;
                // Keep only essential fields
                const essentialFields = ['component', 'operation', 'userId', 'requestId', 'error'];
                const filteredData: any = {};
                essentialFields.forEach(field => {
                    if (breadcrumbData[field]) {
                        filteredData[field] = breadcrumbData[field];
                    }
                });
                breadcrumbData._filtered = filteredData;
            }

            // Add breadcrumb
            addBreadcrumb(message, category, level, breadcrumbData);

            // For error logs, also set context tags
            if (level === 'error' && data) {
                if (data.component) Sentry.setTag('log.component', data.component);
                if (data.operation) Sentry.setTag('log.operation', data.operation);
                if (data.userId) Sentry.setTag('log.user_id', data.userId);
            }

        } catch (error) {
        }
    }

    // ===== SHUTDOWN =====

    private async shutdown(): Promise<void> {
        clearInterval(this.flushInterval);
        await this.flushMetrics();
    }
}

// Create singleton instance
export const loggingService = new LoggingService();
