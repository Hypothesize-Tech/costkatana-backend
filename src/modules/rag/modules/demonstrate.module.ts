import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
  RAGDocument,
} from '../types/rag.types';
import {
  RAGExample,
  RAGExampleDocument,
} from '../../../schemas/document/rag-example.schema';

export interface DemonstrateModuleConfig extends ModuleConfig {
  numExamples?: number;
  selectionStrategy?: 'similarity' | 'random' | 'diversity';
}

/**
 * Demonstrate Module
 * Few-shot example retrieval and selection
 */
@Injectable()
export class DemonstrateModule extends BaseRAGModule {
  private readonly config: DemonstrateModuleConfig;

  constructor(
    @InjectModel(RAGExample.name)
    private readonly ragExampleModel: Model<RAGExampleDocument>,
  ) {
    super('DemonstrateModule');
    this.config = {
      enabled: true,
      priority: 4,
      timeout: 2000,
      numExamples: 3,
      selectionStrategy: 'similarity',
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    const { query } = input;

    try {
      // Retrieve examples based on selection strategy
      const examples = await this.selectExamples(query);

      this.logger.log(
        `Examples retrieved for demonstration: ${examples.length} examples`,
        {
          query: query.substring(0, 100),
          strategy: this.config.selectionStrategy,
        },
      );

      return {
        documents: examples,
        reasoning: `Retrieved ${examples.length} examples for few-shot learning`,
        confidence: 0.7,
        metadata: {
          examplesCount: examples.length,
          strategy: this.config.selectionStrategy,
        },
      };
    } catch (error) {
      this.logger.error('Example retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        documents: [],
        reasoning: 'Example retrieval failed',
        confidence: 0.0,
        metadata: { error: true },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return this.config.enabled;
  }

  getConfig(): ModuleConfig {
    return this.config;
  }

  /**
   * Select examples based on query similarity
   */
  private async selectExamples(query: string): Promise<RAGDocument[]> {
    const numExamples = this.config.numExamples || 3;
    const strategy = this.config.selectionStrategy || 'similarity';

    switch (strategy) {
      case 'similarity':
        return await this.similarityBasedSelection(query, numExamples);
      case 'random':
        return await this.randomSelection(numExamples);
      case 'diversity':
        return await this.diversityBasedSelection(query, numExamples);
      default:
        return await this.similarityBasedSelection(query, numExamples);
    }
  }

  /**
   * Select examples based on semantic similarity to query
   */
  private async similarityBasedSelection(
    query: string,
    numExamples: number,
  ): Promise<RAGDocument[]> {
    try {
      const lowerQuery = query.toLowerCase();

      // Get all active examples from database
      const examples = await this.ragExampleModel.find({ isActive: true });

      // Calculate similarity scores
      const scoredExamples = examples.map((dbExample) => {
        const similarity = this.calculateSimilarity(
          lowerQuery,
          dbExample.content.toLowerCase(),
        );
        return {
          example: {
            id: dbExample.id,
            content: dbExample.content,
            metadata: dbExample.metadata,
          },
          similarity,
          dbRecord: dbExample,
        };
      });

      // Sort by similarity and return top results
      const topExamples = scoredExamples
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, numExamples);

      // Update usage statistics for selected examples
      await Promise.all(
        topExamples.map(async (item) => {
          await this.ragExampleModel.findOneAndUpdate(
            { id: item.dbRecord.id },
            {
              $inc: { usageCount: 1 },
              lastUsed: new Date(),
            },
          );
        }),
      );

      return topExamples.map((item) => item.example);
    } catch (error) {
      this.logger.warn(
        'Similarity-based selection failed, falling back to random',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return this.randomSelection(numExamples);
    }
  }

  /**
   * Random example selection
   */
  private async randomSelection(numExamples: number): Promise<RAGDocument[]> {
    try {
      // Get random active examples from database
      const examples = await this.ragExampleModel.aggregate([
        { $match: { isActive: true } },
        { $sample: { size: numExamples } },
      ]);

      // Update usage statistics
      await Promise.all(
        examples.map(async (dbExample) => {
          await this.ragExampleModel.findOneAndUpdate(
            { id: dbExample.id },
            {
              $inc: { usageCount: 1 },
              lastUsed: new Date(),
            },
          );
        }),
      );

      return examples.map((dbExample) => ({
        id: dbExample.id,
        content: dbExample.content,
        metadata: dbExample.metadata,
      }));
    } catch (error) {
      this.logger.error('Random selection failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Diversity-based selection to cover different topics
   */
  private async diversityBasedSelection(
    query: string,
    numExamples: number,
  ): Promise<RAGDocument[]> {
    try {
      // Start with most similar example
      const similar = await this.similarityBasedSelection(query, 1);
      if (similar.length === 0) return [];

      const selected = [similar[0]];

      // Get remaining examples from database
      const remainingExamples = await this.ragExampleModel.find({
        isActive: true,
        id: { $ne: similar[0].id },
      });

      // Add diverse examples
      while (selected.length < numExamples && remainingExamples.length > 0) {
        // Find example least similar to already selected ones
        let mostDiverse: RAGDocument | null = null;
        let maxDiversity = -1;

        for (const candidate of remainingExamples) {
          const avgSimilarity =
            selected.reduce((sum, selectedEx) => {
              return (
                sum +
                this.calculateSimilarity(
                  candidate.content.toLowerCase(),
                  selectedEx.content.toLowerCase(),
                )
              );
            }, 0) / selected.length;

          const diversity = 1 - avgSimilarity; // Higher diversity = lower similarity
          if (diversity > maxDiversity) {
            maxDiversity = diversity;
            mostDiverse = {
              id: candidate.id,
              content: candidate.content,
              metadata: candidate.metadata,
            };
          }
        }

        if (mostDiverse) {
          selected.push(mostDiverse);
          // Remove from remaining
          const index = remainingExamples.findIndex(
            (ex) => ex.id === mostDiverse.id,
          );
          if (index > -1) {
            remainingExamples.splice(index, 1);
          }

          // Update usage statistics
          await this.ragExampleModel.findOneAndUpdate(
            { id: mostDiverse.id },
            {
              $inc: { usageCount: 1 },
              lastUsed: new Date(),
            },
          );
        } else {
          break;
        }
      }

      return selected;
    } catch (error) {
      this.logger.warn(
        'Diversity-based selection failed, falling back to random',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return this.randomSelection(numExamples);
    }
  }

  /**
   * Simple similarity calculation based on word overlap
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 2));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}
