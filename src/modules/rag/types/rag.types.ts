export interface RAGDocument {
  id: string;
  content: string;
  metadata: {
    source?: string;
    title?: string;
    type?: string;
    score?: number;
    [key: string]: any;
  };
}

export interface RAGContext {
  userId: string;
  conversationId?: string;
  projectId?: string;
  recentMessages?: Array<{ role: string; content: string }>;
  domain?: string;
  /**
   * Documents the user explicitly attached to this chat turn. When present,
   * the RetrieveModule short-circuits vector search and pulls the chunks
   * straight from MongoDB by `metadata.documentId`. Set by KnowledgeBaseHandler
   * from the chat DTO's `documentIds` field.
   */
  documentIds?: string[];
}

export interface OrchestratorInput {
  query: string;
  context: RAGContext;
  /** Optional documents passed from preprocessing or previous steps */
  documents?: RAGDocument[];
  preferredPattern?: 'naive' | 'adaptive' | 'iterative' | 'recursive';
  config?: {
    maxDocuments?: number;
    evaluation?: boolean;
    timeout?: number;
    generatedResponse?: string;
  };
  /** Optional metadata passed through preprocessing (e.g. preprocessingTime) */
  metadata?: {
    preprocessingTime?: number;
    originalQueryLength?: number;
    processedQueryLength?: number;
    [key: string]: unknown;
  };
}

export interface RAGResult {
  success: boolean;
  documents: RAGDocument[];
  sources: string[];
  pattern: string;
  confidence: number;
  metadata: {
    processingTime: number;
    totalDocuments: number;
    patternUsed: string;
    queryProcessed?: boolean;
    preprocessingTime?: number;
    evaluation?: {
      faithfulness: number;
      relevance: number;
      answerCorrectness: number;
    };
    evaluationFeedback?: string | string[];
    evaluationRecommendations?: string[];
    evaluationError?: string;
    error?: string;
    errorType?: string;
    [key: string]: unknown;
  };
}

export interface PatternResult {
  documents: RAGDocument[];
  reasoning: string;
  confidence: number;
  metadata: Record<string, any>;
}

export interface ModuleConfig {
  enabled: boolean;
  priority: number;
  timeout: number;
  [key: string]: any;
}
