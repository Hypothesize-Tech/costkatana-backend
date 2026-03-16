import { Injectable } from '@nestjs/common';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
} from '../types/rag.types';
import { BedrockService } from '../../../services/bedrock.service';

export interface PredictModuleConfig extends ModuleConfig {
  confidenceThreshold?: number;
  maxPredictions?: number;
}

/**
 * Predict Module
 * Answer prediction module for preemptive responses
 */
@Injectable()
export class PredictModule extends BaseRAGModule {
  private readonly config: PredictModuleConfig;

  constructor(private readonly bedrockService: BedrockService) {
    super('PredictModule');
    this.config = {
      enabled: true,
      priority: 5,
      timeout: 5000,
      confidenceThreshold: 0.6,
      maxPredictions: 1,
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    const { query } = input;
    const previousPredictionCount = Array.isArray(previousResults)
      ? previousResults.reduce((count, result) => {
          if (result.metadata && Array.isArray(result.metadata.predictions)) {
            return count + result.metadata.predictions.length;
          }
          return count;
        }, 0)
      : 0;

    try {
      const predictions = await this.generatePredictions(query);

      this.logger.log(`Generated ${predictions.length} predictions`, {
        query: query.substring(0, 50),
        previousPredictionCount,
      });

      return {
        documents: [], // Predict module doesn't return documents
        reasoning: `Generated ${predictions.length} answer predictions. Previous modules produced ${previousPredictionCount} predictions.`,
        confidence: 0.6,
        metadata: {
          predictions,
          predictionCount: predictions.length,
          previousResultsUsed: !!previousResults && previousResults.length > 0,
          previousPredictionCount,
        },
      };
    } catch (error) {
      this.logger.error('Prediction generation failed', {
        error: error instanceof Error ? error.message : String(error),
        previousPredictionCount,
      });

      return {
        documents: [],
        reasoning: 'Prediction generation failed',
        confidence: 0.0,
        metadata: { error: true, previousPredictionCount },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return this.config.enabled && input.query.length > 10;
  }

  getConfig(): ModuleConfig {
    return this.config;
  }

  /**
   * Generate answer predictions for the query
   */
  private async generatePredictions(query: string): Promise<string[]> {
    try {
      const prompt = `Based on the following question, predict what the most likely answer would be. Provide a concise response.

Question: "${query}"

Predicted answer:`;

      const response = await this.bedrockService.invoke([
        { role: 'user', content: prompt },
      ]);
      const prediction =
        typeof response.content === 'string' ? response.content.trim() : null;

      if (prediction) {
        return [prediction];
      }

      return [];
    } catch (error) {
      this.logger.warn('Prediction generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
