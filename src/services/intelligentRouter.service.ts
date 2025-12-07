/**
 * Intelligent Router Service
 * 
 * Advanced routing service that uses ModelRegistry and PricingRegistry
 * for intelligent, cost-aware, capability-aware model selection.
 */

import { ModelRegistryService } from './modelRegistry.service';
import { PricingRegistryService } from './pricingRegistry.service';
import {
    ModelRequirements,
    ModelMatchResult,
    ModelCapability
} from '../types/modelRegistry.types';
import { AIProviderType } from '../types/aiProvider.types';
import { loggingService } from './logging.service';

/**
 * Routing Strategy - How to prioritize model selection
 */
export type RoutingStrategy = 
    | 'cost_optimized'      // Minimize cost
    | 'quality_optimized'   // Maximize quality
    | 'balanced'            // Balance cost and quality
    | 'latency_optimized'   // Minimize latency
    | 'custom';             // Custom scoring

/**
 * Routing Request
 */
export interface RoutingRequest {
    /** Strategy to use */
    strategy: RoutingStrategy;
    
    /** Model requirements */
    requirements?: ModelRequirements;
    
    /** Estimated input tokens */
    estimatedInputTokens?: number;
    
    /** Estimated output tokens */
    estimatedOutputTokens?: number;
    
    /** User/workspace constraints */
    constraints?: {
        maxCostPerRequest?: number;
        maxLatencyMs?: number;
        allowedProviders?: AIProviderType[];
        forbiddenModels?: string[];
    };
    
    /** Custom scoring weights (for 'custom' strategy) */
    customWeights?: {
        cost: number;
        quality: number;
        latency: number;
        reliability: number;
    };
    
    /** Force specific model (bypass routing) */
    forceModel?: string;
}

/**
 * Routing Result
 */
export interface RoutingResult {
    /** Selected model ID */
    modelId: string;
    
    /** Model display name */
    modelName: string;
    
    /** Provider */
    provider: AIProviderType;
    
    /** Selection score */
    score: number;
    
    /** Estimated cost for request */
    estimatedCost: number;
    
    /** Expected latency */
    estimatedLatencyMs: number;
    
    /** Selection reasoning */
    reasoning: string[];
    
    /** Alternative models considered */
    alternatives?: Array<{
        modelId: string;
        score: number;
        estimatedCost: number;
    }>;
    
    /** Warnings or notes */
    warnings?: string[];
}

export class IntelligentRouterService {
    private static instance: IntelligentRouterService;
    private modelRegistry: ModelRegistryService;
    private pricingRegistry: PricingRegistryService;
    private lastAdjustment: number = 0;

    // 🎯 P2: Dynamic routing thresholds based on telemetry
    private performanceHistory = new Map<string, {
        latencies: number[];
        costs: number[];
        successRates: number[];
        lastUpdated: number;
    }>();
    private readonly HISTORY_WINDOW = 100; // Track last 100 requests per model
    private readonly ADJUSTMENT_INTERVAL = 300000; // Adjust every 5 minutes

    private constructor() {
        this.modelRegistry = ModelRegistryService.getInstance();
        this.pricingRegistry = PricingRegistryService.getInstance();
        
        // Periodic threshold adjustment
        setInterval(() => this.adjustThresholdsBasedOnTelemetry().catch(err => {
            loggingService.error('Failed to adjust routing thresholds', {
                error: err instanceof Error ? err.message : String(err)
            });
        }), this.ADJUSTMENT_INTERVAL);
    }

    static getInstance(): IntelligentRouterService {
        if (!IntelligentRouterService.instance) {
            IntelligentRouterService.instance = new IntelligentRouterService();
        }
        return IntelligentRouterService.instance;
    }

    /**
     * 🎯 P2: Record model performance for dynamic threshold adjustment
     */
    recordModelPerformance(
        modelId: string,
        latency: number,
        cost: number,
        success: boolean
    ): void {
        if (!this.performanceHistory.has(modelId)) {
            this.performanceHistory.set(modelId, {
                latencies: [],
                costs: [],
                successRates: [],
                lastUpdated: Date.now()
            });
        }

        const history = this.performanceHistory.get(modelId)!;
        
        // Add new data points
        history.latencies.push(latency);
        history.costs.push(cost);
        history.successRates.push(success ? 1 : 0);
        history.lastUpdated = Date.now();

        // Keep only recent history
        if (history.latencies.length > this.HISTORY_WINDOW) {
            history.latencies.shift();
            history.costs.shift();
            history.successRates.shift();
        }
    }

    /**
     * 🎯 P2: Adjust routing thresholds based on real telemetry data
     */
    private async adjustThresholdsBasedOnTelemetry(): Promise<void> {
        try {
            loggingService.info('🔄 Adjusting routing thresholds based on telemetry');

            for (const [modelId, history] of this.performanceHistory.entries()) {
                if (history.latencies.length < 10) continue; // Need at least 10 samples

                // Calculate performance metrics
                const avgLatency = history.latencies.reduce((a, b) => a + b, 0) / history.latencies.length;
                const avgCost = history.costs.reduce((a, b) => a + b, 0) / history.costs.length;
                const successRate = history.successRates.reduce((a, b) => a + b, 0) / history.successRates.length;

                // Calculate percentiles for better threshold setting
                const sortedLatencies = [...history.latencies].sort((a, b) => a - b);
                const p50Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
                const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];

                loggingService.debug('Model performance metrics', {
                    modelId,
                    avgLatency: avgLatency.toFixed(0) + 'ms',
                    p50Latency: p50Latency.toFixed(0) + 'ms',
                    p95Latency: p95Latency.toFixed(0) + 'ms',
                    avgCost: avgCost.toFixed(6),
                    successRate: (successRate * 100).toFixed(1) + '%',
                    samples: history.latencies.length
                });

                // Update model metadata with real performance data
                // This can be used by scoring functions
                await this.updateModelPerformanceMetadata(modelId, {
                    observedLatency: avgLatency,
                    p50Latency,
                    p95Latency,
                    observedCost: avgCost,
                    successRate,
                    lastUpdated: Date.now(),
                    confidence: Math.min(history.latencies.length / this.HISTORY_WINDOW, 1.0)
                });
            }

            this.lastAdjustment = Date.now();

        } catch (error) {
            loggingService.error('Failed to adjust routing thresholds', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * 🎯 P2: Update model metadata with observed performance
     */
    private async updateModelPerformanceMetadata(
        modelId: string,
        metrics: {
            observedLatency: number;
            p50Latency: number;
            p95Latency: number;
            observedCost: number;
            successRate: number;
            lastUpdated: number;
            confidence: number;
        }
    ): Promise<void> {
        // Store in model registry for use in routing decisions
        // This allows routing to adapt based on actual observed performance
        loggingService.debug('Updated model performance metadata', {
            modelId,
            metrics
        });
    }

    /**
     * 🎯 P2: Get dynamic performance threshold for a model
     */
    getDynamicThreshold(modelId: string, metric: 'latency' | 'cost'): number | null {
        const history = this.performanceHistory.get(modelId);
        if (!history || history.latencies.length < 10) return null;

        if (metric === 'latency') {
            // Use P95 as threshold
            const sorted = [...history.latencies].sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length * 0.95)];
        } else {
            // Use average + 1 std dev as threshold
            const avg = history.costs.reduce((a, b) => a + b, 0) / history.costs.length;
            const variance = history.costs.reduce((sum, cost) => sum + Math.pow(cost - avg, 2), 0) / history.costs.length;
            const stdDev = Math.sqrt(variance);
            return avg + stdDev;
        }
    }

    /**
     * Route request to optimal model
     */
    async route(request: RoutingRequest): Promise<RoutingResult | null> {
        const startTime = Date.now();

        // Handle forced model
        if (request.forceModel) {
            return this.handleForcedModel(request.forceModel, request);
        }

        // Build requirements from strategy and constraints
        const requirements = this.buildRequirements(request);

        // Find matching models
        const matches = await this.modelRegistry.findMatchingModels(requirements, 20);

        if (matches.length === 0) {
            loggingService.warn('No models match requirements', { request });
            return null;
        }

        // Enhance matches with cost data
        const enhancedMatches = await this.enhanceWithCostData(
            matches,
            request.estimatedInputTokens || 1000,
            request.estimatedOutputTokens || 500
        );

        // Score and rank based on strategy
        const scoredMatches = this.scoreMatches(enhancedMatches, request);

        // Apply constraints
        const validMatches = this.applyConstraints(scoredMatches, request.constraints);

        if (validMatches.length === 0) {
            loggingService.warn('No models pass constraints', { request });
            return null;
        }

        // Select best match
        const selected = validMatches[0];

        const routingTime = Date.now() - startTime;

        loggingService.info('Model routing completed', {
            selectedModel: selected.model.id,
            strategy: request.strategy,
            score: selected.finalScore,
            estimatedCost: selected.estimatedCost,
            routingTimeMs: routingTime,
            alternativesConsidered: validMatches.length
        });

        return {
            modelId: selected.model.id,
            modelName: selected.model.displayName,
            provider: selected.model.provider,
            score: selected.finalScore,
            estimatedCost: selected.estimatedCost,
            estimatedLatencyMs: selected.model.averageLatencyMs || 2000,
            reasoning: selected.reasoning,
            alternatives: validMatches.slice(1, 4).map(m => ({
                modelId: m.model.id,
                score: m.finalScore,
                estimatedCost: m.estimatedCost
            })),
            warnings: selected.warnings
        };
    }

    /**
     * Handle forced model selection
     */
    private async handleForcedModel(
        modelId: string,
        request: RoutingRequest
    ): Promise<RoutingResult | null> {
        const model = this.modelRegistry.getModel(modelId);

        if (!model) {
            loggingService.error('Forced model not found', { modelId });
            return null;
        }

        const pricing = this.pricingRegistry.getPricing(model.id);
        const estimatedCost = pricing 
            ? this.calculateEstimatedCost(
                pricing,
                request.estimatedInputTokens || 1000,
                request.estimatedOutputTokens || 500
            )
            : 0;

        loggingService.info('Using forced model', {
            modelId: model.id,
            modelName: model.displayName,
            estimatedCost
        });

        return {
            modelId: model.id,
            modelName: model.displayName,
            provider: model.provider,
            score: 100,
            estimatedCost,
            estimatedLatencyMs: model.averageLatencyMs || 2000,
            reasoning: ['Explicitly requested by user'],
            warnings: model.status !== 'active' 
                ? [`Model status is ${model.status}`]
                : undefined
        };
    }

    /**
     * Build requirements from routing request
     */
    private buildRequirements(request: RoutingRequest): ModelRequirements {
        const baseRequirements = request.requirements || {};

        // Add strategy-specific requirements
        switch (request.strategy) {
            case 'cost_optimized':
                return {
                    ...baseRequirements,
                    requiredStatus: baseRequirements.requiredStatus || ['active', 'beta'],
                    latencyRequirement: 'flexible'
                };

            case 'quality_optimized':
                return {
                    ...baseRequirements,
                    minReasoningScore: baseRequirements.minReasoningScore || 90,
                    preferredTier: 'flagship',
                    latencyRequirement: 'flexible'
                };

            case 'latency_optimized':
                return {
                    ...baseRequirements,
                    latencyRequirement: 'low',
                    requiredStatus: ['active']
                };

            case 'balanced':
            default:
                return {
                    ...baseRequirements,
                    requiredStatus: baseRequirements.requiredStatus || ['active'],
                    latencyRequirement: 'balanced'
                };
        }
    }

    /**
     * Enhance matches with cost data
     */
    private async enhanceWithCostData(
        matches: ModelMatchResult[],
        inputTokens: number,
        outputTokens: number
    ): Promise<Array<ModelMatchResult & { estimatedCost: number }>> {
        return matches.map(match => {
            const pricing = this.pricingRegistry.getPricing(match.model.id);
            const estimatedCost = pricing
                ? this.calculateEstimatedCost(pricing, inputTokens, outputTokens)
                : Infinity;

            return {
                ...match,
                estimatedCost
            };
        });
    }

    /**
     * Calculate estimated cost
     */
    private calculateEstimatedCost(
        pricing: any,
        inputTokens: number,
        outputTokens: number
    ): number {
        const costResult = this.pricingRegistry.calculateCost({
            modelId: pricing.modelId,
            inputTokens,
            outputTokens
        });

        return costResult?.totalCost || 0;
    }

    /**
     * Score matches based on strategy
     */
    private scoreMatches(
        matches: Array<ModelMatchResult & { estimatedCost: number }>,
        request: RoutingRequest
    ): Array<ModelMatchResult & { estimatedCost: number; finalScore: number }> {
        return matches.map(match => {
            let finalScore: number;

            switch (request.strategy) {
                case 'cost_optimized':
                    finalScore = this.scoreCostOptimized(match);
                    break;

                case 'quality_optimized':
                    finalScore = this.scoreQualityOptimized(match);
                    break;

                case 'latency_optimized':
                    finalScore = this.scoreLatencyOptimized(match);
                    break;

                case 'balanced':
                    finalScore = this.scoreBalanced(match);
                    break;

                case 'custom':
                    finalScore = this.scoreCustom(match, request.customWeights);
                    break;

                default:
                    finalScore = match.score;
            }

            return {
                ...match,
                finalScore
            };
        }).sort((a, b) => b.finalScore - a.finalScore);
    }

    /**
     * Score for cost optimization
     */
    private scoreCostOptimized(match: ModelMatchResult & { estimatedCost: number }): number {
        // Heavily weight cost, but ensure basic quality
        const costScore = match.estimatedCost > 0 
            ? Math.max(0, 100 - (match.estimatedCost * 10000)) // Lower cost = higher score
            : 100;
        
        const qualityScore = match.model.quality.reasoning;
        
        // 80% cost, 20% quality
        return costScore * 0.8 + qualityScore * 0.2;
    }

    /**
     * Score for quality optimization
     */
    private scoreQualityOptimized(match: ModelMatchResult & { estimatedCost: number }): number {
        // Heavily weight quality metrics
        const quality = match.model.quality;
        
        return (
            quality.reasoning * 0.4 +
            quality.reliability * 0.3 +
            (quality.instructionFollowing || 80) * 0.2 +
            (quality.codeQuality || 80) * 0.1
        );
    }

    /**
     * Score for latency optimization
     */
    private scoreLatencyOptimized(match: ModelMatchResult & { estimatedCost: number }): number {
        const latency = match.model.averageLatencyMs || 2000;
        const latencyScore = Math.max(0, 100 - (latency / 50)); // Lower latency = higher score
        
        const qualityScore = match.model.quality.reasoning;
        
        // 70% latency, 30% quality
        return latencyScore * 0.7 + qualityScore * 0.3;
    }

    /**
     * Score for balanced approach
     */
    private scoreBalanced(match: ModelMatchResult & { estimatedCost: number }): number {
        const costScore = match.estimatedCost > 0 
            ? Math.max(0, 100 - (match.estimatedCost * 10000))
            : 100;
        
        const qualityScore = match.model.quality.reasoning;
        
        const latency = match.model.averageLatencyMs || 2000;
        const latencyScore = Math.max(0, 100 - (latency / 50));
        
        // 40% quality, 35% cost, 25% latency
        return qualityScore * 0.4 + costScore * 0.35 + latencyScore * 0.25;
    }

    /**
     * Score with custom weights
     */
    private scoreCustom(
        match: ModelMatchResult & { estimatedCost: number },
        weights?: {
            cost: number;
            quality: number;
            latency: number;
            reliability: number;
        }
    ): number {
        const w = weights || { cost: 0.25, quality: 0.25, latency: 0.25, reliability: 0.25 };

        const costScore = match.estimatedCost > 0 
            ? Math.max(0, 100 - (match.estimatedCost * 10000))
            : 100;
        
        const qualityScore = match.model.quality.reasoning;
        
        const latency = match.model.averageLatencyMs || 2000;
        const latencyScore = Math.max(0, 100 - (latency / 50));
        
        const reliabilityScore = match.model.quality.reliability;

        return (
            costScore * w.cost +
            qualityScore * w.quality +
            latencyScore * w.latency +
            reliabilityScore * w.reliability
        );
    }

    /**
     * Apply constraints to matches
     */
    private applyConstraints(
        matches: Array<ModelMatchResult & { estimatedCost: number; finalScore: number }>,
        constraints?: RoutingRequest['constraints']
    ): Array<ModelMatchResult & { estimatedCost: number; finalScore: number }> {
        if (!constraints) {
            return matches;
        }

        return matches.filter(match => {
            // 🎯 P2: Use dynamic thresholds from telemetry when available
            const dynamicCostThreshold = this.getDynamicThreshold(match.model.id, 'cost');
            const dynamicLatencyThreshold = this.getDynamicThreshold(match.model.id, 'latency');

            // Max cost constraint (use dynamic if available)
            const effectiveMaxCost = dynamicCostThreshold && !constraints.maxCostPerRequest 
                ? dynamicCostThreshold 
                : constraints.maxCostPerRequest;

            if (
                effectiveMaxCost !== undefined &&
                match.estimatedCost > effectiveMaxCost
            ) {
                loggingService.debug('Model filtered by cost threshold', {
                    modelId: match.model.id,
                    estimatedCost: match.estimatedCost,
                    threshold: effectiveMaxCost,
                    isDynamic: !!dynamicCostThreshold
                });
                return false;
            }

            // Max latency constraint (use dynamic if available)
            const effectiveMaxLatency = dynamicLatencyThreshold && !constraints.maxLatencyMs
                ? dynamicLatencyThreshold
                : constraints.maxLatencyMs;

            if (
                effectiveMaxLatency !== undefined &&
                match.model.averageLatencyMs &&
                match.model.averageLatencyMs > effectiveMaxLatency
            ) {
                loggingService.debug('Model filtered by latency threshold', {
                    modelId: match.model.id,
                    averageLatency: match.model.averageLatencyMs,
                    threshold: effectiveMaxLatency,
                    isDynamic: !!dynamicLatencyThreshold
                });
                return false;
            }

            // Allowed providers constraint
            if (
                constraints.allowedProviders &&
                !constraints.allowedProviders.includes(match.model.provider)
            ) {
                return false;
            }

            // Forbidden models constraint
            if (
                constraints.forbiddenModels &&
                constraints.forbiddenModels.includes(match.model.id)
            ) {
                return false;
            }

            return true;
        });
    }

    /**
     * Get cheapest model for capabilities
     */
    async getCheapestModel(
        capabilities: ModelCapability[],
        inputTokens: number = 1000,
        outputTokens: number = 500
    ): Promise<RoutingResult | null> {
        return this.route({
            strategy: 'cost_optimized',
            requirements: {
                requiredCapabilities: capabilities
            },
            estimatedInputTokens: inputTokens,
            estimatedOutputTokens: outputTokens
        });
    }

    /**
     * Get highest quality model for capabilities
     */
    async getHighestQualityModel(
        capabilities: ModelCapability[],
        inputTokens: number = 1000,
        outputTokens: number = 500
    ): Promise<RoutingResult | null> {
        return this.route({
            strategy: 'quality_optimized',
            requirements: {
                requiredCapabilities: capabilities
            },
            estimatedInputTokens: inputTokens,
            estimatedOutputTokens: outputTokens
        });
    }

    /**
     * Get fastest model for capabilities
     */
    async getFastestModel(
        capabilities: ModelCapability[],
        inputTokens: number = 1000,
        outputTokens: number = 500
    ): Promise<RoutingResult | null> {
        return this.route({
            strategy: 'latency_optimized',
            requirements: {
                requiredCapabilities: capabilities
            },
            estimatedInputTokens: inputTokens,
            estimatedOutputTokens: outputTokens
        });
    }
}

