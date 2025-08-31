// Simple logger to avoid circular dependencies
const simpleLogger = {
    info: (message: string, context: any = {}) => console.log(`[INFO] ${message}`, context),
    error: (message: string, context: any = {}) => console.error(`[ERROR] ${message}`, context),
    warn: (message: string, context: any = {}) => console.warn(`[WARN] ${message}`, context),
    debug: (message: string, context: any = {}) => console.log(`[DEBUG] ${message}`, context),
    verbose: (message: string, context: any = {}) => console.log(`[VERBOSE] ${message}`, context),
    logError: (error: Error, context: any = {}) => console.error(`[ERROR] ${error.message}`, { ...context, stack: error.stack }),
    logPerformance: (operation: string, duration: number, context: any = {}) => console.log(`[PERF] ${operation} took ${duration}ms`, context),
    logSecurity: (event: string, context: any = {}) => console.warn(`[SECURITY] ${event}`, context),
    logBusiness: (event: string, context: any = {}) => console.log(`[BUSINESS] ${event}`, context),
    logRequest: (method: string, endpoint: string, context: any = {}) => console.log(`[REQUEST] ${method} ${endpoint}`, context),
    logResponse: (method: string, endpoint: string, statusCode: number, responseTime: number, context: any = {}) => console.log(`[RESPONSE] ${method} ${endpoint} ${statusCode} ${responseTime}ms`, context),
    setRequestContext: (requestId: string, userId?: string) => {
        console.log(`[CONTEXT] Setting request context`, { requestId, userId });
    },
    clearRequestContext: () => {}
};
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

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
        simpleLogger.info(message, context);
    }

    error(message: string, context: LogContext = {}): void {
        simpleLogger.error(message, context);
    }

    warn(message: string, context: LogContext = {}): void {
        simpleLogger.warn(message, context);
    }

    debug(message: string, context: LogContext = {}): void {
        simpleLogger.debug(message, context);
    }

    verbose(message: string, context: LogContext = {}): void {
        simpleLogger.verbose(message, context);
    }

    // ===== SPECIALIZED LOGGING METHODS =====

    logError(error: Error, context: LogContext = {}): void {
        simpleLogger.logError(error, context);
    }

    logPerformance(metric: PerformanceMetric, context: LogContext = {}): void {
        simpleLogger.logPerformance(metric.operation, metric.duration, {
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
        simpleLogger.logSecurity(event.event, {
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
        simpleLogger.logBusiness(event.event, {
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
        simpleLogger.logRequest(method, endpoint, context);
    }

    logResponse(method: string, endpoint: string, statusCode: number, responseTime: number, context: LogContext = {}): void {
        simpleLogger.logResponse(method, endpoint, statusCode, responseTime, context);

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
        simpleLogger.setRequestContext(requestId, userId);
    }

    clearRequestContext(): void {
        simpleLogger.clearRequestContext();
    }

    // ===== SHUTDOWN =====

    private async shutdown(): Promise<void> {
        clearInterval(this.flushInterval);
        await this.flushMetrics();
    }
}

// Create singleton instance
export const loggingService = new LoggingService();
