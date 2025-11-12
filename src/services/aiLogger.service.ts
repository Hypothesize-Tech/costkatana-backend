import { EventEmitter } from 'events';
import crypto from 'crypto';
import { AILog, IAILog } from '../models/AILog';
import { loggingService } from './logging.service';
import { CloudWatchService } from './cloudwatch.service';
import mongoose from 'mongoose';

/**
 * AILoggerService - Enterprise-grade AI operation logging
 * 
 * Features:
 * - Async non-blocking logging with event emitters
 * - Batch processing for efficiency
 * - Dual storage: MongoDB + CloudWatch metrics
 * - Automatic context enrichment
 * - Sensitive data redaction
 * - Correlation ID tracking for distributed tracing
 */

export interface AILogEntry {
    // Required fields
    userId: string | mongoose.Types.ObjectId;
    service: string;
    operation: string;
    aiModel: string;
    statusCode: number;
    responseTime: number;
    
    // Optional fields
    projectId?: string | mongoose.Types.ObjectId;
    requestId?: string;
    endpoint?: string;
    method?: string;
    modelVersion?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    prompt?: string;
    parameters?: Record<string, any>;
    success?: boolean;
    cost?: number;
    result?: string;
    errorMessage?: string;
    errorType?: string;
    errorStack?: string;
    errorCode?: string;
    ipAddress?: string;
    userAgent?: string;
    workflowId?: string;
    workflowName?: string;
    workflowStep?: string;
    experimentId?: string;
    experimentName?: string;
    notebookId?: string;
    sessionId?: string;
    cortexEnabled?: boolean;
    cortexOptimizationApplied?: boolean;
    cacheHit?: boolean;
    cacheKey?: string;
    retryAttempt?: number;
    ttfb?: number;
    streamingLatency?: number;
    queueTime?: number;
    costBreakdown?: {
        inputCost?: number;
        outputCost?: number;
        cacheCost?: number;
        additionalFees?: number;
    };
    tags?: string[];
    environment?: 'development' | 'staging' | 'production';
    region?: string;
    logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
    logSource?: string;
}

interface LogBuffer {
    logs: IAILog[];
    lastFlush: number;
}

export class AILoggerService {
    private static instance: AILoggerService;
    private eventEmitter: EventEmitter;
    private logBuffer: LogBuffer;
    private flushInterval: NodeJS.Timeout | null = null;
    private isShuttingDown: boolean = false;
    
    // Configuration
    private readonly BATCH_SIZE = 50;
    private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds
    private readonly MAX_PROMPT_LENGTH = 1000;
    private readonly MAX_RESULT_LENGTH = 1000;
    
    // Sensitive data patterns
    private readonly SENSITIVE_PATTERNS = [
        /api[_-]?key[_-]?:\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi,
        /token[_-]?:\s*['"]?([a-zA-Z0-9_.-]+)['"]?/gi,
        /password[_-]?:\s*['"]?([^'"]+)['"]?/gi,
        /secret[_-]?:\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi,
        /bearer\s+([a-zA-Z0-9_.-]+)/gi,
        /\b[A-Z0-9]{20,}\b/g // Long uppercase alphanumeric (likely keys)
    ];
    
    private constructor() {
        this.eventEmitter = new EventEmitter();
        this.eventEmitter.setMaxListeners(100); // Increase for high-throughput scenarios
        
        this.logBuffer = {
            logs: [],
            lastFlush: Date.now()
        };
        
        // Set up event listeners
        this.eventEmitter.on('log', this.handleLogEvent.bind(this));
        
        // Start periodic flush
        this.startPeriodicFlush();
        
        // Graceful shutdown handlers
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
        process.on('beforeExit', () => this.shutdown());
        
        loggingService.info('AILoggerService initialized', {
            component: 'AILoggerService',
            batchSize: this.BATCH_SIZE,
            flushInterval: this.FLUSH_INTERVAL_MS
        });
    }
    
    public static getInstance(): AILoggerService {
        if (!AILoggerService.instance) {
            AILoggerService.instance = new AILoggerService();
        }
        return AILoggerService.instance;
    }
    
    /**
     * Log an AI operation (async, non-blocking)
     */
    public async logAICall(entry: AILogEntry): Promise<void> {
        try {
            // Enrich entry with defaults and metadata
            const enrichedEntry = await this.enrichLogEntry(entry);
            
            // Emit event for async processing
            this.eventEmitter.emit('log', enrichedEntry);
        } catch (error) {
            // Never let logging errors crash the application
            loggingService.error('Failed to queue AI log', {
                component: 'AILoggerService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * Enrich log entry with metadata and context
     */
    private async enrichLogEntry(entry: AILogEntry): Promise<IAILog> {
        const timestamp = new Date();
        
        // Generate request ID if not provided
        const requestId = entry.requestId || this.generateRequestId();
        
        // Redact sensitive data from prompt and result
        const sanitizedPrompt = entry.prompt 
            ? this.redactSensitiveData(entry.prompt).substring(0, this.MAX_PROMPT_LENGTH)
            : undefined;
        
        const sanitizedResult = entry.result 
            ? this.redactSensitiveData(entry.result).substring(0, this.MAX_RESULT_LENGTH)
            : undefined;
        
        // Generate hashes for exact matching
        const promptHash = entry.prompt ? this.generateHash(entry.prompt) : undefined;
        const resultHash = entry.result ? this.generateHash(entry.result) : undefined;
        
        // Calculate tokens if not provided
        const inputTokens = entry.inputTokens ?? (entry.prompt ? Math.ceil(entry.prompt.length / 4) : 0);
        const outputTokens = entry.outputTokens ?? (entry.result ? Math.ceil(entry.result.length / 4) : 0);
        const totalTokens = entry.totalTokens ?? (inputTokens + outputTokens);
        
        // Determine success from status code if not provided
        const success = entry.success ?? (entry.statusCode < 400);
        
        // Calculate cost if not provided (rough estimation)
        const cost = entry.cost ?? this.estimateCost(entry.service, entry.aiModel, inputTokens, outputTokens);
        
        // Get caller context
        const logSource = entry.logSource || this.getCallerContext();
        
        // Sanitize error stack
        const sanitizedStack = entry.errorStack ? this.sanitizeStackTrace(entry.errorStack) : undefined;
        
        // Determine log level
        const logLevel = entry.logLevel || this.determineLogLevel(success, entry.statusCode);
        
        // Build the enriched log entry
        const logEntry = new AILog({
            userId: entry.userId,
            projectId: entry.projectId,
            requestId,
            timestamp,
            service: entry.service,
            operation: entry.operation,
            endpoint: entry.endpoint,
            method: entry.method,
            aiModel: entry.aiModel,
            modelVersion: entry.modelVersion,
            inputTokens,
            outputTokens,
            totalTokens,
            prompt: sanitizedPrompt,
            promptHash,
            parameters: entry.parameters,
            statusCode: entry.statusCode,
            success,
            responseTime: entry.responseTime,
            cost,
            result: sanitizedResult,
            resultHash,
            errorMessage: entry.errorMessage,
            errorType: entry.errorType,
            errorStack: sanitizedStack,
            errorCode: entry.errorCode,
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
            workflowId: entry.workflowId,
            workflowName: entry.workflowName,
            workflowStep: entry.workflowStep,
            experimentId: entry.experimentId,
            experimentName: entry.experimentName,
            notebookId: entry.notebookId,
            sessionId: entry.sessionId,
            cortexEnabled: entry.cortexEnabled ?? false,
            cortexOptimizationApplied: entry.cortexOptimizationApplied,
            cacheHit: entry.cacheHit ?? false,
            cacheKey: entry.cacheKey,
            retryAttempt: entry.retryAttempt ?? 0,
            ttfb: entry.ttfb,
            streamingLatency: entry.streamingLatency,
            queueTime: entry.queueTime,
            costBreakdown: entry.costBreakdown,
            tags: entry.tags,
            environment: entry.environment || (process.env.NODE_ENV as any) || 'development',
            region: entry.region || process.env.AWS_REGION,
            logLevel,
            logSource
        });
        
        return logEntry;
    }
    
    /**
     * Handle log event (called asynchronously)
     */
    private async handleLogEvent(logEntry: IAILog): Promise<void> {
        try {
            // Add to buffer
            this.logBuffer.logs.push(logEntry);
            
            // Flush if buffer is full
            if (this.logBuffer.logs.length >= this.BATCH_SIZE) {
                await this.flushLogs();
            }
        } catch (error) {
            loggingService.error('Failed to handle log event', {
                component: 'AILoggerService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * Flush buffered logs to storage
     */
    private async flushLogs(): Promise<void> {
        if (this.logBuffer.logs.length === 0) return;
        
        const logsToFlush = [...this.logBuffer.logs];
        this.logBuffer.logs = [];
        this.logBuffer.lastFlush = Date.now();
        
        try {
            // Write to MongoDB (bulk insert for efficiency)
            await AILog.insertMany(logsToFlush, { ordered: false });
            
            // Send metrics to CloudWatch in parallel
            await this.sendMetricsToCloudWatch(logsToFlush);
            
            loggingService.debug('Flushed AI logs', {
                component: 'AILoggerService',
                count: logsToFlush.length
            });
        } catch (error) {
            loggingService.error('Failed to flush AI logs', {
                component: 'AILoggerService',
                error: error instanceof Error ? error.message : String(error),
                logCount: logsToFlush.length
            });
            
            // Re-add logs to buffer for retry (but limit size to prevent memory issues)
            if (this.logBuffer.logs.length < this.BATCH_SIZE * 10) {
                this.logBuffer.logs.unshift(...logsToFlush);
            }
        }
    }
    
    /**
     * Send aggregated metrics to CloudWatch
     */
    private async sendMetricsToCloudWatch(logs: IAILog[]): Promise<void> {
        try {
            const metrics: any[] = [];
            
            for (const log of logs) {
                // AI Call Count
                metrics.push({
                    metricName: 'AICallCount',
                    value: 1,
                    unit: 'Count' as const,
                    dimensions: [
                        { name: 'Service', value: log.service },
                        { name: 'Model', value: log.model },
                        { name: 'Operation', value: log.operation },
                        { name: 'Environment', value: log.environment || 'development' }
                    ]
                });
                
                // Error tracking
                if (!log.success) {
                    metrics.push({
                        metricName: 'AIErrorCount',
                        value: 1,
                        unit: 'Count' as const,
                        dimensions: [
                            { name: 'Service', value: log.service },
                            { name: 'Model', value: log.model },
                            { name: 'ErrorType', value: log.errorType || 'unknown' },
                            { name: 'StatusCode', value: log.statusCode.toString() }
                        ]
                    });
                }
                
                // Latency tracking
                metrics.push({
                    metricName: 'AILatency',
                    value: log.responseTime,
                    unit: 'Milliseconds' as const,
                    dimensions: [
                        { name: 'Service', value: log.service },
                        { name: 'Model', value: log.model }
                    ]
                });
                
                // Token usage
                metrics.push({
                    metricName: 'AITokenUsage',
                    value: log.totalTokens,
                    unit: 'Count' as const,
                    dimensions: [
                        { name: 'Service', value: log.service },
                        { name: 'Model', value: log.model }
                    ]
                });
                
                // Cost tracking
                metrics.push({
                    metricName: 'AICost',
                    value: log.cost,
                    unit: 'None' as const,
                    dimensions: [
                        { name: 'Service', value: log.service },
                        { name: 'Model', value: log.model },
                        { name: 'ProjectId', value: log.projectId?.toString() || 'none' }
                    ]
                });
            }
            
            // Send to CloudWatch in batches (max 20 metrics per call)
            const CLOUDWATCH_BATCH_SIZE = 20;
            for (let i = 0; i < metrics.length; i += CLOUDWATCH_BATCH_SIZE) {
                const batch = metrics.slice(i, i + CLOUDWATCH_BATCH_SIZE);
                await CloudWatchService.sendMetrics({
                    namespace: 'CostKatana/AI-Operations',
                    metricData: batch
                });
            }
        } catch (error) {
            // Don't throw - CloudWatch failures shouldn't stop logging
            loggingService.warn('Failed to send AI metrics to CloudWatch', {
                component: 'AILoggerService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * Start periodic flush timer
     */
    private startPeriodicFlush(): void {
        this.flushInterval = setInterval(async () => {
            if (this.logBuffer.logs.length > 0) {
                await this.flushLogs();
            }
        }, this.FLUSH_INTERVAL_MS);
    }
    
    /**
     * Graceful shutdown
     */
    public async shutdown(): Promise<void> {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        
        loggingService.info('AILoggerService shutting down...', {
            component: 'AILoggerService',
            pendingLogs: this.logBuffer.logs.length
        });
        
        // Stop periodic flush
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        
        // Flush remaining logs
        await this.flushLogs();
        
        // Remove event listeners
        this.eventEmitter.removeAllListeners();
        
        loggingService.info('AILoggerService shut down complete', {
            component: 'AILoggerService'
        });
    }
    
    /**
     * Utility: Generate unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }
    
    /**
     * Utility: Generate SHA256 hash
     */
    private generateHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    
    /**
     * Utility: Redact sensitive data
     */
    private redactSensitiveData(text: string): string {
        let sanitized = text;
        
        for (const pattern of this.SENSITIVE_PATTERNS) {
            sanitized = sanitized.replace(pattern, (match) => {
                // Keep first 4 and last 4 characters, redact middle
                if (match.length > 12) {
                    return match.substring(0, 4) + '***REDACTED***' + match.substring(match.length - 4);
                }
                return '***REDACTED***';
            });
        }
        
        return sanitized;
    }
    
    /**
     * Utility: Sanitize stack trace (remove sensitive paths)
     */
    private sanitizeStackTrace(stack: string): string {
        return stack
            .replace(/\/Users\/[^\/]+/g, '/Users/***')
            .replace(/\/home\/[^\/]+/g, '/home/***')
            .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***')
            .split('\n')
            .slice(0, 10) // Limit to first 10 lines
            .join('\n');
    }
    
    /**
     * Utility: Get caller context from stack trace
     */
    private getCallerContext(): string {
        try {
            const stack = new Error().stack || '';
            const lines = stack.split('\n');
            // Find the first line that's not from this file
            for (const line of lines) {
                if (line.includes('.ts') && !line.includes('aiLogger.service')) {
                    const match = line.match(/at\s+(.+)\s+\(/);
                    if (match) {
                        return match[1].trim();
                    }
                }
            }
            return 'unknown';
        } catch {
            return 'unknown';
        }
    }
    
    /**
     * Utility: Determine log level based on success and status code
     */
    private determineLogLevel(success: boolean, statusCode: number): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL' {
        if (!success) {
            if (statusCode >= 500) return 'CRITICAL';
            if (statusCode >= 400) return 'ERROR';
            return 'WARN';
        }
        return 'INFO';
    }
    
    /**
     * Utility: Estimate cost (rough approximation when not provided)
     */
    private estimateCost(service: string, aiModel: string, inputTokens: number, outputTokens: number): number {
        // Service-specific default costs (per 1K tokens)
        const serviceDefaults: Record<string, { input: number; output: number }> = {
            'aws-bedrock': { input: 0.001, output: 0.002 },
            'openai': { input: 0.0015, output: 0.002 },
            'anthropic': { input: 0.008, output: 0.024 },
            'google-ai': { input: 0.00025, output: 0.0005 },
            'cohere': { input: 0.0015, output: 0.002 },
            'huggingface': { input: 0.0001, output: 0.0002 }
        };
        
        // Model-specific cost estimates (per 1K tokens)
        const modelCosts: Record<string, { input: number; output: number }> = {
            // Anthropic Claude
            'claude-3-opus': { input: 0.015, output: 0.075 },
            'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
            'claude-3-sonnet': { input: 0.003, output: 0.015 },
            'claude-3-haiku': { input: 0.00025, output: 0.00125 },
            
            // OpenAI GPT
            'gpt-4-turbo': { input: 0.01, output: 0.03 },
            'gpt-4': { input: 0.03, output: 0.06 },
            'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
            
            // AWS Nova
            'nova-pro': { input: 0.0008, output: 0.0032 },
            'nova-lite': { input: 0.00006, output: 0.00024 },
            'nova-micro': { input: 0.000035, output: 0.00014 },
            
            // Google Gemini
            'gemini-pro': { input: 0.00025, output: 0.0005 },
            'gemini-ultra': { input: 0.00125, output: 0.00375 },
            
            // Meta Llama
            'llama-3-70b': { input: 0.00099, output: 0.00099 },
            'llama-3-8b': { input: 0.00015, output: 0.00015 }
        };
        
        // Try to find model-specific pricing first
        const normalizedModel = aiModel.toLowerCase();
        for (const [key, value] of Object.entries(modelCosts)) {
            if (normalizedModel.includes(key)) {
                return ((inputTokens / 1000) * value.input) + ((outputTokens / 1000) * value.output);
            }
        }
        
        // Fall back to service-specific default pricing
        const normalizedService = service.toLowerCase();
        for (const [key, value] of Object.entries(serviceDefaults)) {
            if (normalizedService.includes(key)) {
                return ((inputTokens / 1000) * value.input) + ((outputTokens / 1000) * value.output);
            }
        }
        
        // Ultimate fallback
        const fallbackCost = { input: 0.001, output: 0.002 };
        return ((inputTokens / 1000) * fallbackCost.input) + ((outputTokens / 1000) * fallbackCost.output);
    }
    
    /**
     * Public: Get current buffer size (for monitoring)
     */
    public getBufferSize(): number {
        return this.logBuffer.logs.length;
    }
    
    /**
     * Public: Force flush (useful for testing)
     */
    public async forceFlush(): Promise<void> {
        await this.flushLogs();
    }
}

// Export singleton instance
export const aiLogger = AILoggerService.getInstance();

