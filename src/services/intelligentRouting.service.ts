/**
 * Intelligent Routing Service
 * Automatically routes AI requests to the best provider based on CPI scores
 */

import { loggingService } from './logging.service';
import { CPIService } from './cpi.service';
import { 
    CPIRoutingDecision, 
    CPIOptimizationStrategy, 
    CPICalculationInput,
    CPIMetrics 
} from '../types/cpi.types';
import { getModelPricing } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';

export class IntelligentRoutingService {
    private static routingCache = new Map<string, CPIRoutingDecision>();
    private static cacheTTL = 2 * 60 * 1000; // 2 minutes

    /**
     * Get intelligent routing decision for a request
     */
    static async getRoutingDecision(
        request: any,
        strategy: CPIOptimizationStrategy,
        availableProviders: string[] = []
    ): Promise<CPIRoutingDecision> {
        try {
            const cacheKey = this.generateCacheKey(request, strategy);
            const cached = this.routingCache.get(cacheKey);
            
            if (cached && Date.now() - Date.now() < this.cacheTTL) {
                loggingService.debug('Returning cached routing decision', { value:  { cacheKey  } });
                return cached;
            }

            // Estimate tokens if not provided
            const promptTokens = request.promptTokens || await this.estimatePromptTokens(request);
            const completionTokens = request.completionTokens || this.estimateCompletionTokens(request);

            // Get all available models across providers
            const availableModels = await this.getAvailableModels(availableProviders);
            
            // Calculate CPI scores for all models
            const modelScores = await this.calculateAllModelScores(
                availableModels,
                {
                    promptTokens,
                    completionTokens,
                    modelId: request.model || 'auto',
                    provider: request.provider || 'auto',
                    useCase: this.detectUseCase(request),
                    qualityRequirement: this.detectQualityRequirement(request),
                    latencyRequirement: this.detectLatencyRequirement(request),
                    budgetConstraint: strategy.constraints.maxCost,
                    reliabilityRequirement: this.detectReliabilityRequirement(request)
                }
            );

            // Apply strategy-based filtering and ranking
            const filteredModels = this.applyStrategyFiltering(modelScores, strategy);
            
            // Select best model based on strategy
            const selectedModel = this.selectBestModel(filteredModels, strategy);
            
            // Generate alternatives and fallback options
            const alternatives = this.generateAlternatives(filteredModels, selectedModel);
            const fallbackOptions = this.generateFallbackOptions(filteredModels, selectedModel);

            // Create routing decision
            const decision: CPIRoutingDecision = {
                selectedProvider: selectedModel.provider,
                selectedModel: selectedModel.modelId,
                reasoning: this.generateReasoning(selectedModel, strategy, alternatives),
                alternatives,
                confidence: this.calculateConfidence(selectedModel, alternatives),
                fallbackOptions
            };

            // Cache the decision
            this.routingCache.set(cacheKey, decision);

            loggingService.info('Intelligent routing decision generated', { value:  { 
                selectedProvider: decision.selectedProvider,
                selectedModel: decision.selectedModel,
                cpiScore: selectedModel.cpiScore,
                strategy: strategy.strategy,
                alternativesCount: alternatives.length
             } });

            return decision;
        } catch (error) {
            loggingService.error('Error generating routing decision:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get available models across providers
     */
    private static async getAvailableModels(providers: string[]): Promise<Array<{
        provider: string;
        modelId: string;
        modelName: string;
        pricing: any;
    }>> {
        const models: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            pricing: any;
        }> = [];

        // Default providers if none specified
        const defaultProviders = providers.length > 0 ? providers : [
            'openai', 'anthropic', 'aws-bedrock', 'google-ai', 'cohere'
        ];

        for (const provider of defaultProviders) {
            try {
                // Get all models for this provider
                const providerModels = await this.getProviderModels(provider);
                for (const model of providerModels) {
                    const pricing = getModelPricing(provider, model.modelId);
                    if (pricing) {
                        models.push({
                            provider,
                            modelId: model.modelId,
                            modelName: model.modelName,
                            pricing
                        });
                    }
                }
            } catch (error) {
                loggingService.warn(`Failed to get models for provider ${provider}:`, { error: error instanceof Error ? error.message : String(error) });
            }
        }

        return models;
    }

    /**
     * Get models for a specific provider
     */
    private static async getProviderModels(provider: string): Promise<Array<{
        modelId: string;
        modelName: string;
    }>> {
                    try {
                // Import all pricing modules to get available models
                const pricingModules: Record<string, () => Promise<any[]>> = {
                    'openai': () => import('../utils/pricing/openai').then(m => m.OPENAI_PRICING),
                    'anthropic': () => import('../utils/pricing/anthropic').then(m => m.ANTHROPIC_PRICING),
                    'aws-bedrock': () => import('../utils/pricing/aws-bedrock').then(m => m.AWS_BEDROCK_PRICING),
                    'google-ai': () => import('../utils/pricing/google').then(m => m.GOOGLE_PRICING),
                    'cohere': () => import('../utils/pricing/cohere').then(m => m.COHERE_PRICING)
                };

                const getPricing = pricingModules[provider];
                if (!getPricing) {
                    return [];
                }

                const pricing = await getPricing();
                return pricing.map((model: any) => ({
                    modelId: model.modelId,
                    modelName: model.modelName
                }));
            } catch (error) {
                loggingService.warn(`Failed to get models for provider ${provider}:`, { error: error instanceof Error ? error.message : String(error) });
                return [];
            }
    }

    /**
     * Calculate CPI scores for all available models
     */
    private static async calculateAllModelScores(
        models: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            pricing: any;
        }>,
        input: CPICalculationInput
    ): Promise<Array<{
        provider: string;
        modelId: string;
        modelName: string;
        cpiScore: number;
        estimatedCost: number;
        estimatedLatency: number;
        metrics: CPIMetrics;
    }>> {
        const scores: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        }> = [];

        for (const model of models) {
            try {
                const metrics = await CPIService.calculateCPIMetrics(
                    model.provider,
                    model.modelId,
                    input
                );

                // Estimate cost
                const estimatedCost = this.estimateModelCost(
                    input.promptTokens,
                    input.completionTokens,
                    model.pricing
                );

                // Estimate latency (this would come from real performance data)
                const estimatedLatency = await this.estimateModelLatency(model.provider, model.modelId);

                scores.push({
                    provider: model.provider,
                    modelId: model.modelId,
                    modelName: model.modelName,
                    cpiScore: metrics.cpiScore,
                    estimatedCost,
                    estimatedLatency,
                    metrics
                });
            } catch (error) {
                loggingService.warn(`Failed to calculate CPI for ${model.provider}:${model.modelId}:`, { error: error instanceof Error ? error.message : String(error) });
            }
        }

        return scores.sort((a, b) => b.cpiScore - a.cpiScore);
    }

    /**
     * Apply strategy-based filtering to model scores
     */
    private static applyStrategyFiltering(
        modelScores: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        }>,
        strategy: CPIOptimizationStrategy
    ): Array<typeof modelScores[0]> {
        let filtered = [...modelScores];

        // Apply cost constraints
        if (strategy.constraints.maxCost) {
            filtered = filtered.filter(model => model.estimatedCost <= strategy.constraints.maxCost!);
        }

        // Apply latency constraints
        if (strategy.constraints.maxLatency) {
            filtered = filtered.filter(model => model.estimatedLatency <= strategy.constraints.maxLatency!);
        }

        // Apply quality constraints
        if (strategy.constraints.minQuality) {
            filtered = filtered.filter(model => model.metrics.qualityScore >= strategy.constraints.minQuality!);
        }

        // Apply reliability constraints
        if (strategy.constraints.minReliability) {
            filtered = filtered.filter(model => model.metrics.reliabilityScore >= strategy.constraints.minReliability!);
        }

        // Sort by strategy weights
        filtered.sort((a, b) => {
            const scoreA = this.calculateWeightedScore(a, strategy);
            const scoreB = this.calculateWeightedScore(b, strategy);
            return scoreB - scoreA;
        });

        return filtered;
    }

    /**
     * Calculate weighted score based on strategy
     */
    private static calculateWeightedScore(
        model: {
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        },
        strategy: CPIOptimizationStrategy
    ): number {
        const { cost, performance, quality, reliability } = strategy.weightings;

        // Normalize values to 0-100 scale
        const costScore = Math.max(0, 100 - (model.estimatedCost * 100)); // Lower cost = higher score
        const performanceScore = Math.max(0, 100 - (model.estimatedLatency / 100)); // Lower latency = higher score
        const qualityScore = model.metrics.qualityScore;
        const reliabilityScore = model.metrics.reliabilityScore;

        return (
            costScore * cost +
            performanceScore * performance +
            qualityScore * quality +
            reliabilityScore * reliability
        );
    }

    /**
     * Select best model based on strategy
     */
    private static selectBestModel(
        filteredModels: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        }>,
        _strategy: CPIOptimizationStrategy
    ): typeof filteredModels[0] {
        if (filteredModels.length === 0) {
            throw new Error('No models available after filtering');
        }

        // For now, return the first (highest scored) model
        // In the future, this could implement more sophisticated selection logic
        return filteredModels[0];
    }

    /**
     * Generate alternative models
     */
    private static generateAlternatives(
        modelScores: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        }>,
        selectedModel: typeof modelScores[0]
    ): Array<{
        provider: string;
        model: string;
        cpiScore: number;
        estimatedCost: number;
        estimatedLatency: number;
    }> {
        return modelScores
            .filter(model => model.provider !== selectedModel.provider || model.modelId !== selectedModel.modelId)
            .slice(0, 3) // Top 3 alternatives
            .map(model => ({
                provider: model.provider,
                model: model.modelId,
                cpiScore: model.cpiScore,
                estimatedCost: model.estimatedCost,
                estimatedLatency: model.estimatedLatency
            }));
    }

    /**
     * Generate fallback options
     */
    private static generateFallbackOptions(
        modelScores: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        }>,
        selectedModel: typeof modelScores[0]
    ): Array<{
        provider: string;
        model: string;
        trigger: 'cost' | 'performance' | 'reliability' | 'availability';
    }> {
        const fallbacks: Array<{
            provider: string;
            model: string;
            trigger: 'cost' | 'performance' | 'reliability' | 'availability';
        }> = [];

        // Cost fallback (cheaper alternative)
        const costFallback = modelScores
            .filter(model => model.estimatedCost < selectedModel.estimatedCost)
            .sort((a, b) => a.estimatedCost - b.estimatedCost)[0];
        
        if (costFallback) {
            fallbacks.push({
                provider: costFallback.provider,
                model: costFallback.modelId,
                trigger: 'cost'
            });
        }

        // Performance fallback (faster alternative)
        const performanceFallback = modelScores
            .filter(model => model.estimatedLatency < selectedModel.estimatedLatency)
            .sort((a, b) => a.estimatedLatency - b.estimatedLatency)[0];
        
        if (performanceFallback) {
            fallbacks.push({
                provider: performanceFallback.provider,
                model: performanceFallback.modelId,
                trigger: 'performance'
            });
        }

        // Reliability fallback (more reliable alternative)
        const reliabilityFallback = modelScores
            .filter(model => model.metrics.reliabilityScore > selectedModel.metrics.reliabilityScore)
            .sort((a, b) => b.metrics.reliabilityScore - a.metrics.reliabilityScore)[0];
        
        if (reliabilityFallback) {
            fallbacks.push({
                provider: reliabilityFallback.provider,
                model: reliabilityFallback.modelId,
                trigger: 'reliability'
            });
        }

        return fallbacks;
    }

    /**
     * Generate reasoning for the routing decision
     */
    private static generateReasoning(
        selectedModel: {
            provider: string;
            modelId: string;
            modelName: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        },
        _strategy: CPIOptimizationStrategy,
        alternatives: Array<{
            provider: string;
            model: string;
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
        }>
    ): string[] {
        const reasoning: string[] = [];

        reasoning.push(`Selected ${selectedModel.provider}:${selectedModel.modelName} with CPI score ${selectedModel.cpiScore}`);

        if (_strategy.strategy === 'cost_optimized') {
            reasoning.push('Strategy: Cost optimization - prioritizing lower cost models');
        } else if (_strategy.strategy === 'performance_optimized') {
            reasoning.push('Strategy: Performance optimization - prioritizing faster response times');
        } else if (_strategy.strategy === 'balanced') {
            reasoning.push('Strategy: Balanced approach - optimizing for cost-performance ratio');
        } else if (_strategy.strategy === 'reliability_optimized') {
            reasoning.push('Strategy: Reliability optimization - prioritizing stable, reliable models');
        }

        if (alternatives.length > 0) {
            const topAlternative = alternatives[0];
            reasoning.push(`Top alternative: ${topAlternative.provider}:${topAlternative.model} (CPI: ${topAlternative.cpiScore})`);
        }

        return reasoning;
    }

    /**
     * Calculate confidence in the routing decision
     */
    private static calculateConfidence(
        selectedModel: {
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
            metrics: CPIMetrics;
        },
        alternatives: Array<{
            cpiScore: number;
            estimatedCost: number;
            estimatedLatency: number;
        }>
    ): number {
        let confidence = 0.7; // Base confidence

        // Higher confidence for higher CPI scores
        if (selectedModel.cpiScore >= 80) confidence += 0.2;
        else if (selectedModel.cpiScore >= 60) confidence += 0.1;

        // Higher confidence if alternatives are significantly worse
        if (alternatives.length > 0) {
            const topAlternative = alternatives[0];
            const scoreDifference = selectedModel.cpiScore - topAlternative.cpiScore;
            if (scoreDifference > 20) confidence += 0.1;
            else if (scoreDifference > 10) confidence += 0.05;
        }

        return Math.min(1.0, confidence);
    }

    /**
     * Generate cache key for routing decisions
     */
    private static generateCacheKey(request: any, strategy: CPIOptimizationStrategy): string {
        const key = `${JSON.stringify(request)}:${JSON.stringify(strategy)}`;
        return Buffer.from(key).toString('base64').substring(0, 32);
    }

    /**
     * Estimate prompt tokens
     */
    private static async estimatePromptTokens(request: any): Promise<number> {
        if (request.prompt) {
            try {
                return await estimateTokens(request.prompt, 'openai' as any);
            } catch (error) {
                loggingService.warn('Failed to estimate prompt tokens, using fallback calculation:', { error: error instanceof Error ? error.message : String(error) });
                // Fallback: rough estimation based on character count
                return Math.ceil(request.prompt.length / 4);
            }
        }
        
        // If no prompt, estimate based on request context
        if (request.messages && Array.isArray(request.messages)) {
            const totalChars = request.messages.reduce((sum: number, msg: any) => sum + (msg.content?.length || 0), 0);
            return Math.ceil(totalChars / 4);
        }
        
        // Final fallback based on request type
        if (request.type === 'chat') return 800;
        if (request.type === 'completion') return 600;
        if (request.type === 'embedding') return 100;
        
        return 500; // Conservative default
    }

    /**
     * Estimate completion tokens
     */
    private static async estimateCompletionTokens(request: any): Promise<number> {
        if (request.maxTokens) {
            return request.maxTokens;
        }
        
        // Estimate based on prompt length and use case
        if (request.prompt) {
            const promptTokens = await this.estimatePromptTokens(request);
            const useCase = this.detectUseCase(request);
            
            // Different completion ratios based on use case
            const completionRatios: Record<string, number> = {
                'creative': 1.5,      // Creative writing tends to be longer
                'analytical': 0.8,     // Analysis tends to be concise
                'conversational': 1.2,  // Chat responses are moderate
                'code': 0.6,           // Code generation is usually shorter
                'vision': 0.4,         // Vision tasks have minimal text output
                'general': 1.0         // Default ratio
            };
            
            return Math.ceil(promptTokens * (completionRatios[useCase] || 1.0));
        }
        
        // Estimate based on request type
        if (request.type === 'chat') return 400;
        if (request.type === 'completion') return 300;
        if (request.type === 'embedding') return 0;
        
        return 300; // Conservative default
    }

    /**
     * Detect use case from request
     */
    private static detectUseCase(request: any): 'general' | 'creative' | 'analytical' | 'conversational' | 'code' | 'vision' {
        const prompt = (request.prompt || '').toLowerCase();
        
        if (prompt.includes('code') || prompt.includes('function') || prompt.includes('api')) return 'code';
        if (prompt.includes('image') || prompt.includes('vision') || prompt.includes('photo')) return 'vision';
        if (prompt.includes('analyze') || prompt.includes('data') || prompt.includes('report')) return 'analytical';
        if (prompt.includes('creative') || prompt.includes('story') || prompt.includes('art')) return 'creative';
        if (prompt.includes('chat') || prompt.includes('conversation') || prompt.includes('help')) return 'conversational';
        
        return 'general';
    }

    /**
     * Detect quality requirement from request
     */
    private static detectQualityRequirement(request: any): 'low' | 'medium' | 'high' | 'ultra' {
        // Analyze request content and context for quality indicators
        const prompt = (request.prompt || '').toLowerCase();
        const temperature = request.temperature || 0.7;
        const maxTokens = request.maxTokens || 1000;
        
        // High quality indicators
        if (prompt.includes('professional') || prompt.includes('expert') || prompt.includes('detailed') ||
            prompt.includes('comprehensive') || prompt.includes('thorough') || temperature < 0.3) {
            return 'high';
        }
        
        // Ultra quality indicators
        if (prompt.includes('research') || prompt.includes('academic') || prompt.includes('scientific') ||
            prompt.includes('analysis') || prompt.includes('investigation') || temperature < 0.1) {
            return 'ultra';
        }
        
        // Low quality indicators
        if (prompt.includes('quick') || prompt.includes('brief') || prompt.includes('simple') ||
            prompt.includes('basic') || temperature > 0.9 || maxTokens < 100) {
            return 'low';
        }
        
        return 'medium';
    }

    /**
     * Detect latency requirement from request
     */
    private static detectLatencyRequirement(request: any): 'relaxed' | 'normal' | 'strict' | 'real-time' {
        // Analyze request context for latency requirements
        const prompt = (request.prompt || '').toLowerCase();
        const headers = request.headers || {};
        const stream = request.stream || false;
        const useCase = this.detectUseCase(request);
        
        // Real-time indicators
        if (stream || prompt.includes('real-time') || prompt.includes('live') || 
            prompt.includes('instant') || prompt.includes('immediate') ||
            headers['x-costkatana-latency'] === 'real-time') {
            return 'real-time';
        }
        
        // Strict indicators
        if (prompt.includes('fast') || prompt.includes('quick') || prompt.includes('urgent') ||
            prompt.includes('time-sensitive') || useCase === 'conversational' ||
            headers['x-costkatana-latency'] === 'strict') {
            return 'strict';
        }
        
        // Relaxed indicators
        if (prompt.includes('take your time') || prompt.includes('thorough') || 
            prompt.includes('detailed') || prompt.includes('comprehensive') ||
            useCase === 'analytical' || useCase === 'creative' ||
            headers['x-costkatana-latency'] === 'relaxed') {
            return 'relaxed';
        }
        
        return 'normal';
    }

    /**
     * Detect reliability requirement from request
     */
    private static detectReliabilityRequirement(request: any): 'low' | 'medium' | 'high' | 'critical' {
        // Analyze request context for reliability requirements
        const prompt = (request.prompt || '').toLowerCase();
        const headers = request.headers || {};
        const useCase = this.detectUseCase(request);
        const qualityReq = this.detectQualityRequirement(request);
        
        // Critical reliability indicators
        if (prompt.includes('critical') || prompt.includes('production') || prompt.includes('business') ||
            prompt.includes('financial') || prompt.includes('medical') || prompt.includes('legal') ||
            prompt.includes('safety') || headers['x-costkatana-reliability'] === 'critical') {
            return 'critical';
        }
        
        // High reliability indicators
        if (prompt.includes('important') || prompt.includes('professional') || prompt.includes('official') ||
            prompt.includes('formal') || qualityReq === 'high' || qualityReq === 'ultra' ||
            headers['x-costkatana-reliability'] === 'high') {
            return 'high';
        }
        
        // Low reliability indicators
        if (prompt.includes('experimental') || prompt.includes('draft') || prompt.includes('test') ||
            prompt.includes('casual') || prompt.includes('fun') || useCase === 'creative' ||
            headers['x-costkatana-reliability'] === 'low') {
            return 'low';
        }
        
        return 'medium';
    }

    /**
     * Estimate model cost
     */
    private static estimateModelCost(promptTokens: number, completionTokens: number, pricing: any): number {
        const inputCost = (promptTokens / 1000000) * (pricing.inputPrice || 0);
        const outputCost = (completionTokens / 1000000) * (pricing.outputPrice || 0);
        return inputCost + outputCost;
    }

    /**
     * Estimate model latency based on real performance data
     */
    private static async estimateModelLatency(provider: string, modelId: string): Promise<number> {
        try {
            // Try to get real latency data from usage analytics
            const { Usage } = await import('../models/Usage');
            
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const recentLatency = await Usage.aggregate([
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
                        avgLatency: { $avg: '$responseTime' }
                    }
                }
            ]);

            if (recentLatency.length > 0 && recentLatency[0].avgLatency) {
                return recentLatency[0].avgLatency;
            }
        } catch (error) {
            loggingService.warn(`Failed to get real latency data for ${provider}:${modelId}:`, { error: error instanceof Error ? error.message : String(error) });
        }

        // Fallback: Use model specifications and provider reputation
        try {
            const { getModelPricing } = await import('../utils/pricing');
            const pricing = getModelPricing(provider, modelId);
            
            if (pricing) {
                // Estimate based on model tier and provider
                const isHighTier = modelId.includes('pro') || modelId.includes('ultra') || modelId.includes('4o');
                const isLowTier = modelId.includes('mini') || modelId.includes('lite') || modelId.includes('3.5');
                
                let baseLatency = 2000; // Default
                
                if (isHighTier) baseLatency = 1500;
                else if (isLowTier) baseLatency = 3000;
                
                // Provider-specific adjustments based on infrastructure quality
                const providerAdjustments: Record<string, number> = {
                    'openai': 0.9,      // Generally faster infrastructure
                    'anthropic': 1.0,    // Standard performance
                    'aws-bedrock': 1.1,  // Slightly slower due to AWS overhead
                    'google-ai': 0.85,   // Google's infrastructure is very fast
                    'cohere': 1.05       // Slightly slower
                };
                
                return baseLatency * (providerAdjustments[provider] || 1.0);
            }
        } catch (error) {
            loggingService.warn(`Failed to get pricing data for ${provider}:${modelId}:`, { error: error instanceof Error ? error.message : String(error) });
        }
        
        // Final fallback: conservative estimate
        return 2500;
    }

    /**
     * Clear expired cache entries
     */
    static clearExpiredCache(): void {
        const now = Date.now();
        this.routingCache.forEach((_value, key) => {
            if (now - Date.now() > this.cacheTTL) {
                this.routingCache.delete(key);
            }
        });
    }
}
