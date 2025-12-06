/**
 * Cortex Model Router Service
 * 
 * Intelligently routes Cortex processing requests to the most appropriate models
 * based on complexity analysis, cost constraints, user preferences, and real-time latency.
 * Implements adaptive routing for optimal performance and cost efficiency.
 */

import { latencyRouterService, ModelOption as LatencyModelOption } from './latencyRouter.service';
import { loggingService } from './logging.service';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

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

// ============================================================================
// MODEL TIER DEFINITIONS
// ============================================================================

const MODEL_TIERS: Record<string, ModelTier> = {
    fast: {
        name: 'Fast Tier',
        models: {
             encoder: 'anthropic.claude-3-5-haiku-20241022-v1:0',
            core: 'anthropic.claude-opus-4-1-20250805-v1:0', // Claude 4 for core processing
            decoder: 'anthropic.claude-3-5-haiku-20241022-v1:0'
        },
        characteristics: {
            speed: 'very_fast',
            quality: 'good',
            cost: 'very_low',
            capabilities: ['basic_optimization', 'simple_compression', 'pattern_recognition']
        },
        suitableFor: [
            'Simple queries', 
            'Basic transformations', 
            'Quick compressions',
            'Repetitive tasks',
            'High-volume processing'
        ],
        maxComplexity: 'simple'
    },

    balanced: {
        name: 'Balanced Tier',
        models: {
            encoder: 'amazon.nova-pro-v1:0', // Nova Pro for fast encoding
            core: 'anthropic.claude-opus-4-1-20250805-v1:0', // Claude 4 for core processing
            decoder: 'amazon.nova-pro-v1:0' // Nova Pro for fast decoding
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
                'technical_processing'
            ]
        },
        suitableFor: [
            'Standard queries',
            'Technical documentation',
            'Business content',
            'Multi-part requests',
            'Most general use cases'
        ],
        maxComplexity: 'medium'
    },

    premium: {
        name: 'Premium Tier',
        models: {
            encoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0', // Claude 3.5 Sonnet for premium encoding
            core: 'anthropic.claude-opus-4-1-20250805-v1:0', // Claude 4 for core processing
            decoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0' // Claude 3.5 Sonnet for premium decoding
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
                'code_analysis'
            ]
        },
        suitableFor: [
            'Complex technical queries',
            'Research and analysis',
            'Creative content',
            'Code optimization',
            'Domain-specific tasks'
        ],
        maxComplexity: 'complex'
    },

    expert: {
        name: 'Expert Tier',
        models: {
            encoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0', // Claude 3.5 Sonnet for premium encoding
            core: 'anthropic.claude-opus-4-1-20250805-v1:0', // Claude 4 for core processing
            decoder: 'anthropic.claude-3-5-sonnet-20240620-v1:0' // Claude 3.5 Sonnet for premium decoding
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
                'research_grade_analysis'
            ]
        },
        suitableFor: [
            'Highly complex queries',
            'Research papers',
            'Advanced technical analysis',
            'Multi-domain reasoning',
            'Critical decision support'
        ],
        maxComplexity: 'expert'
    }
};

// ============================================================================
// COMPLEXITY ANALYSIS PATTERNS
// ============================================================================

const TECHNICAL_TERMS = [
    // Programming & Development
    'API', 'SDK', 'database', 'algorithm', 'framework', 'deployment', 'CI/CD',
    'containerization', 'microservices', 'kubernetes', 'docker', 'REST', 'GraphQL',
    
    // AI & ML
    'neural network', 'machine learning', 'deep learning', 'transformer', 'LLM',
    'training', 'inference', 'model', 'dataset', 'embeddings', 'fine-tuning',
    
    // Business & Finance
    'ROI', 'KPI', 'revenue', 'optimization', 'analytics', 'metrics', 'conversion',
    'acquisition', 'retention', 'scalability', 'market penetration',
    
    // Science & Research
    'hypothesis', 'methodology', 'analysis', 'correlation', 'statistical', 
    'experimental', 'peer review', 'systematic', 'empirical'
];

const COMPLEXITY_INDICATORS = {
    multiStepWords: ['first', 'second', 'then', 'next', 'after', 'finally', 'step', 'phase'],
    abstractConcepts: ['strategy', 'approach', 'methodology', 'philosophy', 'theory', 'concept'],
    relationshipWords: ['compare', 'contrast', 'relationship', 'correlation', 'depends on', 'affects'],
    domainSpecific: ['implement', 'optimize', 'configure', 'architect', 'design pattern', 'best practices']
};

// ============================================================================
// CORTEX MODEL ROUTER SERVICE
// ============================================================================

export class CortexModelRouterService {
    private static instance: CortexModelRouterService;

    private constructor() {}

    public static getInstance(): CortexModelRouterService {
        if (!CortexModelRouterService.instance) {
            CortexModelRouterService.instance = new CortexModelRouterService();
        }
        return CortexModelRouterService.instance;
    }

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
            domainSpecific: this.isDomainSpecific(prompt)
        };

        // Calculate complexity score (0-100)
        const complexityScore = this.calculateComplexityScore(factors);
        
        // Determine overall complexity level
        const overallComplexity = this.determineComplexityLevel(complexityScore);
        
        // Estimate processing time based on complexity
        const estimatedProcessingTime = this.estimateProcessingTime(complexityScore, factors);
        
        // Recommend tier
        const recommendedTier = this.recommendTier(overallComplexity, factors);
        
        return {
            overallComplexity,
            factors,
            confidence: Math.min(0.95, 0.6 + (complexityScore / 200)), // Higher confidence for clearer cases
            estimatedProcessingTime,
            recommendedTier
        };
    }

    /**
     * Make routing decision based on complexity analysis and user preferences
     */
    public makeRoutingDecision(
        complexity: PromptComplexityAnalysis,
        preferences: Partial<RoutingPreferences> = {}
    ): RoutingDecision {
        const defaultPreferences: RoutingPreferences = {
            priority: 'balanced',
            ...preferences
        };

        // Start with recommended tier based on complexity
        let selectedTier = MODEL_TIERS[complexity.recommendedTier];
        
        // Apply user preferences
        selectedTier = this.applyUserPreferences(selectedTier, complexity, defaultPreferences);
        
        // Validate constraints - throw error if constraints can't be met
        const constraintValidation = this.validateConstraints(selectedTier, complexity, defaultPreferences);
        if (!constraintValidation.valid) {
            throw new Error(`Routing constraints cannot be met: ${constraintValidation.reason}`);
        }

        // Estimate cost
        const costEstimate = this.estimateCost(selectedTier, complexity);

        const reasoning = this.generateReasoning(selectedTier, complexity, defaultPreferences);

        return {
            selectedTier,
            reasoning,
            confidence: Math.min(0.95, complexity.confidence + 0.1),
            costEstimate
        };
    }

    /**
     * Make routing decision with real-time latency consideration
     */
    public async makeRoutingDecisionWithLatency(
        complexity: PromptComplexityAnalysis,
        preferences: Partial<RoutingPreferences> = {}
    ): Promise<RoutingDecision> {
        const defaultPreferences: RoutingPreferences = {
            priority: 'balanced',
            ...preferences
        };

        try {
            // Get base decision without latency
            const baseDecision = this.makeRoutingDecision(complexity, defaultPreferences);
            
            // If maxProcessingTime is specified, use latency-based routing
            if (defaultPreferences.maxProcessingTime) {
                loggingService.info('🔄 Using latency-based routing', {
                    maxLatency: defaultPreferences.maxProcessingTime,
                    baseTier: baseDecision.selectedTier.name
                });
                
                // Prepare model options for latency routing
                const modelOptions: LatencyModelOption[] = [
                    {
                        provider: 'anthropic',
                        model: baseDecision.selectedTier.models.core,
                        estimatedCost: baseDecision.costEstimate.estimatedCost,
                        capabilities: baseDecision.selectedTier.characteristics.capabilities
                    }
                ];
                
                // Add alternative models from other tiers
                for (const [tierName, tier] of Object.entries(MODEL_TIERS)) {
                    if (tierName !== complexity.recommendedTier && this.tierCanHandle(tier, complexity)) {
                        const altCostEstimate = this.estimateCost(tier, complexity);
                        modelOptions.push({
                            provider: 'anthropic',
                            model: tier.models.core,
                            estimatedCost: altCostEstimate.estimatedCost,
                            capabilities: tier.characteristics.capabilities
                        });
                    }
                }
                
                // Select by latency
                const latencyDecision = await latencyRouterService.selectModelByLatency(
                    defaultPreferences.maxProcessingTime,
                    modelOptions
                );
                
                if (latencyDecision) {
                    // Find the tier for the selected model
                    const selectedTierEntry = Object.entries(MODEL_TIERS).find(([_, tier]) => 
                        tier.models.core === latencyDecision.selectedModel
                    );
                    
                    if (selectedTierEntry) {
                        const [tierName, selectedTier] = selectedTierEntry;
                        const costEstimate = this.estimateCost(selectedTier, complexity);
                        
                        loggingService.info('✅ Latency-based routing selected model', {
                            model: latencyDecision.selectedModel,
                            tier: tierName,
                            latencyP95: latencyDecision.latencyP95,
                            confidence: latencyDecision.confidence
                        });
                        
                        return {
                            selectedTier,
                            reasoning: `${latencyDecision.reasoning}. ${this.generateReasoning(selectedTier, complexity, defaultPreferences)}`,
                            confidence: Math.min(0.95, latencyDecision.confidence * complexity.confidence),
                            costEstimate
                        };
                    }
                }
            }
            
            // Fallback to base decision
            return baseDecision;
            
        } catch (error) {
            loggingService.warn('Latency-based routing failed, using base decision', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to original decision
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
            cortexDecodingModel: routingDecision.selectedTier.models.decoder
        };
    }

    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================

    private countTechnicalTerms(prompt: string): number {
        const lowercasePrompt = prompt.toLowerCase();
        return TECHNICAL_TERMS.filter(term => 
            lowercasePrompt.includes(term.toLowerCase())
        ).length;
    }

    private countEntities(prompt: string): number {
        // Simple entity counting - look for proper nouns, numbers, dates
        const entities = prompt.match(/[A-Z][a-z]+|[\d,]+\.?\d*|[\d]{1,2}\/[\d]{1,2}\/[\d]{2,4}/g);
        return entities ? entities.length : 0;
    }

    private countRelationships(prompt: string): number {
        const lowercasePrompt = prompt.toLowerCase();
        return COMPLEXITY_INDICATORS.relationshipWords.filter(word =>
            lowercasePrompt.includes(word)
        ).length;
    }

    private countAbstractConcepts(prompt: string): number {
        const lowercasePrompt = prompt.toLowerCase();
        return COMPLEXITY_INDICATORS.abstractConcepts.filter(concept =>
            lowercasePrompt.includes(concept)
        ).length;
    }

    private isMultiStep(prompt: string): boolean {
        const lowercasePrompt = prompt.toLowerCase();
        const stepIndicators = COMPLEXITY_INDICATORS.multiStepWords.filter(word =>
            lowercasePrompt.includes(word)
        ).length;
        return stepIndicators >= 2 || prompt.split('\n').length > 3;
    }

    private isDomainSpecific(prompt: string): boolean {
        const lowercasePrompt = prompt.toLowerCase();
        return COMPLEXITY_INDICATORS.domainSpecific.some(indicator =>
            lowercasePrompt.includes(indicator)
        ) || this.countTechnicalTerms(prompt) > 2;
    }

    private calculateComplexityScore(factors: any): number {
        let score = 0;
        
        // Length factor (0-20 points)
        score += Math.min(20, factors.length / 50);
        
        // Technical terms (0-25 points)
        score += Math.min(25, factors.technicalTerms * 3);
        
        // Entities (0-15 points)
        score += Math.min(15, factors.entities * 2);
        
        // Relationships (0-15 points)
        score += Math.min(15, factors.relationships * 5);
        
        // Abstract concepts (0-15 points)
        score += Math.min(15, factors.abstractConcepts * 4);
        
        // Multi-step bonus (10 points)
        if (factors.multiStep) score += 10;
        
        // Domain specific bonus (10 points)
        if (factors.domainSpecific) score += 10;
        
        return Math.min(100, score);
    }

    private determineComplexityLevel(score: number): 'simple' | 'medium' | 'complex' | 'expert' {
        if (score <= 25) return 'simple';
        if (score <= 50) return 'medium';
        if (score <= 75) return 'complex';
        return 'expert';
    }

    private estimateProcessingTime(score: number, factors: any): number {
        let baseTime = 2000; // 2 seconds base
        
        baseTime += score * 50; // Add time based on complexity
        if (factors.multiStep) baseTime += 3000;
        if (factors.domainSpecific) baseTime += 2000;
        
        return Math.min(30000, baseTime); // Cap at 30 seconds
    }

    private recommendTier(complexity: string, factors: any): 'fast' | 'balanced' | 'premium' | 'expert' {
        if (complexity === 'simple' && factors.technicalTerms <= 1) return 'fast';
        if (complexity === 'simple' || complexity === 'medium') return 'balanced';
        if (complexity === 'complex') return 'premium';
        return 'expert';
    }

    private applyUserPreferences(
        initialTier: ModelTier, 
        complexity: PromptComplexityAnalysis,
        preferences: RoutingPreferences
    ): ModelTier {
        // If user has specific model preferences, check if they're valid
        if (preferences.preferredModels?.core) {
            // Find tier that matches preferred core model
            const matchingTier = Object.values(MODEL_TIERS).find(tier => 
                tier.models.core === preferences.preferredModels!.core
            );
            if (matchingTier && this.tierCanHandle(matchingTier, complexity)) {
                return matchingTier;
            }
        }

        // Apply priority-based adjustments
        switch (preferences.priority) {
            case 'cost':
                // Try to use cheaper tier if possible
                const cheaperTiers = ['fast', 'balanced', 'premium', 'expert'];
                for (const tierName of cheaperTiers) {
                    const tier = MODEL_TIERS[tierName];
                    if (this.tierCanHandle(tier, complexity)) {
                        return tier;
                    }
                }
                break;
                
            case 'speed':
                // Prefer faster tiers
                const fastTiers = ['fast', 'balanced', 'premium', 'expert'];
                for (const tierName of fastTiers) {
                    const tier = MODEL_TIERS[tierName];
                    if (this.tierCanHandle(tier, complexity)) {
                        return tier;
                    }
                }
                break;
                
            case 'quality':
                // Prefer higher quality tiers
                const qualityTiers = ['expert', 'premium', 'balanced', 'fast'];
                for (const tierName of qualityTiers) {
                    const tier = MODEL_TIERS[tierName];
                    if (this.tierCanHandle(tier, complexity)) {
                        return tier;
                    }
                }
                break;
        }

        return initialTier;
    }

    private tierCanHandle(tier: ModelTier, complexity: PromptComplexityAnalysis): boolean {
        const complexityOrder = ['simple', 'medium', 'complex', 'expert'];
        const tierMax = complexityOrder.indexOf(tier.maxComplexity);
        const promptComplexity = complexityOrder.indexOf(complexity.overallComplexity);
        
        return tierMax >= promptComplexity;
    }

    private validateConstraints(
        tier: ModelTier,
        complexity: PromptComplexityAnalysis,
        preferences: RoutingPreferences
    ): { valid: boolean; reason?: string } {
        // Check cost constraints
        if (preferences.maxCostPerRequest) {
            const estimatedCost = this.estimateCost(tier, complexity);
            if (estimatedCost.estimatedCost > preferences.maxCostPerRequest) {
                return {
                    valid: false,
                    reason: `Cost constraint exceeded: ${estimatedCost.estimatedCost} > ${preferences.maxCostPerRequest}`
                };
            }
        }

        // Check time constraints
        if (preferences.maxProcessingTime && complexity.estimatedProcessingTime > preferences.maxProcessingTime) {
            return {
                valid: false,
                reason: `Time constraint exceeded: ${complexity.estimatedProcessingTime}ms > ${preferences.maxProcessingTime}ms`
            };
        }

        return { valid: true };
    }


    private estimateCost(tier: ModelTier, complexity: PromptComplexityAnalysis): {
        tokens: number;
        estimatedCost: number;
        tier: string;
    } {
        const estimatedTokens = complexity.factors.length / 4 * 1.2; // Rough token estimation
        
        // Cost per 1K tokens (rough estimates)
        const costPer1K = {
            'very_low': 0.0005,  // Haiku
            'low': 0.002,        // Mixed
            'medium': 0.015,     // Sonnet
            'high': 0.025        // Premium Sonnet
        };
        
        const unitCost = costPer1K[tier.characteristics.cost] || 0.015;
        const estimatedCost = (estimatedTokens / 1000) * unitCost;
        
        return {
            tokens: Math.ceil(estimatedTokens),
            estimatedCost: Math.round(estimatedCost * 10000) / 10000, // Round to 4 decimals
            tier: tier.name
        };
    }

    private generateReasoning(
        tier: ModelTier,
        complexity: PromptComplexityAnalysis,
        preferences: RoutingPreferences
    ): string {
        const reasons = [];
        
        reasons.push(`Selected ${tier.name} for ${complexity.overallComplexity} complexity prompt`);
        reasons.push(`Complexity score: ${Math.round((complexity.confidence - 0.6) * 200)}/100`);
        
        if (complexity.factors.technicalTerms > 0) {
            reasons.push(`${complexity.factors.technicalTerms} technical terms detected`);
        }
        
        if (complexity.factors.multiStep) {
            reasons.push('Multi-step processing required');
        }
        
        if (preferences.priority !== 'balanced') {
            reasons.push(`Optimized for ${preferences.priority}`);
        }
        
        return reasons.join('. ');
    }

}
