/**
 * Fusion Module
 * Merges results from multiple retrieval sources/strategies
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  FusionConfig,
} from '../types/rag.types';
import { Document } from '@langchain/core/documents';

export class FusionModule extends BaseRAGModule {
  protected config: FusionConfig;

  constructor(
    config: FusionConfig = {
      enabled: true,
      strategy: 'rrf',
      deduplicationThreshold: 0.85,
    },
  ) {
    super('FusionModule', 'fusion', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { documents, metadata, config } = input;

    if (!documents || documents.length === 0) {
      return {
        ...this.createSuccessOutput([], { empty: true }),
        documents: [],
      };
    }

    const effectiveConfig = { ...this.config, ...config };

    try {
      // If metadata contains multiple document lists, fuse them
      const documentSets = (metadata?.documentSets as
        | Document[][]
        | undefined) ?? [documents ?? []];

      let fusedDocuments: Document[];

      switch (effectiveConfig.strategy) {
        case 'rrf':
          fusedDocuments = this.reciprocalRankFusion(documentSets);
          break;

        case 'weighted':
          fusedDocuments = this.weightedFusion(
            documentSets,
            effectiveConfig.weights ?? {},
          );
          break;

        case 'dbsf':
          fusedDocuments = this.diversityBiasedScoreFusion(documentSets);
          break;

        case 'llm-based':
          fusedDocuments = await this.llmBasedFusion(
            documentSets,
            input.query || '',
          );
          break;

        default:
          this.logger.warn(
            `Unknown fusion strategy: ${effectiveConfig.strategy}, using RRF`,
            {
              component: 'FusionModule',
            },
          );
          fusedDocuments = this.reciprocalRankFusion(documentSets);
      }

      // Apply deduplication if threshold is set
      if (effectiveConfig.deduplicationThreshold !== undefined) {
        fusedDocuments = this.deduplicateDocuments(
          fusedDocuments,
          effectiveConfig.deduplicationThreshold,
        );
      }

      return {
        ...this.createSuccessOutput(fusedDocuments, {
          strategy: effectiveConfig.strategy,
          originalSets: documentSets.length,
          totalOriginalDocs: documentSets.reduce(
            (sum, set) => sum + set.length,
            0,
          ),
          finalDocCount: fusedDocuments.length,
          deduplicationApplied:
            effectiveConfig.deduplicationThreshold !== undefined,
        }),
        documents: fusedDocuments,
      };
    } catch (error) {
      this.logger.warn('Fusion failed, returning first document set', {
        component: 'FusionModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput(documents, { fusionFailed: true }),
        documents: documents || [],
      };
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * Combines rankings from multiple sources using reciprocal ranks
   */
  private reciprocalRankFusion(documentSets: Document[][]): Document[] {
    const docScores = new Map<
      string,
      { score: number; doc: Document; ranks: number[] }
    >();

    // Calculate RRF scores for each document across all sets
    documentSets.forEach((docSet, setIndex) => {
      docSet.forEach((doc, rank) => {
        const key = this.getDocumentKey(doc);
        const existing = docScores.get(key);

        if (existing) {
          // Add reciprocal rank score: 1/(k + rank)
          existing.score += 1 / (60 + rank); // k=60 is standard RRF constant
          existing.ranks.push(rank);
        } else {
          docScores.set(key, {
            score: 1 / (60 + rank),
            doc,
            ranks: [rank],
          });
        }
      });
    });

    // Sort by RRF score
    const sorted = Array.from(docScores.values()).sort(
      (a, b) => b.score - a.score,
    );

    return sorted.map((item) => ({
      ...item.doc,
      metadata: {
        ...item.doc.metadata,
        fusionScore: item.score,
        fusionMethod: 'rrf',
        ranks: item.ranks,
      },
    }));
  }

  /**
   * Weighted Fusion
   * Combines scores using configurable weights for each source
   */
  private weightedFusion(
    documentSets: Document[][],
    weights: Record<string, number>,
  ): Document[] {
    const docScores = new Map<
      string,
      { score: number; doc: Document; sources: string[] }
    >();

    documentSets.forEach((docSet, setIndex) => {
      const sourceKey = `source_${setIndex}`;
      const weight = weights[sourceKey] ?? 1.0;

      docSet.forEach((doc) => {
        const key = this.getDocumentKey(doc);
        const existing = docScores.get(key);
        const docScore = (doc.metadata.score as number) ?? 0.5;

        if (existing) {
          existing.score += docScore * weight;
          existing.sources.push(sourceKey);
        } else {
          docScores.set(key, {
            score: docScore * weight,
            doc,
            sources: [sourceKey],
          });
        }
      });
    });

    // Sort by weighted score
    const sorted = Array.from(docScores.values()).sort(
      (a, b) => b.score - a.score,
    );

    return sorted.map((item) => ({
      ...item.doc,
      metadata: {
        ...item.doc.metadata,
        fusionScore: item.score,
        fusionMethod: 'weighted',
        sources: item.sources,
      },
    }));
  }

  /**
   * Diversity-Biased Score Fusion (DBSF)
   * Balances relevance and diversity in fused results
   */
  private diversityBiasedScoreFusion(documentSets: Document[][]): Document[] {
    const allDocs = documentSets.flat();
    const diversityThreshold = 0.7; // Similarity threshold for diversity

    const selected: Document[] = [];
    const remaining = [...allDocs];

    while (remaining.length > 0 && selected.length < 10) {
      // Score remaining documents
      const scored = remaining.map((doc) => ({
        doc,
        score: this.calculateDiversityScore(doc, selected, diversityThreshold),
      }));

      // Select highest scoring document
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];

      selected.push(best.doc);

      // Remove from remaining (and similar documents for diversity)
      const filtered = remaining.filter(
        (doc) =>
          this.getDocumentKey(doc) !== this.getDocumentKey(best.doc) &&
          this.calculateSimilarity(doc, best.doc) < diversityThreshold,
      );

      remaining.length = 0;
      remaining.push(...filtered);
    }

    return selected.map((doc) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        fusionScore: (doc.metadata.score as number) ?? 0.5,
        fusionMethod: 'dbsf',
      },
    }));
  }

  /**
   * LLM-based fusion: uses optional LLM ranker or query-aware relevance scoring to select and order documents.
   */
  private async llmBasedFusion(
    documentSets: Document[][],
    query: string,
  ): Promise<Document[]> {
    const effectiveConfig = this.config;

    // Build unique documents by key and short snippets for ranking
    const keyToDoc = new Map<string, { doc: Document; index: number }>();
    const snippets: Array<{ key: string; content: string; index: number }> = [];
    let index = 0;

    for (const docSet of documentSets) {
      for (const doc of docSet) {
        const key = this.getDocumentKey(doc);
        if (!keyToDoc.has(key)) {
          keyToDoc.set(key, { doc, index });
          const content = doc.pageContent.trim();
          snippets.push({
            key,
            content:
              content.length > 500 ? content.slice(0, 500) + '...' : content,
            index,
          });
          index++;
        }
      }
    }

    const uniqueDocs = Array.from(keyToDoc.entries()).map(([, v]) => v.doc);

    if (uniqueDocs.length === 0) {
      return [];
    }

    if (snippets.length === 0) {
      return this.reciprocalRankFusion(documentSets);
    }

    // Option 1: Use provided LLM ranker
    if (
      effectiveConfig.llmRankDocuments &&
      typeof effectiveConfig.llmRankDocuments === 'function'
    ) {
      try {
        const orderedKeys = await effectiveConfig.llmRankDocuments(
          query,
          snippets,
        );
        const orderedDocs: Document[] = [];
        const seen = new Set<string>();
        for (const key of orderedKeys) {
          const entry = keyToDoc.get(key);
          if (entry && !seen.has(key)) {
            seen.add(key);
            orderedDocs.push(entry.doc);
          }
        }
        // Append any docs not returned by the LLM
        for (const [key, { doc }] of keyToDoc) {
          if (!seen.has(key)) orderedDocs.push(doc);
        }
        this.logger.log('LLM-based fusion completed with external ranker', {
          component: 'FusionModule',
          queryLength: query.length,
          totalDocs: uniqueDocs.length,
          rankedCount: orderedDocs.length,
        });
        return orderedDocs.map((doc) => ({
          ...doc,
          metadata: {
            ...doc.metadata,
            fusionMethod: 'llm-based',
          },
        }));
      } catch (error) {
        this.logger.warn(
          'LLM ranker failed, falling back to query-aware scoring',
          {
            component: 'FusionModule',
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Option 2: Query-aware relevance scoring (no LLM)
    const queryTerms = this.tokenize(query);
    const docScores = new Map<string, { score: number; doc: Document }>();

    for (const doc of uniqueDocs) {
      const key = this.getDocumentKey(doc);
      const terms = this.tokenize(doc.pageContent);
      const relevance = this.queryDocumentRelevance(queryTerms, terms);
      const rrfBonus = this.getRRFContribution(key, documentSets);
      const score = relevance + 0.3 * rrfBonus;
      docScores.set(key, { score, doc });
    }

    const sorted = Array.from(docScores.values()).sort(
      (a, b) => b.score - a.score,
    );

    this.logger.log('LLM-based fusion completed with query-aware scoring', {
      component: 'FusionModule',
      queryLength: query.length,
      totalDocs: sorted.length,
    });

    return sorted.map(({ doc, score }) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        fusionScore: score,
        fusionMethod: 'llm-based',
      },
    }));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((t) => t.length > 1);
  }

  private queryDocumentRelevance(
    queryTerms: string[],
    docTerms: string[],
  ): number {
    if (queryTerms.length === 0) return 0;
    const docSet = new Set(docTerms);
    let hits = 0;
    for (const q of queryTerms) {
      if (docSet.has(q)) hits++;
    }
    return queryTerms.length > 0 ? hits / queryTerms.length : 0;
  }

  private getRRFContribution(key: string, documentSets: Document[][]): number {
    const k = 60;
    let sum = 0;
    for (const docSet of documentSets) {
      const rank = docSet.findIndex((d) => this.getDocumentKey(d) === key);
      if (rank >= 0) sum += 1 / (k + rank);
    }
    return sum;
  }

  /**
   * Calculate diversity score (relevance + diversity bonus)
   */
  private calculateDiversityScore(
    candidate: Document,
    selected: Document[],
    diversityThreshold: number,
  ): number {
    const baseScore = (candidate.metadata.score as number) ?? 0.5;
    let diversityBonus = 0;

    // Calculate minimum similarity to already selected documents
    let minSimilarity = 1.0;
    for (const selectedDoc of selected) {
      const similarity = this.calculateSimilarity(candidate, selectedDoc);
      minSimilarity = Math.min(minSimilarity, similarity);
    }

    // Diversity bonus: higher when document is less similar to selected ones
    if (minSimilarity < diversityThreshold) {
      diversityBonus = (1 - minSimilarity) * 0.3; // Up to 0.3 bonus
    }

    return baseScore + diversityBonus;
  }

  /**
   * Calculate similarity between two documents (simple Jaccard similarity)
   */
  private calculateSimilarity(doc1: Document, doc2: Document): number {
    const text1 = doc1.pageContent.toLowerCase().split(/\s+/);
    const text2 = doc2.pageContent.toLowerCase().split(/\s+/);

    const set1 = new Set(text1);
    const set2 = new Set(text2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Remove duplicate documents based on similarity threshold
   */
  private deduplicateDocuments(
    documents: Document[],
    threshold: number,
  ): Document[] {
    const deduplicated: Document[] = [];

    for (const doc of documents) {
      let isDuplicate = false;

      for (const existing of deduplicated) {
        if (this.calculateSimilarity(doc, existing) >= threshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(doc);
      }
    }

    return deduplicated;
  }

  /**
   * Generate a unique key for a document
   */
  private getDocumentKey(doc: Document): string {
    return (
      (doc.metadata._id as string) ||
      (doc.metadata.documentId as string) ||
      doc.pageContent.substring(0, 100)
    );
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      strategy: 'rrf',
      deduplicationThreshold: 0.85,
    };
  }

  protected getDescription(): string {
    return 'Multi-source document fusion and deduplication module';
  }

  protected getCapabilities(): string[] {
    return [
      'Reciprocal Rank Fusion (RRF)',
      'Weighted fusion',
      'Diversity-biased fusion',
      'LLM-based fusion',
      'Document deduplication',
      'Similarity calculation',
      'Multi-source ranking',
    ];
  }
}
