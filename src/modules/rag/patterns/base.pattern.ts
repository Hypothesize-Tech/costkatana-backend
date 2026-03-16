import { Injectable, Logger } from '@nestjs/common';
import { OrchestratorInput, PatternResult } from '../types/rag.types';

/**
 * Base RAG Pattern
 * All RAG patterns extend this base class
 */
@Injectable()
export abstract class BaseRAGPattern {
  protected readonly logger: Logger;

  constructor(patternName: string) {
    this.logger = new Logger(`RAG:Pattern:${patternName}`);
  }

  /**
   * Execute the pattern's retrieval and processing logic
   */
  abstract execute(input: OrchestratorInput): Promise<PatternResult>;

  /**
   * Check if this pattern is suitable for the given input
   */
  abstract isSuitable(input: OrchestratorInput): boolean;

  /**
   * Get pattern metadata
   */
  abstract getMetadata(): {
    name: string;
    description: string;
    complexity: 'simple' | 'medium' | 'complex';
    expectedLatency: number;
  };
}
