/**
 * Cortex Streaming Logger Service (NestJS)
 *
 * Specialized logging service for streaming operations with performance metrics,
 * token-level tracking, and real-time monitoring capabilities.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CortexToken,
  CortexStreamingExecution,
} from './cortex-streaming-orchestrator.service';

export interface StreamingLogEntry {
  id: string;
  executionId: string;
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  data: any;
  tokenId?: string;
  performanceMetrics?: {
    latency: number;
    throughput: number;
    memoryUsage: number;
    cpuUsage: number;
  };
}

export interface StreamingMetrics {
  executionId: string;
  totalTokens: number;
  tokensPerSecond: number;
  averageLatency: number;
  errorRate: number;
  costPerToken: number;
  compressionRatio: number;
  phaseBreakdown: {
    encoding: { duration: number; tokens: number; cost: number };
    processing: { duration: number; tokens: number; cost: number };
    decoding: { duration: number; tokens: number; cost: number };
  };
}

@Injectable()
export class CortexStreamingLoggerService {
  private readonly logger = new Logger(CortexStreamingLoggerService.name);
  private logEntries = new Map<string, StreamingLogEntry[]>();
  private metrics = new Map<string, StreamingMetrics>();

  /**
   * Log streaming event
   */
  public logStreamingEvent(
    executionId: string,
    event: string,
    data: any,
    level: 'debug' | 'info' | 'warn' | 'error' = 'info',
    tokenId?: string,
    performanceMetrics?: StreamingLogEntry['performanceMetrics'],
  ): void {
    const logEntry: StreamingLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      executionId,
      timestamp: new Date(),
      level,
      event,
      data,
      tokenId,
      performanceMetrics,
    };

    if (!this.logEntries.has(executionId)) {
      this.logEntries.set(executionId, []);
    }
    this.logEntries.get(executionId)!.push(logEntry);

    // Log to NestJS logger with appropriate level
    const message = `[${executionId}] ${event}`;
    const context = { executionId, event, data, tokenId, performanceMetrics };

    switch (level) {
      case 'debug':
        this.logger.debug(message, context);
        break;
      case 'info':
        this.logger.log(message, context);
        break;
      case 'warn':
        this.logger.warn(message, context);
        break;
      case 'error':
        this.logger.error(message, context);
        break;
    }
  }

  /**
   * Log token event
   */
  public logTokenEvent(executionId: string, token: CortexToken): void {
    this.logStreamingEvent(
      executionId,
      `token.${token.type}`,
      {
        tokenId: token.id,
        contentLength: token.content.length,
        metadata: token.metadata,
      },
      'debug',
      token.id,
    );
  }

  /**
   * Update streaming metrics
   */
  public updateMetrics(execution: CortexStreamingExecution): void {
    const tokens = execution.tokens;
    const duration =
      execution.duration || Date.now() - execution.startTime.getTime();

    const metrics: StreamingMetrics = {
      executionId: execution.id,
      totalTokens: tokens.length,
      tokensPerSecond: duration > 0 ? tokens.length / (duration / 1000) : 0,
      averageLatency: this.calculateAverageLatency(tokens),
      errorRate: this.calculateErrorRate(execution),
      costPerToken: tokens.length > 0 ? execution.totalCost / tokens.length : 0,
      compressionRatio: this.calculateCompressionRatio(execution),
      phaseBreakdown: {
        encoding: {
          duration: 0,
          tokens: execution.encoderState?.outputTokens || 0,
          cost: execution.encoderState?.cost || 0,
        },
        processing: {
          duration: 0,
          tokens: execution.processorState?.outputTokens || 0,
          cost: execution.processorState?.cost || 0,
        },
        decoding: {
          duration: 0,
          tokens: execution.decoderState?.outputTokens || 0,
          cost: execution.decoderState?.cost || 0,
        },
      },
    };

    this.metrics.set(execution.id, metrics);

    this.logStreamingEvent(execution.id, 'metrics.updated', metrics, 'info');
  }

  /**
   * Get execution logs
   */
  public getExecutionLogs(
    executionId: string,
    limit?: number,
  ): StreamingLogEntry[] {
    const logs = this.logEntries.get(executionId) || [];
    return limit ? logs.slice(-limit) : logs;
  }

  /**
   * Get execution metrics
   */
  public getExecutionMetrics(executionId: string): StreamingMetrics | null {
    return this.metrics.get(executionId) || null;
  }

  /** Alias for controller: streaming analytics by user/date range; optional executionIds to filter. */
  public async getStreamingAnalytics(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    executionIds?: string[],
  ): Promise<{
    userId: string;
    startDate?: Date;
    endDate?: Date;
    totalExecutions: number;
    averageTokensPerSecond: number;
    averageLatency: number;
    averageErrorRate: number;
    totalCost: number;
  }> {
    const base = this.getAggregatedMetrics();
    const filteredExecutionIds =
      executionIds && executionIds.length > 0 ? new Set(executionIds) : null;
    let totalExecutions = base.totalExecutions;
    let totalCost = base.totalCost;
    let averageTokensPerSecond = base.averageTokensPerSecond;
    let averageLatency = base.averageLatency;
    let averageErrorRate = base.averageErrorRate;
    if (filteredExecutionIds) {
      const metricsList = Array.from(this.metrics.entries()).filter(([id]) =>
        filteredExecutionIds.has(id),
      );
      totalExecutions = metricsList.length;
      if (metricsList.length > 0) {
        totalCost = metricsList.reduce(
          (sum, [, m]) => sum + m.totalTokens * m.costPerToken,
          0,
        );
        averageTokensPerSecond =
          metricsList.reduce((s, [, m]) => s + m.tokensPerSecond, 0) /
          metricsList.length;
        averageLatency =
          metricsList.reduce((s, [, m]) => s + m.averageLatency, 0) /
          metricsList.length;
        averageErrorRate =
          metricsList.reduce((s, [, m]) => s + m.errorRate, 0) /
          metricsList.length;
      } else {
        totalCost = 0;
        averageTokensPerSecond = 0;
        averageLatency = 0;
        averageErrorRate = 0;
      }
    }
    return {
      userId,
      startDate,
      endDate,
      totalExecutions,
      averageTokensPerSecond,
      averageLatency,
      averageErrorRate,
      totalCost,
    };
  }

  public getStreamingHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0,
    executionIds?: string[],
  ): StreamingLogEntry[] {
    const filteredIds =
      executionIds && executionIds.length > 0 ? new Set(executionIds) : null;
    let allLogs: StreamingLogEntry[];
    if (filteredIds) {
      allLogs = [];
      for (const executionId of filteredIds) {
        const logs = this.logEntries.get(executionId) ?? [];
        allLogs.push(...logs.filter((log) => (log as any).userId === userId));
      }
      allLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } else {
      allLogs = Array.from(this.logEntries.values()).flat();
      allLogs = allLogs.filter((log) => (log as any).userId === userId);
      allLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
    return allLogs.slice(offset, offset + limit);
  }

  /**
   * Get aggregated metrics across all executions
   */
  public getAggregatedMetrics(): {
    totalExecutions: number;
    averageTokensPerSecond: number;
    averageLatency: number;
    averageErrorRate: number;
    totalCost: number;
  } {
    const allMetrics = Array.from(this.metrics.values());

    if (allMetrics.length === 0) {
      return {
        totalExecutions: 0,
        averageTokensPerSecond: 0,
        averageLatency: 0,
        averageErrorRate: 0,
        totalCost: 0,
      };
    }

    const totalCost = allMetrics.reduce(
      (sum, m) => sum + m.totalTokens * m.costPerToken,
      0,
    );

    return {
      totalExecutions: allMetrics.length,
      averageTokensPerSecond:
        allMetrics.reduce((sum, m) => sum + m.tokensPerSecond, 0) /
        allMetrics.length,
      averageLatency:
        allMetrics.reduce((sum, m) => sum + m.averageLatency, 0) /
        allMetrics.length,
      averageErrorRate:
        allMetrics.reduce((sum, m) => sum + m.errorRate, 0) / allMetrics.length,
      totalCost,
    };
  }

  /**
   * Clean up old logs and metrics
   */
  public cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoffTime = Date.now() - maxAge;
    const executionsToRemove: string[] = [];

    for (const [executionId, logs] of this.logEntries.entries()) {
      const latestLog = logs[logs.length - 1];
      if (latestLog.timestamp.getTime() < cutoffTime) {
        executionsToRemove.push(executionId);
      }
    }

    for (const executionId of executionsToRemove) {
      this.logEntries.delete(executionId);
      this.metrics.delete(executionId);
    }

    this.logger.log(
      `🧹 Cleaned up logs for ${executionsToRemove.length} old executions`,
    );
  }

  // Private helper methods

  private calculateAverageLatency(tokens: CortexToken[]): number {
    if (tokens.length === 0) return 0;

    const latencies = tokens
      .filter((token) => token.metadata?.latency)
      .map((token) => token.metadata!.latency!);

    return latencies.length > 0
      ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
      : 0;
  }

  private calculateErrorRate(execution: CortexStreamingExecution): number {
    const errorTokens = execution.tokens.filter(
      (token) => token.type === 'error',
    ).length;
    return execution.tokens.length > 0
      ? (errorTokens / execution.tokens.length) * 100
      : 0;
  }

  private calculateCompressionRatio(
    execution: CortexStreamingExecution,
  ): number {
    const inputLength = execution.inputText.length;
    const outputTokens = execution.tokens.filter(
      (t) => t.type === 'output',
    ).length;

    if (inputLength === 0 || outputTokens === 0) return 1;

    // Rough estimation: assume average 4 chars per token
    const estimatedOutputLength = outputTokens * 4;
    return inputLength / estimatedOutputLength;
  }
}
