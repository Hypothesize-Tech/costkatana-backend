/**
 * Model Recommendation Service
 * Provides intelligent model selection based on template characteristics
 */

import { IPromptTemplate } from '../models/PromptTemplate';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types';
import { loggingService } from './logging.service';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { ANTHROPIC_PRICING } from '../utils/pricing/anthropic';
import { OPENAI_PRICING } from '../utils/pricing/openai';
import { GOOGLE_PRICING } from '../utils/pricing/google';
import { ModelPricing } from '../utils/pricing/types';

// Extended model info with tier classification
interface ExtendedModelPricing extends ModelPricing {
    tier: 'ultra-cheap' | 'balanced' | 'premium' | 'specialized';
}

export interface ModelRecommendation {
    modelId: string;
    provider: string;
    reasoning: string;
    estimatedCost: number;
    tier: 'ultra-cheap' | 'balanced' | 'premium' | 'specialized';
    confidence: number;
}

export interface TemplateAnalysis {
    estimatedTokens: number;
    complexity: 'simple' | 'moderate' | 'complex' | 'advanced';
    requiresVision: boolean;
    requiresReasoning: boolean;
    category: string;
    hasImageVariables: boolean;
}

export class ModelRecommendationService {
    // Consolidated pricing from all sources
    private static readonly ALL_MODEL_PRICING = [
        ...AWS_BEDROCK_PRICING,
        ...ANTHROPIC_PRICING,
        ...OPENAI_PRICING,
        ...GOOGLE_PRICING
    ];

    // Deprecated/unavailable models to exclude
    private static readonly DEPRECATED_MODELS = [
        'ai21.jamba-instruct-v1:0', // End of life
    ];

    // Helper to classify models by tier based on pricing
    private static classifyModelTier(model: ModelPricing): ExtendedModelPricing['tier'] {
        const avgPrice = (model.inputPrice + model.outputPrice) / 2;
        
        // Vision/multimodal models
        if (model.capabilities?.includes('vision') || model.capabilities?.includes('multimodal')) {
            return 'specialized';
        }
        
        // Price-based classification
        if (avgPrice < 0.5) return 'ultra-cheap';
        if (avgPrice < 3.0) return 'balanced';
        return 'premium';
    }

    // Helper to check if model is available
    private static isModelAvailable(modelId: string): boolean {
        return !this.DEPRECATED_MODELS.includes(modelId);
    }

    // Create extended models with tier classification (excluding deprecated models)
    private static readonly EXTENDED_MODEL_PRICING: ExtendedModelPricing[] = this.ALL_MODEL_PRICING
        .filter(model => this.isModelAvailable(model.modelId))
        .map(model => ({
            ...model,
            tier: this.classifyModelTier(model)
        }));

    // Create a map for quick lookups
    private static readonly MODEL_PRICING_MAP = this.EXTENDED_MODEL_PRICING.reduce((acc, model) => {
        acc[model.modelId] = model;
        return acc;
    }, {} as Record<string, ExtendedModelPricing>);

    // Baseline models for cost comparison
    private static readonly BASELINE_MODELS = {
        default: 'gpt-4',
        vision: 'gpt-4-vision-preview'
    };

    /**
     * Analyze template characteristics
     */
    static analyzeTemplate(template: IPromptTemplate): TemplateAnalysis {
        // Estimate tokens
        const estimatedTokens = estimateTokens(template.content, AIProvider.Anthropic);
        
        // Check for image variables
        const hasImageVariables = (template.variables?.some(v => v.type === 'image')) ?? false;
        
        // Determine complexity based on multiple factors
        const complexity = this.determineComplexity(template, estimatedTokens);
        
        // Check if requires vision
        const requiresVision = hasImageVariables || (template.isVisualCompliance ?? false);
        
        // Check if requires reasoning (based on category and content)
        const requiresReasoning = this.requiresReasoning(template);
        
        return {
            estimatedTokens,
            complexity,
            requiresVision,
            requiresReasoning,
            category: template.category ?? 'general',
            hasImageVariables
        };
    }

    /**
     * Determine template complexity
     */
    private static determineComplexity(
        template: IPromptTemplate,
        tokenCount: number
    ): 'simple' | 'moderate' | 'complex' | 'advanced' {
        let complexityScore = 0;
        
        // Token count factor
        if (tokenCount < 100) complexityScore += 1;
        else if (tokenCount < 500) complexityScore += 2;
        else if (tokenCount < 1000) complexityScore += 3;
        else complexityScore += 4;
        
        // Category factor
        const complexCategories = ['coding', 'analysis', 'business'];
        if (template.category && complexCategories.includes(template.category)) {
            complexityScore += 1;
        }
        
        // Content analysis - look for indicators of complexity
        const content = template.content.toLowerCase();
        if (content.includes('analyze') || content.includes('evaluate')) complexityScore += 1;
        if (content.includes('code') || content.includes('function')) complexityScore += 1;
        if (content.includes('compare') || content.includes('contrast')) complexityScore += 1;
        if (content.includes('step by step') || content.includes('detailed')) complexityScore += 1;
        
        // Variable complexity
        if (template.variables && template.variables.length > 5) complexityScore += 1;
        
        // Map score to complexity level
        if (complexityScore <= 2) return 'simple';
        if (complexityScore <= 4) return 'moderate';
        if (complexityScore <= 6) return 'complex';
        return 'advanced';
    }

    /**
     * Check if template requires reasoning capabilities
     */
    private static requiresReasoning(template: IPromptTemplate): boolean {
        const content = template.content.toLowerCase();
        const reasoningKeywords = [
            'analyze', 'evaluate', 'compare', 'reason', 'explain',
            'why', 'how', 'logic', 'deduce', 'infer', 'conclude'
        ];
        
        return reasoningKeywords.some(keyword => content.includes(keyword));
    }

    /**
     * Recommend best model for template
     */
    static async recommendModel(
        template: IPromptTemplate,
        userPreferences?: {
            preferredProvider?: string;
            maxCostPerRequest?: number;
            prioritize?: 'cost' | 'quality' | 'speed';
        }
    ): Promise<ModelRecommendation> {
        try {
            // Analyze template
            const analysis = this.analyzeTemplate(template);
            
            loggingService.debug('Template analysis for recommendation', {
                templateId: String(template._id),
                analysis
            });
            
            // Get model candidates based on analysis
            const candidates = this.getModelCandidates(analysis, userPreferences);
            
            // Score and rank candidates
            const rankedModels = this.rankModels(candidates, analysis, userPreferences);
            
            // Select best model
            const bestModel = rankedModels[0];
            
            return bestModel;
        } catch (error) {
            loggingService.error('Error recommending model', {
                error: error instanceof Error ? error.message : String(error),
                templateId: String(template._id)
            });
            
            // Return safe default
            return {
                modelId: 'amazon.nova-lite-v1:0',
                provider: 'AWS Bedrock',
                reasoning: 'Default balanced model selected due to recommendation error',
                estimatedCost: 0.001,
                tier: 'balanced',
                confidence: 0.5
            };
        }
    }

    /**
     * Get candidate models based on analysis
     */
    private static getModelCandidates(
        analysis: TemplateAnalysis,
        userPreferences?: {
            preferredProvider?: string;
            maxCostPerRequest?: number;
        }
    ): string[] {
        let candidates: string[] = [];
        
        // If requires vision, only use vision models
        if (analysis.requiresVision) {
            candidates = this.EXTENDED_MODEL_PRICING
                .filter(model => model.capabilities?.includes('vision') || model.capabilities?.includes('multimodal'))
                .map(model => model.modelId);
        } else {
            // Select based on complexity
            switch (analysis.complexity) {
                case 'simple':
                    candidates = this.EXTENDED_MODEL_PRICING
                        .filter(model => model.tier === 'ultra-cheap')
                        .map(model => model.modelId);
                    break;
                case 'moderate':
                    candidates = this.EXTENDED_MODEL_PRICING
                        .filter(model => model.tier === 'balanced' || model.tier === 'ultra-cheap')
                        .map(model => model.modelId);
                    break;
                case 'complex':
                    candidates = this.EXTENDED_MODEL_PRICING
                        .filter(model => model.tier === 'premium' || model.tier === 'balanced')
                        .map(model => model.modelId);
                    break;
                case 'advanced':
                    candidates = this.EXTENDED_MODEL_PRICING
                        .filter(model => model.tier === 'premium')
                        .map(model => model.modelId);
                    break;
            }
        }
        
        // Filter by user preferences
        if (userPreferences?.preferredProvider) {
            candidates = candidates.filter(modelId => {
                const model = this.MODEL_PRICING_MAP[modelId];
                return model?.provider === userPreferences.preferredProvider;
            });
        }
        
        // Filter by max cost if specified
        if (userPreferences?.maxCostPerRequest) {
            candidates = candidates.filter(modelId => {
                const model = this.MODEL_PRICING_MAP[modelId];
                if (!model || !userPreferences.maxCostPerRequest) return false;
                const estimatedCost = (model.inputPrice + model.outputPrice) / 1000; // Rough estimate
                return estimatedCost <= userPreferences.maxCostPerRequest;
            });
        }
        
        // Ensure we have at least one candidate
        if (candidates.length === 0) {
            candidates = ['amazon.nova-lite-v1:0'];
        }
        
        return candidates;
    }

    /**
     * Rank models based on analysis and preferences
     */
    private static rankModels(
        candidates: string[],
        analysis: TemplateAnalysis,
        userPreferences?: {
            prioritize?: 'cost' | 'quality' | 'speed';
        }
    ): ModelRecommendation[] {
        const recommendations: ModelRecommendation[] = [];
        
        for (const modelId of candidates) {
            const model = this.MODEL_PRICING_MAP[modelId];
            if (!model) continue;
            
            // Calculate estimated cost
            const estimatedCost = this.calculateEstimatedCost(
                analysis.estimatedTokens,
                modelId
            );
            
            // Calculate confidence score
            const confidence = this.calculateConfidence(
                modelId,
                analysis,
                userPreferences
            );
            
            // Generate reasoning
            const reasoning = this.generateReasoning(modelId, analysis, model);
            
            recommendations.push({
                modelId,
                provider: model.provider,
                reasoning,
                estimatedCost,
                tier: model.tier,
                confidence
            });
        }
        
        // Sort by confidence (higher is better)
        recommendations.sort((a, b) => b.confidence - a.confidence);
        
        return recommendations;
    }

    /**
     * Calculate estimated cost for a model
     */
    private static calculateEstimatedCost(
        estimatedTokens: number,
        modelId: string
    ): number {
        const model = this.MODEL_PRICING_MAP[modelId];
        if (!model) return 0.001;
        
        // Assume 50/50 split between input and output for estimation
        const inputTokens = estimatedTokens * 0.5;
        const outputTokens = estimatedTokens * 0.5;
        
        const inputCost = (inputTokens / 1_000_000) * model.inputPrice;
        const outputCost = (outputTokens / 1_000_000) * model.outputPrice;
        
        return inputCost + outputCost;
    }

    /**
     * Calculate confidence score for a model recommendation
     */
    private static calculateConfidence(
        modelId: string,
        analysis: TemplateAnalysis,
        userPreferences?: {
            prioritize?: 'cost' | 'quality' | 'speed';
        }
    ): number {
        let confidence = 0.5; // Base confidence
        
        const model = this.MODEL_PRICING_MAP[modelId];
        if (!model) return 0.3;
        
        // Complexity match
        if (analysis.complexity === 'simple' && model.tier === 'ultra-cheap') confidence += 0.3;
        if (analysis.complexity === 'moderate' && model.tier === 'balanced') confidence += 0.3;
        if (analysis.complexity === 'complex' && model.tier === 'premium') confidence += 0.25;
        if (analysis.complexity === 'advanced' && model.tier === 'premium') confidence += 0.3;
        
        // Vision requirements match
        if (analysis.requiresVision && (model.capabilities?.includes('vision') || model.capabilities?.includes('multimodal'))) confidence += 0.2;
        
        // User preference alignment
        if (userPreferences?.prioritize === 'cost' && model.tier === 'ultra-cheap') confidence += 0.15;
        if (userPreferences?.prioritize === 'quality' && model.tier === 'premium') confidence += 0.15;
        
        return Math.min(confidence, 1.0);
    }

    /**
     * Generate reasoning for model recommendation
     */
    private static generateReasoning(
        modelId: string,
        analysis: TemplateAnalysis,
        model: ExtendedModelPricing
    ): string {
        const reasons: string[] = [];
        
        // Complexity-based reasoning
        if (analysis.complexity === 'simple') {
            reasons.push('Template has low complexity');
        } else if (analysis.complexity === 'advanced') {
            reasons.push('Template requires advanced reasoning');
        }
        
        // Token-based reasoning
        if (analysis.estimatedTokens < 200) {
            reasons.push('Short prompt benefits from fast models');
        } else if (analysis.estimatedTokens > 1000) {
            reasons.push('Long prompt requires capable model');
        } else {
            reasons.push('Standard token length');
        }
        
        // Vision reasoning
        if (analysis.requiresVision) {
            reasons.push('Vision capabilities required');
        }
        
        // Tier reasoning
        if (model.tier === 'ultra-cheap') {
            reasons.push('Most cost-effective option');
        } else if (model.tier === 'premium') {
            reasons.push('Best quality for complex tasks');
        } else if (model.tier === 'balanced') {
            reasons.push('Optimal balance of cost and quality');
        }
        
        return reasons.join('. ') + '.';
    }

    /**
     * Get provider name for a model
     */
    static getProviderForModel(modelId: string): string {
        const model = this.MODEL_PRICING_MAP[modelId];
        return model?.provider || 'Unknown';
    }

    /**
     * Calculate baseline cost for comparison
     */
    static calculateBaselineCost(
        estimatedTokens: number,
        requiresVision: boolean = false
    ): number {
        const baselineModel = requiresVision 
            ? this.BASELINE_MODELS.vision 
            : this.BASELINE_MODELS.default;
        
        return this.calculateEstimatedCost(estimatedTokens, baselineModel);
    }

    /**
     * Get all available models with pricing
     */
    static getAllModels(): Array<{
        modelId: string;
        provider: string;
        tier: string;
        pricing: { input: number; output: number };
    }> {
        return this.EXTENDED_MODEL_PRICING.map(model => ({
            modelId: model.modelId,
            provider: model.provider,
            tier: model.tier,
            pricing: {
                input: model.inputPrice,
                output: model.outputPrice
            }
        }));
    }
}
