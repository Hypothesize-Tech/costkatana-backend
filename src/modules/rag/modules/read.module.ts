import { Injectable } from '@nestjs/common';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
  RAGDocument,
} from '../types/rag.types';

export interface ReadModuleConfig extends ModuleConfig {
  extractEntities?: boolean;
  summarizeContent?: boolean;
  maxContentLength?: number;
}

/**
 * Read Module
 * Document reading and content extraction
 */
@Injectable()
export class ReadModule extends BaseRAGModule {
  private readonly config: ReadModuleConfig;

  constructor() {
    super('ReadModule');
    this.config = {
      enabled: true,
      priority: 7,
      timeout: 2000,
      extractEntities: false,
      summarizeContent: false,
      maxContentLength: 2000,
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    // Prefer documents from input if present, otherwise from previous results
    const documents: RAGDocument[] =
      Array.isArray(input.documents) && input.documents.length > 0
        ? input.documents
        : previousResults?.flatMap((result) => result.documents) || [];

    if (documents.length === 0) {
      return {
        documents: [],
        reasoning: 'No documents to read',
        confidence: 0.0,
        metadata: { noDocuments: true },
      };
    }

    try {
      const processedDocs = await this.processDocuments(documents);

      this.logger.log(`Processed ${documents.length} documents for reading`, {
        extractEntities: this.config.extractEntities,
        summarizeContent: this.config.summarizeContent,
      });

      return {
        documents: processedDocs,
        reasoning: `Processed ${processedDocs.length} documents with content extraction`,
        confidence: 0.9,
        metadata: {
          processedCount: processedDocs.length,
          entitiesExtracted: this.config.extractEntities,
          contentSummarized: this.config.summarizeContent,
        },
      };
    } catch (error) {
      this.logger.error('Document reading failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        documents, // Return (input or previous) documents on failure
        reasoning: 'Document reading failed, returning original documents',
        confidence: 0.5,
        metadata: { fallback: true },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return (
      !!input &&
      this.config.enabled &&
      typeof input.query === 'string' &&
      input.query.trim().length > 0
    );
  }

  getConfig(): ModuleConfig {
    return this.config;
  }

  /**
   * Process documents for reading and extraction
   */
  private async processDocuments(
    documents: RAGDocument[],
  ): Promise<RAGDocument[]> {
    return documents.map((doc) => this.processDocument(doc));
  }

  /**
   * Process a single document
   */
  private processDocument(document: RAGDocument): RAGDocument {
    let processedContent = document.content;

    // Truncate if too long
    if (
      this.config.maxContentLength &&
      processedContent.length > this.config.maxContentLength
    ) {
      processedContent =
        processedContent.substring(0, this.config.maxContentLength) + '...';
    }

    // Extract entities if enabled
    const entities = this.config.extractEntities
      ? this.extractEntities(processedContent)
      : [];

    // Create summary if enabled
    const summary = this.config.summarizeContent
      ? this.createSummary(processedContent)
      : null;

    return {
      ...document,
      content: processedContent,
      metadata: {
        ...document.metadata,
        processedAt: new Date().toISOString(),
        originalLength: document.content.length,
        processedLength: processedContent.length,
        entities: entities.length > 0 ? entities : undefined,
        summary,
      },
    };
  }

  /**
   * Extract entities from content
   */
  private extractEntities(content: string): string[] {
    const entities: string[] = [];

    // Simple entity extraction patterns
    const patterns = [
      // Email addresses
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      // URLs
      /\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/g,
      // Numbers (potentially costs, percentages)
      /\$\d+(?:\.\d{2})?|\d+(?:\.\d{2})?%/g,
      // API keys (simplified pattern)
      /\b[a-zA-Z0-9]{20,}\b/g,
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        entities.push(...matches);
      }
    }

    // Remove duplicates and limit
    return [...new Set(entities)].slice(0, 10);
  }

  /**
   * Create a simple summary of content
   */
  private createSummary(content: string): string {
    // Very basic summarization - first sentence or first 100 characters
    const sentences = content
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0);

    if (sentences.length > 0) {
      const firstSentence = sentences[0].trim();
      if (firstSentence.length <= 150) {
        return firstSentence;
      }
    }

    // Fallback to first 100 characters
    return content.substring(0, 100) + (content.length > 100 ? '...' : '');
  }
}
