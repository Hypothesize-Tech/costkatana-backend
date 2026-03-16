import { ModuleConfig } from '../types/rag.types';

export const DEFAULT_RAG_CONFIG = {
  // Pattern configurations
  patterns: {
    naive: {
      enabled: true,
      priority: 1,
      maxDocuments: 5,
      timeout: 5000,
    },
    adaptive: {
      enabled: true,
      priority: 2,
      maxDocuments: 10,
      timeout: 10000,
      llmAnalysis: true,
    },
    iterative: {
      enabled: true,
      priority: 3,
      maxDocuments: 15,
      timeout: 15000,
      maxIterations: 3,
    },
    recursive: {
      enabled: true,
      priority: 4,
      maxDocuments: 20,
      timeout: 20000,
      maxDepth: 3,
    },
  },

  // Module configurations
  modules: {
    retrieve: {
      enabled: true,
      priority: 1,
      timeout: 3000,
      strategies: ['knowledge_base', 'user_documents', 'contextual'],
    } as ModuleConfig,
    rerank: {
      enabled: true,
      priority: 2,
      timeout: 2000,
      method: 'semantic',
    } as ModuleConfig,
    rewrite: {
      enabled: true,
      priority: 3,
      timeout: 2000,
      strategies: ['clarify', 'expand', 'decompose'],
    } as ModuleConfig,
    routing: {
      enabled: true,
      priority: 4,
      timeout: 1000,
      rules: ['domain', 'complexity', 'intent'],
    } as ModuleConfig,
    read: {
      enabled: true,
      priority: 5,
      timeout: 3000,
      extractors: ['summary', 'key_points', 'full_content'],
    } as ModuleConfig,
    fusion: {
      enabled: true,
      priority: 6,
      timeout: 2000,
      method: 'weighted',
    } as ModuleConfig,
    predict: {
      enabled: true,
      priority: 7,
      timeout: 3000,
      horizon: 'short_term',
    } as ModuleConfig,
    demonstrate: {
      enabled: true,
      priority: 8,
      timeout: 2000,
      examples: ['similar_queries', 'patterns'],
    } as ModuleConfig,
    memory: {
      enabled: true,
      priority: 9,
      timeout: 2000,
      contextWindow: 10,
    } as ModuleConfig,
  },

  // Evaluation configuration
  evaluation: {
    enabled: true,
    metrics: ['faithfulness', 'relevance', 'answer_correctness'],
    threshold: 0.7,
  },

  // Global settings
  global: {
    maxProcessingTime: 30000,
    defaultPattern: 'adaptive',
    enableCaching: true,
    cacheTTL: 300000, // 5 minutes
  },
};
