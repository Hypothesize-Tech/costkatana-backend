/**
 * Read Module
 * Context extraction and compression for optimal prompt construction
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  ReadConfig,
} from '../types/rag.types';
import { Document } from '@langchain/core/documents';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';

export class ReadModule extends BaseRAGModule {
  protected config: ReadConfig;
  private llm: ChatBedrockConverse;

  constructor(
    config: ReadConfig = {
      enabled: true,
      maxTokens: 4000,
      compressionRatio: 0.5,
      extractionStrategy: 'key-points',
    }
  ) {
    super('ReadModule', 'read', config);
    this.config = config;

    this.llm = new ChatBedrockConverse({
      model: config.summarizationModel || 'amazon.nova-lite-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.3,
      maxTokens: 1000,
    });
  }

  protected async executeInternal(
    input: RAGModuleInput
  ): Promise<RAGModuleOutput> {
    const { query, documents, config } = input;

    if (!documents || documents.length === 0) {
      return {
        ...this.createSuccessOutput(
          { extractedContext: '' },
          { empty: true }
        ),
        documents: [],
        query,
      };
    }

    const effectiveConfig = { ...this.config, ...config };

    try {
      // Extract and process context based on strategy
      const extractedContext = await this.extractContext(
        query,
        documents,
        effectiveConfig
      );

      // Compress if needed
      const finalContext = await this.compressContext(
        extractedContext,
        effectiveConfig
      );

      loggingService.info('Context extracted and processed', {
        component: 'ReadModule',
        documentCount: documents.length,
        originalLength: extractedContext.length,
        compressedLength: finalContext.length,
        strategy: effectiveConfig.extractionStrategy,
      });

      return {
        ...this.createSuccessOutput(
          { extractedContext: finalContext },
          {
            documentCount: documents.length,
            originalLength: extractedContext.length,
            finalLength: finalContext.length,
            strategy: effectiveConfig.extractionStrategy,
          }
        ),
        documents,
        query,
      };
    } catch (error) {
      loggingService.error('Context extraction failed', {
        component: 'ReadModule',
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple concatenation
      const fallbackContext = documents
        .map(doc => doc.pageContent)
        .join('\n\n')
        .substring(0, effectiveConfig.maxTokens || 4000);

      return {
        ...this.createSuccessOutput(
          { extractedContext: fallbackContext },
          { fallback: true }
        ),
        documents,
        query,
      };
    }
  }

  /**
   * Extract context using configured strategy
   */
  private async extractContext(
    query: string,
    documents: Document[],
    config: ReadConfig
  ): Promise<string> {
    const strategy = config.extractionStrategy || 'key-points';

    switch (strategy) {
      case 'full':
        return this.fullExtraction(documents);

      case 'summary':
        return await this.summaryExtraction(query, documents);

      case 'key-points':
      default:
        return await this.keyPointsExtraction(query, documents);
    }
  }

  /**
   * Full context extraction (no summarization)
   */
  private fullExtraction(documents: Document[]): string {
    return documents.map((doc, idx) => {
      const source = doc.metadata.fileName || doc.metadata.source || `Doc ${idx + 1}`;
      return `[${source}]\n${doc.pageContent}`;
    }).join('\n\n---\n\n');
  }

  /**
   * Summary-based extraction
   */
  private async summaryExtraction(
    query: string,
    documents: Document[]
  ): Promise<string> {
    const summaries: string[] = [];

    for (const doc of documents.slice(0, 5)) { // Limit to avoid too many calls
      try {
        const summary = await this.summarizeDocument(query, doc);
        summaries.push(summary);
      } catch (error) {
        // Fallback to truncated content
        summaries.push(doc.pageContent.substring(0, 300));
      }
    }

    return summaries.join('\n\n');
  }

  /**
   * Key points extraction
   */
  private async keyPointsExtraction(
    query: string,
    documents: Document[]
  ): Promise<string> {
    const keyPoints: string[] = [];

    for (const doc of documents.slice(0, 5)) {
      try {
        const points = await this.extractKeyPoints(query, doc);
        const source = doc.metadata.fileName || doc.metadata.source || 'Document';
        keyPoints.push(`[${source}]\n${points}`);
      } catch (error) {
        // Fallback to truncated content
        const source = doc.metadata.fileName || doc.metadata.source || 'Document';
        keyPoints.push(`[${source}]\n${doc.pageContent.substring(0, 300)}`);
      }
    }

    return keyPoints.join('\n\n');
  }

  /**
   * Summarize a document
   */
  private async summarizeDocument(
    query: string,
    document: Document
  ): Promise<string> {
    const prompt = `Summarize the following document excerpt in 2-3 sentences, focusing on information relevant to this query: "${query}"

Document:
${document.pageContent.substring(0, 2000)}

Summary:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string' 
      ? response.content.trim() 
      : document.pageContent.substring(0, 300);
  }

  /**
   * Extract key points from a document
   */
  private async extractKeyPoints(
    query: string,
    document: Document
  ): Promise<string> {
    const prompt = `Extract the 3 most important points from this document that are relevant to the query: "${query}"

Document:
${document.pageContent.substring(0, 2000)}

Key points (bullet points):`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string' 
      ? response.content.trim() 
      : document.pageContent.substring(0, 300);
  }

  /**
   * Compress context to fit within token limits
   */
  private async compressContext(
    context: string,
    config: ReadConfig
  ): Promise<string> {
    const maxTokens = config.maxTokens || 4000;
    const estimatedTokens = Math.ceil(context.length / 4); // Rough estimate: 1 token ≈ 4 chars

    if (estimatedTokens <= maxTokens) {
      return context;
    }

    // Simple compression: truncate and add ellipsis
    const compressionRatio = config.compressionRatio || 0.5;
    const targetLength = maxTokens * 4 * compressionRatio;
    
    if (context.length > targetLength) {
      loggingService.info('Compressing context', {
        component: 'ReadModule',
        originalLength: context.length,
        targetLength,
        compressionRatio,
      });

      return context.substring(0, targetLength) + '\n\n[Content truncated...]';
    }

    return context;
  }

  protected getDescription(): string {
    return 'Extracts and compresses context from documents for optimal prompting';
  }

  protected getCapabilities(): string[] {
    return [
      'full_extraction',
      'summary_extraction',
      'key_points_extraction',
      'context_compression',
    ];
  }

  protected getDependencies() {
    return ['retrieve' as const, 'rerank' as const];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      maxTokens: 4000,
      compressionRatio: 0.5,
      extractionStrategy: 'key-points',
    };
  }

  validateConfig(): boolean {
    if (this.config.maxTokens && this.config.maxTokens < 100) {
      return false;
    }

    if (
      this.config.compressionRatio &&
      (this.config.compressionRatio < 0 || this.config.compressionRatio > 1)
    ) {
      return false;
    }

    return true;
  }
}

