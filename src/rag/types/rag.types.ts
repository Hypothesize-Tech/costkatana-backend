/**
 * Modular RAG Type Definitions
 * Comprehensive type system for modular RAG architecture
 */

import { Document } from '@langchain/core/documents';
import { BaseMessage } from '@langchain/core/messages';

// ============================================================================
// Core RAG Types
// ============================================================================

export type RAGPatternType = 'naive' | 'adaptive' | 'iterative' | 'recursive';

export type RAGModuleType = 
  | 'routing' 
  | 'retrieve' 
  | 'rewrite' 
  | 'rerank' 
  | 'read' 
  | 'predict' 
  | 'fusion' 
  | 'demonstrate' 
  | 'memory';

// ============================================================================
// Module Input/Output Types
// ============================================================================

export interface RAGModuleInput {
  query: string;
  context?: RAGContext;
  documents?: Document[];
  metadata?: Record<string, unknown>;
  config?: ModuleConfig;
}

export interface RAGModuleOutput {
  success: boolean;
  data?: Record<string, unknown> | string[] | Document[];
  documents?: Document[];
  query?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  performance?: {
    startTime: number;
    endTime: number;
    duration: number;
  };
}

// ============================================================================
// RAG Context
// ============================================================================

export interface RAGContext {
  userId?: string;
  conversationId?: string;
  projectId?: string;
  recentMessages?: Array<{ role: string; content: string }>;
  currentTopic?: string;
  previousQueries?: string[];
  retrievalHistory?: RetrievalHistoryItem[];
  sessionMetadata?: Record<string, unknown>;
}

export interface RetrievalHistoryItem {
  query: string;
  documents: Document[];
  timestamp: Date;
  relevanceScore?: number;
}

// ============================================================================
// Module Configurations
// ============================================================================

export interface ModuleConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface RoutingConfig extends ModuleConfig {
  strategy?: 'semantic' | 'keyword' | 'hybrid' | 'ml-based';
  routes?: RouteDefinition[];
  fallbackRoute?: string;
}

export interface RouteDefinition {
  name: string;
  patterns: string[];
  priority: number;
  datasource?: string;
}

export interface RetrievalConfig extends ModuleConfig {
  limit?: number;
  similarityThreshold?: number;
  useCache?: boolean;
  sources?: string[];
  filters?: RetrievalFilters;
  hybridAlpha?: number; // Balance between vector and keyword search
}

export interface RetrievalFilters {
  source?: string[];
  dateRange?: { from: Date; to: Date };
  tags?: string[];
  projectId?: string;
  conversationId?: string;
  documentIds?: string[];
}

export interface RewriteConfig extends ModuleConfig {
  methods?: Array<'expansion' | 'reformulation' | 'hyde' | 'decomposition'>;
  expansionTerms?: number;
  useThesaurus?: boolean;
  contextWindow?: number;
}

export interface RerankConfig extends ModuleConfig {
  model?: string;
  topK?: number;
  useLLM?: boolean;
  scoreThreshold?: number;
  diversityPenalty?: number;
}

export interface ReadConfig extends ModuleConfig {
  maxTokens?: number;
  compressionRatio?: number;
  summarizationModel?: string;
  extractionStrategy?: 'full' | 'summary' | 'key-points';
}

export interface PredictConfig extends ModuleConfig {
  model?: string;
  generateHypothesis?: boolean;
  numHypotheses?: number;
  temperature?: number;
}

export interface FusionConfig extends ModuleConfig {
  strategy?: 'rrf' | 'weighted' | 'dbsf' | 'llm-based';
  weights?: Record<string, number>;
  deduplicationThreshold?: number;
}

export interface DemonstrateConfig extends ModuleConfig {
  numExamples?: number;
  selectionStrategy?: 'similarity' | 'diversity' | 'coverage';
  exampleSource?: string;
}

export interface MemoryConfig extends ModuleConfig {
  windowSize?: number;
  retentionStrategy?: 'fifo' | 'importance' | 'recency';
  semanticCompression?: boolean;
}

// ============================================================================
// Pattern Configurations
// ============================================================================

export interface RAGConfig {
  pattern: RAGPatternType;
  modules: {
    routing?: RoutingConfig;
    retrieve?: RetrievalConfig;
    rewrite?: RewriteConfig;
    rerank?: RerankConfig;
    read?: ReadConfig;
    predict?: PredictConfig;
    fusion?: FusionConfig;
    demonstrate?: DemonstrateConfig;
    memory?: MemoryConfig;
  };
  // Pattern-specific settings
  iterations?: number; // For iterative pattern
  maxDepth?: number; // For recursive pattern
  adaptiveThreshold?: number; // For adaptive pattern
  caching?: CachingConfig;
  evaluation?: EvaluationConfig;
}

export interface CachingConfig {
  enabled: boolean;
  ttl?: number;
  strategy?: 'semantic' | 'exact' | 'hybrid';
  redisEnabled?: boolean;
}

export interface EvaluationConfig {
  enabled: boolean;
  metrics?: Array<'relevance' | 'faithfulness' | 'precision' | 'recall'>;
  logResults?: boolean;
}

// ============================================================================
// Pattern-Specific Types
// ============================================================================

// Iterative Pattern
export interface IterativeState {
  currentIteration: number;
  maxIterations: number;
  partialAnswer: string;
  retrievedDocuments: Document[][];
  refinementQuery: string;
  converged: boolean;
}

// Recursive Pattern
export interface RecursiveState {
  originalQuery: string;
  subQuestions: SubQuestion[];
  depth: number;
  maxDepth: number;
  results: Map<string, SubQuestionResult>;
}

export interface SubQuestion {
  id: string;
  question: string;
  parentId?: string;
  depth: number;
  dependencies?: string[];
}

export interface SubQuestionResult {
  questionId: string;
  answer: string;
  documents: Document[];
  confidence: number;
}

// Adaptive Pattern
export interface AdaptiveState {
  query: string;
  retrievalDecision: 'retrieve' | 'parametric' | 'hybrid';
  confidence: number;
  reasoning: string;
  selfReflection?: SelfReflectionResult;
}

export interface SelfReflectionResult {
  needsRetrieval: boolean;
  answerQuality: 'high' | 'medium' | 'low';
  missingInformation?: string[];
  confidence: number;
}

// ============================================================================
// RAG Result Types
// ============================================================================

export interface RAGResult {
  success: boolean;
  answer: string;
  documents: Document[];
  sources: string[];
  metadata: RAGMetadata;
  error?: string;
}

export interface RAGMetadata {
  pattern: RAGPatternType;
  modulesUsed: RAGModuleType[];
  retrievalCount: number;
  totalDocuments: number;
  performance: PerformanceMetrics;
  cacheHit: boolean;
  evaluation?: EvaluationMetrics;
}

export interface PerformanceMetrics {
  totalDuration: number;
  retrievalDuration: number;
  generationDuration: number;
  moduleDurations: Record<string, number>;
  tokenCount?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
}

export interface EvaluationMetrics {
  contextRelevance?: number;
  answerFaithfulness?: number;
  answerRelevance?: number;
  retrievalPrecision?: number;
  retrievalRecall?: number;
  overall?: number;
}

// ============================================================================
// Module Interface
// ============================================================================

export interface IRAGModule {
  name: string;
  type: RAGModuleType;
  
  /**
   * Execute the module's core functionality
   */
  execute(input: RAGModuleInput): Promise<RAGModuleOutput>;
  
  /**
   * Validate module configuration
   */
  validateConfig(): boolean;
  
  /**
   * Get module metadata
   */
  getMetadata(): ModuleMetadata;
}

export interface ModuleMetadata {
  name: string;
  type: RAGModuleType;
  version: string;
  description: string;
  capabilities: string[];
  dependencies?: RAGModuleType[];
}

// ============================================================================
// Pattern Interface
// ============================================================================

export interface IRAGPattern {
  name: string;
  type: RAGPatternType;
  config: RAGConfig;
  
  /**
   * Execute the pattern with given query and context
   */
  execute(query: string, context: RAGContext): Promise<RAGResult>;
  
  /**
   * Get pattern description
   */
  getDescription(): PatternDescription;
}

export interface PatternDescription {
  name: string;
  type: RAGPatternType;
  description: string;
  useCases: string[];
  complexity: 'low' | 'medium' | 'high';
  avgLatency?: number;
  avgCost?: number;
}

// ============================================================================
// Orchestrator Types
// ============================================================================

export interface OrchestratorConfig {
  defaultPattern: RAGPatternType;
  autoSelectPattern?: boolean;
  patternSelectionModel?: string;
  fallbackPattern?: RAGPatternType;
  maxRetries?: number;
}

export interface OrchestratorInput {
  query: string;
  context: RAGContext;
  preferredPattern?: RAGPatternType;
  config?: Partial<RAGConfig>;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface QueryAnalysis {
  complexity: 'simple' | 'moderate' | 'complex';
  type: 'factual' | 'analytical' | 'comparative' | 'exploratory';
  requiresRetrieval: boolean;
  suggestedPattern: RAGPatternType;
  confidence: number;
  reasoning: string;
}

export interface DocumentScore {
  document: Document;
  score: number;
  relevanceFactors: {
    semantic: number;
    keyword: number;
    recency?: number;
    authority?: number;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export class RAGModuleError extends Error {
  constructor(
    public moduleName: string,
    public moduleType: RAGModuleType,
    message: string,
    public originalError?: Error
  ) {
    super(`[${moduleName}] ${message}`);
    this.name = 'RAGModuleError';
  }
}

export class RAGPatternError extends Error {
  constructor(
    public patternType: RAGPatternType,
    message: string,
    public originalError?: Error
  ) {
    super(`[${patternType}] ${message}`);
    this.name = 'RAGPatternError';
  }
}

// ============================================================================
// Export all types
// ============================================================================

export type {
  Document,
  BaseMessage,
};

