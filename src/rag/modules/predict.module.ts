/**
 * Predict Module
 * Hypothesis generation for HyDE-style retrieval
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  PredictConfig,
} from '../types/rag.types';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';

export class PredictModule extends BaseRAGModule {
  protected config: PredictConfig;
  private llm: ChatBedrockConverse;

  constructor(
    config: PredictConfig = {
      enabled: true,
      generateHypothesis: true,
      numHypotheses: 1,
      temperature: 0.5,
    }
  ) {
    super('PredictModule', 'predict', config);
    this.config = config;

    this.llm = new ChatBedrockConverse({
      model: config.model || 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: config.temperature || 0.5,
      maxTokens: 500,
    });
  }

  protected async executeInternal(
    input: RAGModuleInput
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;
    const effectiveConfig = { ...this.config, ...config };

    if (!effectiveConfig.generateHypothesis) {
      return {
        ...this.createSuccessOutput({ hypotheses: [] }, { skipped: true }),
        query,
      };
    }

    try {
      const hypotheses = await this.generateHypotheses(
        query,
        effectiveConfig.numHypotheses || 1
      );

      loggingService.info('Hypotheses generated', {
        component: 'PredictModule',
        query: query.substring(0, 100),
        hypothesesCount: hypotheses.length,
      });

      return {
        ...this.createSuccessOutput(
          { hypotheses },
          { hypothesesCount: hypotheses.length }
        ),
        query: hypotheses[0] || query, // Return best hypothesis as new query
      };
    } catch (error) {
      loggingService.error('Hypothesis generation failed', {
        component: 'PredictModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput({ hypotheses: [query] }, { fallback: true }),
        query,
      };
    }
  }

  /**
   * Generate hypothetical answers (HyDE approach)
   */
  private async generateHypotheses(
    query: string,
    count: number
  ): Promise<string[]> {
    const hypotheses: string[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const hypothesis = await this.generateSingleHypothesis(query);
        if (hypothesis) {
          hypotheses.push(hypothesis);
        }
      } catch (error) {
        loggingService.warn('Single hypothesis generation failed', {
          component: 'PredictModule',
          iteration: i,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return hypotheses.length > 0 ? hypotheses : [query];
  }

  /**
   * Generate a single hypothetical document
   */
  private async generateSingleHypothesis(query: string): Promise<string> {
    const prompt = `You are an expert knowledge base article writer. Given the following question, write a detailed paragraph (3-4 sentences) that would appear in a documentation article answering this question. Write factually and professionally as if this is from official documentation.

Question: "${query}"

Answer paragraph:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    const hypothesis = typeof response.content === 'string' 
      ? response.content.trim() 
      : query;

    return hypothesis || query;
  }

  protected getDescription(): string {
    return 'Generates hypothetical answers for HyDE-style retrieval';
  }

  protected getCapabilities(): string[] {
    return [
      'hypothesis_generation',
      'hyde_retrieval',
      'multiple_hypotheses',
    ];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      generateHypothesis: true,
      numHypotheses: 1,
      temperature: 0.5,
    };
  }

  validateConfig(): boolean {
    if (this.config.numHypotheses && this.config.numHypotheses < 1) {
      return false;
    }

    if (
      this.config.temperature &&
      (this.config.temperature < 0 || this.config.temperature > 1)
    ) {
      return false;
    }

    return true;
  }
}

