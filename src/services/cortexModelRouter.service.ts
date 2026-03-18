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

export type { PromptComplexityAnalysis, ModelTier, RoutingDecision, RoutingPreferences };

// Stub for legacy middleware - Nest service is injectable, no getInstance
type CircuitState = 'closed' | 'open' | 'half-open';
const stub = {
  getCircuitBreakerState: (_provider: string, _model: string): CircuitState => 'closed',
  analyzePromptComplexity: async (_prompt: string) =>
    ({ overallComplexity: 'medium', confidence: 0.5 } as PromptComplexityAnalysis),
  makeRoutingDecision: async (
    _complexity: PromptComplexityAnalysis,
    _preferences?: Partial<RoutingPreferences>,
  ) => ({} as RoutingDecision),
  getModelConfiguration: (_decision: RoutingDecision) =>
    ({ cortexCoreModel: '', cortexEncodingModel: '', cortexDecodingModel: '' }),
};

export const CortexModelRouterService = {
  getInstance: () => stub,
};

export type CortexModelRouterInstance = ReturnType<
  typeof CortexModelRouterService.getInstance
>;
