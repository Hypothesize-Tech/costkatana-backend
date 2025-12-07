/**
 * Provider-Independent Core
 * 
 * Central exports for the provider-independent architecture.
 * This module provides unified access to model registries, pricing,
 * intelligent routing, and failover capabilities.
 */

// Registry Services
export { ModelRegistryService } from '../services/modelRegistry.service';
export { PricingRegistryService } from '../services/pricingRegistry.service';

// Routing Services
export { IntelligentRouterService } from '../services/intelligentRouter.service';
export { IntelligentFailoverService } from '../services/intelligentFailover.service';

// Normalization
export { NormalizationService } from '../services/normalization.service';

// Types - Model Registry
export {
    ModelDefinition,
    ModelRequirements,
    ModelMatchResult,
    ModelFilterOptions,
    ModelRegistryStats,
    ModelStatus,
    ModelCapability,
    ModelTier,
    ModelQualityScores
} from '../types/modelRegistry.types';

// Types - Pricing Registry
export {
    ModelPricing,
    CostCalculationRequest,
    CostCalculationResult,
    CostComparison,
    PricingUpdateEvent,
    PricingSyncConfig,
    PricingRegistryStats,
    PricingUnit,
    PricingTier
} from '../types/pricingRegistry.types';

// Types - Normalization
export {
    NormalizedRequest,
    NormalizedResponse,
    NormalizedError,
    NormalizedErrorFactory,
    NormalizedMessage,
    NormalizedParameters,
    NormalizedUsage,
    NormalizedCost,
    NormalizedFinishReason,
    NormalizedLatency,
    NormalizedCacheInfo,
    NormalizedErrorType,
    NormalizedStreamChunk
} from '../types/normalized.types';

// Types - Routing
export {
    RoutingStrategy,
    RoutingRequest,
    RoutingResult
} from '../services/intelligentRouter.service';

// Types - Failover
export {
    FailoverStrategy,
    FailoverConfig,
    FailoverPlan,
    FailoverContext
} from '../services/intelligentFailover.service';

import { ModelRegistryService } from '../services/modelRegistry.service';
import { PricingRegistryService } from '../services/pricingRegistry.service';
import { IntelligentRouterService } from '../services/intelligentRouter.service';
import { IntelligentFailoverService } from '../services/intelligentFailover.service';

/**
 * Initialize the provider-independent core
 * Call this once during application startup
 */
export function initializeProviderCore(): void {
    // Initialize singletons
    ModelRegistryService.getInstance();
    PricingRegistryService.getInstance();
    IntelligentRouterService.getInstance();
    IntelligentFailoverService.getInstance();
}

/**
 * Get all registry instances
 */
export function getCoreServices() {
    return {
        modelRegistry: ModelRegistryService.getInstance(),
        pricingRegistry: PricingRegistryService.getInstance(),
        intelligentRouter: IntelligentRouterService.getInstance(),
        intelligentFailover: IntelligentFailoverService.getInstance()
    };
}

