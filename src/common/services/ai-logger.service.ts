import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter } from 'events';
import { AILog } from '../../schemas/ai/ai-log.schema';
import { LoggingService } from './logging.service';
import { CloudWatchService } from '../../modules/aws/services/cloudwatch.service';
import { PricingRegistryService } from '../../modules/pricing/services/pricing-registry.service';

export interface AILogEntry {
  // Required fields
  userId: string;
  service: string;
  operation: string;
  aiModel: string;
  statusCode: number;
  responseTime: number;

  // Optional fields
  projectId?: string;
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
  traceId?: string;
  traceName?: string;
  traceStep?: string;
  traceSequence?: number;
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
  logs: Partial<AILog>[];
  lastFlush: number;
}

/**
 * AILoggerService - Enterprise-grade AI operation logging
 */
@Injectable()
export class AILoggerService implements OnModuleDestroy {
  private readonly logger = new Logger(AILoggerService.name);
  private eventEmitter: EventEmitter;
  private logBuffer: LogBuffer;
  private flushInterval: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  // Configuration
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private readonly MAX_PROMPT_LENGTH = 1000;
  private readonly MAX_RESULT_LENGTH = 1000;

  // Sensitive data patterns
  private readonly SENSITIVE_PATTERNS = [
    /api[_-]?key[_-]?:\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi,
    /token[_-]?:\s*['"]?([a-zA-Z0-9_.-]+)['"]?/gi,
    /password[_-]?:\s*['"]?([^\s'"]+)/gi,
    /secret[_-]?:\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi,
  ];

  constructor(
    @InjectModel(AILog.name) private aiLogModel: Model<AILog>,
    private readonly loggingService: LoggingService,
    private readonly cloudWatchService: CloudWatchService,
    private readonly pricingRegistryService: PricingRegistryService,
  ) {
    this.eventEmitter = new EventEmitter();
    this.logBuffer = { logs: [], lastFlush: Date.now() };

    this.startFlushInterval();
    this.setupEventHandlers();
  }

  /**
   * Log an AI call with comprehensive context
   */
  async logAICall(entry: AILogEntry): Promise<void> {
    try {
      // Enrich and sanitize the log entry
      const enrichedEntry = await this.enrichLogEntry(entry);
      const sanitizedEntry = this.sanitizeSensitiveData(enrichedEntry);

      // Add to buffer for batch processing
      this.logBuffer.logs.push(sanitizedEntry);

      // Emit event for real-time processing
      this.eventEmitter.emit('ai-call-logged', sanitizedEntry);

      // Flush if buffer is full
      if (this.logBuffer.logs.length >= this.BATCH_SIZE) {
        await this.flushLogs();
      }

      // Send metrics to CloudWatch
      await this.sendMetricsToCloudWatch(sanitizedEntry);
    } catch (error) {
      this.logger.error('Failed to log AI call', {
        error: error instanceof Error ? error.message : String(error),
        userId: entry.userId,
        service: entry.service,
        operation: entry.operation,
      });

      // Don't let logging failures affect the main flow
      // Just emit error event
      this.eventEmitter.emit('ai-log-error', error);
    }
  }

  /**
   * Query AI logs with filtering and pagination
   */
  async queryLogs(filters: {
    userId?: string;
    projectId?: string;
    service?: string;
    operation?: string;
    aiModel?: string;
    success?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AILog[]; total: number }> {
    try {
      const query: any = {};

      if (filters.userId) query.userId = filters.userId;
      if (filters.projectId) query.projectId = filters.projectId;
      if (filters.service) query.service = filters.service;
      if (filters.operation) query.operation = filters.operation;
      if (filters.aiModel) query.aiModel = filters.aiModel;
      if (filters.success !== undefined) query.success = filters.success;

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = filters.startDate;
        if (filters.endDate) query.createdAt.$lte = filters.endDate;
      }

      const total = await this.aiLogModel.countDocuments(query).exec();
      const logs = await this.aiLogModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(filters.limit || 100)
        .skip(filters.offset || 0)
        .exec();

      return { logs, total };
    } catch (error) {
      this.logger.error('Failed to query AI logs', {
        error: error instanceof Error ? error.message : String(error),
        filters,
      });
      return { logs: [], total: 0 };
    }
  }

  /**
   * Get AI usage statistics
   */
  async getUsageStats(filters: {
    userId?: string;
    projectId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    averageResponseTime: number;
    totalTokens: number;
    totalCost: number;
    topModels: Array<{ model: string; count: number }>;
    topServices: Array<{ service: string; count: number }>;
  }> {
    try {
      const matchStage: any = {};

      if (filters.userId) matchStage.userId = filters.userId;
      if (filters.projectId) matchStage.projectId = filters.projectId;

      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
      }

      const stats = await this.aiLogModel
        .aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              totalCalls: { $sum: 1 },
              successfulCalls: {
                $sum: { $cond: [{ $eq: ['$success', true] }, 1, 0] },
              },
              failedCalls: {
                $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] },
              },
              averageResponseTime: { $avg: '$responseTime' },
              totalInputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
              totalOutputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
              totalCost: { $sum: { $ifNull: ['$cost', 0] } },
            },
          },
          {
            $project: {
              totalCalls: 1,
              successfulCalls: 1,
              failedCalls: 1,
              averageResponseTime: { $round: ['$averageResponseTime', 2] },
              totalTokens: {
                $add: ['$totalInputTokens', '$totalOutputTokens'],
              },
              totalCost: { $round: ['$totalCost', 4] },
            },
          },
        ])
        .exec();

      // Get top models and services
      const [modelStats, serviceStats] = await Promise.all([
        this.aiLogModel
          .aggregate([
            { $match: matchStage },
            { $group: { _id: '$aiModel', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ])
          .exec(),
        this.aiLogModel
          .aggregate([
            { $match: matchStage },
            { $group: { _id: '$service', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ])
          .exec(),
      ]);

      const result = stats[0] || {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageResponseTime: 0,
        totalTokens: 0,
        totalCost: 0,
      };

      return {
        ...result,
        topModels: modelStats.map((item) => ({
          model: item._id,
          count: item.count,
        })),
        topServices: serviceStats.map((item) => ({
          service: item._id,
          count: item.count,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get AI usage stats', {
        error: error instanceof Error ? error.message : String(error),
        filters,
      });
      return {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageResponseTime: 0,
        totalTokens: 0,
        totalCost: 0,
        topModels: [],
        topServices: [],
      };
    }
  }

  /**
   * Enrich log entry with additional context
   */
  private async enrichLogEntry(entry: AILogEntry): Promise<Partial<AILog>> {
    const VALID_ERROR_TYPES = [
      'client_error',
      'server_error',
      'network_error',
      'auth_error',
      'rate_limit',
      'timeout',
      'validation_error',
      'throttling',
      'quota_exceeded',
    ] as const;
    const {
      projectId: entryProjectId,
      errorType: entryErrorType,
      costBreakdown: entryCostBreakdown,
      ...rest
    } = entry;
    const errorType =
      entryErrorType &&
      VALID_ERROR_TYPES.includes(
        entryErrorType as (typeof VALID_ERROR_TYPES)[number],
      )
        ? (entryErrorType as (typeof VALID_ERROR_TYPES)[number])
        : undefined;
    const enriched: Partial<AILog> = {
      ...rest,
      userId: new Types.ObjectId(entry.userId) as unknown as AILog['userId'],
      projectId: entryProjectId
        ? (new Types.ObjectId(entryProjectId) as unknown as AILog['projectId'])
        : undefined,
      errorType,
      totalTokens: (entry.inputTokens || 0) + (entry.outputTokens || 0),
      environment:
        entry.environment || (process.env.NODE_ENV as any) || 'production',
      region: entry.region || process.env.AWS_REGION || 'us-east-1',
      createdAt: new Date(),
    };
    if (
      entryCostBreakdown &&
      typeof entryCostBreakdown.inputCost === 'number' &&
      typeof entryCostBreakdown.outputCost === 'number'
    ) {
      enriched.costBreakdown = {
        inputCost: entryCostBreakdown.inputCost,
        outputCost: entryCostBreakdown.outputCost,
        cacheCost: entryCostBreakdown.cacheCost,
        additionalFees: entryCostBreakdown.additionalFees,
      };
    }

    // Truncate long fields
    if (entry.prompt && entry.prompt.length > this.MAX_PROMPT_LENGTH) {
      enriched.prompt =
        entry.prompt.substring(0, this.MAX_PROMPT_LENGTH) + '...';
    }

    if (entry.result && entry.result.length > this.MAX_RESULT_LENGTH) {
      enriched.result =
        entry.result.substring(0, this.MAX_RESULT_LENGTH) + '...';
    }

    // Calculate cost if not provided and we have pricing info
    if (!entry.cost && entry.inputTokens && entry.outputTokens) {
      try {
        const pricing = this.pricingRegistryService.getPricing(
          entry.aiModel ?? '',
        );
        if (pricing) {
          const inputCost = (entry.inputTokens / 1000) * pricing.inputPricePerK;
          const outputCost =
            (entry.outputTokens / 1000) * pricing.outputPricePerK;
          enriched.cost = inputCost + outputCost;
          enriched.costBreakdown = { inputCost, outputCost };
        }
      } catch (error) {
        // Cost calculation failed, continue without it
      }
    }

    return enriched;
  }

  /**
   * Sanitize sensitive data from log entry
   */
  private sanitizeSensitiveData(entry: Partial<AILog>): Partial<AILog> {
    const sanitized = { ...entry };

    // Sanitize prompt
    if (sanitized.prompt) {
      sanitized.prompt = this.redactSensitiveData(sanitized.prompt);
    }

    // Sanitize result
    if (sanitized.result) {
      sanitized.result = this.redactSensitiveData(sanitized.result);
    }

    // Sanitize parameters
    if (sanitized.parameters) {
      sanitized.parameters = this.sanitizeObject(sanitized.parameters);
    }

    return sanitized;
  }

  /**
   * Redact sensitive data from text
   */
  private redactSensitiveData(text: string): string {
    let redacted = text;

    for (const pattern of this.SENSITIVE_PATTERNS) {
      redacted = redacted.replace(pattern, (match, sensitiveValue) => {
        return match.replace(sensitiveValue, '***REDACTED***');
      });
    }

    return redacted;
  }

  /**
   * Recursively sanitize object values
   */
  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        return this.redactSensitiveData(obj);
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = this.sanitizeObject(value);
    }

    return sanitized;
  }

  /**
   * Send metrics to CloudWatch
   */
  private async sendMetricsToCloudWatch(entry: Partial<AILog>): Promise<void> {
    try {
      await this.cloudWatchService.putMetricData('AI/Calls', [
        {
          MetricName: 'ResponseTime',
          Value: entry.responseTime || 0,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Service', Value: entry.service || 'unknown' },
            { Name: 'Model', Value: entry.aiModel || 'unknown' },
            { Name: 'Success', Value: entry.success ? 'true' : 'false' },
          ],
        },
        {
          MetricName: 'TokenUsage',
          Value: entry.totalTokens || 0,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Service', Value: entry.service || 'unknown' },
            { Name: 'Model', Value: entry.aiModel || 'unknown' },
            { Name: 'Type', Value: 'Total' },
          ],
        },
        {
          MetricName: 'Cost',
          Value: entry.cost || 0,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Service', Value: entry.service || 'unknown' },
            { Name: 'Model', Value: entry.aiModel || 'unknown' },
          ],
        },
      ]);
    } catch (error) {
      // Don't fail the main logging flow for metrics
      this.logger.debug('Failed to send metrics to CloudWatch', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Flush buffered logs to database
   */
  private async flushLogs(): Promise<void> {
    if (this.logBuffer.logs.length === 0) return;

    const logsToFlush = [...this.logBuffer.logs];
    this.logBuffer.logs = [];
    this.logBuffer.lastFlush = Date.now();

    try {
      await this.aiLogModel.insertMany(logsToFlush);
      this.logger.debug(`Flushed ${logsToFlush.length} AI logs to database`);
    } catch (error) {
      this.logger.error('Failed to flush AI logs to database', {
        error: error instanceof Error ? error.message : String(error),
        logCount: logsToFlush.length,
      });

      // Re-add logs to buffer for retry
      this.logBuffer.logs.unshift(...logsToFlush);
    }
  }

  /**
   * Start periodic flush interval
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(async () => {
      if (!this.isShuttingDown) {
        await this.flushLogs();
      }
    }, this.FLUSH_INTERVAL_MS);
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.eventEmitter.on('ai-call-logged', (entry: Partial<AILog>) => {
      // Handle real-time processing if needed
      this.logger.debug('AI call logged', {
        userId: entry.userId,
        service: entry.service,
        operation: entry.operation,
        responseTime: entry.responseTime,
      });
    });

    this.eventEmitter.on('ai-log-error', (error: any) => {
      this.logger.error('AI logging error occurred', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    await this.flushLogs();

    this.eventEmitter.removeAllListeners();
  }
}
