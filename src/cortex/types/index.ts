/**
 * Cortex Meta-Language Type Definitions
 * Core types for the Cortex semantic optimization system
 */

// ============= Core Expression Types =============

export type FrameType = 
  | 'query' 
  | 'answer' 
  | 'event' 
  | 'state' 
  | 'entity' 
  | 'list' 
  | 'error'
  | 'context'
  | 'temporal_query'
  | 'multimodal_query'
  | 'meta_instruction';

export type PrimitiveType = 
  | 'action' 
  | 'concept' 
  | 'property' 
  | 'modifier' 
  | 'relation';

export interface CortexPrimitive {
  type: PrimitiveType;
  id: string;
  value: string;
  metadata?: Record<string, any>;
}

export interface CortexRole {
  name: string;
  value: any;
  optional?: boolean;
  type?: string;
}

export interface CortexFrame {
  type: string;
  [key: string]: any;
}

export interface CortexExpression {
  type?: string; // Frame type (frame, primitive, list, etc.)
  name?: string; // Name of the frame/entity
  frame: FrameType;
  frames?: CortexFrame[]; // Support multiple frames
  roles: Record<string, any>;
  metadata?: ExpressionMetadata;
  children?: CortexExpression[];
  references?: string[];
  value?: any; // For primitive values
}

export interface ExpressionMetadata {
  id?: string;
  timestamp?: number;
  source?: string;
  confidence?: number;
  version?: string;
  tags?: string[];
  neuralCompression?: {
    enabled: boolean;
    vectorDimensions: number;
    originalHash: string;
    compressionTimestamp: number;
  };
  compressedVector?: number[];
  [key: string]: any; // Allow additional metadata fields
}

// ============= Query and Response Types =============

export interface CortexQuery extends CortexExpression {
  expression?: CortexExpression; // Support for nested expression
  tasks?: any[]; // Multi-task queries for parallel execution
  optimizationHints?: OptimizationHints;
  routingPreferences?: RoutingPreferences;
  executionConstraints?: ExecutionConstraints;
}

export interface CortexResponse extends CortexExpression {
  status: 'success' | 'partial' | 'error';
  response?: CortexExpression; // Support for nested response
  metrics?: ResponseMetrics;
  trace?: ExecutionTrace[];
}

export interface OptimizationHints {
  targetTokenReduction?: number;
  prioritize?: 'speed' | 'cost' | 'quality';
  enableCaching?: boolean;
  enableCompression?: boolean;
  maxLatency?: number;
}

export interface RoutingPreferences {
  preferredModels?: string[];
  excludeModels?: string[];
  minQuality?: number;
  maxCost?: number;
  allowFallback?: boolean;
}

export interface ExecutionConstraints {
  timeout?: number;
  maxRetries?: number;
  parallelExecution?: boolean;
  toolUseAllowed?: boolean;
}

export interface ResponseMetrics {
  originalTokens: number;
  optimizedTokens: number;
  tokenReduction: number;
  processingTime: number;
  costSavings: number;
  modelUsed: string;
  cacheHit: boolean;
  earlyTermination?: boolean;
  qualityPrediction?: { score: number; reason: string; confidence: number };
}

export interface ExecutionTrace {
  step: string;
  timestamp: number;
  duration: number;
  details?: any;
}

// ============= Cortex Fragments (for caching) =============

export interface CortexFragment {
  id: string;
  expression: Partial<CortexExpression>;
  hash: string;
  ttl?: number;
}

export interface CachedResult {
  fragment: CortexFragment;
  result: any;
  timestamp: number;
  hits: number;
}

// ============= Encoding/Decoding Types =============

export interface EncodeOptions {
  language?: string;
  preserveContext?: boolean;
  compressionLevel?: 'none' | 'basic' | 'aggressive' | 'neural';
  includeMetadata?: boolean;
  modelOverride?: string;
}

export interface DecodeOptions {
  targetLanguage?: string;
  format?: 'plain' | 'markdown' | 'html' | 'json';
  style?: 'formal' | 'casual' | 'technical' | 'simple';
  maxLength?: number;
  modelOverride?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  suggestions?: OptimizationSuggestion[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface OptimizationSuggestion {
  type: string;
  description: string;
  potentialSavings?: number;
}

// ============= Model Selection Types =============

export interface ModelSelection {
  modelId: string;
  provider: string;
  capabilities: ModelCapabilities;
  estimatedCost: number;
  estimatedLatency: number;
  confidence: number;
}

export interface ModelCapabilities {
  maxTokens: number;
  supportedLanguages: string[];
  specializations: string[];
  costPerToken: number;
  averageLatency: number;
}

// ============= Plugin System Types =============

export interface PluginContext {
  cortexVersion: string;
  config: any;
  logger: any;
  metrics: any;
  cache?: any;
}

export interface CortexPlugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  
  // Lifecycle hooks
  onInit?(context: PluginContext): Promise<void>;
  onEncode?(input: string, options: EncodeOptions, context: PluginContext): Promise<CortexQuery>;
  onOptimize?(query: CortexQuery, context: PluginContext): Promise<CortexQuery>;
  onRoute?(query: CortexQuery, context: PluginContext): Promise<ModelSelection>;
  onExecute?(query: CortexQuery, context: PluginContext): Promise<CortexResponse>;
  onDecode?(response: CortexResponse, options: DecodeOptions, context: PluginContext): Promise<string>;
  onCache?(fragment: CortexFragment, context: PluginContext): Promise<void>;
  onMetrics?(metrics: ResponseMetrics, context: PluginContext): Promise<void>;
  onError?(error: Error, context: PluginContext): Promise<void>;
  onDestroy?(): Promise<void>;
}

// ============= Configuration Types =============

export interface CortexConfig {
  enabled: boolean;
  mode: 'mandatory' | 'optional' | 'disabled';
  
  optimization: {
    tokenReduction: boolean;
    semanticCaching: boolean;
    modelRouting: boolean;
    binarySerialization: boolean;
    neuralCompression: boolean;
    fragmentCaching: boolean;
    predictivePrefetching: boolean;
  };
  
  gateway: {
    headerName: string;
    queryParam: string;
    cookieName?: string;
    defaultEnabled: boolean;
    allowOverride: boolean;
  };
  
  cache: {
    provider: 'redis' | 'memory' | 'hybrid';
    ttl: number;
    maxSize: number;
    evictionPolicy: 'lru' | 'lfu' | 'fifo';
  };
  
  plugins: {
    enabled: string[];
    config: Record<string, any>;
    autoLoad: boolean;
    directory?: string;
  };
  
  monitoring: {
    metricsEnabled: boolean;
    loggingLevel: 'debug' | 'info' | 'warn' | 'error';
    traceEnabled: boolean;
    sampleRate: number;
  };
  
  limits: {
    maxExpressionDepth: number;
    maxRoleCount: number;
    maxReferenceDepth: number;
    maxCacheSize: number;
  };
}

// ============= Primitive Vocabulary Types =============

export interface PrimitiveVocabulary {
  actions: Record<string, string>;
  concepts: Record<string, string>;
  properties: Record<string, string>;
  modifiers: Record<string, string>;
  relations: Record<string, string>;
  custom?: Record<string, Record<string, string>>;
}

// ============= Binary Serialization Types =============

export interface BinaryFormat {
  version: number;
  compressed: boolean;
  encryption?: 'none' | 'aes256' | 'rsa';
  checksum?: string;
  data: Uint8Array;
}

export interface CompressedQuery {
  format: 'binary' | 'vector' | 'hybrid';
  data: Uint8Array | number[];
  metadata: CompressionMetadata;
}

export interface CompressionMetadata {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  algorithm: string;
  timestamp: number;
}

// ============= Advanced Features Types =============

export interface NeuralCompressionVector {
  dimensions: number;
  values: Float32Array;
  model: string;
  version: string;
}

export interface TemporalContext {
  timeframe: 'past' | 'present' | 'future';
  duration?: number;
  reference?: Date;
  granularity?: 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
}

export interface MultimodalData {
  type: 'image' | 'audio' | 'video' | 'sensor';
  encoding: string;
  data: Uint8Array | string;
  metadata: Record<string, any>;
}

export interface EmotionalContext {
  emotion: string;
  confidence: number;
  history?: EmotionalState[];
  responseStrategy?: string;
}

export interface EmotionalState {
  emotion: string;
  timestamp: number;
  trigger?: string;
}

// ============= Export utility type guards =============

export const isCortexExpression = (obj: any): obj is CortexExpression => {
  return obj && typeof obj.frame === 'string' && typeof obj.roles === 'object';
};

export const isCortexQuery = (obj: any): obj is CortexQuery => {
  return isCortexExpression(obj) && ('optimizationHints' in obj || 'routingPreferences' in obj);
};

export const isCortexResponse = (obj: any): obj is CortexResponse => {
  return isCortexExpression(obj) && 'status' in obj;
};

export const isValidFrameType = (frame: string): frame is FrameType => {
  const validFrames: FrameType[] = ['query', 'answer', 'event', 'state', 'entity', 'list', 'error', 'context', 'temporal_query', 'multimodal_query', 'meta_instruction'];
  return validFrames.includes(frame as FrameType);
};
