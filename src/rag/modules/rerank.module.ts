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
import { loggingService } from '../../services/logging.service';

export class RerankModule extends BaseRAGModule {
  protected config: RerankConfig;
  private llm?: ChatBedrockConverse;

  constructor(
    config: RerankConfig = {
      enabled: true,
      topK: 5,
      useLLM: false,
      scoreThreshold: 0.5,
    }
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
    input: RAGModuleInput
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
        rankedDocuments = await this.llmBasedRerank(query, documents);
      } else {
        rankedDocuments = await this.heuristicRerank(query, documents, effectiveConfig);
      }

      // Apply CRAG - detect and filter low-quality retrievals
      const correctedDocuments = await this.applyCRAG(
        query,
        rankedDocuments,
        effectiveConfig
      );

      // Take top K
      const topK = effectiveConfig.topK || 5;
      const finalDocuments = correctedDocuments.slice(0, topK);

      loggingService.info('Documents reranked', {
        component: 'RerankModule',
        originalCount: documents.length,
        rerankedCount: finalDocuments.length,
        useLLM: effectiveConfig.useLLM,
        cragApplied: correctedDocuments.length !== rankedDocuments.length,
      });

      return {
        ...this.createSuccessOutput(finalDocuments, {
          originalCount: documents.length,
          rerankedCount: finalDocuments.length,
          method: effectiveConfig.useLLM ? 'llm' : 'heuristic',
        }),
        documents: finalDocuments,
        query,
      };
    } catch (error) {
      loggingService.error('Reranking failed', {
        component: 'RerankModule',
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Return original documents on failure
      return {
        ...this.createSuccessOutput(documents, { fallback: true }),
        documents: documents.slice(0, effectiveConfig.topK || 5),
        query,
      };
    }
  }

  /**
   * LLM-based reranking for higher accuracy
   */
  private async llmBasedRerank(
    query: string,
    documents: Document[]
  ): Promise<Document[]> {
    if (!this.llm) {
      return this.heuristicRerank(query, documents, this.config);
    }

    try {
      const scoredDocs: DocumentScore[] = [];

      // Score each document using LLM
      for (const doc of documents.slice(0, 10)) { // Limit to avoid too many API calls
        const score = await this.scoreLLMRelevance(query, doc);
        scoredDocs.push({
          document: doc,
          score,
          relevanceFactors: {
            semantic: score,
            keyword: 0,
          },
        });
      }

      // Sort by score
      scoredDocs.sort((a, b) => b.score - a.score);

      return scoredDocs.map(sd => {
        const doc = sd.document;
        doc.metadata.rerankScore = sd.score;
        return doc;
      });
    } catch (error) {
      loggingService.warn('LLM reranking failed, falling back to heuristic', {
        component: 'RerankModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.heuristicRerank(query, documents, this.config);
    }
  }

  /**
   * Score document relevance using LLM
   */
  private async scoreLLMRelevance(
    query: string,
    document: Document
  ): Promise<number> {
    if (!this.llm) return 0.5;

    const prompt = `Rate the relevance of this document to the query on a scale of 0.0 to 1.0. Respond with only the number.

Query: "${query}"

Document: "${document.pageContent.substring(0, 500)}"

Relevance score:`;

    try {
      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '0.5';
      const score = parseFloat(content.match(/[\d.]+/)?.[0] || '0.5');
      return Math.max(0, Math.min(1, score));
    } catch (error) {
      return 0.5;
    }
  }

  /**
   * Heuristic-based reranking (fast, no LLM calls)
   */
  private async heuristicRerank(
    query: string,
    documents: Document[],
    config: RerankConfig
  ): Promise<Document[]> {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const scoredDocs: DocumentScore[] = [];

    for (const doc of documents) {
      const content = doc.pageContent.toLowerCase();
      
      // Keyword matching score
      let keywordScore = 0;
      for (const term of queryTerms) {
        const matches = (content.match(new RegExp(term, 'g')) || []).length;
        keywordScore += matches * 0.1;
      }
      keywordScore = Math.min(keywordScore, 1.0);

      // Semantic score (from original retrieval)
      const semanticScore = (doc.metadata.score as number) || 0.5;

      // Recency score
      let recencyScore = 0.5;
      if (doc.metadata.createdAt) {
        const createdAt = new Date(doc.metadata.createdAt as string);
        const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        recencyScore = daysSinceCreation < 30 ? 1.0 : daysSinceCreation < 90 ? 0.7 : 0.5;
      }

      // Authority score (based on access count)
      const accessCount = (doc.metadata.accessCount as number) || 0;
      const authorityScore = Math.min(accessCount / 100, 1.0);

      // Combined score
      const combinedScore = 
        semanticScore * 0.4 +
        keywordScore * 0.3 +
        recencyScore * 0.2 +
        authorityScore * 0.1;

      scoredDocs.push({
        document: doc,
        score: combinedScore,
        relevanceFactors: {
          semantic: semanticScore,
          keyword: keywordScore,
          recency: recencyScore,
          authority: authorityScore,
        },
      });
    }

    // Apply diversity penalty if configured
    if (config.diversityPenalty && config.diversityPenalty > 0) {
      this.applyDiversityPenalty(scoredDocs, config.diversityPenalty);
    }

    // Sort by score
    scoredDocs.sort((a, b) => b.score - a.score);

    return scoredDocs.map(sd => {
      const doc = sd.document;
      doc.metadata.rerankScore = sd.score;
      doc.metadata.relevanceFactors = sd.relevanceFactors;
      return doc;
    });
  }

  /**
   * Apply CRAG - Corrective RAG to filter low-quality results
   */
  private async applyCRAG(
    query: string,
    documents: Document[],
    config: RerankConfig
  ): Promise<Document[]> {
    const threshold = config.scoreThreshold || 0.5;
    
    // Filter documents below threshold
    const filteredDocs = documents.filter(doc => {
      const score = doc.metadata.rerankScore as number || 0.5;
      return score >= threshold;
    });

    // If all documents filtered out, return top 2 as fallback
    if (filteredDocs.length === 0 && documents.length > 0) {
      loggingService.warn('CRAG filtered all documents, using fallback', {
        component: 'RerankModule',
        threshold,
      });
      return documents.slice(0, 2);
    }

    // Log CRAG filtering
    if (filteredDocs.length < documents.length) {
      loggingService.info('CRAG filtered low-quality documents', {
        component: 'RerankModule',
        original: documents.length,
        filtered: filteredDocs.length,
        threshold,
      });
    }

    return filteredDocs;
  }

  /**
   * Apply diversity penalty to reduce redundancy
   */
  private applyDiversityPenalty(
    scoredDocs: DocumentScore[],
    penaltyFactor: number
  ): void {
    const seen = new Set<string>();

    for (const scoredDoc of scoredDocs) {
      const contentHash = scoredDoc.document.pageContent.substring(0, 100);
      
      if (seen.has(contentHash)) {
        scoredDoc.score *= (1 - penaltyFactor);
      } else {
        seen.add(contentHash);
      }
    }
  }

  protected getDescription(): string {
    return 'Reranks documents using LLM or heuristic scoring with CRAG filtering';
  }

  protected getCapabilities(): string[] {
    return [
      'llm_reranking',
      'heuristic_reranking',
      'crag_filtering',
      'diversity_penalty',
      'relevance_scoring',
    ];
  }

  protected getDependencies() {
    return ['retrieve' as const];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      topK: 5,
      useLLM: false,
      scoreThreshold: 0.5,
    };
  }

  validateConfig(): boolean {
    if (this.config.topK && this.config.topK < 1) {
      return false;
    }

    if (
      this.config.scoreThreshold &&
      (this.config.scoreThreshold < 0 || this.config.scoreThreshold > 1)
    ) {
      return false;
    }

    return true;
  }
}

