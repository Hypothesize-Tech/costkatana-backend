/**
 * Base RAG Pattern
 * Abstract base class for all RAG patterns
 */

import {
  IRAGPattern,
  RAGPatternType,
  RAGConfig,
  RAGContext,
  RAGResult,
  PatternDescription,
  RAGPatternError,
} from '../types/rag.types';
import { loggingService } from '../../services/logging.service';

export abstract class BaseRAGPattern implements IRAGPattern {
  public readonly name: string;
  public readonly type: RAGPatternType;
  public config: RAGConfig;

  constructor(name: string, type: RAGPatternType, config: RAGConfig) {
    this.name = name;
    this.type = type;
    this.config = config;
  }

  /**
   * Execute the pattern with error handling and logging
   */
  async execute(query: string, context: RAGContext): Promise<RAGResult> {
    const startTime = Date.now();

    try {
      loggingService.info(`RAG Pattern [${this.name}] executing`, {
        component: 'RAGPattern',
        pattern: this.type,
        query: query.substring(0, 100),
        userId: context.userId,
        conversationId: context.conversationId,
      });

      // Execute pattern-specific logic
      const result = await this.executePattern(query, context);

      const totalDuration = Date.now() - startTime;

      loggingService.info(`RAG Pattern [${this.name}] completed`, {
        component: 'RAGPattern',
        pattern: this.type,
        success: result.success,
        documentCount: result.documents.length,
        duration: totalDuration,
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          performance: {
            ...result.metadata.performance,
            totalDuration,
          },
        },
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      loggingService.error(`RAG Pattern [${this.name}] failed`, {
        component: 'RAGPattern',
        pattern: this.type,
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
      });

      throw new RAGPatternError(
        this.type,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Abstract method that each pattern must implement
   */
  protected abstract executePattern(
    query: string,
    context: RAGContext
  ): Promise<RAGResult>;

  /**
   * Get pattern description
   */
  abstract getDescription(): PatternDescription;

  /**
   * Update pattern configuration
   */
  updateConfig(newConfig: Partial<RAGConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      modules: {
        ...this.config.modules,
        ...newConfig.modules,
      },
    };

    loggingService.info(`RAG Pattern [${this.name}] configuration updated`, {
      component: 'RAGPattern',
      pattern: this.type,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): RAGConfig {
    return { ...this.config };
  }
}

