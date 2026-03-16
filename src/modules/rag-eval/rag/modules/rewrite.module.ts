/**
 * Rewrite Module
 * Query reformulation, expansion, and HyDE-style transformations
 */

import { BaseRAGModule } from './base.module';
import {
  RAGContext,
  RAGModuleInput,
  RAGModuleOutput,
  RewriteConfig,
} from '../types/rag.types';
import { ChatBedrockConverse } from '@langchain/aws';

export class RewriteModule extends BaseRAGModule {
  protected config: RewriteConfig;
  private llm: ChatBedrockConverse;

  constructor(
    config: RewriteConfig = {
      enabled: true,
      methods: ['expansion', 'reformulation'],
      expansionTerms: 3,
    },
  ) {
    super('RewriteModule', 'rewrite', config);
    this.config = config;

    this.llm = new ChatBedrockConverse({
      model: 'amazon.nova-micro-v1:0', // Use cheap model for query rewriting
      region: process.env.AWS_REGION ?? 'us-east-1',
      temperature: 0.3,
      maxTokens: 500,
    });
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, context, config } = input;
    const effectiveConfig = { ...this.config, ...config };
    const methods = effectiveConfig.methods ?? ['reformulation'];

    const rewrittenQueries: string[] = [query]; // Original query always included

    try {
      // Apply each rewriting method
      for (const method of methods) {
        let methodResults: string[] = [];

        switch (method) {
          case 'expansion': {
            const expanded = await this.expandQuery(query, effectiveConfig);
            methodResults = expanded;
            break;
          }

          case 'reformulation': {
            const reformulated = await this.reformulateQuery(query, context);
            methodResults = [reformulated];
            break;
          }

          case 'hyde': {
            const hydeQuery = await this.generateHydeQuery(query);
            methodResults = [hydeQuery];
            break;
          }

          case 'decomposition': {
            const decomposed = await this.decomposeQuery(query);
            methodResults = decomposed;
            break;
          }

          default:
            this.logger.warn(`Unknown rewrite method: ${method}`, {
              component: 'RewriteModule',
            });
        }

        rewrittenQueries.push(...methodResults);
      }

      return {
        ...this.createSuccessOutput(
          { rewrittenQueries },
          {
            methodsApplied: methods,
            originalQuery: query,
            totalQueries: rewrittenQueries.length,
          },
        ),
        query: rewrittenQueries[0], // Use first rewritten query as main query
      };
    } catch (error) {
      return this.createErrorOutput(
        error instanceof Error ? error.message : String(error),
        { rewriteFailed: true },
      );
    }
  }

  /**
   * Expand query with related terms
   */
  private async expandQuery(
    query: string,
    config: RewriteConfig,
  ): Promise<string[]> {
    const expansionTerms = config.expansionTerms ?? 3;

    const prompt = `Expand this query by adding ${expansionTerms} related terms or synonyms. Return only the expanded query.

Original query: "${query}"

Expanded query:`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : query;

      return [content];
    } catch (error) {
      this.logger.warn('Query expansion failed', {
        component: 'RewriteModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return [query];
    }
  }

  /**
   * Reformulate query for better retrieval
   */
  private async reformulateQuery(
    query: string,
    context?: RAGContext,
  ): Promise<string> {
    let prompt = `Reformulate this query to be more effective for information retrieval. Make it clearer and more specific.

Original query: "${query}"

Reformulated query:`;

    // Add context if available
    if (context?.previousQueries && context.previousQueries.length > 0) {
      prompt += `\n\nPrevious queries in this conversation:\n${context.previousQueries.slice(-3).join('\n')}`;
    }

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : query;

      return content;
    } catch (error) {
      this.logger.warn('Query reformulation failed', {
        component: 'RewriteModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return query;
    }
  }

  /**
   * Generate Hypothetical Document Embedding (HyDE) query
   */
  private async generateHydeQuery(query: string): Promise<string> {
    const prompt = `Generate a hypothetical answer to this question. The answer should be detailed enough to match relevant documents when used for retrieval.

Question: "${query}"

Hypothetical answer:`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content.trim() : query;

      return content;
    } catch (error) {
      this.logger.warn('HyDE query generation failed', {
        component: 'RewriteModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return query;
    }
  }

  /**
   * Decompose complex query into simpler sub-queries
   */
  private async decomposeQuery(query: string): Promise<string[]> {
    const prompt = `Break down this complex query into 2-3 simpler, focused sub-queries that together would help answer the original question.

Complex query: "${query}"

Sub-queries:
1.`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string' ? response.content : '';

      // Parse sub-queries (simple parsing)
      const lines = content
        .split('\n')
        .filter((line) => line.trim().length > 0);
      const subQueries: string[] = [];

      for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+)$/);
        if (match) {
          subQueries.push(match[1].trim());
        }
      }

      return subQueries.length > 0 ? subQueries : [query];
    } catch (error) {
      this.logger.warn('Query decomposition failed', {
        component: 'RewriteModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return [query];
    }
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      methods: ['expansion', 'reformulation'],
      expansionTerms: 3,
    };
  }

  protected getDescription(): string {
    return 'Query rewriting and transformation module';
  }

  protected getCapabilities(): string[] {
    return [
      'Query expansion',
      'Query reformulation',
      'HyDE generation',
      'Query decomposition',
      'Semantic rewriting',
    ];
  }
}
