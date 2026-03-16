import { Injectable, Logger } from '@nestjs/common';
import {
  ModuleConfig,
  OrchestratorInput,
  PatternResult,
} from '../types/rag.types';

/**
 * Base RAG Module
 * All RAG modules extend this base class
 */
@Injectable()
export abstract class BaseRAGModule {
  protected readonly logger: Logger;

  constructor(moduleName: string) {
    this.logger = new Logger(`RAG:${moduleName}`);
  }

  /**
   * Execute the module's logic
   */
  abstract execute(
    input: OrchestratorInput,
    previousResults?: any[],
  ): Promise<PatternResult>;

  /**
   * Check if this module is applicable for the given input
   */
  abstract isApplicable(input: OrchestratorInput): boolean;

  /**
   * Get module configuration
   */
  abstract getConfig(): ModuleConfig;

  /**
   * Validate module configuration
   */
  protected validateConfig(): boolean {
    const config = this.getConfig();
    return config.enabled && config.priority > 0 && config.timeout > 0;
  }

  /**
   * Create timeout promise for module execution.
   * Public so subclasses can use it in Promise.race without visibility errors.
   */
  public createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Module execution timeout after ${timeout}ms`));
      }, timeout);
    });
  }
}
