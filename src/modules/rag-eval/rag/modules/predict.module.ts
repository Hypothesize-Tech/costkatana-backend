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

export class PredictModule extends BaseRAGModule {
  protected config: PredictConfig;
  private llm: ChatBedrockConverse;

  constructor(
    config: PredictConfig = {
      enabled: true,
      generateHypothesis: true,
      numHypotheses: 1,
      temperature: 0.5,
    },
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
    input: RAGModuleInput,
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
        effectiveConfig.numHypotheses || 1,
      );

      this.logger.log('Hypotheses generated', {
        component: 'PredictModule',
        query: query.substring(0, 100),
        hypothesesCount: hypotheses.length,
      });

      return {
        ...this.createSuccessOutput(
          { hypotheses },
          {
            hypothesisCount: hypotheses.length,
            generationMethod: 'llm',
            temperature: effectiveConfig.temperature,
          },
        ),
        query,
      };
    } catch (error) {
      this.logger.warn('Hypothesis generation failed', {
        component: 'PredictModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.createSuccessOutput(
          { hypotheses: [] },
          { generationFailed: true },
        ),
        query,
      };
    }
  }

  /**
   * Generate hypotheses for the query
   */
  private async generateHypotheses(
    query: string,
    numHypotheses: number,
  ): Promise<string[]> {
    const hypotheses: string[] = [];

    for (let i = 0; i < numHypotheses; i++) {
      const hypothesis = await this.generateSingleHypothesis(query, i + 1);
      if (hypothesis) {
        hypotheses.push(hypothesis);
      }
    }

    return hypotheses;
  }

  /**
   * Generate a single hypothesis
   */
  private async generateSingleHypothesis(
    query: string,
    hypothesisNumber: number,
  ): Promise<string> {
    let prompt = `Generate a hypothesis that would help answer this question. The hypothesis should be a detailed passage that contains the type of information needed to answer the question.

Question: "${query}"`;

    if (hypothesisNumber > 1) {
      prompt += `\n\nNote: This is hypothesis #${hypothesisNumber}. Try to generate a different perspective or approach from previous hypotheses.`;
    }

    prompt += `\n\nHypothesis:`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : '';

      return content;
    } catch (error) {
      this.logger.warn(`Hypothesis ${hypothesisNumber} generation failed`, {
        component: 'PredictModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }

  /**
   * Evaluate hypothesis quality (for future use)
   */
  private async evaluateHypothesis(
    hypothesis: string,
    query: string,
  ): Promise<number> {
    const prompt = `Evaluate how well this hypothesis would help answer the question. Rate from 0.0 (not helpful) to 1.0 (very helpful).

Question: "${query}"
Hypothesis: "${hypothesis}"

Rating (0.0-1.0):`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : '0.5';
      const rating = parseFloat(content);

      return isNaN(rating) ? 0.5 : Math.max(0, Math.min(1, rating));
    } catch (error) {
      return 0.5;
    }
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      generateHypothesis: true,
      numHypotheses: 1,
      temperature: 0.5,
    };
  }

  protected getDescription(): string {
    return 'Hypothesis generation for HyDE-style retrieval';
  }

  protected getCapabilities(): string[] {
    return [
      'Hypothesis generation',
      'HyDE retrieval',
      'Query prediction',
      'Answer anticipation',
      'Multiple hypothesis generation',
      'Hypothesis evaluation',
    ];
  }
}
