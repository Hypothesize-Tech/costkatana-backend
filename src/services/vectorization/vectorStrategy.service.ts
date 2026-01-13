/**
 * Vector Strategy Service
 * Unified interface for all vector operations
 * Routes between FAISS and MongoDB based on configuration and data type
 */

import { Document as LangchainDocument } from '@langchain/core/documents';
import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from '../safeBedrockEmbeddings';
import { loggingService } from '../logging.service';
import { faissVectorService } from './faiss.service';
import { MongoDBVectorStore, createMongoDBVectorStore } from '../langchainVectorStore.service';
import { DocumentModel } from '../../models/Document';
import {
  VectorSearchOptions,
  VectorSearchResult,
  VectorSource,
  DivergenceMetrics,
  USER_INDEX_SOURCES,
  DERIVED_VECTOR_SOURCES
} from './types';

export class VectorStrategyService {
  private embeddings: SafeBedrockEmbeddings;
  private mongoVectorStore?: MongoDBVectorStore;
  private isInitialized = false;
  
  // Feature flags
  private enableFaissDualWrite: boolean;
  private enableFaissShadowRead: boolean;
  private enableFaissPrimary: boolean;
  
  // Metrics collection
  private divergenceMetrics: DivergenceMetrics[] = [];
  private maxMetricsHistory = 1000;

  constructor() {
    this.embeddings = createSafeBedrockEmbeddings({
      model: 'amazon.titan-embed-text-v2:0'
    });

    // Load feature flags from environment
    this.enableFaissDualWrite = true;
    this.enableFaissShadowRead = true;
    this.enableFaissPrimary = true;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      loggingService.info('Initializing Vector Strategy Service', {
        component: 'VectorStrategyService',
        flags: {
          dualWrite: this.enableFaissDualWrite,
          shadowRead: this.enableFaissShadowRead,
          faissPrimary: this.enableFaissPrimary
        }
      });

      // Initialize FAISS if any FAISS features are enabled
      if (this.enableFaissDualWrite || this.enableFaissShadowRead || this.enableFaissPrimary) {
        await faissVectorService.initialize();
      }

      // Initialize MongoDB vector store if not using FAISS as primary
      if (!this.enableFaissPrimary) {
        this.mongoVectorStore = createMongoDBVectorStore(this.embeddings);
      }

      this.isInitialized = true;
      
      loggingService.info('Vector Strategy Service initialized', {
        component: 'VectorStrategyService'
      });
    } catch (error) {
      loggingService.error('Failed to initialize Vector Strategy Service', {
        component: 'VectorStrategyService',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Add documents to vector store(s)
   */
  async add(
    documents: LangchainDocument[],
    metadata: {
      source: VectorSource;
      userId?: string;
      projectId?: string;
      documentId?: string;
    }
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { source, userId, projectId, documentId } = metadata;

    // Validate source
    if (!DERIVED_VECTOR_SOURCES.includes(source)) {
      throw new Error(`Invalid vector source: ${source}`);
    }

    // Validate user isolation
    if (USER_INDEX_SOURCES.includes(source) && !userId) {
      throw new Error(`User ID required for source: ${source}`);
    }

    try {
      // Phase A: Dual-write to both MongoDB and FAISS
      if (this.enableFaissDualWrite) {
        // Write to MongoDB first (source of truth)
        if (this.mongoVectorStore) {
          await this.mongoVectorStore.addDocuments(documents, {
            userId,
            projectId,
            documentId
          });
        }

        // Then write to FAISS
        await faissVectorService.addDocuments(documents, source, userId);
        
        loggingService.info('Dual-write completed', {
          component: 'VectorStrategyService',
          operation: 'add',
          documentCount: documents.length,
          source,
          userId
        });
      } 
      // Phase C/D: FAISS as primary
      else if (this.enableFaissPrimary) {
        // Write to FAISS only
        await faissVectorService.addDocuments(documents, source, userId);
        
        loggingService.info('FAISS write completed', {
          component: 'VectorStrategyService',
          operation: 'add',
          documentCount: documents.length,
          source,
          userId
        });
      }
      // Default: MongoDB only
      else {
        if (!this.mongoVectorStore) {
          throw new Error('MongoDB vector store not initialized');
        }
        
        await this.mongoVectorStore.addDocuments(documents, {
          userId,
          projectId,
          documentId
        });
        
        loggingService.info('MongoDB write completed', {
          component: 'VectorStrategyService',
          operation: 'add',
          documentCount: documents.length,
          source,
          userId
        });
      }
    } catch (error) {
      loggingService.error('Failed to add documents', {
        component: 'VectorStrategyService',
        operation: 'add',
        source,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Search for similar documents
   */
  async search(
    query: string,
    k: number = 4,
    userId?: string,
    filter?: Record<string, any>
  ): Promise<VectorSearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const options: VectorSearchOptions = {
      k,
      userId,
      filter,
      includeScores: true
    };

    try {
      // Phase B: Shadow read (query both, compare results)
      if (this.enableFaissShadowRead && !this.enableFaissPrimary) {
        const [faissResults, mongoResults] = await Promise.all([
          this.searchFaiss(query, options),
          this.searchMongoDB(query, options)
        ]);

        // Log divergence metrics
        this.logDivergence(query, userId, faissResults, mongoResults);

        // Return MongoDB results (no user impact)
        return mongoResults;
      }
      
      // Phase C: FAISS primary with MongoDB fallback
      else if (this.enableFaissPrimary) {
        try {
          const results = await this.searchFaiss(query, options);
          
          loggingService.info('FAISS search successful', {
            component: 'VectorStrategyService',
            operation: 'search',
            resultsCount: results.length
          });
          
          return results;
        } catch (error) {
          loggingService.warn('FAISS search failed, falling back to MongoDB', {
            component: 'VectorStrategyService',
            operation: 'search',
            error: error instanceof Error ? error.message : String(error)
          });
          
          // Fallback to MongoDB
          return await this.searchMongoDB(query, options);
        }
      }
      
      // Default: MongoDB only
      else {
        return await this.searchMongoDB(query, options);
      }
    } catch (error) {
      loggingService.error('Search failed', {
        component: 'VectorStrategyService',
        operation: 'search',
        query: query.substring(0, 50),
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Search using FAISS
   */
  private async searchFaiss(
    query: string,
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    const faissResults = await faissVectorService.search(query, options);
    
    // Enrich with MongoDB metadata if needed
    const enrichedResults: VectorSearchResult[] = [];
    
    for (const result of faissResults) {
      if (result.documentId) {
        try {
          const doc = await DocumentModel.findById(result.documentId).lean();
          if (doc) {
            result.document.metadata = {
              ...result.document.metadata,
              ...doc.metadata
            };
          }
        } catch (error) {
          loggingService.warn('Failed to enrich FAISS result with MongoDB metadata', {
            component: 'VectorStrategyService',
            documentId: result.documentId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      enrichedResults.push(result);
    }
    
    return enrichedResults;
  }

  /**
   * Search using MongoDB
   */
  private async searchMongoDB(
    query: string,
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    if (!this.mongoVectorStore) {
      throw new Error('MongoDB vector store not initialized');
    }
    
    const { k = 4, userId, filter } = options;
    
    // Build MongoDB filter
    const mongoFilter: any = { ...filter };
    if (userId) {
      mongoFilter['metadata.userId'] = userId;
    }
    
    const results = await this.mongoVectorStore.similaritySearchWithScore(
      query,
      k,
      mongoFilter
    );
    
    return results.map(([doc, score]) => ({
      document: doc,
      score,
      documentId: doc.metadata?.documentId
    }));
  }

  /**
   * Log divergence between FAISS and MongoDB results
   */
  private logDivergence(
    query: string,
    userId: string | undefined,
    faissResults: VectorSearchResult[],
    mongoResults: VectorSearchResult[]
  ): void {
    const faissIds = new Set(faissResults.map(r => r.documentId).filter(Boolean));
    const mongoIds = new Set(mongoResults.map(r => r.documentId).filter(Boolean));
    
    // Calculate Jaccard similarity
    const intersection = new Set([...faissIds].filter(x => mongoIds.has(x)));
    const union = new Set([...faissIds, ...mongoIds]);
    const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 1;
    
    // Count unique results
    const faissOnly = [...faissIds].filter(x => !mongoIds.has(x));
    const mongoOnly = [...mongoIds].filter(x => !faissIds.has(x));
    
    const metrics: DivergenceMetrics = {
      query,
      userId,
      timestamp: new Date(),
      faissResults: Array.from(faissIds) as string[],
      mongoResults: Array.from(mongoIds) as string[],
      jaccardSimilarity,
      overlapCount: intersection.size,
      faissOnlyCount: faissOnly.length,
      mongoOnlyCount: mongoOnly.length,
      isAcceptable: jaccardSimilarity >= 0.7 // 70% overlap threshold
    };
    
    // Store metrics
    this.divergenceMetrics.push(metrics);
    if (this.divergenceMetrics.length > this.maxMetricsHistory) {
      this.divergenceMetrics.shift();
    }
    
    // Log divergence
    const logLevel = metrics.isAcceptable ? 'info' : 'warn';
    loggingService[logLevel]('Shadow read divergence', {
      component: 'VectorStrategyService',
      operation: 'logDivergence',
      query: query.substring(0, 50),
      userId,
      jaccardSimilarity: jaccardSimilarity.toFixed(3),
      overlapCount: metrics.overlapCount,
      faissOnlyCount: metrics.faissOnlyCount,
      mongoOnlyCount: metrics.mongoOnlyCount,
      isAcceptable: metrics.isAcceptable
    });
  }

  /**
   * Get divergence metrics for analysis
   */
  getDivergenceMetrics(): DivergenceMetrics[] {
    return [...this.divergenceMetrics];
  }

  /**
   * Get divergence statistics
   */
  getDivergenceStats(): {
    totalComparisons: number;
    averageJaccard: number;
    acceptablePercentage: number;
    lastComparison?: Date;
  } {
    if (this.divergenceMetrics.length === 0) {
      return {
        totalComparisons: 0,
        averageJaccard: 0,
        acceptablePercentage: 0
      };
    }
    
    const totalComparisons = this.divergenceMetrics.length;
    const averageJaccard = this.divergenceMetrics.reduce(
      (sum, m) => sum + m.jaccardSimilarity, 0
    ) / totalComparisons;
    const acceptableCount = this.divergenceMetrics.filter(m => m.isAcceptable).length;
    const acceptablePercentage = (acceptableCount / totalComparisons) * 100;
    const lastComparison = this.divergenceMetrics[this.divergenceMetrics.length - 1].timestamp;
    
    return {
      totalComparisons,
      averageJaccard,
      acceptablePercentage,
      lastComparison
    };
  }

  /**
   * Update feature flags (for runtime configuration)
   */
  updateFeatureFlags(flags: {
    enableFaissDualWrite?: boolean;
    enableFaissShadowRead?: boolean;
    enableFaissPrimary?: boolean;
  }): void {
    if (flags.enableFaissDualWrite !== undefined) {
      this.enableFaissDualWrite = flags.enableFaissDualWrite;
    }
    if (flags.enableFaissShadowRead !== undefined) {
      this.enableFaissShadowRead = flags.enableFaissShadowRead;
    }
    if (flags.enableFaissPrimary !== undefined) {
      this.enableFaissPrimary = flags.enableFaissPrimary;
      
      // Re-initialize MongoDB if switching away from FAISS primary
      if (!flags.enableFaissPrimary && !this.mongoVectorStore) {
        this.mongoVectorStore = createMongoDBVectorStore(this.embeddings);
      }
    }
    
    loggingService.info('Feature flags updated', {
      component: 'VectorStrategyService',
      flags: {
        dualWrite: this.enableFaissDualWrite,
        shadowRead: this.enableFaissShadowRead,
        faissPrimary: this.enableFaissPrimary
      }
    });
  }

  /**
   * Get current feature flags
   */
  getFeatureFlags(): {
    enableFaissDualWrite: boolean;
    enableFaissShadowRead: boolean;
    enableFaissPrimary: boolean;
  } {
    return {
      enableFaissDualWrite: this.enableFaissDualWrite,
      enableFaissShadowRead: this.enableFaissShadowRead,
      enableFaissPrimary: this.enableFaissPrimary
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    loggingService.info('Shutting down Vector Strategy Service', {
      component: 'VectorStrategyService'
    });
    
    // Shutdown FAISS if initialized
    if (this.enableFaissDualWrite || this.enableFaissShadowRead || this.enableFaissPrimary) {
      await faissVectorService.shutdown();
    }
  }
}

// Export singleton instance
export const vectorStrategyService = new VectorStrategyService();