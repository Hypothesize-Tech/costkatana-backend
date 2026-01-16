/**
 * Grounding Confidence Layer (GCL) Type Definitions
 * 
 * Defines types for pre-generation grounding evaluation.
 * GCL measures input sufficiency, NOT answer correctness.
 */

export type QueryType = 'FACTUAL' | 'OPINION' | 'ACTION' | 'MIXED';
export type DecisionType = 'GENERATE' | 'ASK_CLARIFY' | 'SEARCH_MORE' | 'REFUSE';
export type AgentType = 'MASTER' | 'OPTIMIZER' | 'QA' | 'MEMORY' | 'WEB_SCRAPER';
export type SourceType = 'doc' | 'memory' | 'web' | 'integration';

/**
 * Source of grounding information
 */
export interface GroundingSource {
  sourceType: SourceType;
  sourceId: string;
  similarity: number;
  timestamp?: number; // Unix timestamp
}

/**
 * Cache information for freshness scoring
 */
export interface CacheInfo {
  used: boolean;
  freshnessScore?: number; // 0–1
  validUntil?: number; // Unix timestamp
  cacheType?: 'semantic' | 'integration' | 'vector';
}

/**
 * Intent signals for clarity assessment
 */
export interface IntentInfo {
  confidence: number; // 0-1
  ambiguous: boolean;
}

/**
 * Retrieval quality signals
 */
export interface RetrievalInfo {
  hitCount: number;
  maxSimilarity: number;
  meanSimilarity: number;
  sources: GroundingSource[];
}

/**
 * Complete context for grounding evaluation
 */
export interface GroundingContext {
  query: string;
  queryType: QueryType;
  retrieval: RetrievalInfo;
  cache?: CacheInfo;
  intent: IntentInfo;
  agentType: AgentType;
  timeSensitive: boolean;
  
  // Optional context
  userId?: string;
  conversationId?: string;
  documentIds?: string[]; // For user-uploaded document queries
  
  // Critical safeguards
  contextDriftHigh?: boolean; // From cortexContextManager
  clarificationAttempts?: number;
  searchAttempts?: number;
}

/**
 * Component scores from grounding evaluation
 */
export interface GroundingMetrics {
  retrievalScore: number;
  intentScore: number;
  freshnessScore: number;
  sourceDiversityScore: number;
  finalScore: number;
}

/**
 * Grounding decision with reasoning
 */
export interface GroundingDecision {
  groundingScore: number; // 0–1
  decision: DecisionType;
  reasons: string[];
  metrics: GroundingMetrics;
  timestamp: number;
  
  // Additional metadata for debugging
  prohibitMemoryWrite?: boolean;
}

/**
 * Configurable thresholds for decision logic
 */
export interface GroundingThresholds {
  refuse: number; // Default: 0.45
  askClarify: number; // For intent, default: 0.7
  searchMore: number; // For cache freshness, default: 0.6
  intentMinimum: number; // Default: 0.7
  optimizerRetrievalMinimum: number; // Default: 0.7
  cacheMinimumFreshness: number; // Default: 0.6
  contextDriftIntentThreshold: number; // Default: 0.75
}

/**
 * Configurable weights for composite scoring
 */
export interface GroundingWeights {
  retrieval: number; // Default: 0.35
  intent: number; // Default: 0.25
  freshness: number; // Default: 0.20
  diversity: number; // Default: 0.20
}

/**
 * Feature flags for GCL rollout
 */
export interface GroundingConfig {
  shadowMode: boolean;
  blockingEnabled: boolean;
  strictRefusal: boolean;
  loggingEnabled: boolean;
  emergencyBypass: boolean;
}

/**
 * Explainability information for future UX
 */
export interface GroundingExplanation {
  missing: string[]; // What information is missing
  weakSignals: string[]; // What signals are below threshold
  strongSignals?: string[]; // What signals passed strongly
}

/**
 * Domain risk levels for stricter thresholds
 */
export type DomainRisk = 'FINANCE' | 'SECURITY' | 'LEGAL' | 'HEALTHCARE' | 'GENERAL';
