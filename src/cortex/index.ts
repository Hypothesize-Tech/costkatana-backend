/**
 * Cortex Meta-Language Module
 * Main export file for the Cortex optimization system
 */

// Core components
export { CortexParser, cortexParser } from './core/parser';
export { CortexEncoder, cortexEncoder } from './core/encoder';
export { CortexDecoder, cortexDecoder } from './core/decoder';
export { CorePrimitives, DomainPrimitives, getPrimitiveByValue, isValidPrimitive } from './core/primitives';

// Relay components
export { CortexRelayEngine, cortexRelay } from './relay/relayEngine';
export { ModelRouter, modelRouter } from './relay/modelRouter';
export { DynamicModelSelector, dynamicModelSelector } from './relay/dynamicModelSelector';
export { IntelligentModelSelector, intelligentModelSelector } from './relay/intelligentModelSelector';

// Types
export * from './types';

// Enhancement modules
export { BinarySerializer, SchemaBasedSerializer } from './serialization/binarySerializer';
export { 
  ControlFlowProcessor, 
  ControlFlowBuilder, 
  ControlFlowType, 
  LogicalOperator,
  type IfThenElseFrame,
  type SwitchCaseFrame,
  type ForEachFrame,
  type WhileFrame,
  type TryCatchFrame,
  type ParallelFrame
} from './core/controlFlow';
export { 
  HybridExecutionEngine, 
  ToolType,
  type ToolRequest,
  type ToolResult,
  type ToolExecutor
} from './execution/hybridEngine';
export { 
  FragmentCacheManager, 
  FragmentType,
  type CachedFragment,
  type FragmentIdentification
} from './caching/fragmentCache';
export { 
  ContextManager,
  type ContextFrame,
  type EntityContext,
  type GoalContext,
  type ContextUpdateResult
} from './context/contextManager';

// Re-export the main service for convenience
export { cortexService } from '../services/cortexService';
export { cortexGatewayMiddleware, enableCortex, cortexResponse, cortexError } from '../middleware/cortexGateway';

/**
 * Initialize Cortex with default configuration
 */
export async function initializeCortex(): Promise<void> {
  const { loggingService } = await import('../services/logging.service');
  
  loggingService.info('Initializing Cortex Meta-Language System', {
    version: '1.0.0',
    environment: process.env.NODE_ENV,
    features: {
      enabled: process.env.CORTEX_ENABLED !== 'false',
      mode: process.env.CORTEX_MODE || 'optional',
      tokenReduction: process.env.CORTEX_TOKEN_REDUCTION !== 'false',
      semanticCaching: process.env.CORTEX_SEMANTIC_CACHING !== 'false',
      modelRouting: process.env.CORTEX_MODEL_ROUTING !== 'false',
      neuralCompression: process.env.CORTEX_NEURAL_COMPRESSION === 'true'
    }
  });
  
  // Initialize dynamic model selection
  const { dynamicModelSelector } = await import('./relay/dynamicModelSelector');
  const models = await dynamicModelSelector.getAvailableModels();
  
  loggingService.info('Cortex initialized with available models', {
    modelCount: models.length,
    providers: Array.from(new Set(models.map(m => m.provider)))
  });
}

/**
 * Quick helper to process text through Cortex
 */
export async function processThroughCortex(
  input: string,
  options?: {
    useCache?: boolean;
    modelOverride?: string;
  }
): Promise<{
  response: string;
  metrics: any;
  optimized: boolean;
}> {
  const { cortexService } = await import('../services/cortexService');
  return cortexService.process(input, options);
}

/**
 * Get Cortex metrics
 */
export async function getCortexMetrics(): Promise<{
  totalRequests: number;
  avgTokenReduction: number;
  avgCostSavings: number;
  avgProcessingTime: number;
  cacheHitRate: number;
}> {
  const { cortexService } = await import('../services/cortexService');
  return cortexService.getMetrics();
}

/**
 * Export a simplified API for external use
 */
export const Cortex = {
  // Processing
  process: processThroughCortex,
  encode: async (input: string) => {
    const { cortexEncoder } = await import('./core/encoder');
    return cortexEncoder.encode(input);
  },
  decode: async (response: any) => {
    const { cortexDecoder } = await import('./core/decoder');
    return cortexDecoder.decode(response);
  },
  
  // Metrics
  getMetrics: getCortexMetrics,
  
  // Configuration
  initialize: initializeCortex,
  isEnabled: async () => {
    const { cortexService } = await import('../services/cortexService');
    return cortexService.isEnabled();
  },
  
  // Cache management
  clearCache: async () => {
    const { cortexService } = await import('../services/cortexService');
    return cortexService.clearCache();
  }
};

export default Cortex;
