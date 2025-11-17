/**
 * Base RAG Module
 * Abstract base class for all RAG modules
 */

import {
  IRAGModule,
  RAGModuleType,
  RAGModuleInput,
  RAGModuleOutput,
  ModuleConfig,
  ModuleMetadata,
  RAGModuleError,
} from '../types/rag.types';
import { loggingService } from '../../services/logging.service';

export abstract class BaseRAGModule implements IRAGModule {
  public readonly name: string;
  public readonly type: RAGModuleType;
  protected config: ModuleConfig;
  protected version: string = '1.0.0';

  constructor(
    name: string,
    type: RAGModuleType,
    config: ModuleConfig = { enabled: true }
  ) {
    this.name = name;
    this.type = type;
    this.config = config;
  }

  /**
   * Execute the module with error handling and logging
   */
  async execute(input: RAGModuleInput): Promise<RAGModuleOutput> {
    const startTime = Date.now();

    try {
      // Check if module is enabled
      if (this.config.enabled === false) {
        return this.createSkippedOutput(input, startTime);
      }

      // Validate input
      this.validateInput(input);

      // Validate configuration
      if (!this.validateConfig()) {
        throw new RAGModuleError(
          this.name,
          this.type,
          'Invalid module configuration'
        );
      }

      loggingService.info(`RAG Module [${this.name}] executing`, {
        component: 'RAGModule',
        module: this.name,
        type: this.type,
        query: input.query?.substring(0, 100),
        hasDocuments: !!input.documents,
        documentCount: input.documents?.length || 0,
      });

      // Execute the module-specific logic
      const result = await this.executeInternal(input);

      const endTime = Date.now();
      const duration = endTime - startTime;

      loggingService.info(`RAG Module [${this.name}] completed`, {
        component: 'RAGModule',
        module: this.name,
        type: this.type,
        duration,
        success: result.success,
      });

      return {
        ...result,
        performance: {
          startTime,
          endTime,
          duration,
        },
      };
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      loggingService.error(`RAG Module [${this.name}] failed`, {
        component: 'RAGModule',
        module: this.name,
        type: this.type,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        performance: {
          startTime,
          endTime,
          duration,
        },
      };
    }
  }

  /**
   * Abstract method that each module must implement
   */
  protected abstract executeInternal(
    input: RAGModuleInput
  ): Promise<RAGModuleOutput>;

  /**
   * Validate module configuration
   * Can be overridden by subclasses for specific validation
   */
  validateConfig(): boolean {
    return true;
  }

  /**
   * Validate input
   * Can be overridden by subclasses for specific validation
   */
  protected validateInput(input: RAGModuleInput): void {
    if (!input) {
      throw new RAGModuleError(
        this.name,
        this.type,
        'Input is required'
      );
    }

    if (!input.query && !input.documents) {
      throw new RAGModuleError(
        this.name,
        this.type,
        'Either query or documents must be provided'
      );
    }
  }

  /**
   * Get module metadata
   */
  getMetadata(): ModuleMetadata {
    return {
      name: this.name,
      type: this.type,
      version: this.version,
      description: this.getDescription(),
      capabilities: this.getCapabilities(),
      dependencies: this.getDependencies(),
    };
  }

  /**
   * Get module description
   * Should be overridden by subclasses
   */
  protected getDescription(): string {
    return `${this.name} module`;
  }

  /**
   * Get module capabilities
   * Should be overridden by subclasses
   */
  protected getCapabilities(): string[] {
    return [];
  }

  /**
   * Get module dependencies
   * Should be overridden by subclasses
   */
  protected getDependencies(): RAGModuleType[] | undefined {
    return undefined;
  }

  /**
   * Create a skipped output when module is disabled
   */
  private createSkippedOutput(
    input: RAGModuleInput,
    startTime: number
  ): RAGModuleOutput {
    const endTime = Date.now();

    loggingService.info(`RAG Module [${this.name}] skipped (disabled)`, {
      component: 'RAGModule',
      module: this.name,
      type: this.type,
    });

    return {
      success: true,
      query: input.query,
      documents: input.documents || [],
      metadata: { skipped: true },
      performance: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
    };
  }

  /**
   * Helper method to create successful output
   */
  protected createSuccessOutput(
    data: any,
    metadata?: Record<string, any>
  ): Omit<RAGModuleOutput, 'performance'> {
    return {
      success: true,
      data,
      metadata,
    };
  }

  /**
   * Helper method to create error output
   */
  protected createErrorOutput(
    error: string | Error,
    metadata?: Record<string, any>
  ): Omit<RAGModuleOutput, 'performance'> {
    return {
      success: false,
      error: error instanceof Error ? error.message : error,
      metadata,
    };
  }

  /**
   * Update module configuration
   */
  updateConfig(newConfig: Partial<ModuleConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    loggingService.info(`RAG Module [${this.name}] configuration updated`, {
      component: 'RAGModule',
      module: this.name,
      type: this.type,
      config: this.config,
    });
  }

  /**
   * Reset module to default configuration
   */
  abstract resetConfig(): void;

  /**
   * Get current configuration
   */
  getConfig(): ModuleConfig {
    return { ...this.config };
  }
}

