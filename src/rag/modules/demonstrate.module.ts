/**
 * Demonstrate Module
 * Few-shot example retrieval and selection
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  DemonstrateConfig,
} from '../types/rag.types';
import { Document } from '@langchain/core/documents';
import { retrievalService } from '../../services/retrieval.service';
import { loggingService } from '../../services/logging.service';

export class DemonstrateModule extends BaseRAGModule {
  protected config: DemonstrateConfig;

  constructor(
    config: DemonstrateConfig = {
      enabled: true,
      numExamples: 3,
      selectionStrategy: 'similarity',
    }
  ) {
    super('DemonstrateModule', 'demonstrate', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;
    const effectiveConfig = { ...this.config, ...config };

    try {
      // Retrieve examples based on selection strategy
      const examples = await this.selectExamples(query, effectiveConfig);

      loggingService.info('Examples retrieved for demonstration', {
        component: 'DemonstrateModule',
        query: query.substring(0, 100),
        examplesCount: examples.length,
        strategy: effectiveConfig.selectionStrategy,
      });

      return {
        ...this.createSuccessOutput(
          { examples },
          {
            examplesCount: examples.length,
            strategy: effectiveConfig.selectionStrategy,
          }
        ),
        documents: examples,
        query,
      };
    } catch (error) {
      loggingService.error('Example retrieval failed', {
        component: 'DemonstrateModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput({ examples: [] }, { fallback: true }),
        documents: [],
        query,
      };
    }
  }

  /**
   * Select examples based on strategy
   */
  private async selectExamples(
    query: string,
    config: DemonstrateConfig
  ): Promise<Document[]> {
    const numExamples = config.numExamples || 3;
    const strategy = config.selectionStrategy || 'similarity';

    switch (strategy) {
      case 'similarity':
        return this.selectBySimilarity(query, numExamples, config);

      case 'diversity':
        return this.selectByDiversity(query, numExamples, config);

      case 'coverage':
        return this.selectByCoverage(query, numExamples, config);

      default:
        return this.selectBySimilarity(query, numExamples, config);
    }
  }

  /**
   * Select examples by similarity to query
   */
  private async selectBySimilarity(
    query: string,
    numExamples: number,
    config: DemonstrateConfig
  ): Promise<Document[]> {
    // Retrieve examples from knowledge base or example repository
    const source = config.exampleSource || 'knowledge-base';

    const result = await retrievalService.retrieve(query, {
      limit: numExamples,
      filters: {
        source: [source],
        tags: ['example', 'demonstration'],
      },
      useCache: true,
      rerank: true,
    });

    return result.documents;
  }

  /**
   * Select diverse examples covering different aspects
   */
  private async selectByDiversity(
    query: string,
    numExamples: number,
    config: DemonstrateConfig
  ): Promise<Document[]> {
    // Retrieve more candidates than needed
    const source = config.exampleSource || 'knowledge-base';
    const result = await retrievalService.retrieve(query, {
      limit: numExamples * 3,
      filters: {
        source: [source],
        tags: ['example', 'demonstration'],
      },
      useCache: true,
    });

    // Apply diversity selection
    const diverseExamples = this.applyDiversitySelection(
      result.documents,
      numExamples
    );

    return diverseExamples;
  }

  /**
   * Select examples for maximum coverage
   */
  private async selectByCoverage(
    query: string,
    numExamples: number,
    config: DemonstrateConfig
  ): Promise<Document[]> {
    // Similar to diversity but focuses on covering different topics
    const source = config.exampleSource || 'knowledge-base';
    const result = await retrievalService.retrieve(query, {
      limit: numExamples * 2,
      filters: {
        source: [source],
        tags: ['example', 'demonstration'],
      },
      useCache: true,
    });

    // Group by topics and select one from each
    const coverageExamples = this.applyCoverageSelection(
      result.documents,
      numExamples
    );

    return coverageExamples;
  }

  /**
   * Apply diversity selection algorithm
   */
  private applyDiversitySelection(
    documents: Document[],
    target: number
  ): Document[] {
    if (documents.length <= target) {
      return documents;
    }

    const selected: Document[] = [];
    const remaining = [...documents];

    // Select first document (highest score)
    selected.push(remaining.shift()!);

    // Iteratively select most diverse document
    while (selected.length < target && remaining.length > 0) {
      let maxDiversity = -1;
      let maxIndex = 0;

      for (let i = 0; i < remaining.length; i++) {
        const diversity = this.calculateDiversity(remaining[i], selected);
        if (diversity > maxDiversity) {
          maxDiversity = diversity;
          maxIndex = i;
        }
      }

      selected.push(remaining.splice(maxIndex, 1)[0]);
    }

    return selected;
  }

  /**
   * Calculate diversity score for a document relative to selected documents
   */
  private calculateDiversity(
    doc: Document,
    selected: Document[]
  ): number {
    if (selected.length === 0) return 1.0;

    // Simple diversity: lower similarity to already selected docs = higher diversity
    let minSimilarity = 1.0;

    for (const selectedDoc of selected) {
      const similarity = this.calculateSimilarity(doc, selectedDoc);
      minSimilarity = Math.min(minSimilarity, similarity);
    }

    return 1 - minSimilarity;
  }

  /**
   * Calculate similarity between two documents
   */
  private calculateSimilarity(doc1: Document, doc2: Document): number {
    // Simple Jaccard similarity based on word overlap
    const words1 = new Set(doc1.pageContent.toLowerCase().split(/\s+/));
    const words2 = new Set(doc2.pageContent.toLowerCase().split(/\s+/));

    const intersection = new Set(
      [...words1].filter(word => words2.has(word))
    );
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Apply coverage selection algorithm
   */
  private applyCoverageSelection(
    documents: Document[],
    target: number
  ): Document[] {
    if (documents.length <= target) {
      return documents;
    }

    // Group by topics/categories
    const groups = this.groupByTopic(documents);

    // Select one from each group
    const selected: Document[] = [];
    const groupKeys = Object.keys(groups);

    for (let i = 0; i < target && i < groupKeys.length; i++) {
      const groupKey = groupKeys[i];
      const group = groups[groupKey];
      selected.push(group[0]); // Take highest-scoring from each group
    }

    // Fill remaining slots if needed
    while (selected.length < target) {
      for (const groupKey of groupKeys) {
        const group = groups[groupKey];
        const nextDoc = group.find(doc => !selected.includes(doc));
        if (nextDoc) {
          selected.push(nextDoc);
          if (selected.length >= target) break;
        }
      }
      break; // Avoid infinite loop
    }

    return selected;
  }

  /**
   * Group documents by topic
   */
  private groupByTopic(documents: Document[]): Record<string, Document[]> {
    const groups: Record<string, Document[]> = {};

    for (const doc of documents) {
      const topic = doc.metadata.topic as string || doc.metadata.category as string || 'general';
      
      if (!groups[topic]) {
        groups[topic] = [];
      }
      groups[topic].push(doc);
    }

    return groups;
  }

  protected getDescription(): string {
    return 'Retrieves and selects few-shot examples for demonstration';
  }

  protected getCapabilities(): string[] {
    return [
      'similarity_selection',
      'diversity_selection',
      'coverage_selection',
      'few_shot_learning',
    ];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      numExamples: 3,
      selectionStrategy: 'similarity',
    };
  }

  validateConfig(): boolean {
    if (this.config.numExamples && this.config.numExamples < 1) {
      return false;
    }
    return true;
  }
}

