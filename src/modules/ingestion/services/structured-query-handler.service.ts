/**
 * Structured Query Handler Service
 * Orchestrates the structured retrieval path end-to-end:
 * 1. Receives ParsedQueryParams from the detector
 * 2. Calls MongoQueryBuilder to build + execute the pipeline
 * 3. Formats raw MongoDB results into RAGDocument[] (same shape as vector search)
 * 4. Returns results with source: 'structured_db' for observability
 */

import { Injectable, Logger } from '@nestjs/common';
import { generateSecureId } from '../../../common/utils/secure-id.util';
import type { RAGDocument } from '../../rag/types/rag.types';
import type {
  StructuredQueryType,
  StructuredQueryDetection,
} from './structured-query-detector.service';
import { MongoQueryBuilderService } from './mongo-query-builder.service';
import type { StructuredQueryOptions } from './mongo-query-builder.service';

export interface StructuredQueryHandlerResult {
  documents: RAGDocument[];
  source: 'structured_db';
  metadata: {
    queryType: StructuredQueryType;
    totalDocuments: number;
    retrievalTimeMs: number;
    query?: string;
  };
}

@Injectable()
export class StructuredQueryHandlerService {
  private readonly logger = new Logger(StructuredQueryHandlerService.name);

  constructor(private readonly mongoQueryBuilder: MongoQueryBuilderService) {}

  /**
   * Handle a structured query: execute MongoDB pipeline and format as RAGDocument[].
   * If queryType is semantic (should not occur when routed from routeQuery), returns empty.
   *
   * @param query - Original user query
   * @param detection - Structured query detection result with extracted params
   * @param options - userId, projectId, limit for MongoDB filtering
   */
  async handle(
    query: string,
    detection: StructuredQueryDetection,
    options: StructuredQueryOptions = {},
  ): Promise<StructuredQueryHandlerResult> {
    const startTime = Date.now();
    const { extractedParams, queryType } = detection;

    // If queryType is semantic, just return empty structured results (semantic will be handled elsewhere)
    if (queryType === 'semantic') {
      return {
        documents: [],
        source: 'structured_db',
        metadata: {
          queryType: 'semantic',
          totalDocuments: 0,
          retrievalTimeMs: 0,
          query,
        },
      };
    }

    try {
      const results = await this.mongoQueryBuilder.executeQuery(
        extractedParams,
        queryType,
        options,
      );

      const queryContextDoc: RAGDocument = {
        id: generateSecureId('structured_query'),
        content: `User query: "${query}"\n\nRetrieved ${results.length} matching usage record(s).`,
        metadata: {
          source: 'structured_db',
          score: 1,
          queryType: 'query_context',
          query,
        },
      };

      const resultDocs: RAGDocument[] = results.map((r, index) => ({
        id: generateSecureId(`structured_${index}`),
        content: r.content,
        metadata: {
          source: 'structured_db',
          score: 1,
          queryType,
          query,
          model: r.model,
          service: r.service,
          cost: r.cost,
          totalTokens: r.totalTokens,
          ...r.metadata,
        },
      }));

      const documents: RAGDocument[] = [queryContextDoc, ...resultDocs];

      const retrievalTimeMs = Date.now() - startTime;

      this.logger.log('Structured query handled successfully', {
        queryType,
        documentCount: documents.length,
        retrievalTimeMs,
      });

      return {
        documents,
        source: 'structured_db',
        metadata: {
          queryType,
          totalDocuments: documents.length,
          retrievalTimeMs,
          query,
        },
      };
    } catch (error) {
      this.logger.error('Structured query handler failed', {
        error: error instanceof Error ? error.message : String(error),
        queryType,
      });
      throw error;
    }
  }
}
