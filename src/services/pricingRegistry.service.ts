/**
 * @deprecated Use PricingRegistryService from PricingModule via DI.
 * This stub is only for legacy code that cannot use DI.
 * RequestInterceptorMiddleware now uses the real PricingRegistryService.
 */
import {
  PricingRegistryService as NestPricingRegistryService,
  type PricingRegistryStats,
  type ModelPricing,
  type CostCalculationRequest,
  type CostCalculationResult,
  type CostComparison,
} from '../modules/pricing/services/pricing-registry.service';

export type { PricingRegistryStats, ModelPricing, CostCalculationRequest, CostCalculationResult, CostComparison };

// Stub for legacy middleware - Nest service is injectable, no getInstance
const pricingStub = {
  calculateCost: (_req: CostCalculationRequest): CostCalculationResult => ({
    modelId: '',
    provider: {} as import('../modules/pricing/services/pricing-registry.service').AIProviderType,
    inputCost: 0,
    outputCost: 0,
    totalCost: 0,
    currency: 'USD',
    effectiveRatePerK: 0,
    breakdown: {
      inputTokens: 0,
      outputTokens: 0,
      inputPricePerK: 0,
      outputPricePerK: 0,
    },
  }),
};

export const PricingRegistryService = {
  getInstance: () => pricingStub,
};
