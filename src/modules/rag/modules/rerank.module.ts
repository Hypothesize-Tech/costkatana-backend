import { Injectable } from '@nestjs/common';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
  RAGDocument,
} from '../types/rag.types';

export interface RerankModuleConfig extends ModuleConfig {
  topK?: number;
  scoreThreshold?: number;
}

/**
 * Rerank Module
 * Reranks documents by score for the main RAG pipeline (compatible with BaseRAGModule).
 */
@Injectable()
export class RerankModule extends BaseRAGModule {
  private readonly config: RerankModuleConfig;

  constructor() {
    super('RerankModule');
    this.config = {
      enabled: true,
      priority: 6,
      timeout: 3000,
      topK: 5,
      scoreThreshold: 0.5,
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    // Use both input and previousResults for reasoning/context
    const documents: RAGDocument[] =
      previousResults?.flatMap((r) => r.documents) ?? [];

    if (documents.length === 0) {
      return {
        documents: [],
        reasoning: `No documents to rerank for query: "${input?.query ?? '[no query]'}"`,
        confidence: 0.0,
        metadata: { noDocuments: true, input },
      };
    }

    try {
      const topK = this.config.topK ?? 5;
      const scoreThreshold = this.config.scoreThreshold ?? 0.5;

      // Example: Optionally include input-based sorting/filtering or logging
      // Classic behavior: Only simple score rerank, but now log query and input
      const scored = documents
        .map((doc) => ({
          doc,
          score: (doc.metadata?.score as number) ?? 0.5,
        }))
        .filter((s) => s.score >= scoreThreshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => s.doc);

      this.logger.log(
        `Reranked ${documents.length} documents to top ${scored.length}`,
        {
          topK,
          scoreThreshold,
          inputQuery: input?.query,
          input,
        },
      );

      return {
        documents: scored,
        reasoning: `Reranked to top ${scored.length} by score (threshold ${scoreThreshold}) for query: "${input?.query}"`,
        confidence: 0.85,
        metadata: {
          inputQuery: input?.query,
          inputCount: documents.length,
          outputCount: scored.length,
          topK,
          scoreThreshold,
          input,
        },
      };
    } catch (error) {
      this.logger.error('Rerank failed', {
        error: error instanceof Error ? error.message : String(error),
        input,
      });
      return {
        documents,
        reasoning: `Rerank failed for query: "${input?.query}". Returning original order.`,
        confidence: 0.5,
        metadata: { fallback: true, input },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return this.config.enabled && !!input && typeof input.query === 'string';
  }

  getConfig(): ModuleConfig {
    return this.config;
  }
}
