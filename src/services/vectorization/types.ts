/**
 * Type definitions for FAISS vector storage system
 * MongoDB remains source of truth, FAISS stores derived embeddings only
 */

import { Document as LangchainDocument } from '@langchain/core/documents';

/**
 * FAISS indices store DERIVED data only.
 * Safe to delete and rebuild from MongoDB + S3.
 * Never treat FAISS as source of truth.
 */
export const DERIVED_VECTOR_SOURCES = [
  'knowledge-base',   // Global index - rebuildable from /knowledge-base/
  'telemetry',        // Global index - rebuildable from MongoDB
  'activity',         // Global index - rebuildable from MongoDB  
  'conversation',     // Per-user index - rebuildable from MongoDB
  'user-upload'       // Per-user index - rebuildable from MongoDB + S3
] as const;

export type VectorSource = typeof DERIVED_VECTOR_SOURCES[number];

// Sources that go to global index (internal/system data)
export const GLOBAL_INDEX_SOURCES: VectorSource[] = [
  'knowledge-base',
  'telemetry', 
  'activity'
];

// Sources that go to per-user indices (user-owned data)
export const USER_INDEX_SOURCES: VectorSource[] = [
  'conversation',
  'user-upload'
];

export interface VectorSearchOptions {
  k?: number;                    // Number of results to return
  filter?: Record<string, any>;  // Metadata filters
  userId?: string;                // User ID for isolation
  scoreThreshold?: number;        // Minimum similarity score
  includeScores?: boolean;        // Include similarity scores
}

export interface VectorSearchResult {
  document: LangchainDocument;
  score: number;
  documentId?: string;
}

export interface IndexHealthStatus {
  indexPath: string;
  exists: boolean;
  isValid: boolean;
  documentCount: number;
  sizeBytes: number;
  lastModified?: Date;
  lastValidation?: Date;
  needsRebuild: boolean;
  error?: string;
}

export interface RecoveryProgress {
  userId?: string;
  indexType: 'global' | 'user';
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  percentComplete: number;
  estimatedTimeRemaining?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
  startTime: Date;
  endTime?: Date;
}

export interface WriteQueueStats {
  queueDepth: number;
  batchesProcessed: number;
  documentsProcessed: number;
  failedWrites: number;
  averageProcessingTime: number;
  lastProcessedAt?: Date;
  isProcessing: boolean;
}

export interface WriteQueueItem {
  id: string;
  userId?: string;
  documents: LangchainDocument[];
  metadata: {
    source: VectorSource;
    timestamp: Date;
    retryCount: number;
    maxRetries: number;
  };
}

export interface ValidationReport {
  timestamp: Date;
  globalIndex: IndexHealthStatus;
  userIndices: Map<string, IndexHealthStatus>;
  totalIndices: number;
  healthyIndices: number;
  corruptedIndices: string[];
  rebuildRequired: string[];
  recommendations: string[];
}

export interface FaissIndexConfig {
  indexPath: string;
  maxLoadedIndices: number;
  writeBatchSize: number;
  writeBatchTimeoutMs: number;
  autoSave: boolean;
  compressionLevel?: number;
}

export interface DivergenceMetrics {
  query: string;
  userId?: string;
  timestamp: Date;
  faissResults: string[];
  mongoResults: string[];
  jaccardSimilarity: number;
  overlapCount: number;
  faissOnlyCount: number;
  mongoOnlyCount: number;
  isAcceptable: boolean;
}