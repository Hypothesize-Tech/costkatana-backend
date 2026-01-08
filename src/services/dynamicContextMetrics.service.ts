/**
 * Dynamic Context Discovery Metrics Service
 * Tracks token usage, cost savings, and performance improvements
 */

import { loggingService } from './logging.service';
import { toolRegistryService } from './toolRegistry.service';
import { contextFileManager } from './contextFileManager.service';

export interface ContextMetrics {
    timestamp: Date;
    requestId: string;
    userId: string;
    
    // Token metrics
    promptTokensWithStaticContext: number;
    promptTokensWithDynamicContext: number;
    tokenReduction: number;
    tokenReductionPercentage: number;
    
    // Cost metrics
    estimatedCostSavings: number;
    
    // Performance metrics
    toolsLoaded: number;
    toolsUsed: number;
    filesWritten: number;
    filesRead: number;
    
    // Context metrics
    largeResponsesHandled: number;
    historyExportsCreated: number;
    
    // Feature flags
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
    dateRange: {
        start: Date;
        end: Date;
    };
}

export class DynamicContextMetricsService {
    private static instance: DynamicContextMetricsService;
    private metrics: ContextMetrics[] = [];
    private readonly MAX_METRICS_IN_MEMORY = 1000;
    
    // Approximate token costs (per 1M tokens)
    private readonly TOKEN_COSTS = {
        input: 3.00, // $3 per 1M input tokens (average)
        output: 15.00 // $15 per 1M output tokens (average)
    };

    private constructor() {
        loggingService.info('Dynamic Context Metrics Service initialized');
    }

    static getInstance(): DynamicContextMetricsService {
        if (!DynamicContextMetricsService.instance) {
            DynamicContextMetricsService.instance = new DynamicContextMetricsService();
        }
        return DynamicContextMetricsService.instance;
    }

    /**
     * Record a new metrics data point
     */
    recordMetrics(metrics: ContextMetrics): void {
        this.metrics.push(metrics);
        
        // Log significant improvements
        if (metrics.tokenReductionPercentage > 30) {
            loggingService.info('Significant token reduction achieved', {
                requestId: metrics.requestId,
                tokenReduction: metrics.tokenReduction,
                reductionPercentage: metrics.tokenReductionPercentage,
                costSavings: metrics.estimatedCostSavings
            });
        }
        
        // Keep only recent metrics in memory
        if (this.metrics.length > this.MAX_METRICS_IN_MEMORY) {
            this.metrics = this.metrics.slice(-this.MAX_METRICS_IN_MEMORY);
        }
    }

    /**
     * Compare static vs dynamic context token usage
     */
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
        const tokenReduction = params.staticPromptLength - params.dynamicPromptLength;
        const tokenReductionPercentage = (tokenReduction / params.staticPromptLength) * 100;
        
        // Estimate cost savings (input tokens only for prompts)
        const estimatedCostSavings = (tokenReduction / 1_000_000) * this.TOKEN_COSTS.input;
        
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
            fileContextEnabled: contextFileManager.isEnabled(),
            minimalPromptsEnabled: process.env.COSTKATANA_ENABLE_FILE_CONTEXT !== 'false'
        };
        
        this.recordMetrics(metrics);
        return metrics;
    }

    /**
     * Get aggregated metrics for a time period
     */
    getAggregatedMetrics(startDate?: Date, endDate?: Date): AggregatedMetrics {
        const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default 7 days
        const end = endDate || new Date();
        
        const filteredMetrics = this.metrics.filter(
            m => m.timestamp >= start && m.timestamp <= end
        );
        
        if (filteredMetrics.length === 0) {
            return {
                totalRequests: 0,
                totalTokensReduced: 0,
                averageTokenReductionPercentage: 0,
                totalCostSavings: 0,
                totalFilesWritten: 0,
                totalFilesRead: 0,
                toolUsageStats: {},
                dateRange: { start, end }
            };
        }
        
        const totalTokensReduced = filteredMetrics.reduce((sum, m) => sum + m.tokenReduction, 0);
        const totalCostSavings = filteredMetrics.reduce((sum, m) => sum + m.estimatedCostSavings, 0);
        const averageTokenReductionPercentage = 
            filteredMetrics.reduce((sum, m) => sum + m.tokenReductionPercentage, 0) / filteredMetrics.length;
        
        const totalFilesWritten = filteredMetrics.reduce((sum, m) => sum + m.filesWritten, 0);
        const totalFilesRead = filteredMetrics.reduce((sum, m) => sum + m.filesRead, 0);
        
        return {
            totalRequests: filteredMetrics.length,
            totalTokensReduced,
            averageTokenReductionPercentage,
            totalCostSavings,
            totalFilesWritten,
            totalFilesRead,
            toolUsageStats: {},
            dateRange: { start, end }
        };
    }

    /**
     * Get real-time system statistics
     */
    async getSystemStatistics(): Promise<{
        toolRegistry: any;
        contextFiles: any;
        recentMetrics: ContextMetrics[];
    }> {
        const toolRegistryStats = await toolRegistryService.getStatistics();
        const contextFilesStats = await contextFileManager.getStatistics();
        const recentMetrics = this.metrics.slice(-10);
        
        return {
            toolRegistry: toolRegistryStats,
            contextFiles: contextFilesStats,
            recentMetrics
        };
    }

    /**
     * Generate performance report
     */
    generateReport(days: number = 7): string {
        const metrics = this.getAggregatedMetrics(
            new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        );
        
        const report = `
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
- At current rate: $${(metrics.totalCostSavings * 365 / days).toFixed(2)}/year
- Token reduction: ${((metrics.totalTokensReduced * 365) / days).toLocaleString()} tokens/year

🎯 EFFICIENCY METRICS:
- Cost per request saved: $${(metrics.totalCostSavings / Math.max(metrics.totalRequests, 1)).toFixed(6)}
- Tokens saved per request: ${Math.round(metrics.totalTokensReduced / Math.max(metrics.totalRequests, 1))}

===============================================
`;
        
        return report;
    }

    /**
     * Log metrics summary
     */
    logMetricsSummary(): void {
        const metrics = this.getAggregatedMetrics();
        
        loggingService.info('Dynamic Context Discovery Metrics Summary', {
            totalRequests: metrics.totalRequests,
            totalTokensReduced: metrics.totalTokensReduced,
            averageReduction: `${metrics.averageTokenReductionPercentage.toFixed(2)}%`,
            totalCostSavings: `$${metrics.totalCostSavings.toFixed(4)}`,
            filesWritten: metrics.totalFilesWritten,
            filesRead: metrics.totalFilesRead
        });
    }

    /**
     * Clear metrics
     */
    clearMetrics(): void {
        this.metrics = [];
        loggingService.info('Metrics cleared');
    }

    /**
     * Export metrics to JSON
     */
    exportMetrics(): string {
        return JSON.stringify({
            exported: new Date(),
            totalMetrics: this.metrics.length,
            metrics: this.metrics,
            aggregated: this.getAggregatedMetrics()
        }, null, 2);
    }
}

// Export singleton instance
export const dynamicContextMetrics = DynamicContextMetricsService.getInstance();
