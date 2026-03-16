/**
 * Dynamic Context Discovery Metrics Service (NestJS)
 * Tracks token usage, cost savings, and performance improvements for context strategies.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ContextMetrics {
  timestamp: Date;
  requestId: string;
  userId: string;
  promptTokensWithStaticContext: number;
  promptTokensWithDynamicContext: number;
  tokenReduction: number;
  tokenReductionPercentage: number;
  estimatedCostSavings: number;
  toolsLoaded: number;
  toolsUsed: number;
  filesWritten: number;
  filesRead: number;
  largeResponsesHandled: number;
  historyExportsCreated: number;
  fileContextEnabled: boolean;
  minimalPromptsEnabled: boolean;
}

export interface AggregatedMetrics {
  totalRequests: number;
  totalTokensReduced: number;
  averageTokenReductionPercentage: number;
  totalCostSavings: number;
  totalFilesWritten: number;
  totalFilesRead: number;
  toolUsageStats: Record<string, number>;
  dateRange: { start: Date; end: Date };
}

@Injectable()
export class DynamicContextMetricsService {
  private readonly logger = new Logger(DynamicContextMetricsService.name);
  private readonly metrics: ContextMetrics[] = [];
  private readonly MAX_METRICS_IN_MEMORY = 1000;
  private readonly TOKEN_COSTS = { input: 3.0, output: 15.0 };

  constructor(private readonly configService: ConfigService) {}

  recordMetrics(metrics: ContextMetrics): void {
    this.metrics.push(metrics);
    if (metrics.tokenReductionPercentage > 30) {
      this.logger.log('Significant token reduction achieved', {
        requestId: metrics.requestId,
        tokenReduction: metrics.tokenReduction,
        reductionPercentage: metrics.tokenReductionPercentage,
        costSavings: metrics.estimatedCostSavings,
      });
    }
    if (this.metrics.length > this.MAX_METRICS_IN_MEMORY) {
      this.metrics.splice(0, this.metrics.length - this.MAX_METRICS_IN_MEMORY);
    }
  }

  compareContextStrategies(params: {
    requestId: string;
    userId: string;
    staticPromptLength: number;
    dynamicPromptLength: number;
    toolsLoaded: number;
    toolsUsed: number;
    filesWritten: number;
    filesRead: number;
    largeResponsesHandled: number;
    historyExportsCreated: number;
  }): ContextMetrics {
    const tokenReduction =
      params.staticPromptLength - params.dynamicPromptLength;
    const tokenReductionPercentage =
      params.staticPromptLength > 0
        ? (tokenReduction / params.staticPromptLength) * 100
        : 0;
    const estimatedCostSavings =
      (tokenReduction / 1_000_000) * this.TOKEN_COSTS.input;

    const fileContextEnabled =
      this.configService.get<string>('COSTKATANA_ENABLE_FILE_CONTEXT') !==
      'false';

    const metrics: ContextMetrics = {
      timestamp: new Date(),
      requestId: params.requestId,
      userId: params.userId,
      promptTokensWithStaticContext: params.staticPromptLength,
      promptTokensWithDynamicContext: params.dynamicPromptLength,
      tokenReduction,
      tokenReductionPercentage,
      estimatedCostSavings,
      toolsLoaded: params.toolsLoaded,
      toolsUsed: params.toolsUsed,
      filesWritten: params.filesWritten,
      filesRead: params.filesRead,
      largeResponsesHandled: params.largeResponsesHandled,
      historyExportsCreated: params.historyExportsCreated,
      fileContextEnabled,
      minimalPromptsEnabled: fileContextEnabled,
    };

    this.recordMetrics(metrics);
    return metrics;
  }

  getAggregatedMetrics(startDate?: Date, endDate?: Date): AggregatedMetrics {
    const start = startDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ?? new Date();
    const filtered = this.metrics.filter(
      (m) => m.timestamp >= start && m.timestamp <= end,
    );

    if (filtered.length === 0) {
      return {
        totalRequests: 0,
        totalTokensReduced: 0,
        averageTokenReductionPercentage: 0,
        totalCostSavings: 0,
        totalFilesWritten: 0,
        totalFilesRead: 0,
        toolUsageStats: {},
        dateRange: { start, end },
      };
    }

    const totalTokensReduced = filtered.reduce(
      (s, m) => s + m.tokenReduction,
      0,
    );
    const totalCostSavings = filtered.reduce(
      (s, m) => s + m.estimatedCostSavings,
      0,
    );
    const averageTokenReductionPercentage =
      filtered.reduce((s, m) => s + m.tokenReductionPercentage, 0) /
      filtered.length;
    const totalFilesWritten = filtered.reduce((s, m) => s + m.filesWritten, 0);
    const totalFilesRead = filtered.reduce((s, m) => s + m.filesRead, 0);

    return {
      totalRequests: filtered.length,
      totalTokensReduced,
      averageTokenReductionPercentage,
      totalCostSavings,
      totalFilesWritten,
      totalFilesRead,
      toolUsageStats: {},
      dateRange: { start, end },
    };
  }

  async getSystemStatistics(): Promise<{
    toolRegistry: Record<string, unknown>;
    contextFiles: Record<string, unknown>;
    recentMetrics: ContextMetrics[];
  }> {
    const recentMetrics = this.metrics.slice(-10);
    return {
      toolRegistry: {},
      contextFiles: {},
      recentMetrics,
    };
  }

  generateReport(days: number = 7): string {
    const metrics = this.getAggregatedMetrics(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    );
    return `
=== Dynamic Context Discovery Performance Report ===
Period: Last ${days} days
Date Range: ${metrics.dateRange.start.toLocaleDateString()} - ${metrics.dateRange.end.toLocaleDateString()}

📊 OVERALL STATISTICS:
- Total Requests: ${metrics.totalRequests}
- Total Tokens Reduced: ${metrics.totalTokensReduced.toLocaleString()}
- Average Token Reduction: ${metrics.averageTokenReductionPercentage.toFixed(2)}%
- Total Cost Savings: $${metrics.totalCostSavings.toFixed(4)}

📁 FILE OPERATIONS:
- Files Written: ${metrics.totalFilesWritten}
- Files Read: ${metrics.totalFilesRead}

💡 PROJECTED ANNUAL SAVINGS:
- At current rate: $${((metrics.totalCostSavings * 365) / days).toFixed(2)}/year
- Token reduction: ${((metrics.totalTokensReduced * 365) / days).toLocaleString()} tokens/year

🎯 EFFICIENCY METRICS:
- Cost per request saved: $${(metrics.totalCostSavings / Math.max(metrics.totalRequests, 1)).toFixed(6)}
- Tokens saved per request: ${Math.round(metrics.totalTokensReduced / Math.max(metrics.totalRequests, 1))}

===============================================
`;
  }

  logMetricsSummary(): void {
    const metrics = this.getAggregatedMetrics();
    this.logger.log('Dynamic Context Discovery Metrics Summary', {
      totalRequests: metrics.totalRequests,
      totalTokensReduced: metrics.totalTokensReduced,
      averageReduction: `${metrics.averageTokenReductionPercentage.toFixed(2)}%`,
      totalCostSavings: `$${metrics.totalCostSavings.toFixed(4)}`,
      filesWritten: metrics.totalFilesWritten,
      filesRead: metrics.totalFilesRead,
    });
  }

  clearMetrics(): void {
    this.metrics.length = 0;
    this.logger.log('Metrics cleared');
  }

  exportMetrics(): string {
    return JSON.stringify(
      {
        exported: new Date(),
        totalMetrics: this.metrics.length,
        metrics: this.metrics,
        aggregated: this.getAggregatedMetrics(),
      },
      null,
      2,
    );
  }
}
