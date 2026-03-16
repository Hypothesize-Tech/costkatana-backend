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
import { RagServiceLocator } from '../../services/rag-service-locator';

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
      const result = await RagServiceLocator.getRetrievalService().retrieve(
        query,
        retrievalOptions,
      );

      return {
        ...this.createSuccessOutput(result.documents, {
          cacheHit: result.cacheHit,
          retrievalTime: result.retrievalTime,
          totalResults: result.totalResults,
        }),
        documents: result.documents,
        query,
      };
    } catch (error) {
      return this.createErrorOutput(
        error instanceof Error ? error.message : String(error),
        { retrievalFailed: true },
      );
    }
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      limit: 5,
      useCache: true,
      similarityThreshold: 0.7,
    };
  }

  protected getDescription(): string {
    return 'Vector and hybrid search retrieval module';
  }

  protected getCapabilities(): string[] {
    return [
      'Vector search',
      'Hybrid search',
      'Semantic retrieval',
      'Keyword search',
      'Document filtering',
      'Result caching',
      'Re-ranking',
    ];
  }
}
