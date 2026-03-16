/**
 * Strategic Policies Configuration
 *
 * This file defines the strategic policies and routing configurations for Cortex operations.
 * These policies determine how Cortex processes requests, handles fallbacks, and routes
 * between different models and processing strategies.
 */

// ============================================================================
// OPERATION TYPES AND POLICIES
// ============================================================================

/**
 * Types of Cortex operations
 */
export type CortexOperationType =
  | 'encoding'
  | 'processing'
  | 'decoding'
  | 'optimization'
  | 'compression'
  | 'analysis'
  | 'translation'
  | 'summarization'
  | 'question_answering'
  | 'code_generation'
  | 'data_extraction';

/**
 * Strategic policy for Cortex operations
 */
export interface CortexOperationPolicy {
  /** Operation type */
  operation: CortexOperationType;

  /** Primary processing strategy */
  primaryStrategy: 'direct' | 'hybrid' | 'fallback' | 'parallel';

  /** Model selection criteria */
  modelSelection: {
    criteria: 'cost' | 'quality' | 'speed' | 'balanced';
    allowedModels: string[];
    preferredModels: string[];
    fallbackModels: string[];
  };

  /** Quality thresholds */
  qualityThresholds: {
    minimumConfidence: number;
    maximumProcessingTime: number;
    minimumFidelity: number;
    acceptableErrorRate: number;
  };

  /** Resource constraints */
  resourceConstraints: {
    maxTokens: number;
    maxProcessingTime: number;
    maxCost: number;
    concurrencyLimit: number;
  };

  /** Caching strategy */
  cachingStrategy: {
    enabled: boolean;
    ttl: number;
    cacheKeyStrategy: 'semantic_hash' | 'content_hash' | 'combined';
    cacheInvalidation: 'time_based' | 'usage_based' | 'manual';
  };

  /** Circuit breaker configuration */
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeout: number;
    monitoringWindow: number;
  };
}

// ============================================================================
// FALLBACK AND ROUTING POLICIES
// ============================================================================

/**
 * Fallback pricing policy for model selection
 */
export interface FallbackPricingPolicy {
  /** Policy name */
  name: string;

  /** Cost optimization strategy */
  costOptimization: 'aggressive' | 'balanced' | 'conservative';

  /** Model hierarchy by cost and capability */
  modelHierarchy: Array<{
    tier: number;
    models: string[];
    maxCostPerToken: number;
    minQualityScore: number;
    capabilities: string[];
  }>;

  /** Automatic fallback triggers */
  fallbackTriggers: {
    costExceeded: boolean;
    qualityThreshold: number;
    timeoutExceeded: number;
    errorRateExceeded: number;
  };

  /** Fallback behavior */
  fallbackBehavior: {
    downgradeSteps: number;
    retryAttempts: number;
    circuitBreakAfter: number;
    notifyOnFallback: boolean;
  };
}

/**
 * Routing strategy for request distribution
 */
export interface RoutingStrategyPolicy {
  /** Strategy name */
  name: string;

  /** Routing algorithm */
  algorithm:
    | 'round_robin'
    | 'weighted_round_robin'
    | 'least_loaded'
    | 'cost_based'
    | 'quality_based'
    | 'adaptive';

  /** Load balancing configuration */
  loadBalancing: {
    enabled: boolean;
    healthCheckInterval: number;
    unhealthyThreshold: number;
    recoveryTime: number;
  };

  /** Traffic distribution */
  trafficDistribution: {
    regions: Record<string, number>; // region -> percentage
    providers: Record<string, number>; // provider -> percentage
    models: Record<string, number>; // model -> percentage
  };

  /** Quality of Service (QoS) */
  qos: {
    priorityLevels: 'low' | 'medium' | 'high' | 'critical';
    slaTargets: Record<
      string,
      {
        responseTime: number;
        successRate: number;
        costLimit: number;
      }
    >;
  };

  /** Adaptive routing */
  adaptiveRouting: {
    enabled: boolean;
    metricsWindow: number;
    adjustmentInterval: number;
    performanceWeights: {
      latency: number;
      cost: number;
      quality: number;
      reliability: number;
    };
  };
}

// ============================================================================
// PREDEFINED POLICIES
// ============================================================================

/**
 * Default operation policies for each operation type
 */
export const DEFAULT_OPERATION_POLICIES: Record<
  CortexOperationType,
  CortexOperationPolicy
> = {
  encoding: {
    operation: 'encoding',
    primaryStrategy: 'direct',
    modelSelection: {
      criteria: 'quality',
      allowedModels: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-opus-20240229-v1:0',
        'openai.gpt-4o-2024-08-06',
        'openai.gpt-4o-mini-2024-07-18',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['anthropic.claude-3-opus-20240229-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.85,
      maximumProcessingTime: 30000,
      minimumFidelity: 0.9,
      acceptableErrorRate: 0.05,
    },
    resourceConstraints: {
      maxTokens: 100000,
      maxProcessingTime: 30000,
      maxCost: 0.5,
      concurrencyLimit: 10,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 3600,
      cacheKeyStrategy: 'semantic_hash',
      cacheInvalidation: 'time_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 60000,
      monitoringWindow: 300000,
    },
  },

  processing: {
    operation: 'processing',
    primaryStrategy: 'hybrid',
    modelSelection: {
      criteria: 'balanced',
      allowedModels: [
        'anthropic.claude-3-opus-20240229-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      preferredModels: ['anthropic.claude-3-opus-20240229-v1:0'],
      fallbackModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.9,
      maximumProcessingTime: 60000,
      minimumFidelity: 0.95,
      acceptableErrorRate: 0.03,
    },
    resourceConstraints: {
      maxTokens: 200000,
      maxProcessingTime: 60000,
      maxCost: 1.0,
      concurrencyLimit: 5,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 1800,
      cacheKeyStrategy: 'combined',
      cacheInvalidation: 'usage_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      recoveryTimeout: 120000,
      monitoringWindow: 600000,
    },
  },

  decoding: {
    operation: 'decoding',
    primaryStrategy: 'direct',
    modelSelection: {
      criteria: 'quality',
      allowedModels: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'openai.gpt-4o-2024-08-06',
        'openai.gpt-4o-mini-2024-07-18',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['anthropic.claude-3-haiku-20240307-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.88,
      maximumProcessingTime: 25000,
      minimumFidelity: 0.92,
      acceptableErrorRate: 0.04,
    },
    resourceConstraints: {
      maxTokens: 80000,
      maxProcessingTime: 25000,
      maxCost: 0.3,
      concurrencyLimit: 15,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 7200,
      cacheKeyStrategy: 'content_hash',
      cacheInvalidation: 'time_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 45000,
      monitoringWindow: 240000,
    },
  },

  optimization: {
    operation: 'optimization',
    primaryStrategy: 'parallel',
    modelSelection: {
      criteria: 'cost',
      allowedModels: [
        'anthropic.claude-3-haiku-20240307-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'openai.gpt-4o-mini-2024-07-18',
      ],
      preferredModels: ['anthropic.claude-3-haiku-20240307-v1:0'],
      fallbackModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.8,
      maximumProcessingTime: 20000,
      minimumFidelity: 0.85,
      acceptableErrorRate: 0.08,
    },
    resourceConstraints: {
      maxTokens: 50000,
      maxProcessingTime: 20000,
      maxCost: 0.2,
      concurrencyLimit: 20,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 3600,
      cacheKeyStrategy: 'semantic_hash',
      cacheInvalidation: 'usage_based',
    },
    circuitBreaker: {
      enabled: false,
      failureThreshold: 10,
      recoveryTimeout: 30000,
      monitoringWindow: 180000,
    },
  },

  compression: {
    operation: 'compression',
    primaryStrategy: 'direct',
    modelSelection: {
      criteria: 'cost',
      allowedModels: [
        'anthropic.claude-3-haiku-20240307-v1:0',
        'openai.gpt-4o-mini-2024-07-18',
      ],
      preferredModels: ['anthropic.claude-3-haiku-20240307-v1:0'],
      fallbackModels: ['openai.gpt-4o-mini-2024-07-18'],
    },
    qualityThresholds: {
      minimumConfidence: 0.75,
      maximumProcessingTime: 15000,
      minimumFidelity: 0.8,
      acceptableErrorRate: 0.1,
    },
    resourceConstraints: {
      maxTokens: 30000,
      maxProcessingTime: 15000,
      maxCost: 0.1,
      concurrencyLimit: 30,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 7200,
      cacheKeyStrategy: 'content_hash',
      cacheInvalidation: 'time_based',
    },
    circuitBreaker: {
      enabled: false,
      failureThreshold: 15,
      recoveryTimeout: 20000,
      monitoringWindow: 120000,
    },
  },

  analysis: {
    operation: 'analysis',
    primaryStrategy: 'hybrid',
    modelSelection: {
      criteria: 'quality',
      allowedModels: [
        'anthropic.claude-3-opus-20240229-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['anthropic.claude-3-opus-20240229-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.85,
      maximumProcessingTime: 45000,
      minimumFidelity: 0.88,
      acceptableErrorRate: 0.05,
    },
    resourceConstraints: {
      maxTokens: 150000,
      maxProcessingTime: 45000,
      maxCost: 0.75,
      concurrencyLimit: 8,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 1800,
      cacheKeyStrategy: 'combined',
      cacheInvalidation: 'usage_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 4,
      recoveryTimeout: 90000,
      monitoringWindow: 450000,
    },
  },

  translation: {
    operation: 'translation',
    primaryStrategy: 'direct',
    modelSelection: {
      criteria: 'balanced',
      allowedModels: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['openai.gpt-4o-2024-08-06'],
    },
    qualityThresholds: {
      minimumConfidence: 0.9,
      maximumProcessingTime: 35000,
      minimumFidelity: 0.95,
      acceptableErrorRate: 0.03,
    },
    resourceConstraints: {
      maxTokens: 100000,
      maxProcessingTime: 35000,
      maxCost: 0.4,
      concurrencyLimit: 12,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 86400, // 24 hours
      cacheKeyStrategy: 'content_hash',
      cacheInvalidation: 'time_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 60000,
      monitoringWindow: 300000,
    },
  },

  summarization: {
    operation: 'summarization',
    primaryStrategy: 'direct',
    modelSelection: {
      criteria: 'cost',
      allowedModels: [
        'anthropic.claude-3-haiku-20240307-v1:0',
        'openai.gpt-4o-mini-2024-07-18',
      ],
      preferredModels: ['anthropic.claude-3-haiku-20240307-v1:0'],
      fallbackModels: ['openai.gpt-4o-mini-2024-07-18'],
    },
    qualityThresholds: {
      minimumConfidence: 0.82,
      maximumProcessingTime: 20000,
      minimumFidelity: 0.85,
      acceptableErrorRate: 0.06,
    },
    resourceConstraints: {
      maxTokens: 60000,
      maxProcessingTime: 20000,
      maxCost: 0.15,
      concurrencyLimit: 25,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 3600,
      cacheKeyStrategy: 'content_hash',
      cacheInvalidation: 'usage_based',
    },
    circuitBreaker: {
      enabled: false,
      failureThreshold: 10,
      recoveryTimeout: 30000,
      monitoringWindow: 150000,
    },
  },

  question_answering: {
    operation: 'question_answering',
    primaryStrategy: 'hybrid',
    modelSelection: {
      criteria: 'quality',
      allowedModels: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-opus-20240229-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['anthropic.claude-3-opus-20240229-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.87,
      maximumProcessingTime: 40000,
      minimumFidelity: 0.9,
      acceptableErrorRate: 0.04,
    },
    resourceConstraints: {
      maxTokens: 120000,
      maxProcessingTime: 40000,
      maxCost: 0.6,
      concurrencyLimit: 10,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 1800,
      cacheKeyStrategy: 'semantic_hash',
      cacheInvalidation: 'usage_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 4,
      recoveryTimeout: 75000,
      monitoringWindow: 375000,
    },
  },

  code_generation: {
    operation: 'code_generation',
    primaryStrategy: 'direct',
    modelSelection: {
      criteria: 'quality',
      allowedModels: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-opus-20240229-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['anthropic.claude-3-opus-20240229-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.88,
      maximumProcessingTime: 50000,
      minimumFidelity: 0.92,
      acceptableErrorRate: 0.05,
    },
    resourceConstraints: {
      maxTokens: 150000,
      maxProcessingTime: 50000,
      maxCost: 0.8,
      concurrencyLimit: 8,
    },
    cachingStrategy: {
      enabled: false, // Code generation typically shouldn't be cached
      ttl: 0,
      cacheKeyStrategy: 'content_hash',
      cacheInvalidation: 'manual',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      recoveryTimeout: 100000,
      monitoringWindow: 500000,
    },
  },

  data_extraction: {
    operation: 'data_extraction',
    primaryStrategy: 'hybrid',
    modelSelection: {
      criteria: 'balanced',
      allowedModels: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      preferredModels: ['anthropic.claude-3-5-sonnet-20240620-v1:0'],
      fallbackModels: ['anthropic.claude-3-haiku-20240307-v1:0'],
    },
    qualityThresholds: {
      minimumConfidence: 0.85,
      maximumProcessingTime: 30000,
      minimumFidelity: 0.88,
      acceptableErrorRate: 0.05,
    },
    resourceConstraints: {
      maxTokens: 80000,
      maxProcessingTime: 30000,
      maxCost: 0.35,
      concurrencyLimit: 15,
    },
    cachingStrategy: {
      enabled: true,
      ttl: 7200,
      cacheKeyStrategy: 'content_hash',
      cacheInvalidation: 'time_based',
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 50000,
      monitoringWindow: 250000,
    },
  },
};

/**
 * Default fallback pricing policy
 */
export const DEFAULT_FALLBACK_PRICING_POLICY: FallbackPricingPolicy = {
  name: 'default_fallback',
  costOptimization: 'balanced',
  modelHierarchy: [
    {
      tier: 1,
      models: [
        'anthropic.claude-3-haiku-20240307-v1:0',
        'openai.gpt-4o-mini-2024-07-18',
      ],
      maxCostPerToken: 0.00025,
      minQualityScore: 0.7,
      capabilities: ['basic_reasoning', 'text_generation', 'simple_analysis'],
    },
    {
      tier: 2,
      models: [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'openai.gpt-4o-2024-08-06',
      ],
      maxCostPerToken: 0.001,
      minQualityScore: 0.8,
      capabilities: [
        'advanced_reasoning',
        'complex_analysis',
        'code_generation',
      ],
    },
    {
      tier: 3,
      models: [
        'anthropic.claude-3-opus-20240229-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
      ],
      maxCostPerToken: 0.002,
      minQualityScore: 0.9,
      capabilities: ['expert_reasoning', 'specialized_tasks', 'high_accuracy'],
    },
  ],
  fallbackTriggers: {
    costExceeded: true,
    qualityThreshold: 0.75,
    timeoutExceeded: 1,
    errorRateExceeded: 0.1,
  },
  fallbackBehavior: {
    downgradeSteps: 2,
    retryAttempts: 3,
    circuitBreakAfter: 5,
    notifyOnFallback: true,
  },
};

/**
 * Default routing strategy policy
 */
export const DEFAULT_ROUTING_STRATEGY_POLICY: RoutingStrategyPolicy = {
  name: 'default_routing',
  algorithm: 'adaptive',
  loadBalancing: {
    enabled: true,
    healthCheckInterval: 30000,
    unhealthyThreshold: 3,
    recoveryTime: 60000,
  },
  trafficDistribution: {
    regions: {
      'us-east-1': 0.4,
      'us-west-2': 0.3,
      'eu-west-1': 0.2,
      'ap-southeast-1': 0.1,
    },
    providers: {
      anthropic: 0.6,
      openai: 0.4,
    },
    models: {
      'anthropic.claude-3-5-sonnet-20240620-v1:0': 0.3,
      'anthropic.claude-3-opus-20240229-v1:0': 0.2,
      'anthropic.claude-3-haiku-20240307-v1:0': 0.2,
      'openai.gpt-4o-2024-08-06': 0.2,
      'openai.gpt-4o-mini-2024-07-18': 0.1,
    },
  },
  qos: {
    priorityLevels: 'medium',
    slaTargets: {
      low: {
        responseTime: 60000,
        successRate: 0.95,
        costLimit: 0.5,
      },
      medium: {
        responseTime: 30000,
        successRate: 0.98,
        costLimit: 1.0,
      },
      high: {
        responseTime: 15000,
        successRate: 0.99,
        costLimit: 2.0,
      },
      critical: {
        responseTime: 5000,
        successRate: 0.995,
        costLimit: 5.0,
      },
    },
  },
  adaptiveRouting: {
    enabled: true,
    metricsWindow: 300000, // 5 minutes
    adjustmentInterval: 60000, // 1 minute
    performanceWeights: {
      latency: 0.3,
      cost: 0.3,
      quality: 0.25,
      reliability: 0.15,
    },
  },
};

// ============================================================================
// POLICY MANAGEMENT
// ============================================================================

/**
 * Policy registry for managing different policies
 */
export interface PolicyRegistry {
  operationPolicies: Map<CortexOperationType, CortexOperationPolicy>;
  fallbackPolicies: Map<string, FallbackPricingPolicy>;
  routingPolicies: Map<string, RoutingStrategyPolicy>;
  activePolicies: {
    operation: CortexOperationType;
    fallback: string;
    routing: string;
  };
}

/**
 * Default policy registry
 */
export const DEFAULT_POLICY_REGISTRY: PolicyRegistry = {
  operationPolicies: new Map(Object.entries(DEFAULT_OPERATION_POLICIES)) as Map<
    CortexOperationType,
    CortexOperationPolicy
  >,
  fallbackPolicies: new Map([['default', DEFAULT_FALLBACK_PRICING_POLICY]]),
  routingPolicies: new Map([['default', DEFAULT_ROUTING_STRATEGY_POLICY]]),
  activePolicies: {
    operation: 'optimization', // Default for optimization context
    fallback: 'default',
    routing: 'default',
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get operation policy for a specific operation
 */
export function getOperationPolicy(
  operation: CortexOperationType,
): CortexOperationPolicy {
  return (
    DEFAULT_POLICY_REGISTRY.operationPolicies.get(operation) ||
    DEFAULT_OPERATION_POLICIES.optimization
  );
}

/**
 * Get active fallback policy
 */
export function getActiveFallbackPolicy(): FallbackPricingPolicy {
  const policyName = DEFAULT_POLICY_REGISTRY.activePolicies.fallback;
  return (
    DEFAULT_POLICY_REGISTRY.fallbackPolicies.get(policyName) ||
    DEFAULT_FALLBACK_PRICING_POLICY
  );
}

/**
 * Get active routing policy
 */
export function getActiveRoutingPolicy(): RoutingStrategyPolicy {
  const policyName = DEFAULT_POLICY_REGISTRY.activePolicies.routing;
  return (
    DEFAULT_POLICY_REGISTRY.routingPolicies.get(policyName) ||
    DEFAULT_ROUTING_STRATEGY_POLICY
  );
}

/**
 * Validate operation policy
 */
export function validateOperationPolicy(
  policy: CortexOperationPolicy,
): boolean {
  return (
    policy.operation in DEFAULT_OPERATION_POLICIES &&
    policy.qualityThresholds.minimumConfidence >= 0 &&
    policy.qualityThresholds.minimumConfidence <= 1 &&
    policy.resourceConstraints.maxTokens > 0 &&
    policy.resourceConstraints.maxProcessingTime > 0
  );
}

/**
 * Validate fallback pricing policy
 */
export function validateFallbackPricingPolicy(
  policy: FallbackPricingPolicy,
): boolean {
  return (
    policy.modelHierarchy.length > 0 &&
    policy.modelHierarchy.every(
      (tier) =>
        tier.models.length > 0 &&
        tier.maxCostPerToken > 0 &&
        tier.minQualityScore >= 0 &&
        tier.minQualityScore <= 1,
    ) &&
    policy.fallbackBehavior.downgradeSteps >= 0 &&
    policy.fallbackBehavior.retryAttempts >= 0
  );
}

/**
 * Adapter for optimization service: returns strategic policies with cortexOperation shape.
 */
export function getStrategicPolicies(): {
  cortexOperation: {
    defaultOperation: CortexOperationType;
    operationConfig: Record<
      CortexOperationType,
      CortexOperationPolicy & { tradeoff?: string }
    >;
  };
} {
  const operationConfig = {} as Record<
    CortexOperationType,
    CortexOperationPolicy & { tradeoff?: string }
  >;
  for (const [op, policy] of Object.entries(DEFAULT_OPERATION_POLICIES)) {
    operationConfig[op as CortexOperationType] = {
      ...policy,
      tradeoff: 'balanced',
    };
  }
  return {
    cortexOperation: {
      defaultOperation: 'optimization',
      operationConfig,
    },
  };
}

/**
 * Adapter for optimization service: returns fallback pricing with strategy and pricingRates.
 */
export function getFallbackPricing(): {
  strategy: 'strict' | 'relaxed' | 'estimate';
  accuracy: number;
  risk: string;
  rationale: string;
  pricingRates: { inputCostPer1M: number; outputCostPer1M: number };
} {
  const policy = getActiveFallbackPolicy();
  const tier = policy.modelHierarchy[0];
  const costPerToken = tier ? tier.maxCostPerToken : 0.001;
  return {
    strategy: 'relaxed',
    accuracy: 0.8,
    risk: 'low',
    rationale: 'Fallback when no explicit pricing',
    pricingRates: {
      inputCostPer1M: costPerToken * 1_000_000,
      outputCostPer1M: costPerToken * 1_000_000 * 1.5,
    },
  };
}
