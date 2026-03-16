import { Injectable } from '@nestjs/common';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
  RAGDocument,
} from '../types/rag.types';

export interface FusionModuleConfig extends ModuleConfig {
  fusionStrategy?: 'merge' | 'deduplicate' | 'score-based';
  deduplicationThreshold?: number;
  maxResults?: number;
}

/**
 * Fusion Module
 * Multi-query fusion and result consolidation
 */
@Injectable()
export class FusionModule extends BaseRAGModule {
  private readonly config: FusionModuleConfig;

  constructor() {
    super('FusionModule');
    this.config = {
      enabled: true,
      priority: 8,
      timeout: 2000,
      fusionStrategy: 'merge',
      deduplicationThreshold: 0.8,
      maxResults: 20,
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    if (!previousResults || previousResults.length === 0) {
      return {
        documents: [],
        reasoning: 'No previous results to fuse',
        confidence: 0.0,
        metadata: { noResults: true },
      };
    }

    try {
      const allDocuments = previousResults.flatMap(
        (result) => result.documents,
      );
      const fusedDocuments = await this.fuseDocuments(allDocuments);

      this.logger.log(
        `Fused ${allDocuments.length} documents into ${fusedDocuments.length}`,
        {
          fusionStrategy: this.config.fusionStrategy,
          deduplicationThreshold: this.config.deduplicationThreshold,
        },
      );

      return {
        documents: fusedDocuments,
        reasoning: `Fused results using ${this.config.fusionStrategy} strategy`,
        confidence: 0.8,
        metadata: {
          originalDocumentCount: allDocuments.length,
          fusedDocumentCount: fusedDocuments.length,
          fusionStrategy: this.config.fusionStrategy,
        },
      };
    } catch (error) {
      this.logger.error('Document fusion failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return merged documents without fusion on failure
      const allDocuments = previousResults.flatMap(
        (result) => result.documents,
      );
      return {
        documents: allDocuments.slice(0, this.config.maxResults),
        reasoning: 'Fusion failed, returning merged results',
        confidence: 0.5,
        metadata: { fallback: true },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return (
      this.config.enabled &&
      !!input &&
      typeof input.query === 'string' &&
      input.query.trim().length > 0
    );
  }

  getConfig(): ModuleConfig {
    return this.config;
  }

  /**
   * Fuse documents based on configured strategy
   */
  private async fuseDocuments(
    documents: RAGDocument[],
  ): Promise<RAGDocument[]> {
    const strategy = this.config.fusionStrategy || 'merge';
    const maxResults = this.config.maxResults || 20;

    switch (strategy) {
      case 'deduplicate':
        return this.deduplicateDocuments(documents).slice(0, maxResults);
      case 'score-based':
        return this.scoreBasedFusion(documents).slice(0, maxResults);
      case 'merge':
      default:
        return this.mergeDocuments(documents).slice(0, maxResults);
    }
  }

  /**
   * Simple merge with deduplication
   */
  private mergeDocuments(documents: RAGDocument[]): RAGDocument[] {
    const seen = new Set<string>();
    const unique: RAGDocument[] = [];

    for (const doc of documents) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        unique.push(doc);
      }
    }

    return unique;
  }

  /**
   * Advanced deduplication based on content similarity
   */
  private deduplicateDocuments(documents: RAGDocument[]): RAGDocument[] {
    const threshold = this.config.deduplicationThreshold || 0.8;
    const unique: RAGDocument[] = [];

    for (const candidate of documents) {
      let isDuplicate = false;

      for (const existing of unique) {
        const similarity = this.calculateContentSimilarity(
          candidate.content.toLowerCase(),
          existing.content.toLowerCase(),
        );

        if (similarity >= threshold) {
          // Merge metadata and keep the higher-scored document
          const candidateScore = candidate.metadata.score || 0;
          const existingScore = existing.metadata.score || 0;

          if (candidateScore > existingScore) {
            // Replace existing with candidate
            const index = unique.indexOf(existing);
            unique[index] = {
              ...candidate,
              metadata: {
                ...candidate.metadata,
                ...existing.metadata,
                mergedFrom: [
                  existing.id,
                  ...(candidate.metadata.mergedFrom || []),
                ],
              },
            };
          } else {
            // Update existing metadata
            existing.metadata = {
              ...existing.metadata,
              mergedFrom: [
                candidate.id,
                ...(existing.metadata.mergedFrom || []),
              ],
            };
          }

          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        unique.push(candidate);
      }
    }

    return unique;
  }

  /**
   * Score-based fusion combining multiple ranking signals
   */
  private scoreBasedFusion(documents: RAGDocument[]): RAGDocument[] {
    // Group by document ID
    const docGroups = new Map<string, RAGDocument[]>();

    for (const doc of documents) {
      if (!docGroups.has(doc.id)) {
        docGroups.set(doc.id, []);
      }
      docGroups.get(doc.id)!.push(doc);
    }

    // Fuse each group
    const fusedDocs: RAGDocument[] = [];

    for (const [docId, variants] of docGroups) {
      if (variants.length === 1) {
        fusedDocs.push(variants[0]);
      } else {
        // Combine scores and metadata
        const combinedScore =
          variants.reduce((sum, v) => sum + (v.metadata.score || 0), 0) /
          variants.length;
        const allSources = variants.flatMap((v) =>
          v.metadata.source ? [v.metadata.source] : [],
        );

        fusedDocs.push({
          ...variants[0], // Use first variant as base
          metadata: {
            ...variants[0].metadata,
            score: combinedScore,
            sources: [...new Set(allSources)],
            variantCount: variants.length,
          },
        });
      }
    }

    // Sort by combined score
    return fusedDocs.sort(
      (a, b) => (b.metadata.score || 0) - (a.metadata.score || 0),
    );
  }

  /**
   * Calculate similarity between two text contents
   */
  private calculateContentSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/).filter((w) => w.length > 3));
    const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 3));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}
