/**
 * RetrievalService - RAG document retrieval
 * Wraps RagRetrievalService from RagServiceLocator when available.
 * Provides singleton retrievalService for src/rag/modules.
 */

import { Document } from '@langchain/core/documents';
import { loggingService } from '../../common/services/logging.service';

export interface RetrievalOptions {
  userId?: string;
  limit?: number;
  filters?: {
    source?: string[];
    dateRange?: { from: Date; to: Date };
    tags?: string[];
    projectId?: string;
    conversationId?: string;
    documentIds?: string[];
    domain?: string[];
    topics?: string[];
    contentType?: string[];
    technicalLevel?: string[];
    importance?: string[];
    minQualityScore?: number;
    maxAgeInDays?: number;
    excludeDeprecated?: boolean;
    mustContainKeywords?: string[];
    mustNotContainKeywords?: string[];
  };
  includeScore?: boolean;
  useCache?: boolean;
  rerank?: boolean;
  userContext?: {
    technicalLevel?: string;
    preferredTopics?: string[];
    recentQueries?: string[];
  };
}

export interface RetrievalResult {
  documents: Document[];
  sources: string[];
  totalResults: number;
  cacheHit: boolean;
  retrievalTime: number;
  stats: {
    sources: string[];
    cacheHit: boolean;
    retrievalTime: number;
  };
}

function emptyResult(retrievalTime = 0): RetrievalResult {
  return {
    documents: [],
    sources: [],
    totalResults: 0,
    cacheHit: false,
    retrievalTime,
    stats: { sources: [], cacheHit: false, retrievalTime },
  };
}

function getRagRetrieval(): {
  retrieve: (
    query: string,
    options: RetrievalOptions,
  ) => Promise<RetrievalResult>;
  retrieveKnowledgeBase: (
    query: string,
    options: RetrievalOptions,
  ) => Promise<RetrievalResult>;
  retrieveUserDocuments: (
    userId: string,
    query: string,
    options: Omit<RetrievalOptions, 'userId'>,
  ) => Promise<RetrievalResult>;
  retrieveWithContext: (
    query: string,
    context: {
      conversationHistory?: string[];
      userPreferences?: Record<string, unknown>;
      domain?: string;
      technicalLevel?: string;
    },
    options: RetrievalOptions,
  ) => Promise<RetrievalResult>;
  retrieveWithGoogleDriveFiles: (
    userId: string,
    query: string,
    options: Omit<RetrievalOptions, 'userId'>,
  ) => Promise<RetrievalResult>;
} | null {
  try {
    const {
      RagServiceLocator,
    } = require('../../modules/rag-eval/services/rag-service-locator');
    return RagServiceLocator.getRetrievalService();
  } catch {
    return null;
  }
}

class RetrievalServiceImpl {
  async initializeVectorStore(): Promise<void> {
    const rag = getRagRetrieval();
    if (
      rag &&
      typeof (rag as { initializeVectorStore?: () => Promise<void> })
        .initializeVectorStore === 'function'
    ) {
      await (
        rag as { initializeVectorStore: () => Promise<void> }
      ).initializeVectorStore();
    }
  }

  async retrieve(
    query: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    const start = Date.now();
    const rag = getRagRetrieval();
    if (rag) return rag.retrieve(query, options);
    loggingService.debug(
      'RagRetrievalService not available, returning empty results',
      {
        component: 'RetrievalService',
        query: query.substring(0, 50),
      },
    );
    return emptyResult(Date.now() - start);
  }

  async retrieveKnowledgeBase(
    query: string,
    limitOrOptions: number | RetrievalOptions = 5,
  ): Promise<RetrievalResult> {
    const options: RetrievalOptions =
      typeof limitOrOptions === 'number'
        ? { limit: limitOrOptions }
        : limitOrOptions;
    const rag = getRagRetrieval();
    if (rag) return rag.retrieveKnowledgeBase(query, options);
    return emptyResult(0);
  }

  async retrieveUserDocuments(
    userId: string,
    query: string,
    options: Omit<RetrievalOptions, 'userId'> = {},
  ): Promise<RetrievalResult> {
    const rag = getRagRetrieval();
    if (rag) return rag.retrieveUserDocuments(userId, query, options);
    return emptyResult(0);
  }

  async retrieveWithContext(
    query: string,
    context: {
      userId?: string;
      recentMessages?: string[];
      currentTopic?: string;
      conversationHistory?: string[];
      userPreferences?: Record<string, unknown>;
      domain?: string;
      technicalLevel?: string;
    },
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    const rag = getRagRetrieval();
    if (rag) {
      const mappedContext = {
        conversationHistory:
          context.recentMessages ?? context.conversationHistory,
        userPreferences: context.userPreferences,
        domain: context.currentTopic ?? context.domain,
        technicalLevel: context.technicalLevel,
      };
      return rag.retrieveWithContext(query, mappedContext, options);
    }
    return emptyResult(0);
  }

  /** (query, options) - options.userId required when used from RAG retrieve module */
  async retrieveWithGoogleDriveFiles(
    query: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievalResult> {
    const rag = getRagRetrieval();
    if (rag) {
      const userId = options.userId ?? '';
      return rag.retrieveWithGoogleDriveFiles(userId, query, options);
    }
    return emptyResult(0);
  }

  async clearCache(userId?: string): Promise<void> {
    const rag = getRagRetrieval() as {
      clearCache?: (userId?: string) => Promise<void>;
    } | null;
    if (rag?.clearCache) await rag.clearCache(userId);
  }
}

export const retrievalService = new RetrievalServiceImpl();
