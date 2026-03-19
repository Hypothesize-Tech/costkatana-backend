/**
 * @deprecated Use CortexModelRouterService from CortexModule via DI.
 * This stub is only for legacy code that cannot use DI.
 * RequestInterceptorMiddleware now uses the real CortexModelRouterService.
 */
import {
  type PromptComplexityAnalysis,
  type ModelTier,
  type RoutingDecision,
  type RoutingPreferences,
} from '../modules/cortex/services/cortex-model-router.service';

export type {
  PromptComplexityAnalysis,
  ModelTier,
  RoutingDecision,
  RoutingPreferences,
};

// Fallback balanced tier for stub - provides valid defaults when DI is unavailable
const BALANCED_TIER: ModelTier = {
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
    capabilities: ['advanced_optimization', 'semantic_compression'],
  },
  suitableFor: ['Standard queries'],
  maxComplexity: 'medium',
};

type CircuitState = 'closed' | 'open' | 'half-open';

interface StubParams {
  circuitBreakerState?: CircuitState;
  overallComplexity?: PromptComplexityAnalysis['overallComplexity'];
  confidence?: number;
  length?: number;
  technicalTerms?: number;
  entities?: number;
  relationships?: number;
  abstractConcepts?: number;
  multiStep?: boolean;
  domainSpecific?: boolean;
  estimatedProcessingTime?: number;
  recommendedTier?: PromptComplexityAnalysis['recommendedTier'];
}

const createStub = (params: StubParams = {}) => {
  const {
    circuitBreakerState = 'closed',
    overallComplexity = 'medium',
    confidence = 0.5,
    length = 0,
    technicalTerms = 0,
    entities = 0,
    relationships = 0,
    abstractConcepts = 0,
    multiStep = false,
    domainSpecific = false,
    estimatedProcessingTime = 0,
    recommendedTier = 'balanced',
  } = params;

  return {
    getCircuitBreakerState: (
      _provider: string,
      _model: string,
    ): CircuitState => circuitBreakerState,

    analyzePromptComplexity: async (_prompt: string) =>
      ({
        overallComplexity,
        confidence,
        factors: {
          length,
          technicalTerms,
          entities,
          relationships,
          abstractConcepts,
          multiStep,
          domainSpecific,
        },
        estimatedProcessingTime,
        recommendedTier,
      }) as PromptComplexityAnalysis,

    makeRoutingDecision: async (
      _complexity: PromptComplexityAnalysis,
      _preferences?: Partial<RoutingPreferences>,
    ): Promise<RoutingDecision> => ({
      selectedTier: BALANCED_TIER,
      reasoning: 'Stub fallback: using balanced tier',
      confidence,
      costEstimate: {
        tokens: 0,
        estimatedCost: 0,
        tier: 'balanced',
      },
    }),

    getModelConfiguration: (_decision: RoutingDecision) => ({
      cortexCoreModel: BALANCED_TIER.models.core,
      cortexEncodingModel: BALANCED_TIER.models.encoder,
      cortexDecodingModel: BALANCED_TIER.models.decoder,
    }),
  };
};

/**
 * Returns a stub CortexModelRouterService instance.
 * Allows optional parameterization for testing or legacy use.
 */
export const CortexModelRouterService = {
  getInstance: (params?: StubParams) => createStub(params),
};

export type CortexModelRouterInstance = ReturnType<
  typeof CortexModelRouterService.getInstance
>;
