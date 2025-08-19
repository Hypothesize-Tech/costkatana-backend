/**
 * Cost-Performance Index (CPI) Types
 * Core types for cross-provider cost normalization and intelligent routing
 */

export interface CPIMetrics {
    /** Normalized cost per 1M tokens (input + output) */
    normalizedCostPer1MTokens: number;
    /** Performance score (0-100) based on latency, throughput, reliability */
    performanceScore: number;
    /** Overall CPI score (0-100) - higher is better cost/performance ratio */
    cpiScore: number;
    /** Cost efficiency score (0-100) - lower cost = higher score */
    costEfficiencyScore: number;
    /** Quality score (0-100) - based on accuracy, consistency, capabilities */
    qualityScore: number;
    /** Reliability score (0-100) - based on uptime, error rates */
    reliabilityScore: number;
}

export interface ProviderPerformance {
    provider: string;
    modelId: string;
    modelName: string;
    /** Real-time performance metrics */
    metrics: {
        averageLatency: number; // milliseconds
        p95Latency: number; // milliseconds
        p99Latency: number; // milliseconds
        throughput: number; // requests per second
        successRate: number; // percentage
        errorRate: number; // percentage
        lastUpdated: Date;
    };
    /** Historical performance trends */
    trends: {
        latencyTrend: 'improving' | 'stable' | 'degrading';
        costTrend: 'decreasing' | 'stable' | 'increasing';
        reliabilityTrend: 'improving' | 'stable' | 'degrading';
    };
    /** Provider-specific capabilities and limitations */
    capabilities: {
        maxContextLength: number;
        supportsVision: boolean;
        supportsAudio: boolean;
        supportsFunctionCalling: boolean;
        supportsStreaming: boolean;
        rateLimits: {
            requestsPerMinute: number;
            tokensPerMinute: number;
        };
    };
}

export interface CPICalculationInput {
    promptTokens: number;
    completionTokens: number;
    modelId: string;
    provider: string;
    useCase: 'general' | 'creative' | 'analytical' | 'conversational' | 'code' | 'vision';
    qualityRequirement: 'low' | 'medium' | 'high' | 'ultra';
    latencyRequirement: 'relaxed' | 'normal' | 'strict' | 'real-time';
    budgetConstraint?: number; // maximum cost per request
    reliabilityRequirement: 'low' | 'medium' | 'high' | 'critical';
}

export interface CPIRoutingDecision {
    selectedProvider: string;
    selectedModel: string;
    reasoning: string[];
    alternatives: Array<{
        provider: string;
        model: string;
        cpiScore: number;
        estimatedCost: number;
        estimatedLatency: number;
    }>;
    confidence: number; // 0-1
    fallbackOptions: Array<{
        provider: string;
        model: string;
        trigger: 'cost' | 'performance' | 'reliability' | 'availability';
    }>;
}

export interface CPIOptimizationStrategy {
    strategy: 'cost_optimized' | 'performance_optimized' | 'balanced' | 'reliability_optimized';
    weightings: {
        cost: number; // 0-1
        performance: number; // 0-1
        quality: number; // 0-1
        reliability: number; // 0-1
    };
    constraints: {
        maxCost?: number;
        maxLatency?: number;
        minQuality?: number;
        minReliability?: number;
    };
}

export interface CPIBenchmarkResult {
    provider: string;
    modelId: string;
    benchmarkId: string;
    timestamp: Date;
    metrics: {
        costPer1MTokens: number;
        averageLatency: number;
        throughput: number;
        successRate: number;
        qualityScore: number;
        cpiScore: number;
    };
    testPrompts: Array<{
        prompt: string;
        expectedTokens: number;
        actualTokens: number;
        latency: number;
        success: boolean;
        error?: string;
    }>;
}

export interface CPIAnalytics {
    providerComparison: Array<{
        provider: string;
        averageCPI: number;
        costTrend: number; // percentage change
        performanceTrend: number; // percentage change
        marketShare: number; // percentage of total requests
        totalRequests: number;
        totalCost: number;
    }>;
    costSavings: {
        totalSaved: number;
        percentageSaved: number;
        savingsByProvider: Record<string, number>;
        savingsByModel: Record<string, number>;
    };
    performanceInsights: Array<{
        insight: string;
        impact: 'high' | 'medium' | 'low';
        recommendation: string;
        estimatedSavings?: number;
    }>;
}
