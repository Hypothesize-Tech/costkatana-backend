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
import { RagServiceLocator } from '../../services/rag-service-locator';

export class DemonstrateModule extends BaseRAGModule {
  protected config: DemonstrateConfig;

  constructor(
    config: DemonstrateConfig = {
      enabled: true,
      numExamples: 3,
      selectionStrategy: 'similarity',
    },
  ) {
    super('DemonstrateModule', 'demonstrate', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;
    const effectiveConfig = { ...this.config, ...config };

    try {
      // Retrieve examples based on selection strategy
      const examples = await this.selectExamples(query, effectiveConfig);

      this.logger.log('Examples retrieved for demonstration', {
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
            source: effectiveConfig.exampleSource || 'conversation',
          },
        ),
        documents: examples,
        query,
      };
    } catch (error) {
      this.logger.warn('Example retrieval failed', {
        component: 'DemonstrateModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput(
          { examples: [] },
          { retrievalFailed: true },
        ),
        documents: [],
        query,
      };
    }
  }

  /**
   * Select examples based on the configured strategy
   */
  private async selectExamples(
    query: string,
    config: DemonstrateConfig,
  ): Promise<Document[]> {
    const strategy = config.selectionStrategy ?? 'similarity';
    const numExamples = config.numExamples ?? 3;

    switch (strategy) {
      case 'similarity':
        return this.selectBySimilarity(query, numExamples, config);

      case 'diversity':
        return this.selectByDiversity(query, numExamples, config);

      case 'coverage':
        return this.selectByCoverage(query, numExamples, config);

      default:
        this.logger.warn(
          `Unknown selection strategy: ${strategy}, using similarity`,
          {
            component: 'DemonstrateModule',
          },
        );
        return this.selectBySimilarity(query, numExamples, config);
    }
  }

  /**
   * Select examples by semantic similarity to query
   */
  private async selectBySimilarity(
    query: string,
    numExamples: number,
    config: DemonstrateConfig,
  ): Promise<Document[]> {
    try {
      // Retrieve examples using the retrieval service
      const retrievalOptions = {
        limit: numExamples * 2, // Get more for selection
        filters: {
          source: ['conversation', 'examples'], // Look in conversation history and example sources
        },
        userId: undefined, // Allow public examples
      };

      const result = await RagServiceLocator.getRetrievalService().retrieve(
        query,
        retrievalOptions,
      );

      // Filter to examples only (documents marked as examples)
      const examples = result.documents.filter(
        (doc) =>
          (doc.metadata.isExample as boolean) ||
          (doc.metadata.source as string) === 'examples' ||
          (doc.metadata.tags as string[])?.includes('example'),
      );

      return examples.slice(0, numExamples);
    } catch (error) {
      this.logger.warn('Similarity-based example selection failed', {
        component: 'DemonstrateModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Select diverse examples covering different aspects
   */
  private async selectByDiversity(
    query: string,
    numExamples: number,
    config: DemonstrateConfig,
  ): Promise<Document[]> {
    try {
      // Get more examples than needed
      const candidates = await this.selectBySimilarity(
        query,
        numExamples * 3,
        config,
      );

      if (candidates.length <= numExamples) {
        return candidates;
      }

      // Select diverse examples using MMR (Maximal Marginal Relevance)
      const selected: Document[] = [];
      const remaining = [...candidates];

      // Always include the most similar example first
      selected.push(remaining.shift()!);

      while (selected.length < numExamples && remaining.length > 0) {
        let bestCandidate: Document | null = null;
        let bestScore = -1;

        for (const candidate of remaining) {
          // Calculate diversity score (relevance - redundancy)
          const relevance = this.calculateSimilarity(
            query,
            candidate.pageContent,
          );
          const redundancy = selected.reduce(
            (max, selected) =>
              Math.max(
                max,
                this.calculateSimilarity(
                  selected.pageContent,
                  candidate.pageContent,
                ),
              ),
            0,
          );

          const diversityScore = 0.7 * relevance - 0.3 * redundancy;

          if (diversityScore > bestScore) {
            bestScore = diversityScore;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate) {
          selected.push(bestCandidate);
          remaining.splice(remaining.indexOf(bestCandidate), 1);
        } else {
          break;
        }
      }

      return selected;
    } catch (error) {
      this.logger.warn('Diversity-based example selection failed', {
        component: 'DemonstrateModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.selectBySimilarity(query, numExamples, config);
    }
  }

  /**
   * Select examples that provide broad coverage of query aspects
   */
  private async selectByCoverage(
    query: string,
    numExamples: number,
    config: DemonstrateConfig,
  ): Promise<Document[]> {
    try {
      const candidates = await this.selectBySimilarity(
        query,
        numExamples * 2,
        config,
      );

      // Extract key aspects from query
      const queryAspects = this.extractQueryAspects(query);

      // Score examples by aspect coverage
      const scored = candidates.map((example) => {
        const exampleAspects = this.extractQueryAspects(example.pageContent);
        const coverage = this.calculateAspectCoverage(
          queryAspects,
          exampleAspects,
        );

        return {
          example,
          coverage,
        };
      });

      // Select examples with best aspect coverage
      scored.sort((a, b) => b.coverage - a.coverage);

      return scored.slice(0, numExamples).map((item) => item.example);
    } catch (error) {
      this.logger.warn('Coverage-based example selection failed', {
        component: 'DemonstrateModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.selectBySimilarity(query, numExamples, config);
    }
  }

  /**
   * Extract key aspects/concepts from text
   */
  private extractQueryAspects(text: string): string[] {
    // Simple keyword extraction (could be enhanced with NLP)
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3 && !this.isStopWord(word));

    // Remove duplicates and return top concepts
    const unique = [...new Set(words)];
    return unique.slice(0, 5); // Limit to 5 key aspects
  }

  /**
   * Check if word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'an',
      'a',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
    ]);

    return stopWords.has(word);
  }

  /**
   * Calculate aspect coverage between query and example
   */
  private calculateAspectCoverage(
    queryAspects: string[],
    exampleAspects: string[],
  ): number {
    if (queryAspects.length === 0) return 0;

    let covered = 0;
    for (const queryAspect of queryAspects) {
      const hasMatch = exampleAspects.some(
        (exampleAspect) =>
          exampleAspect.includes(queryAspect) ||
          queryAspect.includes(exampleAspect),
      );
      if (hasMatch) {
        covered++;
      }
    }

    return covered / queryAspects.length;
  }

  /**
   * Calculate simple text similarity
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      numExamples: 3,
      selectionStrategy: 'similarity',
    };
  }

  protected getDescription(): string {
    return 'Few-shot example retrieval and selection module';
  }

  protected getCapabilities(): string[] {
    return [
      'Example retrieval',
      'Few-shot learning',
      'Similarity-based selection',
      'Diversity-based selection',
      'Coverage-based selection',
      'Aspect extraction',
      'Semantic matching',
    ];
  }
}
