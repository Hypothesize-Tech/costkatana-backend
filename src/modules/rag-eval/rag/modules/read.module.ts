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

export class ReadModule extends BaseRAGModule {
  protected config: ReadConfig;
  private llm: ChatBedrockConverse;

  constructor(
    config: ReadConfig = {
      enabled: true,
      maxTokens: 4000,
      compressionRatio: 0.5,
      extractionStrategy: 'key-points',
    },
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
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, documents, config } = input;

    if (!documents || documents.length === 0) {
      return {
        ...this.createSuccessOutput({ extractedContext: '' }, { empty: true }),
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
        effectiveConfig,
      );

      return {
        ...this.createSuccessOutput(
          { extractedContext },
          {
            strategy: effectiveConfig.extractionStrategy,
            documentCount: documents.length,
            contextLength: extractedContext.length,
          },
        ),
        query,
      };
    } catch (error) {
      return this.createErrorOutput(
        error instanceof Error ? error.message : String(error),
        { extractionFailed: true },
      );
    }
  }

  /**
   * Extract context based on the configured strategy
   */
  private async extractContext(
    query: string,
    documents: Document[],
    config: ReadConfig,
  ): Promise<string> {
    const strategy = config.extractionStrategy ?? 'key-points';
    const maxTokens = config.maxTokens ?? 4000;

    switch (strategy) {
      case 'full':
        return this.extractFullContext(documents, maxTokens);

      case 'summary':
        return this.extractSummary(query, documents, maxTokens);

      case 'key-points':
        return this.extractKeyPoints(query, documents, maxTokens);

      case 'hybrid':
        return this.extractHybrid(query, documents, maxTokens);

      default:
        this.logger.warn(
          `Unknown extraction strategy: ${strategy}, using key-points`,
          {
            component: 'ReadModule',
          },
        );
        return this.extractKeyPoints(query, documents, maxTokens);
    }
  }

  /**
   * Extract full context (with length limiting)
   */
  private extractFullContext(documents: Document[], maxTokens: number): string {
    let context = '';
    const tokenEstimate = maxTokens * 4; // Rough character estimate

    for (const doc of documents) {
      if (context.length >= tokenEstimate) break;

      const content = doc.pageContent;
      if (context.length + content.length > tokenEstimate) {
        // Truncate content to fit
        const remaining = tokenEstimate - context.length;
        context += content.substring(0, remaining);
        break;
      } else {
        context += content + '\n\n';
      }
    }

    return context.trim();
  }

  /**
   * Extract summarized context
   */
  private async extractSummary(
    query: string,
    documents: Document[],
    maxTokens: number,
  ): Promise<string> {
    const combinedContent = documents
      .map((doc) => doc.pageContent)
      .join('\n\n')
      .substring(0, 2000); // Limit input to avoid token limits

    const prompt = `Summarize the following documents in relation to this query. Keep the summary concise but informative.

Query: "${query}"

Documents:
${combinedContent}

Summary:`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : '';

      // Ensure length limit
      return content.length > maxTokens * 4
        ? content.substring(0, maxTokens * 4)
        : content;
    } catch (error) {
      this.logger.warn('Summary extraction failed, using full context', {
        component: 'ReadModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.extractFullContext(documents, maxTokens);
    }
  }

  /**
   * Extract key points
   */
  private async extractKeyPoints(
    query: string,
    documents: Document[],
    maxTokens: number,
  ): Promise<string> {
    const combinedContent = documents
      .map((doc) => doc.pageContent)
      .join('\n\n')
      .substring(0, 2000);

    const prompt = `Extract the key points from these documents that are most relevant to answering this query. Format as bullet points.

Query: "${query}"

Documents:
${combinedContent}

Key points:
•`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : '';

      // Ensure length limit
      return content.length > maxTokens * 4
        ? content.substring(0, maxTokens * 4)
        : content;
    } catch (error) {
      this.logger.warn('Key points extraction failed, using summary', {
        component: 'ReadModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.extractSummary(query, documents, maxTokens);
    }
  }

  /**
   * Hybrid extraction: key points + relevant quotes
   */
  private async extractHybrid(
    query: string,
    documents: Document[],
    maxTokens: number,
  ): Promise<string> {
    const keyPoints = await this.extractKeyPoints(
      query,
      documents,
      maxTokens / 2,
    );
    const relevantQuotes = this.extractRelevantQuotes(
      query,
      documents,
      maxTokens / 2,
    );

    return `Key Points:\n${keyPoints}\n\nRelevant Quotes:\n${relevantQuotes}`;
  }

  /**
   * Extract relevant quotes from documents
   */
  private extractRelevantQuotes(
    query: string,
    documents: Document[],
    maxLength: number,
  ): string {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2);
    let quotes = '';

    for (const doc of documents) {
      if (quotes.length >= maxLength) break;

      const content = doc.pageContent;
      const sentences = content
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 10);

      for (const sentence of sentences) {
        if (quotes.length >= maxLength) break;

        const lowerSentence = sentence.toLowerCase();
        const hasRelevantTerms = queryTerms.some((term) =>
          lowerSentence.includes(term),
        );

        if (hasRelevantTerms) {
          const quote = `"${sentence.trim()}."`;
          if (quotes.length + quote.length + 2 <= maxLength) {
            quotes += quote + '\n';
          }
        }
      }
    }

    return quotes.trim() || 'No relevant quotes found.';
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      maxTokens: 4000,
      compressionRatio: 0.5,
      extractionStrategy: 'key-points',
    };
  }

  protected getDescription(): string {
    return 'Context extraction and compression module';
  }

  protected getCapabilities(): string[] {
    return [
      'Context extraction',
      'Document summarization',
      'Key points extraction',
      'Content compression',
      'Relevance filtering',
      'Multi-strategy processing',
    ];
  }
}
