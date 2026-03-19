/**
 * Re-exports PricingRegistryService from PricingModule.
 * For NestJS usage, inject PricingRegistryService from PricingModule via DI.
 *
 * Legacy getInstance() stub removed - use PricingModule and dependency injection.
 */
export {
  PricingRegistryService,
  type PricingRegistryStats,
  type ModelPricing,
  type CostCalculationRequest,
  type CostCalculationResult,
  type CostComparison,
} from '../modules/pricing/services/pricing-registry.service';
