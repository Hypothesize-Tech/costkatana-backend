import { Injectable, Logger } from '@nestjs/common';
import { PromptTemplateDocument } from '../../../schemas/prompt/prompt-template.schema';
import { estimateTokens } from '../../../utils/tokenCounter';
import { AWS_BEDROCK_PRICING } from '../../../utils/pricing/aws-bedrock';
import { ANTHROPIC_PRICING } from '../../../utils/pricing/anthropic';
import { OPENAI_PRICING } from '../../../utils/pricing/openai';
import { GOOGLE_PRICING } from '../../../utils/pricing/google';
import { ModelPricing } from '../../../utils/pricing/types';

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

@Injectable()
export class ModelRecommendationService {
  private readonly logger = new Logger(ModelRecommendationService.name);

  // Consolidated pricing from all sources
  private static readonly ALL_MODEL_PRICING = [
    ...AWS_BEDROCK_PRICING,
    ...ANTHROPIC_PRICING,
    ...OPENAI_PRICING,
    ...GOOGLE_PRICING,
  ];

  // Deprecated/unavailable models to exclude
  private static readonly DEPRECATED_MODELS = [
    'ai21.jamba-instruct-v1:0', // End of life
  ];

  // Static properties
  private static EXTENDED_MODEL_PRICING: ExtendedModelPricing[];
  private static MODEL_PRICING_MAP: Record<string, ExtendedModelPricing>;

  constructor() {
    // Initialize static properties on first instantiation
    if (!ModelRecommendationService.EXTENDED_MODEL_PRICING) {
      ModelRecommendationService.initializeStaticProperties();
    }
  }

  private static initializeStaticProperties(): void {
    this.EXTENDED_MODEL_PRICING = this.ALL_MODEL_PRICING.filter((model) =>
      this.isModelAvailable(model.modelId),
    ).map((model) => ({
      ...model,
      tier: this.classifyModelTier(model),
    }));

    this.MODEL_PRICING_MAP = this.EXTENDED_MODEL_PRICING.reduce(
      (acc, model) => {
        acc[model.modelId] = model;
        return acc;
      },
      {} as Record<string, ExtendedModelPricing>,
    );
  }

  // Helper to classify models by tier based on pricing
  private static classifyModelTier(
    model: ModelPricing,
  ): ExtendedModelPricing['tier'] {
    const avgPrice = (model.inputPrice + model.outputPrice) / 2;

    // Vision/multimodal models
    if (
      model.capabilities?.includes('vision') ||
      model.capabilities?.includes('multimodal')
    ) {
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

  // Baseline models for cost comparison
  private static readonly BASELINE_MODELS = {
    default: 'claude-3-sonnet-20240229',
    vision: 'claude-3-haiku-20240307',
  };

  /**
   * Analyze template characteristics
   */
  analyzeTemplate(template: PromptTemplateDocument): TemplateAnalysis {
    // Estimate tokens
    const estimatedTokens = estimateTokens(template.content);

    // Check for image variables
    const hasImageVariables =
      template.variables?.some((v: any) => v.type === 'image') || false;

    // Determine complexity
    let complexity: TemplateAnalysis['complexity'] = 'simple';
    if (estimatedTokens > 2000) complexity = 'complex';
    else if (estimatedTokens > 500) complexity = 'moderate';
    if (hasImageVariables) complexity = 'advanced';

    // Check for reasoning requirements (based on keywords)
    const reasoningKeywords = [
      'analyze',
      'compare',
      'evaluate',
      'reason',
      'think',
      'decide',
    ];
    const requiresReasoning = reasoningKeywords.some((keyword) =>
      template.content.toLowerCase().includes(keyword),
    );

    return {
      estimatedTokens,
      complexity,
      requiresVision: hasImageVariables,
      requiresReasoning,
      category: template.category || 'general',
      hasImageVariables,
    };
  }

  /**
   * Calculate baseline cost for comparison
   */
  calculateBaselineCost(template: PromptTemplateDocument): number {
    const analysis = this.analyzeTemplate(template);
    const baselineModel = this.getModelPricing(
      ModelRecommendationService.BASELINE_MODELS.default,
    );

    if (!baselineModel) return 0;

    const inputCost =
      (analysis.estimatedTokens * baselineModel.inputPrice) /
      this.getTokenMultiplier(baselineModel);
    const outputCost =
      (analysis.estimatedTokens * 0.3 * baselineModel.outputPrice) /
      this.getTokenMultiplier(baselineModel); // Assume 30% output

    return inputCost + outputCost;
  }

  /**
   * Recommend the best model for a template
   */
  recommendModel(template: PromptTemplateDocument): ModelRecommendation | null {
    const analysis = this.analyzeTemplate(template);

    // Get all available models
    const availableModels = this.getAllModels();

    if (availableModels.length === 0) {
      this.logger.warn('No models available for recommendation');
      return null;
    }

    // Score each model
    const scoredModels = availableModels.map((model) => ({
      model,
      score: this.scoreModelForTemplate(model, analysis),
      estimatedCost: this.calculateCost(template, model),
    }));

    // Sort by score (descending)
    scoredModels.sort((a, b) => b.score - a.score);

    const bestModel = scoredModels[0];
    const reasoning = this.generateReasoning(bestModel.model, analysis);

    return {
      modelId: bestModel.model.modelId,
      provider: bestModel.model.provider,
      reasoning,
      estimatedCost: bestModel.estimatedCost,
      tier: bestModel.model.tier,
      confidence: Math.min(bestModel.score / 100, 1), // Normalize to 0-1
    };
  }

  /**
   * Get all available models
   */
  getAllModels(): ExtendedModelPricing[] {
    return ModelRecommendationService.EXTENDED_MODEL_PRICING || [];
  }

  /**
   * Get provider for a model ID
   */
  getProviderForModel(modelId: string): string {
    const model = ModelRecommendationService.MODEL_PRICING_MAP[modelId];
    return model?.provider || 'Unknown';
  }

  // Private helper methods

  private getModelPricing(modelId: string): ExtendedModelPricing | null {
    return ModelRecommendationService.MODEL_PRICING_MAP?.[modelId] || null;
  }

  private getTokenMultiplier(model: ModelPricing): number {
    switch (model.unit) {
      case 'PER_1K_TOKENS':
        return 1000;
      case 'PER_1M_TOKENS':
        return 1000000;
      default:
        return 1000; // Default to per 1K tokens
    }
  }

  private scoreModelForTemplate(
    model: ExtendedModelPricing,
    analysis: TemplateAnalysis,
  ): number {
    let score = 50; // Base score

    // Complexity matching
    if (analysis.complexity === 'simple' && model.tier === 'ultra-cheap')
      score += 20;
    if (analysis.complexity === 'moderate' && model.tier === 'balanced')
      score += 20;
    if (analysis.complexity === 'complex' && model.tier === 'premium')
      score += 20;
    if (analysis.complexity === 'advanced' && model.tier === 'specialized')
      score += 20;

    // Vision capability matching
    if (analysis.requiresVision && model.capabilities?.includes('vision'))
      score += 30;
    if (analysis.requiresVision && !model.capabilities?.includes('vision'))
      score -= 50;

    // Context window adequacy
    if (
      model.contextWindow &&
      model.contextWindow >= analysis.estimatedTokens * 2
    )
      score += 10;

    // Category preference (some models work better for specific categories)
    if (analysis.category === 'coding' && model.capabilities?.includes('code'))
      score += 10;
    if (
      analysis.category === 'creative' &&
      model.capabilities?.includes('creative')
    )
      score += 10;

    return Math.max(0, Math.min(100, score));
  }

  private calculateCost(
    template: PromptTemplateDocument,
    model: ExtendedModelPricing,
  ): number {
    const analysis = this.analyzeTemplate(template);
    const multiplier = this.getTokenMultiplier(model);

    const inputCost =
      (analysis.estimatedTokens * model.inputPrice) / multiplier;
    const outputCost =
      (analysis.estimatedTokens * 0.3 * model.outputPrice) / multiplier; // Assume 30% output ratio

    return inputCost + outputCost;
  }

  private generateReasoning(
    model: ExtendedModelPricing,
    analysis: TemplateAnalysis,
  ): string {
    const reasons = [];

    if (analysis.complexity === 'simple' && model.tier === 'ultra-cheap') {
      reasons.push('Cost-effective for simple templates');
    }

    if (analysis.requiresVision && model.capabilities?.includes('vision')) {
      reasons.push('Supports image/vision capabilities');
    }

    if (
      model.contextWindow &&
      model.contextWindow >= analysis.estimatedTokens * 2
    ) {
      reasons.push('Sufficient context window for template size');
    }

    if (
      analysis.category === 'coding' &&
      model.capabilities?.includes('code')
    ) {
      reasons.push('Optimized for coding tasks');
    }

    if (reasons.length === 0) {
      reasons.push('General purpose model suitable for this template');
    }

    return reasons.join('. ') + '.';
  }
}
