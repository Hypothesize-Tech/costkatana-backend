/**
 * Default RAG Configuration
 * Provides sensible defaults for all patterns and modules
 */

import { RAGConfig, OrchestratorConfig } from '../types/rag.types';

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  pattern: 'adaptive', // Default to adaptive for efficiency
  modules: {
    routing: {
      enabled: true,
      strategy: 'hybrid',
    },
    retrieve: {
      enabled: true,
      limit: 5,
      similarityThreshold: 0.7,
      useCache: true,
    },
    rewrite: {
      enabled: false, // Disabled by default for performance
      methods: ['reformulation'],
      expansionTerms: 2,
    },
    rerank: {
      enabled: true,
      topK: 5,
      useLLM: false, // Use heuristic reranking by default
      scoreThreshold: 0.5,
    },
    read: {
      enabled: true,
      maxTokens: 4000,
      compressionRatio: 0.5,
      extractionStrategy: 'key-points',
    },
    predict: {
      enabled: false, // Disabled by default
      generateHypothesis: false,
      numHypotheses: 1,
    },
    fusion: {
      enabled: false, // Only for multi-source retrieval
      strategy: 'rrf',
      deduplicationThreshold: 0.85,
    },
    demonstrate: {
      enabled: false, // Only when few-shot needed
      numExamples: 3,
      selectionStrategy: 'similarity',
    },
    memory: {
      enabled: true,
      windowSize: 5,
      retentionStrategy: 'recency',
      semanticCompression: false,
    },
  },
  iterations: 2, // For iterative pattern
  maxDepth: 2, // For recursive pattern
  adaptiveThreshold: 0.7, // For adaptive pattern
  caching: {
    enabled: true,
    ttl: 3600,
    strategy: 'semantic',
    redisEnabled: true,
  },
  evaluation: {
    enabled: false, // Enable in development/testing
    metrics: ['relevance', 'faithfulness'],
    logResults: false,
  },
};

export const NAIVE_RAG_CONFIG: RAGConfig = {
  ...DEFAULT_RAG_CONFIG,
  pattern: 'naive',
  modules: {
    ...DEFAULT_RAG_CONFIG.modules,
    routing: { enabled: false },
    rewrite: { enabled: false },
    rerank: { enabled: false },
    memory: { enabled: false },
  },
};

export const ADAPTIVE_RAG_CONFIG: RAGConfig = {
  ...DEFAULT_RAG_CONFIG,
  pattern: 'adaptive',
  adaptiveThreshold: 0.7,
  modules: {
    ...DEFAULT_RAG_CONFIG.modules,
    rerank: { ...DEFAULT_RAG_CONFIG.modules.rerank, enabled: true },
  },
};

export const ITERATIVE_RAG_CONFIG: RAGConfig = {
  ...DEFAULT_RAG_CONFIG,
  pattern: 'iterative',
  iterations: 3,
  modules: {
    ...DEFAULT_RAG_CONFIG.modules,
    rerank: { ...DEFAULT_RAG_CONFIG.modules.rerank, enabled: true },
    rewrite: { enabled: true, methods: ['reformulation'], expansionTerms: 2 },
  },
};

export const RECURSIVE_RAG_CONFIG: RAGConfig = {
  ...DEFAULT_RAG_CONFIG,
  pattern: 'recursive',
  maxDepth: 2,
  modules: {
    ...DEFAULT_RAG_CONFIG.modules,
    rerank: { ...DEFAULT_RAG_CONFIG.modules.rerank, enabled: true },
  },
};

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  defaultPattern: 'adaptive',
  autoSelectPattern: true,
  patternSelectionModel: 'amazon.nova-micro-v1:0',
  fallbackPattern: 'naive',
  maxRetries: 2,
};

/**
 * Get configuration for a specific pattern
 */
export function getPatternConfig(pattern: string): RAGConfig {
  switch (pattern) {
    case 'naive':
      return NAIVE_RAG_CONFIG;
    case 'adaptive':
      return ADAPTIVE_RAG_CONFIG;
    case 'iterative':
      return ITERATIVE_RAG_CONFIG;
    case 'recursive':
      return RECURSIVE_RAG_CONFIG;
    default:
      return DEFAULT_RAG_CONFIG;
  }
}

