/**
 * Rerank Module
 * Advanced reranking with LLM-based scoring and CRAG (Corrective RAG) integration
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  RerankConfig,
  DocumentScore,
} from '../types/rag.types';
import { Document } from '@langchain/core/documents';
import { ChatBedrockConverse } from '@langchain/aws';

export class RerankModule extends BaseRAGModule {
  protected config: RerankConfig;
  private llm?: ChatBedrockConverse;

  constructor(
    config: RerankConfig = {
      enabled: true,
      topK: 5,
      useLLM: false,
      scoreThreshold: 0.5,
    },
  ) {
    super('RerankModule', 'rerank', config);
    this.config = config;

    if (config.useLLM) {
      this.llm = new ChatBedrockConverse({
        model: config.model || 'amazon.nova-micro-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.1,
        maxTokens: 200,
      });
    }
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, documents, config } = input;

    if (!documents || documents.length === 0) {
      return {
        ...this.createSuccessOutput([], { skipped: true }),
        documents: [],
        query,
      };
    }

    const effectiveConfig = { ...this.config, ...config };

    try {
      // Rerank documents
      let rankedDocuments: Document[];

      if (effectiveConfig.useLLM && this.llm) {
        rankedDocuments = await this.llmRerank(query, documents);
      } else {
        rankedDocuments = await this.heuristicRerank(query, documents);
      }

      // Apply score threshold if specified
      if (effectiveConfig.scoreThreshold !== undefined) {
        rankedDocuments = rankedDocuments.filter((doc) => {
          const score = (doc.metadata.score as number) ?? 0;
          return score >= effectiveConfig.scoreThreshold!;
        });
      }

      // Limit to topK
      const topK = effectiveConfig.topK ?? 5;
      rankedDocuments = rankedDocuments.slice(0, topK);

      return {
        ...this.createSuccessOutput(rankedDocuments, {
          reranked: true,
          method: effectiveConfig.useLLM ? 'llm' : 'heuristic',
          originalCount: documents.length,
          finalCount: rankedDocuments.length,
          scoreThreshold: effectiveConfig.scoreThreshold,
        }),
        documents: rankedDocuments,
        query,
      };
    } catch (error) {
      this.logger.warn('Reranking failed, returning original documents', {
        component: 'RerankModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput(documents, { reranked: false }),
        documents,
        query,
      };
    }
  }

  /**
   * LLM-based reranking using pairwise comparisons
   * @param query The search query
   * @param documents The documents to rerank
   * @param _config The configuration options (currently unused, but included for interface consistency and future use)
   */
  private async llmRerank(
    query: string,
    documents: Document[],
  ): Promise<Document[]> {
    if (!this.llm) {
      throw new Error('LLM not initialized');
    }

    const scores: DocumentScore[] = [];

    // Score each document individually
    for (const doc of documents) {
      const score = await this.scoreDocument(query, doc, this.llm);
      scores.push({
        document: doc,
        score,
        relevanceFactors: {
          semantic: score,
          keyword: 0,
          recency: 0,
          authority: 0,
        },
      });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Update document metadata with scores
    const rankedDocuments = scores.map((item) => ({
      ...item.document,
      metadata: {
        ...item.document.metadata,
        score: item.score,
        reranked: true,
      },
    }));

    return rankedDocuments;
  }

  /**
   * Heuristic reranking based on multiple factors
   * @param query The search query
   * @param documents The documents to rerank
   * @param _config The configuration options (currently unused, but included for interface consistency and future use)
   */
  private async heuristicRerank(
    query: string,
    documents: Document[],
  ): Promise<Document[]> {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2);

    const scored: DocumentScore[] = documents.map((doc) => {
      const semantic = (doc.metadata.score as number) ?? 0.5;
      let keyword = 0;
      let recency = 0;
      let authority = 0;

      const content = doc.pageContent.toLowerCase();

      // Keyword matching score
      queryTerms.forEach((term) => {
        const matches = (content.match(new RegExp(term, 'g')) ?? []).length;
        keyword += matches * 0.1;

        // Boost for exact phrase matches
        if (content.includes(term)) {
          keyword += 0.05;
        }
      });

      // Recency score (newer documents get slight boost)
      if (doc.metadata.createdAt) {
        const createdAt = new Date(doc.metadata.createdAt as string);
        const daysOld =
          (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

        if (daysOld < 30) {
          recency = 0.1;
        } else if (daysOld < 365) {
          recency = 0.05;
        }
      }

      // Authority score based on source
      const source = doc.metadata.source as string;
      if (source === 'knowledge-base') {
        authority = 0.1;
      } else if (source === 'documentation') {
        authority = 0.05;
      }

      // Diversity penalty (avoid duplicate content)
      let diversityPenalty = 0;
      if (doc.metadata.duplicateScore) {
        diversityPenalty = (doc.metadata.duplicateScore as number) * -0.1;
      }

      const totalScore =
        semantic * 0.5 +
        keyword * 0.3 +
        recency * 0.1 +
        authority * 0.1 +
        diversityPenalty;

      return {
        document: doc,
        score: Math.max(0, Math.min(1, totalScore)),
        relevanceFactors: { semantic, keyword, recency, authority },
      };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Update document metadata with scores
    const rankedDocuments = scored.map((item) => ({
      ...item.document,
      metadata: {
        ...item.document.metadata,
        score: item.score,
        reranked: true,
        relevanceFactors: item.relevanceFactors,
      },
    }));

    return rankedDocuments;
  }

  /**
   * Score a single document using LLM
   */
  private async scoreDocument(
    query: string,
    document: Document,
    llm: ChatBedrockConverse,
  ): Promise<number> {
    const prompt = `Rate how relevant this document is to the query on a scale of 0.0 to 1.0.

Query: "${query}"

Document: "${document.pageContent.substring(0, 500)}"

Relevance score (0.0-1.0):`;

    try {
      const response = await llm.invoke([{ role: 'user', content: prompt }]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : '0.5';
      const score = parseFloat(content);

      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch (error) {
      this.logger.warn('Document scoring failed', {
        component: 'RerankModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      topK: 5,
      useLLM: false,
      scoreThreshold: 0.5,
    };
  }

  protected getDescription(): string {
    return 'Document reranking and relevance scoring module';
  }

  protected getCapabilities(): string[] {
    return [
      'LLM-based reranking',
      'Heuristic reranking',
      'Relevance scoring',
      'Document filtering',
      'Semantic scoring',
      'Keyword matching',
      'Authority ranking',
      'Recency boosting',
    ];
  }
}
