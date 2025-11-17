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
import { retrievalService } from '../../services/retrieval.service';
import { loggingService } from '../../services/logging.service';
import { Document } from '@langchain/core/documents';

export class RetrieveModule extends BaseRAGModule {
  protected config: RetrievalConfig;

  constructor(
    config: RetrievalConfig = {
      enabled: true,
      limit: 5,
      useCache: true,
      similarityThreshold: 0.7,
    }
  ) {
    super('RetrieveModule', 'retrieve', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput
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
      // Determine retrieval strategy
      const strategy = this.determineStrategy(query, effectiveConfig);

      let result;
      switch (strategy) {
        case 'knowledge_base':
          result = await retrievalService.retrieveKnowledgeBase(
            query,
            retrievalOptions.limit
          );
          break;

        case 'user_documents':
          if (!context?.userId) {
            throw new Error('User ID required for user document retrieval');
          }
          result = await retrievalService.retrieveUserDocuments(
            context.userId,
            query,
            retrievalOptions
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
            retrievalOptions
          );
          break;

        default:
          result = await retrievalService.retrieve(query, retrievalOptions);
      }

      // Filter by similarity threshold if specified
      let filteredDocs = result.documents;
      if (effectiveConfig.similarityThreshold) {
        filteredDocs = this.filterBySimilarity(
          result.documents,
          effectiveConfig.similarityThreshold
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
    config: RetrievalConfig
  ): 'knowledge_base' | 'user_documents' | 'contextual' | 'general' {
    const lowerQuery = query.toLowerCase();

    // Check for user-specific queries
    if (
      lowerQuery.includes('my') ||
      lowerQuery.includes('our') ||
      config.filters?.source?.some((s) =>
        ['user-upload', 'conversation'].includes(s)
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
    threshold: number
  ): Document[] {
    return documents.filter((doc) => {
      const score = doc.metadata.score as number;
      return !score || score >= threshold;
    });
  }

  /**
   * Hybrid search combining vector and keyword search
   */
  async hybridSearch(
    query: string,
    options: RetrievalConfig
  ): Promise<Document[]> {
    const alpha = options.hybridAlpha ?? 0.5;

    // Get vector search results
    const vectorResults = await retrievalService.retrieve(query, {
      limit: (options.limit ?? 5) * 2,
      ...options.filters,
    });

    // Weight vector results by alpha
    const weightedResults = vectorResults.documents.map(doc => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        hybridScore: (doc.metadata.score as number ?? 0.5) * alpha,
      },
    }));

    // Sort by hybrid score and return top results
    weightedResults.sort((a, b) => 
      (b.metadata.hybridScore as number) - (a.metadata.hybridScore as number)
    );

    return weightedResults.slice(0, options.limit ?? 5);
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

