/**
 * Retrieve Module
 * Enhanced vector + hybrid search wrapping existing retrieval service
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  RetrievalConfig,
} from '../types/rag.types';
import { retrievalService } from '../services/retrieval.service';
import { loggingService } from '../../common/services/logging.service';
import { Document } from '@langchain/core/documents';

export class RetrieveModule extends BaseRAGModule {
  protected config: RetrievalConfig;

  constructor(
    config: RetrievalConfig = {
      enabled: true,
      limit: 5,
      useCache: true,
      similarityThreshold: 0.7,
    },
  ) {
    super('RetrieveModule', 'retrieve', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;

    // Merge configurations
    const effectiveConfig = { ...this.config, ...config };

    // Build retrieval options
    const retrievalOptions: any = {
      limit: effectiveConfig.limit ?? 5,
      useCache: effectiveConfig.useCache !== false,
      rerank: true,
      userId: context?.userId,
    };

    // Add filters if provided
    if (effectiveConfig.filters) {
      retrievalOptions.filters = effectiveConfig.filters;
    }

    // Add sources if specified
    if (effectiveConfig.sources && effectiveConfig.sources.length > 0) {
      retrievalOptions.filters = {
        ...retrievalOptions.filters,
        source: effectiveConfig.sources,
      };
    }

    try {
      // **Hard bypass**: when the caller explicitly attached documents (the
      // chat send carried `documentIds`), skip strategy selection AND the
      // vector pipeline entirely. Pull the chunks straight from MongoDB by
      // documentId. This guarantees the user's attached file is loaded even
      // when FAISS only has pre-seeded KB items, Atlas vector search isn't
      // configured, or embeddings are degraded.
      const directIds = effectiveConfig.filters?.documentIds;
      if (directIds && directIds.length > 0) {
        loggingService.info(
          'RetrieveModule: documentIds bypass — direct fetch from MongoDB',
          {
            component: 'RetrieveModule',
            documentIds: directIds,
            userId: context?.userId,
          },
        );
        const direct = await retrievalService.retrieveByDocumentIds(
          directIds,
          retrievalOptions,
        );
        if (direct.documents.length > 0) {
          loggingService.info(
            'RetrieveModule: documentIds bypass succeeded',
            {
              component: 'RetrieveModule',
              chunksLoaded: direct.documents.length,
              sources: direct.sources,
            },
          );
          return {
            ...this.createSuccessOutput(direct, {
              strategy: 'documentIds_direct',
              documentCount: direct.documents.length,
              totalResults: direct.totalResults,
              cacheHit: direct.cacheHit,
              sources: direct.sources,
              retrievalTime: direct.retrievalTime,
            }),
            documents: direct.documents,
          };
        }
        loggingService.warn(
          'RetrieveModule: direct fetch returned 0 chunks for documentIds — falling through to vector search',
          {
            component: 'RetrieveModule',
            documentIds: directIds,
          },
        );
      }

      // Determine retrieval strategy
      const strategy = this.determineStrategy(query, effectiveConfig);

      let result;
      switch (strategy) {
        case 'knowledge_base':
          result = await retrievalService.retrieveKnowledgeBase(
            query,
            retrievalOptions.limit,
          );
          break;

        case 'user_documents':
          if (!context?.userId) {
            throw new Error('User ID required for user document retrieval');
          }
          result = await retrievalService.retrieveUserDocuments(
            context.userId,
            query,
            retrievalOptions,
          );
          break;

        case 'contextual':
          result = await retrievalService.retrieveWithContext(
            query,
            {
              userId: context?.userId,
              recentMessages: context?.recentMessages?.map((m) => m.content),
              currentTopic: context?.currentTopic,
            },
            retrievalOptions,
          );
          break;

        default:
          // Use enhanced retrieval that includes Google Drive files
          if (context?.userId) {
            result = await retrievalService.retrieveWithGoogleDriveFiles(
              query,
              retrievalOptions,
            );
          } else {
            result = await retrievalService.retrieve(query, retrievalOptions);
          }
      }

      // Filter by similarity threshold if specified
      let filteredDocs = result.documents;
      if (effectiveConfig.similarityThreshold) {
        filteredDocs = this.filterBySimilarity(
          result.documents,
          effectiveConfig.similarityThreshold,
        );
      }

      loggingService.info('Documents retrieved successfully', {
        component: 'RetrieveModule',
        strategy,
        documentCount: filteredDocs.length,
        totalResults: result.totalResults,
        cacheHit: result.cacheHit,
        sources: result.sources,
      });

      return {
        ...this.createSuccessOutput(result, {
          strategy,
          documentCount: filteredDocs.length,
          totalResults: result.totalResults,
          cacheHit: result.cacheHit,
          sources: result.sources,
          retrievalTime: result.retrievalTime,
        }),
        documents: filteredDocs,
        query,
      };
    } catch (error) {
      loggingService.error('Retrieval failed', {
        component: 'RetrieveModule',
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Determine the best retrieval strategy
   */
  private determineStrategy(
    query: string,
    config: RetrievalConfig,
  ): 'knowledge_base' | 'user_documents' | 'contextual' | 'general' {
    const lowerQuery = query.toLowerCase();

    // PRIORITY 1: If documentIds are provided, always use user_documents strategy
    // This ensures uploaded documents are properly retrieved
    if (config.filters?.documentIds && config.filters.documentIds.length > 0) {
      return 'user_documents';
    }

    // Check for user-specific queries
    if (
      lowerQuery.includes('my') ||
      lowerQuery.includes('our') ||
      config.filters?.source?.some((s) =>
        ['user-upload', 'conversation'].includes(s),
      )
    ) {
      return 'user_documents';
    }

    // Check for knowledge base queries
    if (
      config.filters?.source?.includes('knowledge-base') ||
      lowerQuery.match(/\b(how|what|explain|guide|documentation)\b/)
    ) {
      return 'knowledge_base';
    }

    // Use contextual if we have context
    if (config.filters?.conversationId || config.filters?.projectId) {
      return 'contextual';
    }

    return 'general';
  }

  /**
   * Filter documents by similarity threshold
   */
  private filterBySimilarity(
    documents: Document[],
    threshold: number,
  ): Document[] {
    return documents.filter((doc) => {
      const score = doc.metadata.score as number;
      return !score || score >= threshold;
    });
  }

  /**
   * Hybrid search — delegates to `retrievalService.retrieve`, which already
   * runs vector + BM25-style `$text` search in parallel and fuses with weighted RRF
   * in `RagRetrievalService`. A second retrieve + merge would double-apply fusion.
   *
   * `hybridAlpha` (0–1) maps to vector rank weight in RRF; lexical weight is `1 - hybridAlpha`.
   */
  async hybridSearch(
    query: string,
    options: RetrievalConfig,
  ): Promise<Document[]> {
    const limit = options.limit ?? 5;
    const hybridVectorWeight = options.hybridAlpha ?? 0.6;

    const result = await retrievalService.retrieve(query, {
      limit,
      filters: options.filters,
      useCache: true,
      rerank: false,
      hybridVectorWeight,
    });

    loggingService.debug('hybridSearch completed (single fused retrieve)', {
      component: 'RetrieveModule',
      query: query.substring(0, 80),
      documents: result.documents.length,
      hybridVectorWeight,
    });

    return result.documents;
  }

  protected getDescription(): string {
    return 'Retrieves relevant documents using vector and hybrid search';
  }

  protected getCapabilities(): string[] {
    return [
      'vector_search',
      'hybrid_search',
      'contextual_retrieval',
      'user_document_retrieval',
      'knowledge_base_search',
      'similarity_filtering',
      'caching',
    ];
  }

  protected getDependencies() {
    return ['routing' as const];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      limit: 5,
      useCache: true,
      similarityThreshold: 0.7,
    };
  }

  validateConfig(): boolean {
    if (this.config.limit && this.config.limit < 1) {
      return false;
    }

    if (
      this.config.similarityThreshold &&
      (this.config.similarityThreshold < 0 ||
        this.config.similarityThreshold > 1)
    ) {
      return false;
    }

    return true;
  }
}
