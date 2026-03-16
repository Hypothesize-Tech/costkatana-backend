/**
 * Vector Strategy Service for NestJS
 * Unified interface for all vector operations
 * Routes between FAISS and MongoDB based on configuration and data type
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document as LangchainDocument } from '@langchain/core/documents';
import {
  FaissVectorService,
  VectorSource,
  VectorSearchOptions,
  VectorSearchResult,
} from './faiss-vector.service';
import { LangchainVectorStoreService } from './langchain-vector-store.service';
import { VectorWriteQueueService } from './vector-write-queue.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

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

@Injectable()
export class VectorStrategyService {
  private readonly logger = new Logger(VectorStrategyService.name);
  private isInitialized = false;

  // Feature flags
  private enableFaissDualWrite: boolean;
  private enableFaissShadowRead: boolean;
  private enableFaissPrimary: boolean;

  // Metrics collection
  private divergenceMetrics: DivergenceMetrics[] = [];
  private maxMetricsHistory = 1000;

  constructor(
    private configService: ConfigService,
    private faissVectorService: FaissVectorService,
    private langchainVectorStoreService: LangchainVectorStoreService,
    private writeQueueService: VectorWriteQueueService,
    @InjectModel('Document') private documentModel: Model<any>,
  ) {
    // Load feature flags from environment
    this.enableFaissDualWrite = this.configService.get<boolean>(
      'ENABLE_FAISS_DUAL_WRITE',
      false,
    );
    this.enableFaissShadowRead = this.configService.get<boolean>(
      'ENABLE_FAISS_SHADOW_READ',
      false,
    );
    this.enableFaissPrimary = this.configService.get<boolean>(
      'ENABLE_FAISS_PRIMARY',
      false,
    );
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.logger.log('Initializing Vector Strategy Service', {
        flags: {
          dualWrite: this.enableFaissDualWrite,
          shadowRead: this.enableFaissShadowRead,
          faissPrimary: this.enableFaissPrimary,
        },
      });

      // Initialize FAISS if any FAISS features are enabled
      if (
        this.enableFaissDualWrite ||
        this.enableFaissShadowRead ||
        this.enableFaissPrimary
      ) {
        await this.faissVectorService.initialize();
      }

      this.isInitialized = true;

      this.logger.log('Vector Strategy Service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Vector Strategy Service', {
        error: error instanceof Error ? error.message : String(error),
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
    },
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { source, userId, projectId, documentId } = metadata;

    // Validate source
    if (
      ![
        'knowledge-base',
        'telemetry',
        'activity',
        'conversation',
        'user-upload',
      ].includes(source)
    ) {
      throw new Error(`Invalid vector source: ${source}`);
    }

    // Validate user isolation
    if (['conversation', 'user-upload'].includes(source) && !userId) {
      throw new Error(`User ID required for source: ${source}`);
    }

    try {
      // Phase A: Dual-write to both MongoDB and FAISS
      if (this.enableFaissDualWrite) {
        // Write to MongoDB first (source of truth)
        await this.langchainVectorStoreService.addDocuments(documents, {
          userId,
          projectId,
          documentId,
        });

        // Then write to FAISS via queue for safety
        await this.writeQueueService.enqueue(documents, source, userId);

        this.logger.log('Dual-write completed', {
          documentCount: documents.length,
          source,
          userId,
        });
      }
      // Phase C/D: FAISS as primary
      else if (this.enableFaissPrimary) {
        // Write to FAISS only via queue for safety
        await this.writeQueueService.enqueue(documents, source, userId);

        this.logger.log('FAISS write completed', {
          documentCount: documents.length,
          source,
          userId,
        });
      }
      // Default: MongoDB only
      else {
        await this.langchainVectorStoreService.addDocuments(documents, {
          userId,
          projectId,
          documentId,
        });

        this.logger.log('MongoDB write completed', {
          documentCount: documents.length,
          source,
          userId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to add documents', {
        source,
        userId,
        error: error instanceof Error ? error.message : String(error),
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
    filter?: Record<string, any>,
  ): Promise<VectorSearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const options: VectorSearchOptions = {
      k,
      userId,
      filter,
      includeScores: true,
    };

    try {
      // Phase B: Shadow read (query both, compare results)
      if (this.enableFaissShadowRead && !this.enableFaissPrimary) {
        const [faissResults, mongoResults] = await Promise.all([
          this.searchFaiss(query, options),
          this.searchMongoDB(query, options),
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

          this.logger.log('FAISS search successful', {
            resultsCount: results.length,
          });

          return results;
        } catch (error) {
          this.logger.warn('FAISS search failed, falling back to MongoDB', {
            error: error instanceof Error ? error.message : String(error),
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
      this.logger.error('Search failed', {
        query: query.substring(0, 50),
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Search using FAISS
   */
  private async searchFaiss(
    query: string,
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const faissResults = await this.faissVectorService.search(query, options);

    // Enrich with MongoDB metadata if needed
    const enrichedResults: VectorSearchResult[] = [];

    for (const result of faissResults) {
      if (result.documentId) {
        try {
          const doc = await this.documentModel
            .findById(result.documentId)
            .lean();
          if (doc && !Array.isArray(doc) && doc.metadata) {
            result.document.metadata = {
              ...result.document.metadata,
              ...doc.metadata,
            };
          }
        } catch (error) {
          this.logger.warn(
            'Failed to enrich FAISS result with MongoDB metadata',
            {
              documentId: result.documentId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
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
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const { k = 4, userId, filter } = options;

    // Build MongoDB filter
    const mongoFilter: any = { ...filter };
    if (userId) {
      mongoFilter['metadata.userId'] = userId;
    }

    const results =
      await this.langchainVectorStoreService.similaritySearchWithScore(
        query,
        k,
        mongoFilter,
      );

    return results.map(([doc, score]) => ({
      document: doc,
      score,
      documentId: doc.metadata?.documentId,
    }));
  }

  /**
   * Log divergence between FAISS and MongoDB results
   */
  private logDivergence(
    query: string,
    userId: string | undefined,
    faissResults: VectorSearchResult[],
    mongoResults: VectorSearchResult[],
  ): void {
    const faissIds = new Set(
      faissResults.map((r) => r.documentId).filter(Boolean),
    );
    const mongoIds = new Set(
      mongoResults.map((r) => r.documentId).filter(Boolean),
    );

    // Calculate Jaccard similarity
    const intersection = new Set([...faissIds].filter((x) => mongoIds.has(x)));
    const union = new Set([...faissIds, ...mongoIds]);
    const jaccardSimilarity =
      union.size > 0 ? intersection.size / union.size : 1;

    // Count unique results
    const faissOnly = [...faissIds].filter((x) => !mongoIds.has(x));
    const mongoOnly = [...mongoIds].filter((x) => !faissIds.has(x));

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
      isAcceptable: jaccardSimilarity >= 0.7, // 70% overlap threshold
    };

    // Store metrics
    this.divergenceMetrics.push(metrics);
    if (this.divergenceMetrics.length > this.maxMetricsHistory) {
      this.divergenceMetrics.shift();
    }

    // Log divergence
    const logLevel = metrics.isAcceptable ? 'log' : 'warn';
    this.logger[logLevel]('Shadow read divergence', {
      query: query.substring(0, 50),
      userId,
      jaccardSimilarity: jaccardSimilarity.toFixed(3),
      overlapCount: metrics.overlapCount,
      faissOnlyCount: metrics.faissOnlyCount,
      mongoOnlyCount: metrics.mongoOnlyCount,
      isAcceptable: metrics.isAcceptable,
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
        acceptablePercentage: 0,
      };
    }

    const totalComparisons = this.divergenceMetrics.length;
    const averageJaccard =
      this.divergenceMetrics.reduce((sum, m) => sum + m.jaccardSimilarity, 0) /
      totalComparisons;
    const acceptableCount = this.divergenceMetrics.filter(
      (m) => m.isAcceptable,
    ).length;
    const acceptablePercentage = (acceptableCount / totalComparisons) * 100;
    const lastComparison =
      this.divergenceMetrics[this.divergenceMetrics.length - 1].timestamp;

    return {
      totalComparisons,
      averageJaccard,
      acceptablePercentage,
      lastComparison,
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
    }

    this.logger.log('Feature flags updated', {
      flags: {
        dualWrite: this.enableFaissDualWrite,
        shadowRead: this.enableFaissShadowRead,
        faissPrimary: this.enableFaissPrimary,
      },
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
      enableFaissPrimary: this.enableFaissPrimary,
    };
  }
}
