/**
 * Strategic Policies Configuration
 * 
 * Makes implicit cost-performance tradeoffs EXPLICIT through configurable policies.
 * Every strategic decision point should be documented here with:
 *   - Rationale: Why this default?
 *   - Alternatives: What else was considered?
 *   - Tradeoffs: What do we gain/lose?
 *   - Impact: Quantified cost/latency/quality effects
 */

import { loggingService } from '../services/logging.service';

// ============================================================================
// CORTEX OPERATION POLICIES
// ============================================================================

/**
 * Cortex Operation Types
 * 
 * RATIONALE: Different operations have different optimization strategies
 * TRADEOFF: Flexibility vs Complexity
 */
export type CortexOperationType = 
    | 'optimize'    // General optimization
    | 'compress'    // Token reduction focus
    | 'analyze'     // Analysis without transformation
    | 'transform'   // Format conversion
    | 'sast'        // Semantic AST generation
    | 'answer';     // Answer generation (legacy default)

export interface CortexOperationPolicy {
    defaultOperation: CortexOperationType;
    allowedOperations: CortexOperationType[];
    operationConfig: Record<CortexOperationType, {
        description: string;
        tokenReduction: number;     // Expected 0-1
        latencyOverhead: number;    // milliseconds
        useCase: string;
        tradeoff: string;
    }>;
}

/**
 * DEFAULT: 'answer' for backward compatibility
 * 
 * ALTERNATIVES CONSIDERED:
 *   1. 'answer' (current) - Backward compatible, works for 80% of use cases
 *   2. 'optimize' (general) - More flexible but requires migration
 *   3. Required parameter - Forces explicit choice, breaks existing code
 * 
 * TRADEOFF: Backward compatibility vs Explicitness
 * IMPACT: Neutral (preserves existing behavior)
 * PRIORITY: P0 - Critical for Cortex extensibility
 */
export const DEFAULT_CORTEX_OPERATION_POLICY: CortexOperationPolicy = {
    defaultOperation: 'answer',
    allowedOperations: ['optimize', 'compress', 'analyze', 'transform', 'sast', 'answer'],
    
    operationConfig: {
        optimize: {
            description: 'General-purpose optimization (recommended default)',
            tokenReduction: 0.45,
            latencyOverhead: 200,
            useCase: 'Most AI operations, balance of speed and savings',
            tradeoff: 'Balanced: 45% token reduction, 200ms overhead'
        },
        compress: {
            description: 'Maximum token compression (cost-critical)',
            tokenReduction: 0.65,
            latencyOverhead: 300,
            useCase: 'High-volume, cost-sensitive workloads',
            tradeoff: 'High savings: 65% token reduction, 300ms overhead, slight quality loss'
        },
        analyze: {
            description: 'Analysis without transformation',
            tokenReduction: 0.0,
            latencyOverhead: 100,
            useCase: 'Understanding prompts without optimization',
            tradeoff: 'Fast analysis: No token reduction, 100ms overhead'
        },
        transform: {
            description: 'Format conversion (e.g., JSON → LISP)',
            tokenReduction: 0.30,
            latencyOverhead: 150,
            useCase: 'Data format transformation',
            tradeoff: 'Format change: 30% token reduction, 150ms overhead'
        },
        sast: {
            description: 'Semantic AST generation',
            tokenReduction: 0.40,
            latencyOverhead: 250,
            useCase: 'Semantic analysis, cross-lingual AI',
            tradeoff: 'Semantic focus: 40% token reduction, 250ms overhead, 92% preservation'
        },
        answer: {
            description: 'Legacy answer generation (backward compat)',
            tokenReduction: 0.45,
            latencyOverhead: 200,
            useCase: 'Existing answer-generation workflows',
            tradeoff: 'Legacy support: Same as optimize, maintained for compatibility'
        }
    }
};

// ============================================================================
// FALLBACK PRICING POLICIES
// ============================================================================

/**
 * Fallback Pricing Strategies
 * 
 * RATIONALE: When model pricing unavailable, need estimation strategy
 * TRADEOFF: Accuracy vs Availability vs Safety
 */
export type FallbackPricingStrategy = 
    | 'conservative'  // Overestimate (safer for budgets)
    | 'optimistic'    // Underestimate (lower estimates)
    | 'balanced'      // Middle of spectrum (current)
    | 'strict';       // Fail without pricing (forces config)

export interface FallbackPricingPolicy {
    strategy: FallbackPricingStrategy;
    pricingRates: {
        inputCostPer1M: number;   // USD per 1M input tokens
        outputCostPer1M: number;  // USD per 1M output tokens
    };
    rationale: string;
    accuracy: number;              // Expected accuracy 0-1
    risk: 'low' | 'medium' | 'high';
}

/**
 * DEFAULT: 'balanced' (GPT-4o-mini rates)
 * 
 * ALTERNATIVES CONSIDERED:
 *   1. Balanced (current) - Middle of pricing spectrum, 50% accuracy
 *   2. Conservative - Safer for budgets, may overestimate 2x
 *   3. Optimistic - Lower estimates, may underestimate 2x
 *   4. Strict - Forces explicit pricing, breaks on new models
 * 
 * TRADEOFF: Accuracy vs User Experience vs Safety
 * IMPACT: Affects cost estimation for models without pricing data
 * PRIORITY: P1 - High impact on budget planning
 */
export const FALLBACK_PRICING_POLICIES: Record<FallbackPricingStrategy, FallbackPricingPolicy> = {
    conservative: {
        strategy: 'conservative',
        pricingRates: {
            inputCostPer1M: 0.50,   // 75th percentile (~GPT-4 level)
            outputCostPer1M: 2.00
        },
        rationale: 'Safer for budget planning - better to overestimate than underestimate',
        accuracy: 0.70,             // Within 30% of actual
        risk: 'low'
    },
    
    optimistic: {
        strategy: 'optimistic',
        pricingRates: {
            inputCostPer1M: 0.10,   // 25th percentile (~Gemini Flash level)
            outputCostPer1M: 0.40
        },
        rationale: 'Lower estimates for cost-sensitive scenarios',
        accuracy: 0.50,             // Within 50% of actual
        risk: 'high'
    },
    
    balanced: {
        strategy: 'balanced',
        pricingRates: {
            inputCostPer1M: 0.15,   // GPT-4o-mini rates (current default)
            outputCostPer1M: 0.60
        },
        rationale: 'Middle of pricing spectrum - reasonable for most models',
        accuracy: 0.60,             // Within 40% of actual
        risk: 'medium'
    },
    
    strict: {
        strategy: 'strict',
        pricingRates: {
            inputCostPer1M: 0,      // Will throw error
            outputCostPer1M: 0
        },
        rationale: 'Forces explicit pricing configuration - highest accuracy',
        accuracy: 1.00,             // 100% (requires exact pricing)
        risk: 'low'
    }
};

// ============================================================================
// ROUTING STRATEGY POLICIES
// ============================================================================

/**
 * Routing Strategies
 * 
 * RATIONALE: Different use cases require different cost/latency/quality balance
 * TRADEOFF: Cost vs Speed vs Quality (can only optimize 2 of 3)
 */
export interface RoutingStrategyPolicy {
    name: string;
    weights: {
        cost: number;      // 0-1, importance of cost
        latency: number;   // 0-1, importance of speed
        quality: number;   // 0-1, importance of quality
    };
    modelPreferences: string[];
    expectedPerformance: {
        avgLatencyMs: number;
        avgCostPerRequest: number;
        userSatisfaction: number;  // 0-1
    };
    useCase: string;
    tradeoff: string;
}

/**
 * DEFAULT: Balanced routing for most users
 * 
 * ALTERNATIVES CONSIDERED:
 *   1. Cost-optimized - Cheapest models, acceptable for high-volume
 *   2. Balanced (current) - Equal weights, good default
 *   3. Speed-optimized - Fastest models, for real-time apps
 *   4. Quality-optimized - Best models, for critical tasks
 * 
 * TRADEOFF: Optimize 2 of 3 (cost, speed, quality)
 * IMPACT: Affects every AI request routing decision
 * PRIORITY: P1 - High impact on user experience
 */
export const ROUTING_STRATEGY_POLICIES: Record<string, RoutingStrategyPolicy> = {
    cost: {
        name: 'Cost-Optimized',
        weights: { cost: 0.60, latency: 0.15, quality: 0.25 },
        modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini', 'claude-3-haiku'],
        expectedPerformance: {
            avgLatencyMs: 2000,
            avgCostPerRequest: 0.001,
            userSatisfaction: 0.85
        },
        useCase: 'High-volume, cost-sensitive applications',
        tradeoff: 'Minimize cost: 3s latency acceptable, 85% satisfaction'
    },
    
    balanced: {
        name: 'Balanced',
        weights: { cost: 0.33, latency: 0.33, quality: 0.34 },
        modelPreferences: ['gpt-4o', 'claude-3.5-sonnet', 'gemini-1.5-pro'],
        expectedPerformance: {
            avgLatencyMs: 800,
            avgCostPerRequest: 0.005,
            userSatisfaction: 0.93
        },
        useCase: 'Production applications, default choice',
        tradeoff: 'Balance all three: 800ms latency, $0.005/request, 93% satisfaction'
    },
    
    speed: {
        name: 'Speed-Optimized',
        weights: { cost: 0.10, latency: 0.70, quality: 0.20 },
        modelPreferences: ['gpt-4o-mini', 'gemini-2.5-flash', 'claude-3-haiku'],
        expectedPerformance: {
            avgLatencyMs: 300,
            avgCostPerRequest: 0.002,
            userSatisfaction: 0.88
        },
        useCase: 'Real-time chat, interactive applications',
        tradeoff: 'Minimize latency: Fast but lower quality (88% satisfaction)'
    },
    
    quality: {
        name: 'Quality-Optimized',
        weights: { cost: 0.10, latency: 0.15, quality: 0.75 },
        modelPreferences: ['claude-opus-4', 'gpt-4o', 'gemini-1.5-pro'],
        expectedPerformance: {
            avgLatencyMs: 4000,
            avgCostPerRequest: 0.020,
            userSatisfaction: 0.98
        },
        useCase: 'Content creation, critical decision-making',
        tradeoff: 'Maximum quality: 4s latency acceptable, $0.02/request, 98% satisfaction'
    }
};

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

export interface StrategicPoliciesConfig {
    cortexOperation: CortexOperationPolicy;
    fallbackPricing: FallbackPricingStrategy;
    routingStrategy: string;  // key into ROUTING_STRATEGY_POLICIES
}

/**
 * Load strategic policies from environment or use defaults
 */
export function getStrategicPolicies(): StrategicPoliciesConfig {
    const config: StrategicPoliciesConfig = {
        cortexOperation: DEFAULT_CORTEX_OPERATION_POLICY,
        fallbackPricing: (process.env.FALLBACK_PRICING_STRATEGY as FallbackPricingStrategy) || 'balanced',
        routingStrategy: process.env.DEFAULT_ROUTING_STRATEGY || 'balanced'
    };
    
    // Validate configuration
    if (!FALLBACK_PRICING_POLICIES[config.fallbackPricing]) {
        loggingService.warn(`Invalid fallback pricing strategy: ${config.fallbackPricing}, using 'balanced'`);
        config.fallbackPricing = 'balanced';
    }
    
    if (!ROUTING_STRATEGY_POLICIES[config.routingStrategy]) {
        loggingService.warn(`Invalid routing strategy: ${config.routingStrategy}, using 'balanced'`);
        config.routingStrategy = 'balanced';
    }
    
    loggingService.info('Strategic policies loaded', {
        cortexDefault: config.cortexOperation.defaultOperation,
        fallbackPricing: config.fallbackPricing,
        routingStrategy: config.routingStrategy
    });
    
    return config;
}

/**
 * Get fallback pricing for a given strategy
 */
export function getFallbackPricing(strategy?: FallbackPricingStrategy): FallbackPricingPolicy {
    const strategyKey = strategy || getStrategicPolicies().fallbackPricing;
    return FALLBACK_PRICING_POLICIES[strategyKey];
}

/**
 * Get routing strategy policy
 */
export function getRoutingStrategy(strategyName?: string): RoutingStrategyPolicy {
    const name = strategyName || getStrategicPolicies().routingStrategy;
    return ROUTING_STRATEGY_POLICIES[name];
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    getStrategicPolicies,
    getFallbackPricing,
    getRoutingStrategy,
    DEFAULT_CORTEX_OPERATION_POLICY,
    FALLBACK_PRICING_POLICIES,
    ROUTING_STRATEGY_POLICIES
};

