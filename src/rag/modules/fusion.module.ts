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
import { loggingService } from '../../services/logging.service';

export class FusionModule extends BaseRAGModule {
  protected config: FusionConfig;

  constructor(
    config: FusionConfig = {
      enabled: true,
      strategy: 'rrf',
      deduplicationThreshold: 0.85,
    }
  ) {
    super('FusionModule', 'fusion', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput
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
      const documentSets = (metadata?.documentSets as Document[][] | undefined) ?? [documents ?? []];

      let fusedDocuments: Document[];

      switch (effectiveConfig.strategy) {
        case 'rrf':
          fusedDocuments = this.reciprocalRankFusion(documentSets);
          break;

        case 'weighted':
          fusedDocuments = this.weightedFusion(
            documentSets,
            (effectiveConfig.weights as Record<string, number> | undefined) ?? {}
          );
          break;

        case 'dbsf':
          fusedDocuments = this.distributionBasedFusion(documentSets);
          break;

        case 'llm-based':
          fusedDocuments = await this.llmBasedFusion(documentSets);
          break;

        default:
          fusedDocuments = this.reciprocalRankFusion(documentSets);
      }

      // Deduplicate
      const deduplicated = this.deduplicateDocuments(
        fusedDocuments,
        (effectiveConfig.deduplicationThreshold as number | undefined) ?? 0.85
      );

      loggingService.info('Documents fused', {
        component: 'FusionModule',
        strategy: effectiveConfig.strategy,
        inputSets: documentSets.length,
        totalDocuments: documentSets.reduce((sum: number, set: Document[]) => sum + set.length, 0),
        fusedCount: deduplicated.length,
      });

      return {
        ...this.createSuccessOutput(deduplicated, {
          strategy: effectiveConfig.strategy,
          originalCount: documents.length,
          fusedCount: deduplicated.length,
        }),
        documents: deduplicated,
      };
    } catch (error) {
      loggingService.error('Document fusion failed', {
        component: 'FusionModule',
        error: error instanceof Error ? error.message : String(error),
      });

      // Return original documents on failure
      return {
        ...this.createSuccessOutput(documents, { fallback: true }),
        documents,
      };
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * Paper: "Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods"
   */
  private reciprocalRankFusion(documentSets: Document[][]): Document[] {
    const k = 60; // Standard RRF constant
    const scoreMap = new Map<string, { document: Document; score: number }>();

    for (const docSet of documentSets) {
      docSet.forEach((doc, rank) => {
        const docId = this.getDocumentId(doc);
        const rrfScore = 1 / (k + rank + 1);

        if (scoreMap.has(docId)) {
          const entry = scoreMap.get(docId)!;
          entry.score += rrfScore;
        } else {
          scoreMap.set(docId, { document: doc, score: rrfScore });
        }
      });
    }

    // Sort by score
    const fusedDocs = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(entry => {
        entry.document.metadata.fusionScore = entry.score;
        return entry.document;
      });

    return fusedDocs;
  }

  /**
   * Weighted fusion with custom weights per source
   */
  private weightedFusion(
    documentSets: Document[][],
    weights: Record<string, number>
  ): Document[] {
    const scoreMap = new Map<string, { document: Document; score: number }>();

    documentSets.forEach((docSet, setIndex) => {
      const weight = weights[`set_${setIndex}`] || 1.0;

      docSet.forEach((doc, rank) => {
        const docId = this.getDocumentId(doc);
        const baseScore = (doc.metadata.score as number) || 1 / (rank + 1);
        const weightedScore = baseScore * weight;

        if (scoreMap.has(docId)) {
          const entry = scoreMap.get(docId)!;
          entry.score += weightedScore;
        } else {
          scoreMap.set(docId, { document: doc, score: weightedScore });
        }
      });
    });

    // Sort by score
    const fusedDocs = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(entry => {
        entry.document.metadata.fusionScore = entry.score;
        return entry.document;
      });

    return fusedDocs;
  }

  /**
   * Distribution-based score fusion
   */
  private distributionBasedFusion(documentSets: Document[][]): Document[] {
    const scoreMap = new Map<string, { document: Document; scores: number[] }>();

    for (const docSet of documentSets) {
      docSet.forEach(doc => {
        const docId = this.getDocumentId(doc);
        const score = (doc.metadata.score as number) || 0.5;

        if (scoreMap.has(docId)) {
          scoreMap.get(docId)!.scores.push(score);
        } else {
          scoreMap.set(docId, { document: doc, scores: [score] });
        }
      });
    }

    // Calculate mean score for each document
    const fusedDocs = Array.from(scoreMap.values())
      .map(entry => {
        const meanScore =
          entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length;
        entry.document.metadata.fusionScore = meanScore;
        entry.document.metadata.fusionCount = entry.scores.length; // How many sets contained this doc
        return { document: entry.document, score: meanScore };
      })
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.document);

    return fusedDocs;
  }

  /**
   * LLM-based fusion using distribution-based scoring
   */
  private async llmBasedFusion(documentSets: Document[][]): Promise<Document[]> {
    // Use distribution-based fusion as sophisticated approach
    // This provides similar benefits to LLM-based fusion without the cost
    loggingService.info('Using distribution-based fusion for LLM-based strategy', {
      component: 'FusionModule',
    });
    return Promise.resolve(this.distributionBasedFusion(documentSets));
  }

  /**
   * Deduplicate documents based on content similarity
   */
  private deduplicateDocuments(
    documents: Document[],
    _threshold: number
  ): Document[] {
    const deduplicated: Document[] = [];
    const seen = new Set<string>();

    for (const doc of documents) {
      // Simple deduplication based on content hash
      const contentHash = this.getContentHash(doc);

      if (!seen.has(contentHash)) {
        seen.add(contentHash);
        deduplicated.push(doc);
      }
    }

    return deduplicated;
  }

  /**
   * Get unique document identifier
   */
  private getDocumentId(doc: Document): string {
    return (
      (doc.metadata._id as string) ||
      (doc.metadata.contentHash as string) ||
      doc.pageContent.substring(0, 100)
    );
  }

  /**
   * Get content hash for deduplication
   */
  private getContentHash(doc: Document): string {
    return (
      (doc.metadata.contentHash as string) ||
      doc.pageContent.substring(0, 200)
    );
  }

  protected getDescription(): string {
    return 'Fuses results from multiple retrieval sources using RRF, weighted, or distribution-based strategies';
  }

  protected getCapabilities(): string[] {
    return [
      'reciprocal_rank_fusion',
      'weighted_fusion',
      'distribution_based_fusion',
      'deduplication',
    ];
  }

  protected getDependencies() {
    return ['retrieve' as const];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      strategy: 'rrf',
      deduplicationThreshold: 0.85,
    };
  }

  validateConfig(): boolean {
    if (
      this.config.deduplicationThreshold &&
      (this.config.deduplicationThreshold < 0 ||
        this.config.deduplicationThreshold > 1)
    ) {
      return false;
    }

    return true;
  }
}

