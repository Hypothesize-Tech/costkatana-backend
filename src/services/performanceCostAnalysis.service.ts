import { Usage, IUsage } from '../models/Usage';
import { QualityScore } from '../models/QualityScore';
import { logger } from '../utils/logger';

export interface PerformanceMetrics {
    latency: number; // in milliseconds
    errorRate: number; // percentage
    qualityScore: number; // 0-1 scale
    throughput: number; // requests per second
    successRate: number; // percentage
    retryRate: number; // percentage
}

export interface CostPerformanceCorrelation {
    service: string;
    model: string;
    costPerRequest: number;
    costPerToken: number;
    performance: PerformanceMetrics;
    efficiency: {
        costEfficiencyScore: number; // 0-1 scale
        performanceRating: 'excellent' | 'good' | 'fair' | 'poor';
        recommendation: string;
        optimizationPotential: number; // percentage
    };
    tradeoffs: {
        costVsLatency: number;
        costVsQuality: number;
        costVsReliability: number;
    };
}

export interface ServiceComparison {
    services: CostPerformanceCorrelation[];
    bestValue: {
        service: string;
        model: string;
        reason: string;
        costSavings: number;
        performanceImpact: number;
    };
    recommendations: Array<{
        type: 'switch_service' | 'optimize_usage' | 'adjust_parameters';
        priority: 'high' | 'medium' | 'low';
        description: string;
        expectedSavings: number;
        implementationEffort: 'easy' | 'moderate' | 'complex';
        riskLevel: 'low' | 'medium' | 'high';
    }>;
}

export interface PerformanceTrend {
    period: string;
    metrics: PerformanceMetrics & {
        cost: number;
        volume: number;
    };
    trend: 'improving' | 'degrading' | 'stable';
    alerts: Array<{
        type: 'performance_degradation' | 'cost_spike' | 'error_increase';
        severity: 'low' | 'medium' | 'high';
        message: string;
        suggestedActions: string[];
    }>;
}

export interface OptimizationOpportunity {
    id: string;
    type: 'model_switch' | 'parameter_tuning' | 'request_optimization' | 'caching';
    title: string;
    description: string;
    currentCost: number;
    projectedCost: number;
    savings: number;
    savingsPercentage: number;
    performanceImpact: {
        latency: number;
        quality: number;
        reliability: number;
    };
    implementationComplexity: 'low' | 'medium' | 'high';
    riskAssessment: {
        level: 'low' | 'medium' | 'high';
        factors: string[];
        mitigation: string[];
    };
    timeline: string;
    priority: number;
}

export class PerformanceCostAnalysisService {

    /**
     * Analyze cost-performance correlation for a user's usage
     */
    static async analyzeCostPerformanceCorrelation(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            services?: string[];
            models?: string[];
            tags?: string[];
        } = {}
    ): Promise<CostPerformanceCorrelation[]> {
        try {
            const {
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate = new Date(),
                services,
                models,
                tags
            } = options;

            const matchStage: any = {
                userId,
                createdAt: { $gte: startDate, $lte: endDate }
            };

            if (services && services.length > 0) {
                matchStage.service = { $in: services };
            }

            if (models && models.length > 0) {
                matchStage.model = { $in: models };
            }

            if (tags && tags.length > 0) {
                matchStage.tags = { $in: tags };
            }

            // Use aggregation pipeline for better performance
            const correlationData = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            service: "$service",
                            model: "$model"
                        },
                        totalCost: { $sum: "$cost" },
                        totalRequests: { $sum: 1 },
                        totalTokens: { $sum: "$totalTokens" },
                        avgResponseTime: { 
                            $avg: { 
                                $ifNull: ["$metadata.responseTime", 1000] 
                            } 
                        },
                        errorCount: {
                            $sum: {
                                $cond: [
                                    { $ifNull: ["$metadata.error", false] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        service: "$_id.service",
                        model: "$_id.model",
                        totalCost: 1,
                        totalRequests: 1,
                        totalTokens: 1,
                        costPerRequest: { $divide: ["$totalCost", "$totalRequests"] },
                        costPerToken: { 
                            $divide: [
                                "$totalCost", 
                                { $cond: [{ $gt: ["$totalTokens", 0] }, "$totalTokens", 1] }
                            ] 
                        },
                        avgLatency: "$avgResponseTime",
                        errorRate: { 
                            $multiply: [
                                { $divide: ["$errorCount", "$totalRequests"] }, 
                                100
                            ] 
                        }
                    }
                },
                { $sort: { totalCost: -1 } },
                { $limit: 20 } // Limit to prevent excessive data
            ]);

            // Calculate correlations in parallel with simplified metrics
            const correlations: CostPerformanceCorrelation[] = correlationData.map((data) => {
                // Calculate performance metrics
                const performance: PerformanceMetrics = {
                    latency: data.avgLatency,
                    errorRate: data.errorRate,
                    qualityScore: this.calculateQualityScore(data.avgLatency, data.errorRate),
                    throughput: data.totalRequests / 24, // requests per hour
                    successRate: 100 - data.errorRate,
                    retryRate: 0 // Default for performance
                };

                // Calculate efficiency metrics
                const costEfficiencyScore = this.calculateCostEfficiencyScore(
                    data.costPerRequest,
                    performance
                );

                const performanceRating = this.getPerformanceRating(performance);
                const recommendation = this.generateRecommendation(data.service, data.model, performance, costEfficiencyScore);
                const optimizationPotential = this.calculateOptimizationPotential(performance, costEfficiencyScore);

                return {
                    service: data.service,
                    model: data.model,
                    costPerRequest: data.costPerRequest,
                    costPerToken: data.costPerToken,
                    performance,
                    efficiency: {
                        costEfficiencyScore,
                        performanceRating,
                        recommendation,
                        optimizationPotential
                    },
                    tradeoffs: {
                        costVsLatency: this.calculateTradeoff(data.costPerRequest, performance.latency),
                        costVsQuality: this.calculateTradeoff(data.costPerRequest, performance.qualityScore),
                        costVsReliability: this.calculateTradeoff(data.costPerRequest, performance.successRate)
                    }
                };
            });

            return correlations;
        } catch (error) {
            logger.error('Error analyzing cost-performance correlation:', error);
            throw error;
        }
    }

    /**
     * Compare services and models for cost-performance trade-offs
     */
    static async compareServices(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            useCase?: string;
            tags?: string[];
        } = {}
    ): Promise<ServiceComparison> {
        try {
            const correlations = await this.analyzeCostPerformanceCorrelation(userId, options);

            // Find best value option
            const bestValue = this.findBestValue(correlations);

            // Generate recommendations
            const recommendations = this.generateRecommendations(correlations);

            return {
                services: correlations,
                bestValue,
                recommendations
            };
        } catch (error) {
            logger.error('Error comparing services:', error);
            throw error;
        }
    }

    /**
     * Get performance trends over time
     */
    static async getPerformanceTrends(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            service?: string;
            model?: string;
            granularity?: 'hour' | 'day' | 'week';
        } = {}
    ): Promise<PerformanceTrend[]> {
        try {
            const {
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate = new Date(),
                service,
                model,
                granularity = 'day'
            } = options;

            // Get usage data
            const usageData = await this.getUsageWithMetrics(userId, startDate, endDate,
                service ? [service] : undefined, model ? [model] : undefined);

            // Group by time period
            const timeGroups = this.groupByTimePeriod(usageData, granularity);

            // Calculate trends
            const trends: PerformanceTrend[] = [];

            for (const [period, usages] of timeGroups.entries()) {
                const metrics = this.calculateAggregatedMetrics(usages);
                const trend = this.calculateTrend(period, metrics, trends);
                const alerts = this.generatePerformanceAlerts(metrics, trend);

                trends.push({
                    period,
                    metrics,
                    trend,
                    alerts
                });
            }

            return trends.sort((a, b) => a.period.localeCompare(b.period));
        } catch (error) {
            logger.error('Error getting performance trends:', error);
            throw error;
        }
    }

    /**
     * Identify optimization opportunities
     */
    static async identifyOptimizationOpportunities(
        userId: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            minSavings?: number;
            tags?: string[];
        } = {}
    ): Promise<OptimizationOpportunity[]> {
        try {
            const {
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate = new Date(),
                minSavings = 50,
                tags
            } = options;

            const opportunities: OptimizationOpportunity[] = [];

            // Get usage analysis
            const correlations = await this.analyzeCostPerformanceCorrelation(userId, {
                startDate,
                endDate,
                tags
            });

            // Model switching opportunities
            const modelSwitchOpportunities = this.identifyModelSwitchOpportunities(correlations);
            opportunities.push(...modelSwitchOpportunities);

            // Parameter tuning opportunities
            const parameterOpportunities = this.identifyParameterTuningOpportunities(correlations);
            opportunities.push(...parameterOpportunities);

            // Request optimization opportunities
            const requestOpportunities = this.identifyRequestOptimizationOpportunities(correlations);
            opportunities.push(...requestOpportunities);

            // Caching opportunities
            const cachingOpportunities = this.identifyCachingOpportunities(correlations);
            opportunities.push(...cachingOpportunities);

            // Filter by minimum savings and sort by priority
            return opportunities
                .filter(opp => opp.savings >= minSavings)
                .sort((a, b) => b.priority - a.priority);
        } catch (error) {
            logger.error('Error identifying optimization opportunities:', error);
            throw error;
        }
    }

    /**
     * Get detailed performance metrics for a specific service/model
     */
    static async getDetailedMetrics(
        userId: string,
        service: string,
        model: string,
        options: {
            startDate?: Date;
            endDate?: Date;
            tags?: string[];
        } = {}
    ): Promise<{
        summary: PerformanceMetrics & { cost: number; volume: number };
        timeSeries: Array<{
            timestamp: Date;
            cost: number;
            latency: number;
            errorRate: number;
            qualityScore: number;
        }>;
        percentiles: {
            latency: { p50: number; p95: number; p99: number };
            cost: { p50: number; p95: number; p99: number };
        };
        anomalies: Array<{
            timestamp: Date;
            type: 'cost_spike' | 'latency_spike' | 'error_spike' | 'quality_drop';
            severity: 'low' | 'medium' | 'high';
            value: number;
            expected: number;
            deviation: number;
        }>;
    }> {
        try {
            const {
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate = new Date(),
                tags
            } = options;

            const usageData = await this.getUsageWithMetrics(userId, startDate, endDate, [service], [model], tags);

            // Calculate summary metrics
            const summary = this.calculateAggregatedMetrics(usageData);

            // Generate time series
            const timeSeries = this.generateTimeSeries(usageData);

            // Calculate percentiles
            const percentiles = this.calculatePercentiles(usageData);

            // Detect anomalies
            const anomalies = this.detectPerformanceAnomalies(usageData);

            return {
                summary,
                timeSeries,
                percentiles,
                anomalies
            };
        } catch (error) {
            logger.error('Error getting detailed metrics:', error);
            throw error;
        }
    }

    /**
     * Private helper methods
     */
    private static async getUsageWithMetrics(
        userId: string,
        startDate: Date,
        endDate: Date,
        services?: string[],
        models?: string[],
        tags?: string[]
    ): Promise<Array<IUsage & {
        latency?: number;
        errorRate?: number;
        qualityScore?: number;
        retryCount?: number;
        successRate?: number;
    }>> {
        const query: any = {
            userId,
            createdAt: { $gte: startDate, $lte: endDate }
        };

        if (services && services.length > 0) {
            query.service = { $in: services };
        }

        if (models && models.length > 0) {
            query.model = { $in: models };
        }

        if (tags && tags.length > 0) {
            query.tags = { $in: tags };
        }

        const usageData = await Usage.find(query).lean();

        // Enhance with performance metrics
        const enhancedData = await Promise.all(
            usageData.map(async (usage) => {
                // In a real implementation, you would fetch actual performance metrics
                // For now, we'll simulate some metrics based on usage patterns
                const latency = this.simulateLatency(usage);
                const errorRate = this.simulateErrorRate(usage);
                const qualityScore = await this.getQualityScore(usage);
                const retryCount = usage.metadata?.retryCount || 0;
                const successRate = usage.metadata?.successRate || 100;

                return {
                    ...usage,
                    latency,
                    errorRate,
                    qualityScore,
                    retryCount,
                    successRate
                };
            })
        );

        return enhancedData;
    }



    // Additional helper methods for simulating metrics and calculations
    private static simulateLatency(usage: IUsage): number {
        // Simulate latency based on token count and service
        const baseLatency = usage.service.includes('gpt-4') ? 2000 : 1000;
        const tokenMultiplier = usage.totalTokens / 100;
        return baseLatency + (tokenMultiplier * 10) + (Math.random() * 500);
    }

    private static simulateErrorRate(usage: IUsage): number {
        // Simulate error rate based on service reliability
        const baseErrorRate = usage.service.includes('gpt-4') ? 0.5 : 1.0;
        return baseErrorRate + (Math.random() * 2);
    }

    private static async getQualityScore(usage: IUsage): Promise<number> {
        // Try to get actual quality score from database
        const qualityScore = await QualityScore.findOne({
            userId: usage.userId,
            service: usage.service,
            model: usage.model,
            createdAt: { $gte: usage.createdAt, $lte: new Date(usage.createdAt.getTime() + 60000) }
        });
        if (qualityScore) {
            return qualityScore.optimizedScore / 100; // Convert to 0-1 scale
        }

        // Simulate quality score based on model and cost
        const baseQuality = usage.model.includes('gpt-4') ? 0.85 : 0.75;
        const costInfluence = Math.min(usage.cost / 0.01, 1) * 0.1;
        return Math.min(baseQuality + costInfluence + (Math.random() * 0.1), 1);
    }

    private static calculateCostEfficiencyScore(costPerRequest: number, performance: PerformanceMetrics): number {
        // Calculate a score from 0-1 based on cost vs performance
        const latencyScore = Math.max(0, 1 - (performance.latency / 10000)); // Normalize latency
        const qualityScore = performance.qualityScore;
        const reliabilityScore = performance.successRate / 100;
        const costScore = Math.max(0, 1 - (costPerRequest / 0.1)); // Normalize cost

        return (latencyScore + qualityScore + reliabilityScore + costScore) / 4;
    }

    private static getPerformanceRating(performance: PerformanceMetrics): 'excellent' | 'good' | 'fair' | 'poor' {
        const score = (performance.qualityScore * 0.4) +
            ((10000 - performance.latency) / 10000 * 0.3) +
            (performance.successRate / 100 * 0.3);

        if (score > 0.8) return 'excellent';
        if (score > 0.6) return 'good';
        if (score > 0.4) return 'fair';
        return 'poor';
    }

    private static generateRecommendation(
        service: string,
        model: string,
        performance: PerformanceMetrics,
        efficiencyScore: number
    ): string {
        if (efficiencyScore > 0.8) {
            return `Excellent cost-performance ratio for ${service} ${model}. Continue current usage.`;
        } else if (efficiencyScore > 0.6) {
            return `Good performance for ${service} ${model} but consider optimizing for better cost efficiency.`;
        } else if (performance.latency > 5000) {
            return `High latency detected for ${service} ${model}. Consider switching to a faster model or optimizing requests.`;
        } else if (performance.errorRate > 5) {
            return `High error rate detected for ${service} ${model}. Consider switching to a more reliable service.`;
        } else {
            return `Poor cost-performance ratio for ${service} ${model}. Consider alternative services or optimization strategies.`;
        }
    }

    private static calculateOptimizationPotential(performance: PerformanceMetrics, efficiencyScore: number): number {
        // Use the performance parameter to calculate potential
        const performanceScore = performance.latency > 0 ? 100 / performance.latency : 0;
        const adjustedScore = efficiencyScore * (1 + performanceScore / 1000);
        return Math.max(0, (1 - adjustedScore) * 100);
    }



    private static findBestValue(correlations: CostPerformanceCorrelation[]): {
        service: string;
        model: string;
        reason: string;
        costSavings: number;
        performanceImpact: number;
    } {
        const bestOption = correlations.reduce((best, current) =>
            current.efficiency.costEfficiencyScore > best.efficiency.costEfficiencyScore ? current : best
        );

        const avgCost = correlations.reduce((sum, c) => sum + c.costPerRequest, 0) / correlations.length;
        const costSavings = avgCost - bestOption.costPerRequest;

        return {
            service: bestOption.service,
            model: bestOption.model,
            reason: `Best cost-efficiency score of ${(bestOption.efficiency.costEfficiencyScore * 100).toFixed(1)}%`,
            costSavings: Math.max(0, costSavings),
            performanceImpact: bestOption.performance.qualityScore * 100
        };
    }

    private static generateRecommendations(correlations: CostPerformanceCorrelation[]): Array<{
        type: 'switch_service' | 'optimize_usage' | 'adjust_parameters';
        priority: 'high' | 'medium' | 'low';
        description: string;
        expectedSavings: number;
        implementationEffort: 'easy' | 'moderate' | 'complex';
        riskLevel: 'low' | 'medium' | 'high';
    }> {
        const recommendations = [];

        // Find service switching opportunities
        const inefficientServices = correlations.filter(c => c.efficiency.costEfficiencyScore < 0.6);
        const efficientServices = correlations.filter(c => c.efficiency.costEfficiencyScore > 0.8);

        if (inefficientServices.length > 0 && efficientServices.length > 0) {
            recommendations.push({
                type: 'switch_service' as const,
                priority: 'high' as const,
                description: `Switch from ${inefficientServices[0].service} to ${efficientServices[0].service} for better cost efficiency`,
                expectedSavings: (inefficientServices[0].costPerRequest - efficientServices[0].costPerRequest) * 1000,
                implementationEffort: 'moderate' as const,
                riskLevel: 'medium' as const
            });
        }

        // Find optimization opportunities
        const highLatencyServices = correlations.filter(c => c.performance.latency > 5000);
        if (highLatencyServices.length > 0) {
            recommendations.push({
                type: 'optimize_usage' as const,
                priority: 'medium' as const,
                description: 'Optimize request patterns to reduce latency and improve cost efficiency',
                expectedSavings: highLatencyServices[0].costPerRequest * 0.2 * 1000,
                implementationEffort: 'easy' as const,
                riskLevel: 'low' as const
            });
        }

        return recommendations;
    }

    // Additional helper methods would be implemented here for:
    // - groupByTimePeriod
    // - calculateAggregatedMetrics
    // - calculateTrend
    // - generatePerformanceAlerts
    // - identifyModelSwitchOpportunities
    // - identifyParameterTuningOpportunities
    // - identifyRequestOptimizationOpportunities
    // - identifyCachingOpportunities
    // - generateTimeSeries
    // - calculatePercentiles
    // - detectPerformanceAnomalies

    private static groupByTimePeriod(
        usageData: Array<IUsage & { latency?: number; errorRate?: number; qualityScore?: number; }>,
        granularity: 'hour' | 'day' | 'week'
    ): Map<string, Array<IUsage & { latency?: number; errorRate?: number; qualityScore?: number; }>> {
        const groups = new Map();

        usageData.forEach(usage => {
            let key: string;
            const date = new Date(usage.createdAt);

            switch (granularity) {
                case 'hour':
                    key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
                    break;
                case 'day':
                    key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    break;
                case 'week':
                    const weekStart = new Date(date.setDate(date.getDate() - date.getDay()));
                    key = `${weekStart.getFullYear()}-${weekStart.getMonth()}-${weekStart.getDate()}`;
                    break;
            }

            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(usage);
        });

        return groups;
    }

    private static calculateAggregatedMetrics(
        usages: Array<IUsage & { latency?: number; errorRate?: number; qualityScore?: number; }>
    ): PerformanceMetrics & { cost: number; volume: number } {
        const totalCost = usages.reduce((sum, usage) => sum + usage.cost, 0);
        const volume = usages.length;

        return {
            cost: totalCost,
            volume,
            latency: usages.reduce((sum, usage) => sum + (usage.latency || 0), 0) / volume,
            errorRate: usages.reduce((sum, usage) => sum + (usage.errorRate || 0), 0) / volume,
            qualityScore: usages.reduce((sum, usage) => sum + (usage.qualityScore || 0), 0) / volume,
            throughput: volume / 24, // assuming 24 hour period
            successRate: usages.reduce((sum, _usage) => sum + 100, 0) / volume, // Default to 100% success
            retryRate: usages.reduce((sum, _usage) => sum + 0, 0) / volume // Default to 0 retries
        };
    }

    private static calculateTrend(
        period: string,
        metrics: PerformanceMetrics & { cost: number; volume: number },
        previousTrends: PerformanceTrend[]
    ): 'improving' | 'degrading' | 'stable' {
        if (previousTrends.length === 0) return 'stable';

        // Period affects the trend calculation sensitivity
        const periodMultiplier = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
        const previousMetrics = previousTrends[previousTrends.length - 1].metrics;
        const costTrend = (metrics.cost - previousMetrics.cost) / periodMultiplier;
        const latencyTrend = (metrics.latency - previousMetrics.latency) / periodMultiplier;
        const qualityTrend = (metrics.qualityScore - previousMetrics.qualityScore) / periodMultiplier;

        const improvingFactors = [
            costTrend < 0 ? 1 : 0,
            latencyTrend < 0 ? 1 : 0,
            qualityTrend > 0 ? 1 : 0
        ].reduce((a, b) => a + b, 0);

        if (improvingFactors >= 2) return 'improving';
        if (improvingFactors <= 1) return 'degrading';
        return 'stable';
    }

    private static generatePerformanceAlerts(
        metrics: PerformanceMetrics & { cost: number; volume: number },
        trend: 'improving' | 'degrading' | 'stable'
    ): Array<{
        type: 'performance_degradation' | 'cost_spike' | 'error_increase';
        severity: 'low' | 'medium' | 'high';
        message: string;
        suggestedActions: string[];
    }> {
        const alerts = [];

        if (metrics.latency > 5000) {
            alerts.push({
                type: 'performance_degradation' as const,
                severity: trend === 'degrading' ? 'high' as const : 'medium' as const,
                message: `High latency detected: ${metrics.latency.toFixed(0)}ms (trend: ${trend})`,
                suggestedActions: [
                    'Optimize request parameters',
                    'Consider faster model alternatives',
                    'Implement request caching'
                ]
            });
        }

        if (metrics.errorRate > 5) {
            alerts.push({
                type: 'error_increase' as const,
                severity: 'high' as const,
                message: `High error rate detected: ${metrics.errorRate.toFixed(1)}%`,
                suggestedActions: [
                    'Review recent API changes',
                    'Implement better error handling',
                    'Consider alternative service providers'
                ]
            });
        }

        if (metrics.cost > 50) {
            alerts.push({
                type: 'cost_spike' as const,
                severity: 'medium' as const,
                message: `Cost spike detected: $${metrics.cost.toFixed(2)}`,
                suggestedActions: [
                    'Review recent usage patterns',
                    'Implement cost controls',
                    'Optimize high-cost operations'
                ]
            });
        }

        return alerts;
    }

    // Placeholder methods for optimization opportunities
    private static identifyModelSwitchOpportunities(correlations: CostPerformanceCorrelation[]): OptimizationOpportunity[] {
        // Implementation would analyze correlations to find better model alternatives
        return correlations.map((correlation, index) => ({
            id: `model_switch_${index}`,
            title: `Model Switch for ${correlation.service} ${correlation.model}`,
            type: 'model_switch' as const,
            description: `Consider switching from ${correlation.service} ${correlation.model} to a more cost-effective model`,
            currentCost: correlation.costPerRequest,
            projectedCost: correlation.costPerRequest * 0.8,
            savings: correlation.costPerRequest * 0.2,
            savingsPercentage: 20,
            performanceImpact: {
                latency: 0,
                quality: -5,
                reliability: 10
            },
            implementationComplexity: 'high' as const,
            riskAssessment: {
                level: 'high' as const,
                factors: ['Model switch requires extensive testing', 'Quality impact assessment needed'],
                mitigation: ['Comprehensive testing', 'Gradual migration', 'Fallback strategy']
            },
            timeline: '1-2 weeks',
            priority: 1
        }));
    }

    private static identifyParameterTuningOpportunities(correlations: CostPerformanceCorrelation[]): OptimizationOpportunity[] {
        // Implementation would analyze parameter settings for cost optimization
        return correlations.map((correlation, index) => ({
            id: `param_tuning_${index}`,
            title: `Parameter Tuning for ${correlation.service} ${correlation.model}`,
            type: 'parameter_tuning' as const,
            description: `Optimize parameters for ${correlation.service} ${correlation.model}`,
            currentCost: correlation.costPerRequest,
            projectedCost: correlation.costPerRequest * 0.9,
            savings: correlation.costPerRequest * 0.1,
            savingsPercentage: 10,
            performanceImpact: {
                latency: -5,
                quality: 10,
                reliability: 0
            },
            implementationComplexity: 'medium' as const,
            riskAssessment: {
                level: 'medium' as const,
                factors: ['Parameter optimization required', 'Performance testing needed'],
                mitigation: ['A/B testing', 'Rollback plan']
            },
            timeline: '3-5 days',
            priority: 3
        }));
    }

    private static identifyRequestOptimizationOpportunities(correlations: CostPerformanceCorrelation[]): OptimizationOpportunity[] {
        // Implementation would analyze request patterns for optimization
        return correlations.map((correlation, index) => ({
            id: `request_opt_${index}`,
            title: `Request Optimization for ${correlation.service} ${correlation.model}`,
            type: 'request_optimization' as const,
            description: `Optimize request patterns for ${correlation.service} ${correlation.model}`,
            currentCost: correlation.costPerRequest,
            projectedCost: correlation.costPerRequest * 0.95,
            savings: correlation.costPerRequest * 0.05,
            savingsPercentage: 5,
            performanceImpact: {
                latency: -10,
                quality: 0,
                reliability: 5
            },
            implementationComplexity: 'low' as const,
            riskAssessment: {
                level: 'low' as const,
                factors: ['Minor code changes required'],
                mitigation: ['Thorough testing', 'Gradual rollout']
            },
            timeline: '1-2 days',
            priority: 2
        }));
    }

    private static identifyCachingOpportunities(correlations: CostPerformanceCorrelation[]): OptimizationOpportunity[] {
        // Implementation would identify caching opportunities
        return correlations.map((correlation, index) => ({
            id: `caching_${index}`,
            title: `Caching for ${correlation.service} ${correlation.model}`,
            type: 'caching' as const,
            description: `Implement caching for ${correlation.service} ${correlation.model} to reduce repeated requests`,
            currentCost: correlation.costPerRequest,
            projectedCost: correlation.costPerRequest * 0.7,
            savings: correlation.costPerRequest * 0.3,
            savingsPercentage: 30,
            performanceImpact: {
                latency: -20,
                quality: 0,
                reliability: 15
            },
            implementationComplexity: 'medium' as const,
            riskAssessment: {
                level: 'medium' as const,
                factors: ['Caching strategy implementation', 'Cache invalidation logic'],
                mitigation: ['Cache warming', 'TTL optimization', 'Cache monitoring']
            },
            timeline: '5-7 days',
            priority: 2
        }));
    }

    private static generateTimeSeries(
        usages: Array<IUsage & { latency?: number; errorRate?: number; qualityScore?: number; }>
    ): Array<{
        timestamp: Date;
        cost: number;
        latency: number;
        errorRate: number;
        qualityScore: number;
    }> {
        return usages.map(usage => ({
            timestamp: usage.createdAt,
            cost: usage.cost,
            latency: usage.latency || 0,
            errorRate: usage.errorRate || 0,
            qualityScore: usage.qualityScore || 0
        }));
    }

    private static calculatePercentiles(
        usages: Array<IUsage & { latency?: number; errorRate?: number; qualityScore?: number; }>
    ): {
        latency: { p50: number; p95: number; p99: number };
        cost: { p50: number; p95: number; p99: number };
    } {
        const latencies = usages.map(u => u.latency || 0).sort((a, b) => a - b);
        const costs = usages.map(u => u.cost).sort((a, b) => a - b);

        const getPercentile = (arr: number[], p: number) => {
            const index = Math.ceil(arr.length * p / 100) - 1;
            return arr[Math.max(0, Math.min(index, arr.length - 1))];
        };

        return {
            latency: {
                p50: getPercentile(latencies, 50),
                p95: getPercentile(latencies, 95),
                p99: getPercentile(latencies, 99)
            },
            cost: {
                p50: getPercentile(costs, 50),
                p95: getPercentile(costs, 95),
                p99: getPercentile(costs, 99)
            }
        };
    }

    private static detectPerformanceAnomalies(
        usages: Array<IUsage & { latency?: number; errorRate?: number; qualityScore?: number; }>
    ): Array<{
        timestamp: Date;
        type: 'cost_spike' | 'latency_spike' | 'error_spike' | 'quality_drop';
        severity: 'low' | 'medium' | 'high';
        value: number;
        expected: number;
        deviation: number;
    }> {
        const anomalies: Array<{
            timestamp: Date;
            type: 'cost_spike' | 'latency_spike' | 'error_spike' | 'quality_drop';
            severity: 'low' | 'medium' | 'high';
            value: number;
            expected: number;
            deviation: number;
        }> = [];

        // Calculate baselines
        const avgCost = usages.reduce((sum, u) => sum + u.cost, 0) / usages.length;
        const avgLatency = usages.reduce((sum, u) => sum + (u.latency || 0), 0) / usages.length;
        const avgQuality = usages.reduce((sum, u) => sum + (u.qualityScore || 0), 0) / usages.length;

        usages.forEach(usage => {
            // Cost anomalies
            if (usage.cost > avgCost * 3) {
                anomalies.push({
                    timestamp: usage.createdAt,
                    type: 'cost_spike' as const,
                    severity: 'high' as const,
                    value: usage.cost,
                    expected: avgCost,
                    deviation: (usage.cost - avgCost) / avgCost
                });
            }

            // Latency anomalies
            if (usage.latency && usage.latency > avgLatency * 3) {
                anomalies.push({
                    timestamp: usage.createdAt,
                    type: 'latency_spike' as const,
                    severity: 'high' as const,
                    value: usage.latency,
                    expected: avgLatency,
                    deviation: (usage.latency - avgLatency) / avgLatency
                });
            }

            // Quality anomalies
            if (usage.qualityScore && usage.qualityScore < avgQuality * 0.7) {
                anomalies.push({
                    timestamp: usage.createdAt,
                    type: 'quality_drop' as const,
                    severity: 'medium' as const,
                    value: usage.qualityScore,
                    expected: avgQuality,
                    deviation: (avgQuality - usage.qualityScore) / avgQuality
                });
            }
        });

        return anomalies.sort((a, b) => b.deviation - a.deviation).slice(0, 20);
    }

    /**
     * Calculate quality score based on latency and error rate
     */
    private static calculateQualityScore(latency: number, errorRate: number): number {
        // Simple quality score calculation (0-100)
        const latencyScore = Math.max(0, 100 - (latency / 10)); // Penalty for high latency
        const errorScore = Math.max(0, 100 - (errorRate * 2)); // Penalty for errors
        return (latencyScore + errorScore) / 2;
    }

    /**
     * Calculate tradeoff score between cost and performance metric
     */
    private static calculateTradeoff(cost: number, performanceMetric: number): number {
        // Simple tradeoff calculation (normalized 0-1)
        return Math.min(1, cost / (performanceMetric + 0.01));
    }
} 