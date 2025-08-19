/**
 * Cost-Performance Index (CPI) Service
 * Core engine for cross-provider cost normalization and intelligent routing
 */

import { logger } from '../utils/logger';
import { getModelPricing } from '../utils/pricing';
import { 
    CPIMetrics, 
    ProviderPerformance, 
    CPICalculationInput
} from '../types/cpi.types';

export class CPIService {
    private static performanceCache = new Map<string, ProviderPerformance>();
    private static cpiCache = new Map<string, CPIMetrics>();
    private static cacheTTL = 5 * 60 * 1000; // 5 minutes

    /**
     * Calculate CPI metrics for a specific provider and model
     */
    static async calculateCPIMetrics(
        provider: string,
        modelId: string,
        input: CPICalculationInput
    ): Promise<CPIMetrics> {
        try {
            const cacheKey = `${provider}:${modelId}:${input.useCase}`;
            const cached = this.cpiCache.get(cacheKey);
            
            if (cached && Date.now() - Date.now() < this.cacheTTL) {
                return cached;
            }

            // Get base pricing
            const pricing = getModelPricing(provider, modelId);
            if (!pricing) {
                throw new Error(`Pricing not found for ${provider}:${modelId}`);
            }

            // Calculate normalized cost
            const normalizedCost = this.calculateNormalizedCost(
                input.promptTokens,
                input.completionTokens,
                pricing,
                provider
            );

            // Get performance metrics
            const performance = await this.getProviderPerformance(provider, modelId);
            
            // Calculate individual scores
            const costEfficiencyScore = this.calculateCostEfficiencyScore(normalizedCost, input.useCase);
            const performanceScore = this.calculatePerformanceScore(performance || undefined, input.latencyRequirement);
            const qualityScore = this.calculateQualityScore(pricing, input.useCase, input.qualityRequirement);
            const reliabilityScore = this.calculateReliabilityScore(performance || undefined);

            // Calculate overall CPI score
            const cpiScore = this.calculateOverallCPIScore({
                costEfficiencyScore,
                performanceScore,
                qualityScore,
                reliabilityScore
            }, input);

            const metrics: CPIMetrics = {
                normalizedCostPer1MTokens: normalizedCost,
                performanceScore,
                cpiScore,
                costEfficiencyScore,
                qualityScore,
                reliabilityScore
            };

            // Cache the result
            this.cpiCache.set(cacheKey, metrics);

            logger.debug('CPI metrics calculated', {
                provider,
                modelId,
                cpiScore,
                normalizedCost,
                performanceScore
            });

            return metrics;
        } catch (error) {
            logger.error('Error calculating CPI metrics:', error);
            throw error;
        }
    }

    /**
     * Calculate normalized cost per 1M tokens across providers
     */
    private static calculateNormalizedCost(
        promptTokens: number,
        completionTokens: number,
        pricing: any,
        provider: string
    ): number {
        try {
            // Get provider-specific pricing
            const inputPrice = pricing.inputPrice || 0;
            const outputPrice = pricing.outputPrice || 0;

            // Calculate total cost for the request
            const totalCost = (promptTokens / 1000000) * inputPrice + 
                            (completionTokens / 1000000) * outputPrice;

            // Normalize to cost per 1M tokens
            const totalTokens = promptTokens + completionTokens;
            const normalizedCost = totalTokens > 0 ? (totalCost / totalTokens) * 1000000 : 0;

            // Apply provider-specific normalization factors
            const normalizationFactor = this.getProviderNormalizationFactor(provider);
            
            return normalizedCost * normalizationFactor;
        } catch (error) {
            logger.error('Error calculating normalized cost:', error);
            return 0;
        }
    }

    /**
     * Get provider-specific normalization factors
     */
    private static getProviderNormalizationFactor(provider: string): number {
        const factors: Record<string, number> = {
            'openai': 1.0,
            'anthropic': 1.0,
            'aws-bedrock': 0.95, // Slight discount for enterprise
            'google-ai': 1.05,   // Slight premium for advanced features
            'cohere': 0.9,       // Discount for specialized models
            'huggingface': 0.85  // Discount for open-source models
        };

        return factors[provider.toLowerCase()] || 1.0;
    }

    /**
     * Calculate cost efficiency score (0-100)
     */
    private static calculateCostEfficiencyScore(
        normalizedCost: number,
        useCase: string
    ): number {
        // Define cost thresholds by use case
        const thresholds: Record<string, { low: number; medium: number; high: number }> = {
            'general': { low: 1.0, medium: 5.0, high: 15.0 },
            'creative': { low: 2.0, medium: 8.0, high: 25.0 },
            'analytical': { low: 1.5, medium: 6.0, high: 20.0 },
            'conversational': { low: 0.8, medium: 3.0, high: 10.0 },
            'code': { low: 1.2, medium: 5.0, high: 18.0 },
            'vision': { low: 3.0, medium: 12.0, high: 40.0 }
        };

        const threshold = thresholds[useCase] || thresholds['general'];

        if (normalizedCost <= threshold.low) return 100;
        if (normalizedCost <= threshold.medium) return 75;
        if (normalizedCost <= threshold.high) return 50;
        return Math.max(0, 100 - ((normalizedCost - threshold.high) / threshold.high) * 50);
    }

    /**
     * Calculate performance score (0-100)
     */
    private static calculatePerformanceScore(
        performance: ProviderPerformance | undefined,
        latencyRequirement: string
    ): number {
        if (!performance) return 50; // Default score if no performance data

        const { averageLatency, throughput, successRate } = performance.metrics;

        // Define latency thresholds by requirement
        const latencyThresholds: Record<string, { target: number; max: number }> = {
            'relaxed': { target: 5000, max: 15000 },
            'normal': { target: 2000, max: 8000 },
            'strict': { target: 1000, max: 3000 },
            'real-time': { target: 200, max: 1000 }
        };

        const threshold = latencyThresholds[latencyRequirement] || latencyThresholds['normal'];

        // Calculate latency score
        let latencyScore = 100;
        if (averageLatency > threshold.max) {
            latencyScore = 0;
        } else if (averageLatency > threshold.target) {
            latencyScore = 100 - ((averageLatency - threshold.target) / (threshold.max - threshold.target)) * 50;
        }

        // Calculate throughput score
        const throughputScore = Math.min(100, (throughput / 10) * 100); // Normalize to 10 req/s

        // Calculate success rate score
        const successScore = successRate;

        // Weighted average
        const performanceScore = (latencyScore * 0.5) + (throughputScore * 0.3) + (successScore * 0.2);

        return Math.round(performanceScore);
    }

    /**
     * Calculate quality score (0-100)
     */
    private static calculateQualityScore(
        pricing: any,
        useCase: string,
        qualityRequirement: string
    ): number {
        // Base quality score from model capabilities
        let baseScore = 70; // Default score

        // Adjust based on model tier
        if (pricing.modelName?.includes('Pro') || pricing.modelName?.includes('Ultra')) {
            baseScore += 15;
        } else if (pricing.modelName?.includes('Mini') || pricing.modelName?.includes('Lite')) {
            baseScore -= 10;
        }

        // Adjust based on use case requirements
        const useCaseMultipliers: Record<string, number> = {
            'general': 1.0,
            'creative': 1.1,
            'analytical': 1.2,
            'conversational': 0.9,
            'code': 1.15,
            'vision': 1.25
        };

        const qualityMultipliers: Record<string, number> = {
            'low': 0.8,
            'medium': 1.0,
            'high': 1.2,
            'ultra': 1.4
        };

        const multiplier = (useCaseMultipliers[useCase] || 1.0) * (qualityMultipliers[qualityRequirement] || 1.0);
        const adjustedScore = baseScore * multiplier;

        return Math.min(100, Math.max(0, Math.round(adjustedScore)));
    }

    /**
     * Calculate reliability score (0-100)
     */
    private static calculateReliabilityScore(performance: ProviderPerformance | undefined): number {
        if (!performance) return 70; // Default score

        const { successRate, errorRate } = performance.metrics;
        const { reliabilityTrend } = performance.trends;

        let baseScore = successRate;

        // Adjust based on trend
        if (reliabilityTrend === 'improving') baseScore += 10;
        else if (reliabilityTrend === 'degrading') baseScore -= 15;

        // Penalize high error rates
        if (errorRate > 5) baseScore -= (errorRate - 5) * 2;

        return Math.min(100, Math.max(0, Math.round(baseScore)));
    }

    /**
     * Calculate overall CPI score
     */
    private static calculateOverallCPIScore(
        scores: {
            costEfficiencyScore: number;
            performanceScore: number;
            qualityScore: number;
            reliabilityScore: number;
        },
        input: CPICalculationInput
    ): number {
        // Define weights based on use case and requirements
        const weights = this.getScoreWeights(input);

        const weightedScore = 
            (scores.costEfficiencyScore * weights.cost) +
            (scores.performanceScore * weights.performance) +
            (scores.qualityScore * weights.quality) +
            (scores.reliabilityScore * weights.reliability);

        return Math.round(weightedScore);
    }

    /**
     * Get score weights based on input requirements
     */
    private static getScoreWeights(input: CPICalculationInput): {
        cost: number;
        performance: number;
        quality: number;
        reliability: number;
    } {
        // Base weights
        let weights = { cost: 0.3, performance: 0.3, quality: 0.2, reliability: 0.2 };

        // Adjust based on latency requirement
        if (input.latencyRequirement === 'real-time') {
            weights.performance += 0.2;
            weights.cost -= 0.1;
            weights.quality -= 0.1;
        } else if (input.latencyRequirement === 'relaxed') {
            weights.cost += 0.2;
            weights.performance -= 0.1;
            weights.quality -= 0.1;
        }

        // Adjust based on quality requirement
        if (input.qualityRequirement === 'ultra') {
            weights.quality += 0.2;
            weights.cost -= 0.1;
            weights.performance -= 0.1;
        } else if (input.qualityRequirement === 'low') {
            weights.cost += 0.2;
            weights.quality -= 0.1;
            weights.performance -= 0.1;
        }

        // Adjust based on reliability requirement
        if (input.reliabilityRequirement === 'critical') {
            weights.reliability += 0.2;
            weights.cost -= 0.1;
            weights.performance -= 0.1;
        }

        // Normalize weights to sum to 1
        const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
        Object.keys(weights).forEach(key => {
            weights[key as keyof typeof weights] /= totalWeight;
        });

        return weights;
    }

    /**
     * Get provider performance data
     */
    private static async getProviderPerformance(
        provider: string,
        modelId: string
    ): Promise<ProviderPerformance | null> {
        const cacheKey = `${provider}:${modelId}`;
        const cached = this.performanceCache.get(cacheKey);
        
        if (cached && Date.now() - Date.now() < this.cacheTTL) {
            return cached;
        }

        try {
            // Get real performance data from usage analytics
            const performance = await this.fetchRealPerformanceData(provider, modelId);
            if (performance) {
                this.performanceCache.set(cacheKey, performance);
                return performance;
            }

            // Fallback to estimated performance based on provider/model characteristics
            const estimatedPerformance = await this.generateEstimatedPerformance(provider, modelId);
            this.performanceCache.set(cacheKey, estimatedPerformance);
            return estimatedPerformance;
        } catch (error) {
            logger.warn(`Failed to fetch performance data for ${provider}:${modelId}:`, error);
            const estimatedPerformance = await this.generateEstimatedPerformance(provider, modelId);
            this.performanceCache.set(cacheKey, estimatedPerformance);
            return estimatedPerformance;
        }
    }

    /**
     * Fetch real performance data from usage analytics
     */
    private static async fetchRealPerformanceData(
        provider: string,
        modelId: string
    ): Promise<ProviderPerformance | null> {
        try {
            // Import Usage model dynamically to avoid circular dependencies
            const { Usage } = await import('../models/Usage');
            
            // Get performance metrics from recent usage data
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const usageStats = await Usage.aggregate([
                {
                    $match: {
                        service: provider,
                        model: modelId,
                        createdAt: { $gte: thirtyDaysAgo },
                        errorOccurred: false
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgResponseTime: { $avg: '$responseTime' },
                        totalRequests: { $sum: 1 },
                        totalErrors: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                        avgTokens: { $avg: '$totalTokens' }
                    }
                }
            ]);

            // Get percentiles separately using a different approach
            const responseTimes = await Usage.distinct('responseTime', {
                service: provider,
                model: modelId,
                createdAt: { $gte: thirtyDaysAgo },
                errorOccurred: false
            });

            const sortedResponseTimes = responseTimes.sort((a, b) => a - b);
            const p95Index = Math.floor(sortedResponseTimes.length * 0.95);
            const p99Index = Math.floor(sortedResponseTimes.length * 0.99);
            
            const p95ResponseTime = sortedResponseTimes[p95Index] || 5000;
            const p99ResponseTime = sortedResponseTimes[p99Index] || 8000;

            if (usageStats.length === 0) {
                return null;
            }

            const stats = usageStats[0];
            const successRate = stats.totalRequests > 0 ? 
                ((stats.totalRequests - stats.totalErrors) / stats.totalRequests) * 100 : 95;

            const performance: ProviderPerformance = {
                provider,
                modelId,
                modelName: modelId,
                metrics: {
                    averageLatency: stats.avgResponseTime || 2000,
                    p95Latency: p95ResponseTime,
                    p99Latency: p99ResponseTime,
                    throughput: this.calculateThroughput(stats.avgResponseTime || 2000),
                    successRate: Math.round(successRate),
                    errorRate: Math.round(100 - successRate),
                    lastUpdated: new Date()
                },
                trends: await this.calculatePerformanceTrends(provider, modelId),
                capabilities: await this.getModelCapabilities(provider, modelId)
            };

            return performance;
        } catch (error) {
            logger.error('Error fetching real performance data:', error);
            return null;
        }
    }

    /**
     * Generate estimated performance based on provider/model characteristics
     */
    private static async generateEstimatedPerformance(
        provider: string,
        modelId: string
    ): Promise<ProviderPerformance> {
        try {
            // Try to get real performance data from telemetry or usage analytics
            const { Usage } = await import('../models/Usage');
            
            // Get recent performance data for this provider/model
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const recentData = await Usage.aggregate([
                {
                    $match: {
                        service: provider,
                        model: modelId,
                        createdAt: { $gte: thirtyDaysAgo },
                        responseTime: { $exists: true, $gt: 0 }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgResponseTime: { $avg: '$responseTime' },
                        totalRequests: { $sum: 1 },
                        errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } }
                    }
                }
            ]);

            // Get percentiles separately using distinct and manual calculation
            const responseTimes = await Usage.distinct('responseTime', {
                service: provider,
                model: modelId,
                createdAt: { $gte: thirtyDaysAgo },
                responseTime: { $exists: true, $gt: 0 }
            });

            const sortedResponseTimes = responseTimes.sort((a, b) => a - b);
            const p95Index = Math.floor(sortedResponseTimes.length * 0.95);
            const p99Index = Math.floor(sortedResponseTimes.length * 0.99);
            
            const p95ResponseTime = sortedResponseTimes[p95Index] || 0;
            const p99ResponseTime = sortedResponseTimes[p99Index] || 0;

            if (recentData.length > 0 && recentData[0].avgResponseTime) {
                const data = recentData[0];
                const successRate = ((data.totalRequests - data.errorCount) / data.totalRequests) * 100;
                const throughput = this.calculateThroughput(data.avgResponseTime);

                return {
                    provider,
                    modelId,
                    modelName: modelId,
                    metrics: {
                        averageLatency: data.avgResponseTime,
                        p95Latency: p95ResponseTime || data.avgResponseTime * 1.5,
                        p99Latency: p99ResponseTime || data.avgResponseTime * 2.0,
                        throughput,
                        successRate,
                        errorRate: 100 - successRate,
                        lastUpdated: new Date()
                    },
                    trends: await this.calculatePerformanceTrends(provider, modelId),
                    capabilities: await this.getModelCapabilities(provider, modelId)
                };
            }
        } catch (error) {
            logger.warn(`Failed to get real performance data for ${provider}:${modelId}:`, error);
        }

        // Fallback: Use industry benchmarks and model specifications
        const modelSpecs = await this.getModelSpecifications(provider, modelId);
        
        return {
            provider,
            modelId,
            modelName: modelId,
            metrics: {
                averageLatency: modelSpecs.estimatedLatency,
                p95Latency: modelSpecs.estimatedLatency * 1.5,
                p99Latency: modelSpecs.estimatedLatency * 2.0,
                throughput: modelSpecs.estimatedThroughput,
                successRate: modelSpecs.estimatedSuccessRate,
                errorRate: 100 - modelSpecs.estimatedSuccessRate,
                lastUpdated: new Date()
            },
            trends: { latencyTrend: 'stable', costTrend: 'stable', reliabilityTrend: 'stable' },
            capabilities: await this.getModelCapabilities(provider, modelId)
        };
    }

    /**
     * Get model specifications from pricing data and industry benchmarks
     */
    private static async getModelSpecifications(
        provider: string,
        modelId: string
    ): Promise<{
        estimatedLatency: number;
        estimatedThroughput: number;
        estimatedSuccessRate: number;
    }> {
        try {
            const pricing = getModelPricing(provider, modelId);
            if (pricing) {
                // Use pricing tier to estimate performance
                const isHighTier = modelId.includes('pro') || modelId.includes('ultra') || modelId.includes('4o');
                const isLowTier = modelId.includes('mini') || modelId.includes('lite') || modelId.includes('3.5');
                
                let baseLatency = 2000; // Default base latency
                let baseThroughput = 5; // Default throughput
                let baseSuccessRate = 95; // Default success rate
                
                if (isHighTier) {
                    baseLatency = 1500;
                    baseThroughput = 8;
                    baseSuccessRate = 98;
                } else if (isLowTier) {
                    baseLatency = 3000;
                    baseThroughput = 3;
                    baseSuccessRate = 92;
                }
                
                // Adjust based on provider reputation
                const providerAdjustments: Record<string, { latency: number; throughput: number; success: number }> = {
                    'openai': { latency: 0.9, throughput: 1.1, success: 1.0 },
                    'anthropic': { latency: 1.0, throughput: 1.0, success: 1.0 },
                    'aws-bedrock': { latency: 1.1, throughput: 0.9, success: 0.98 },
                    'google-ai': { latency: 0.85, throughput: 1.2, success: 0.97 },
                    'cohere': { latency: 1.05, throughput: 0.95, success: 0.96 }
                };
                
                const adjustment = providerAdjustments[provider] || { latency: 1.0, throughput: 1.0, success: 1.0 };
                
                return {
                    estimatedLatency: baseLatency * adjustment.latency,
                    estimatedThroughput: baseThroughput * adjustment.throughput,
                    estimatedSuccessRate: baseSuccessRate * adjustment.success
                };
            }
        } catch (error) {
            logger.warn(`Failed to get model specifications for ${provider}:${modelId}:`, error);
        }
        
        // Final fallback values
        return {
            estimatedLatency: 2500,
            estimatedThroughput: 5,
            estimatedSuccessRate: 95
        };
    }

    /**
     * Calculate throughput based on average response time
     */
    private static calculateThroughput(avgResponseTime: number): number {
        if (avgResponseTime <= 0) return 5;
        return Math.min(10, Math.max(1, 1000 / avgResponseTime));
    }

    /**
     * Calculate performance trends based on historical data
     */
    private static async calculatePerformanceTrends(
        provider: string,
        modelId: string
    ): Promise<{
        latencyTrend: 'improving' | 'stable' | 'degrading';
        costTrend: 'decreasing' | 'stable' | 'increasing';
        reliabilityTrend: 'improving' | 'stable' | 'degrading';
    }> {
        try {
            const { Usage } = await import('../models/Usage');
            
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

            const [recentStats, historicalStats] = await Promise.all([
                Usage.aggregate([
                    {
                        $match: {
                            service: provider,
                            model: modelId,
                            createdAt: { $gte: thirtyDaysAgo },
                            errorOccurred: false
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            avgResponseTime: { $avg: '$responseTime' },
                            avgCost: { $avg: '$cost' },
                            errorRate: { $avg: { $cond: ['$errorOccurred', 1, 0] } }
                        }
                    }
                ]),
                Usage.aggregate([
                    {
                        $match: {
                            service: provider,
                            model: modelId,
                            createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
                            errorOccurred: false
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            avgResponseTime: { $avg: '$responseTime' },
                            avgCost: { $avg: '$cost' },
                            errorRate: { $avg: { $cond: ['$errorOccurred', 1, 0] } }
                        }
                    }
                ])
            ]);

            if (recentStats.length === 0 || historicalStats.length === 0) {
                return { latencyTrend: 'stable', costTrend: 'stable', reliabilityTrend: 'stable' };
            }

            const recent = recentStats[0];
            const historical = historicalStats[0];

            const latencyChange = ((recent.avgResponseTime - historical.avgResponseTime) / historical.avgResponseTime) * 100;
            const costChange = ((recent.avgCost - historical.avgCost) / historical.avgCost) * 100;
            const reliabilityChange = (recent.errorRate - historical.errorRate) * 100;

            return {
                latencyTrend: latencyChange < -5 ? 'improving' : latencyChange > 5 ? 'degrading' : 'stable',
                costTrend: costChange < -5 ? 'decreasing' : costChange > 5 ? 'increasing' : 'stable',
                reliabilityTrend: reliabilityChange < -1 ? 'improving' : reliabilityChange > 1 ? 'degrading' : 'stable'
            };
        } catch (error) {
            logger.warn('Error calculating performance trends:', error);
            return { latencyTrend: 'stable', costTrend: 'stable', reliabilityTrend: 'stable' };
        }
    }

    /**
     * Get model capabilities from pricing data
     */
    private static async getModelCapabilities(
        provider: string,
        _modelId: string
    ): Promise<{
        maxContextLength: number;
        supportsVision: boolean;
        supportsAudio: boolean;
        supportsFunctionCalling: boolean;
        supportsStreaming: boolean;
        rateLimits: {
            requestsPerMinute: number;
            tokensPerMinute: number;
        };
    }> {
        try {
            const pricing = getModelPricing(provider, _modelId);
            if (pricing) {
                return {
                    maxContextLength: pricing.contextWindow || 128000,
                    supportsVision: pricing.capabilities?.includes('vision') || false,
                    supportsAudio: pricing.capabilities?.includes('function-calling') || false,
                    supportsFunctionCalling: pricing.capabilities?.includes('function-calling') || false,
                    supportsStreaming: true, // Most modern models support streaming
                    rateLimits: {
                        requestsPerMinute: 60,
                        tokensPerMinute: 1000000
                    }
                };
            }
        } catch (error) {
            logger.warn('Error getting model capabilities:', error);
        }

        return this.getDefaultCapabilities(provider, _modelId);
    }

    /**
     * Get default capabilities for a provider/model
     */
    private static getDefaultCapabilities(
        _provider: string,
        modelId: string
    ): {
        maxContextLength: number;
        supportsVision: boolean;
        supportsAudio: boolean;
        supportsFunctionCalling: boolean;
        supportsStreaming: boolean;
        rateLimits: {
            requestsPerMinute: number;
            tokensPerMinute: number;
        };
    } {
        const isVisionModel = modelId.includes('vision') || modelId.includes('4o') || modelId.includes('gemini');
        const isFunctionModel = !modelId.includes('mini') && !modelId.includes('lite');
        
        return {
            maxContextLength: 128000,
            supportsVision: isVisionModel,
            supportsAudio: false,
            supportsFunctionCalling: isFunctionModel,
            supportsStreaming: true,
            rateLimits: {
                requestsPerMinute: 60,
                tokensPerMinute: 1000000
            }
        };
    }

    /**
     * Clear expired cache entries
     */
    static clearExpiredCache(): void {
        const now = Date.now();
        
        // Clear expired CPI cache
        this.cpiCache.forEach((_value, key) => {
            if (now - Date.now() > this.cacheTTL) {
                this.cpiCache.delete(key);
            }
        });

        // Clear expired performance cache
        this.performanceCache.forEach((_value, key) => {
            if (now - Date.now() > this.cacheTTL) {
                this.performanceCache.delete(key);
            }
        });
    }
}
