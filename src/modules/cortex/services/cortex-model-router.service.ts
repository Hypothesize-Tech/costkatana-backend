/**
 * Cortex Model Router Service (NestJS)
 *
 * Intelligently routes Cortex processing requests to the most appropriate models
 * based on complexity analysis, cost constraints, user preferences, and real-time latency.
 * Implements adaptive routing for optimal performance and cost efficiency.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CortexCoreService } from './cortex-core.service';
import { CortexVocabularyService } from './cortex-vocabulary.service';
import { CortexCacheService } from './cortex-cache.service';
import { AIRouterService } from './ai-router.service';
import { LatencyRouterService } from '../../utils/services/latency-router.service';
import { TelemetryService } from '../../utils/services/telemetry.service'; // Cortex routing telemetry (performance metrics)

export interface PromptComplexityAnalysis {
  overallComplexity: 'simple' | 'medium' | 'complex' | 'expert';
  factors: {
    length: number;
    technicalTerms: number;
    entities: number;
    relationships: number;
    abstractConcepts: number;
    multiStep: boolean;
    domainSpecific: boolean;
  };
  confidence: number;
  estimatedProcessingTime: number;
  recommendedTier: 'fast' | 'balanced' | 'premium' | 'expert';
}

export interface ModelTier {
  name: string;
  models: {
    encoder: string;
    core: string;
    decoder: string;
  };
  characteristics: {
    speed: 'very_fast' | 'fast' | 'medium' | 'slow';
    quality: 'basic' | 'good' | 'high' | 'premium';
    cost: 'very_low' | 'low' | 'medium' | 'high';
    capabilities: string[];
  };
  suitableFor: string[];
  maxComplexity: 'simple' | 'medium' | 'complex' | 'expert';
}

export interface RoutingDecision {
  selectedTier: ModelTier;
  reasoning: string;
  confidence: number;
  costEstimate: {
    tokens: number;
    estimatedCost: number;
    tier: string;
  };
}

export interface RoutingPreferences {
  priority: 'cost' | 'speed' | 'quality' | 'balanced';
  maxCostPerRequest?: number;
  maxProcessingTime?: number;
  preferredModels?: {
    encoder?: string;
    core?: string;
    decoder?: string;
  };
}

// Model tier definitions
const MODEL_TIERS: Record<string, ModelTier> = {
  fast: {
    name: 'Fast Tier',
    models: {
      encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      core: 'anthropic.claude-opus-4-1-20250805-v1:0',
      decoder: 'mistral.mistral-large-3-675b-instruct',
    },
    characteristics: {
      speed: 'very_fast',
      quality: 'good',
      cost: 'very_low',
      capabilities: [
        'basic_optimization',
        'simple_compression',
        'pattern_recognition',
      ],
    },
    suitableFor: [
      'Simple queries',
      'Basic transformations',
      'Quick compressions',
      'Repetitive tasks',
      'High-volume processing',
    ],
    maxComplexity: 'simple',
  },

  balanced: {
    name: 'Balanced Tier',
    models: {
      encoder: 'amazon.nova-pro-v1:0',
      core: 'anthropic.claude-opus-4-1-20250805-v1:0',
      decoder: 'amazon.nova-pro-v1:0',
    },
    characteristics: {
      speed: 'fast',
      quality: 'high',
      cost: 'low',
      capabilities: [
        'advanced_optimization',
        'semantic_compression',
        'context_analysis',
        'multi_step_reasoning',
        'technical_processing',
      ],
    },
    suitableFor: [
      'Standard queries',
      'Technical documentation',
      'Business content',
      'Multi-part requests',
      'Most general use cases',
    ],
    maxComplexity: 'medium',
  },

  premium: {
    name: 'Premium Tier',
    models: {
      encoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      core: 'anthropic.claude-opus-4-1-20250805-v1:0',
      decoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    },
    characteristics: {
      speed: 'medium',
      quality: 'premium',
      cost: 'medium',
      capabilities: [
        'complex_reasoning',
        'advanced_semantic_analysis',
        'nuanced_optimization',
        'domain_expertise',
        'creative_problem_solving',
        'code_analysis',
      ],
    },
    suitableFor: [
      'Complex technical queries',
      'Research and analysis',
      'Creative content',
      'Code optimization',
      'Domain-specific tasks',
    ],
    maxComplexity: 'complex',
  },

  expert: {
    name: 'Expert Tier',
    models: {
      encoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      core: 'anthropic.claude-opus-4-1-20250805-v1:0',
      decoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    },
    characteristics: {
      speed: 'slow',
      quality: 'premium',
      cost: 'high',
      capabilities: [
        'expert_level_reasoning',
        'advanced_multi_step_logic',
        'specialized_domain_knowledge',
        'complex_optimization_strategies',
        'research_grade_analysis',
      ],
    },
    suitableFor: [
      'Highly complex queries',
      'Research papers',
      'Advanced technical analysis',
      'Multi-domain reasoning',
      'Critical decision support',
    ],
    maxComplexity: 'expert',
  },
};

const TECHNICAL_TERMS = [
  'API',
  'SDK',
  'database',
  'algorithm',
  'framework',
  'deployment',
  'CI/CD',
  'containerization',
  'microservices',
  'kubernetes',
  'docker',
  'REST',
  'GraphQL',
  'neural network',
  'machine learning',
  'deep learning',
  'transformer',
  'LLM',
  'training',
  'inference',
  'model',
  'dataset',
  'embeddings',
  'fine-tuning',
  'ROI',
  'KPI',
  'revenue',
  'optimization',
  'analytics',
  'metrics',
  'conversion',
  'acquisition',
  'retention',
  'scalability',
  'market penetration',
  'hypothesis',
  'methodology',
  'analysis',
  'correlation',
  'statistical',
  'experimental',
  'peer review',
  'systematic',
  'empirical',
];

const COMPLEXITY_INDICATORS = {
  multiStepWords: [
    'first',
    'second',
    'then',
    'next',
    'after',
    'finally',
    'step',
    'phase',
  ],
  abstractConcepts: [
    'strategy',
    'approach',
    'methodology',
    'philosophy',
    'theory',
    'concept',
  ],
  relationshipWords: [
    'compare',
    'contrast',
    'relationship',
    'correlation',
    'depends on',
    'affects',
  ],
  domainSpecific: [
    'implement',
    'optimize',
    'configure',
    'architect',
    'design pattern',
    'best practices',
  ],
};

@Injectable()
export class CortexModelRouterService {
  private readonly logger = new Logger(CortexModelRouterService.name);

  constructor(
    private readonly cortexCoreService: CortexCoreService,
    private readonly cortexVocabularyService: CortexVocabularyService,
    private readonly cortexCacheService: CortexCacheService,
    private readonly aiRouterService: AIRouterService,
    private readonly latencyRouterService: LatencyRouterService,
    private readonly telemetryService: TelemetryService,
  ) {}

  /**
   * Analyze prompt complexity to determine appropriate model tier
   */
  public analyzePromptComplexity(prompt: string): PromptComplexityAnalysis {
    const factors = {
      length: prompt.length,
      technicalTerms: this.countTechnicalTerms(prompt),
      entities: this.countEntities(prompt),
      relationships: this.countRelationships(prompt),
      abstractConcepts: this.countAbstractConcepts(prompt),
      multiStep: this.isMultiStep(prompt),
      domainSpecific: this.isDomainSpecific(prompt),
    };

    const complexityScore = this.calculateComplexityScore(factors);
    const overallComplexity = this.determineComplexityLevel(complexityScore);
    const estimatedProcessingTime = this.estimateProcessingTime(
      complexityScore,
      factors,
    );
    const recommendedTier = this.recommendTier(overallComplexity, factors);

    return {
      overallComplexity,
      factors,
      confidence: Math.min(0.95, 0.6 + complexityScore / 200),
      estimatedProcessingTime,
      recommendedTier,
    };
  }

  /**
   * Make routing decision based on complexity analysis and user preferences
   */
  public makeRoutingDecision(
    complexity: PromptComplexityAnalysis,
    preferences: Partial<RoutingPreferences> = {},
  ): RoutingDecision {
    const defaultPreferences: RoutingPreferences = {
      priority: 'balanced',
      ...preferences,
    };

    let selectedTier = MODEL_TIERS[complexity.recommendedTier];
    selectedTier = this.applyUserPreferences(
      selectedTier,
      complexity,
      defaultPreferences,
    );

    const constraintValidation = this.validateConstraints(
      selectedTier,
      complexity,
      defaultPreferences,
    );
    if (!constraintValidation.valid) {
      throw new Error(
        `Routing constraints cannot be met: ${constraintValidation.reason}`,
      );
    }

    const costEstimate = this.estimateCost(selectedTier, complexity);
    const reasoning = this.generateReasoning(
      selectedTier,
      complexity,
      defaultPreferences,
    );

    return {
      selectedTier,
      reasoning,
      confidence: Math.min(0.95, complexity.confidence + 0.1),
      costEstimate,
    };
  }

  /**
   * Make routing decision with real-time latency consideration
   */
  public async makeRoutingDecisionWithLatency(
    complexity: PromptComplexityAnalysis,
    preferences: Partial<RoutingPreferences> = {},
  ): Promise<RoutingDecision> {
    const defaultPreferences: RoutingPreferences = {
      priority: 'balanced',
      ...preferences,
    };

    try {
      const baseDecision = this.makeRoutingDecision(
        complexity,
        defaultPreferences,
      );

      if (defaultPreferences.maxProcessingTime) {
        this.logger.log(
          `🔄 Using latency-based routing for max latency: ${defaultPreferences.maxProcessingTime}ms`,
        );

        const modelOptions = [
          {
            provider: 'anthropic',
            model: baseDecision.selectedTier.models.core,
            estimatedCost: baseDecision.costEstimate.estimatedCost,
            capabilities:
              baseDecision.selectedTier.characteristics.capabilities,
          },
        ];

        for (const [tierName, tier] of Object.entries(MODEL_TIERS)) {
          if (
            tierName !== complexity.recommendedTier &&
            this.tierCanHandle(tier, complexity)
          ) {
            const altCostEstimate = this.estimateCost(tier, complexity);
            modelOptions.push({
              provider: 'anthropic',
              model: tier.models.core,
              estimatedCost: altCostEstimate.estimatedCost,
              capabilities: tier.characteristics.capabilities,
            });
          }
        }

        const latencyDecision =
          await this.latencyRouterService.selectModelByLatency(
            defaultPreferences.maxProcessingTime,
            modelOptions,
          );

        if (latencyDecision) {
          const selectedTierEntry = Object.entries(MODEL_TIERS).find(
            ([_, tier]) => tier.models.core === latencyDecision.selectedModel,
          );

          if (selectedTierEntry) {
            const [tierName, selectedTier] = selectedTierEntry;
            const costEstimate = this.estimateCost(selectedTier, complexity);

            this.logger.log(
              `✅ Latency-based routing selected model: ${latencyDecision.selectedModel}, tier: ${tierName}`,
            );

            return {
              selectedTier,
              reasoning: `${latencyDecision.reasoning}. ${this.generateReasoning(selectedTier, complexity, defaultPreferences)}`,
              confidence: Math.min(
                0.95,
                latencyDecision.confidence * complexity.confidence,
              ),
              costEstimate,
            };
          }
        }
      }

      return baseDecision;
    } catch (error) {
      this.logger.warn(
        `Latency-based routing failed, using base decision: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.makeRoutingDecision(complexity, defaultPreferences);
    }
  }

  /**
   * Get model configuration for gateway context
   */
  public getModelConfiguration(routingDecision: RoutingDecision): {
    cortexCoreModel: string;
    cortexEncodingModel: string;
    cortexDecodingModel: string;
  } {
    return {
      cortexCoreModel: routingDecision.selectedTier.models.core,
      cortexEncodingModel: routingDecision.selectedTier.models.encoder,
      cortexDecodingModel: routingDecision.selectedTier.models.decoder,
    };
  }

  /**
   * Enhanced routing decision with actual telemetry data
   */
  public async makeRoutingDecisionWithTelemetry(
    complexity: PromptComplexityAnalysis,
    preferences: Partial<RoutingPreferences> = {},
    userId?: string,
    workspaceId?: string,
  ): Promise<RoutingDecision> {
    try {
      const recentMetrics = await this.telemetryService.getPerformanceMetrics({
        workspace_id: workspaceId,
        timeframe: '1h',
      });

      const modelOptions = [];
      for (const [tierName, tier] of Object.entries(MODEL_TIERS)) {
        const modelCostData = recentMetrics.cost_by_model?.find(
          (m: any) => m.model === tier.models.core,
        );

        const actualAvgCost =
          modelCostData && modelCostData.request_count > 0
            ? modelCostData.total_cost / modelCostData.request_count
            : this.estimateCost(tier, complexity).estimatedCost;

        modelOptions.push({
          provider: 'aws-bedrock',
          model: tier.models.core,
          estimatedCost: actualAvgCost,
          capabilities: tier.characteristics.capabilities,
        });
      }

      if (preferences.maxProcessingTime) {
        const latencyDecision =
          await this.latencyRouterService.selectModelByLatency(
            preferences.maxProcessingTime,
            modelOptions,
          );

        if (latencyDecision) {
          const selectedTierEntry = Object.entries(MODEL_TIERS).find(
            ([, tier]) => tier.models.core === latencyDecision.selectedModel,
          );

          if (selectedTierEntry) {
            const [selectedTierName, selectedTier] = selectedTierEntry;
            return {
              selectedTier,
              reasoning: `${latencyDecision.reasoning}. Selected based on actual P95 latency data, workspaceId: ${workspaceId || 'n/a'}, userId: ${userId || 'n/a'}.`,
              confidence: latencyDecision.confidence,
              costEstimate: {
                tokens: complexity.factors.length * 1.5,
                estimatedCost:
                  (latencyDecision.latencyP95 ?? 0) > 0
                    ? (modelOptions.find(
                        (m) => m.model === latencyDecision.selectedModel,
                      )?.estimatedCost ?? 0)
                    : this.estimateCost(selectedTier, complexity).estimatedCost,
                tier: selectedTierName,
              },
            };
          }
        }
      }

      const decision = this.makeRoutingDecision(complexity, preferences);

      const actualModelCost = recentMetrics.cost_by_model?.find(
        (m: any) => m.model === decision.selectedTier.models.core,
      );

      if (actualModelCost && actualModelCost.request_count > 0) {
        decision.costEstimate.estimatedCost =
          actualModelCost.total_cost / actualModelCost.request_count;
        decision.reasoning += ` (using actual cost data from telemetry, workspaceId: ${workspaceId || 'n/a'}, userId: ${userId || 'n/a'})`;
        decision.confidence = Math.min(0.95, decision.confidence + 0.1);
      }

      return decision;
    } catch (error) {
      this.logger.warn(
        `Telemetry-based routing failed, falling back to standard routing: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.makeRoutingDecision(complexity, preferences);
    }
  }

  /**
   * Get model performance metrics from telemetry
   */
  public async getModelPerformanceMetrics(
    modelId: string,
    timeframe: string = '1h',
  ): Promise<{
    avgCost: number;
    avgLatency: number;
    p95Latency: number;
    requestCount: number;
    errorRate: number;
  }> {
    try {
      const metrics = await this.telemetryService.getPerformanceMetrics({
        timeframe,
      });

      const modelSpecific = metrics.cost_by_model?.find(
        (m: any) => m.model === modelId,
      );

      return {
        avgCost: modelSpecific
          ? modelSpecific.total_cost / modelSpecific.request_count
          : 0,
        avgLatency: metrics.avg_duration_ms,
        p95Latency: metrics.p95_duration_ms,
        requestCount: modelSpecific?.request_count || 0,
        errorRate: metrics.error_rate,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get model performance metrics for ${modelId}`,
        error instanceof Error ? error.message : String(error),
      );
      return {
        avgCost: 0,
        avgLatency: 0,
        p95Latency: 0,
        requestCount: 0,
        errorRate: 0,
      };
    }
  }

  /**
   * Get tier recommendation based on user/workspace plan
   */
  public getTierRecommendationForPlan(
    planTier: 'free' | 'plus' | 'pro' | 'enterprise',
    complexity: PromptComplexityAnalysis,
  ): string {
    if (planTier === 'free') {
      return complexity.overallComplexity === 'expert' ? 'balanced' : 'fast';
    }

    if (planTier === 'plus') {
      if (complexity.overallComplexity === 'simple') return 'fast';
      if (complexity.overallComplexity === 'expert') return 'premium';
      return 'balanced';
    }

    if (planTier === 'pro') {
      if (complexity.overallComplexity === 'simple') return 'balanced';
      return complexity.overallComplexity === 'expert' ? 'expert' : 'premium';
    }

    return complexity.recommendedTier;
  }

  // Private helper methods

  private countTechnicalTerms(prompt: string): number {
    const lowercasePrompt = prompt.toLowerCase();
    return TECHNICAL_TERMS.filter((term) =>
      lowercasePrompt.includes(term.toLowerCase()),
    ).length;
  }

  private countEntities(prompt: string): number {
    const entities = prompt.match(
      /[A-Z][a-z]+|[\d,]+\.?\d*|[\d]{1,2}\/[\d]{1,2}\/[\d]{2,4}/g,
    );
    return entities ? entities.length : 0;
  }

  private countRelationships(prompt: string): number {
    const lowercasePrompt = prompt.toLowerCase();
    return COMPLEXITY_INDICATORS.relationshipWords.filter((word) =>
      lowercasePrompt.includes(word),
    ).length;
  }

  private countAbstractConcepts(prompt: string): number {
    const lowercasePrompt = prompt.toLowerCase();
    return COMPLEXITY_INDICATORS.abstractConcepts.filter((concept) =>
      lowercasePrompt.includes(concept),
    ).length;
  }

  private isMultiStep(prompt: string): boolean {
    const lowercasePrompt = prompt.toLowerCase();
    const stepIndicators = COMPLEXITY_INDICATORS.multiStepWords.filter((word) =>
      lowercasePrompt.includes(word),
    ).length;
    return stepIndicators >= 2 || prompt.split('\n').length > 3;
  }

  private isDomainSpecific(prompt: string): boolean {
    const lowercasePrompt = prompt.toLowerCase();
    return (
      COMPLEXITY_INDICATORS.domainSpecific.some((indicator) =>
        lowercasePrompt.includes(indicator),
      ) || this.countTechnicalTerms(prompt) > 2
    );
  }

  private calculateComplexityScore(factors: any): number {
    let score = 0;

    score += Math.min(20, factors.length / 50);
    score += Math.min(25, factors.technicalTerms * 3);
    score += Math.min(15, factors.entities * 2);
    score += Math.min(15, factors.relationships * 5);
    score += Math.min(15, factors.abstractConcepts * 4);

    if (factors.multiStep) score += 10;
    if (factors.domainSpecific) score += 10;

    return Math.min(100, score);
  }

  private determineComplexityLevel(
    score: number,
  ): 'simple' | 'medium' | 'complex' | 'expert' {
    if (score <= 25) return 'simple';
    if (score <= 50) return 'medium';
    if (score <= 75) return 'complex';
    return 'expert';
  }

  private estimateProcessingTime(score: number, factors: any): number {
    let baseTime = 2000;
    baseTime += score * 50;
    if (factors.multiStep) baseTime += 3000;
    if (factors.domainSpecific) baseTime += 2000;
    return Math.min(30000, baseTime);
  }

  private recommendTier(
    complexity: string,
    factors: any,
  ): 'fast' | 'balanced' | 'premium' | 'expert' {
    if (complexity === 'simple' && factors.technicalTerms <= 1) return 'fast';
    if (complexity === 'simple' || complexity === 'medium') return 'balanced';
    if (complexity === 'complex') return 'premium';
    return 'expert';
  }

  private applyUserPreferences(
    initialTier: ModelTier,
    complexity: PromptComplexityAnalysis,
    preferences: RoutingPreferences,
  ): ModelTier {
    if (preferences.preferredModels?.core) {
      const matchingTier = Object.values(MODEL_TIERS).find(
        (tier) => tier.models.core === preferences.preferredModels!.core,
      );
      if (matchingTier && this.tierCanHandle(matchingTier, complexity)) {
        return matchingTier;
      }
    }

    switch (preferences.priority) {
      case 'cost':
        for (const tierName of ['fast', 'balanced', 'premium', 'expert']) {
          const tier = MODEL_TIERS[tierName];
          if (this.tierCanHandle(tier, complexity)) {
            return tier;
          }
        }
        break;

      case 'speed':
        for (const tierName of ['fast', 'balanced', 'premium', 'expert']) {
          const tier = MODEL_TIERS[tierName];
          if (this.tierCanHandle(tier, complexity)) {
            return tier;
          }
        }
        break;

      case 'quality':
        for (const tierName of ['expert', 'premium', 'balanced', 'fast']) {
          const tier = MODEL_TIERS[tierName];
          if (this.tierCanHandle(tier, complexity)) {
            return tier;
          }
        }
        break;
    }

    return initialTier;
  }

  private tierCanHandle(
    tier: ModelTier,
    complexity: PromptComplexityAnalysis,
  ): boolean {
    const complexityOrder = ['simple', 'medium', 'complex', 'expert'];
    const tierMax = complexityOrder.indexOf(tier.maxComplexity);
    const promptComplexity = complexityOrder.indexOf(
      complexity.overallComplexity,
    );
    return tierMax >= promptComplexity;
  }

  private validateConstraints(
    tier: ModelTier,
    complexity: PromptComplexityAnalysis,
    preferences: RoutingPreferences,
  ): { valid: boolean; reason?: string } {
    if (preferences.maxCostPerRequest) {
      const estimatedCost = this.estimateCost(tier, complexity);
      if (estimatedCost.estimatedCost > preferences.maxCostPerRequest) {
        return {
          valid: false,
          reason: `Cost constraint exceeded: ${estimatedCost.estimatedCost} > ${preferences.maxCostPerRequest}`,
        };
      }
    }

    if (
      preferences.maxProcessingTime &&
      complexity.estimatedProcessingTime > preferences.maxProcessingTime
    ) {
      return {
        valid: false,
        reason: `Time constraint exceeded: ${complexity.estimatedProcessingTime}ms > ${preferences.maxProcessingTime}ms`,
      };
    }

    return { valid: true };
  }

  private estimateCost(
    tier: ModelTier,
    complexity: PromptComplexityAnalysis,
  ): {
    tokens: number;
    estimatedCost: number;
    tier: string;
  } {
    const estimatedTokens = (complexity.factors.length / 4) * 1.2;

    const costPer1K = {
      very_low: 0.0005,
      low: 0.002,
      medium: 0.015,
      high: 0.025,
    };

    const unitCost = costPer1K[tier.characteristics.cost] || 0.015;
    const estimatedCost = (estimatedTokens / 1000) * unitCost;

    return {
      tokens: Math.ceil(estimatedTokens),
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      tier: tier.name,
    };
  }

  private generateReasoning(
    tier: ModelTier,
    complexity: PromptComplexityAnalysis,
    preferences: RoutingPreferences,
  ): string {
    const reasons = [];

    reasons.push(
      `Selected ${tier.name} for ${complexity.overallComplexity} complexity prompt`,
    );
    reasons.push(
      `Complexity score: ${Math.round((complexity.confidence - 0.6) * 200)}/100`,
    );

    if (complexity.factors.technicalTerms > 0) {
      reasons.push(
        `${complexity.factors.technicalTerms} technical terms detected`,
      );
    }

    if (complexity.factors.multiStep) {
      reasons.push('Multi-step processing required');
    }

    if (preferences.priority !== 'balanced') {
      reasons.push(`Optimized for ${preferences.priority}`);
    }

    return reasons.join('. ');
  }

  /**
   * Get circuit breaker state for a provider
   */
  public getCircuitBreakerState(
    provider: string,
    model?: string,
  ): 'closed' | 'open' | 'half-open' {
    const modelToCheck =
      model || 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';
    const state = this.latencyRouterService.getCircuitBreakerState(
      provider,
      modelToCheck,
    );
    return state.toLowerCase() as 'closed' | 'open' | 'half-open';
  }
}
