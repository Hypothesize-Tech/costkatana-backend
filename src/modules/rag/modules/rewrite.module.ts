import { Injectable } from '@nestjs/common';
import { BaseRAGModule } from './base.module';
import {
  OrchestratorInput,
  PatternResult,
  ModuleConfig,
} from '../types/rag.types';
import { BedrockService } from '../../bedrock/bedrock.service';

export interface RewriteModuleConfig extends ModuleConfig {
  methods?: ('expansion' | 'reformulation' | 'hyde' | 'decomposition')[];
  expansionTerms?: number;
}

/**
 * Rewrite Module
 * Query reformulation, expansion, and HyDE-style transformations
 */
@Injectable()
export class RewriteModule extends BaseRAGModule {
  private readonly config: RewriteModuleConfig;

  constructor(private readonly bedrockService: BedrockService) {
    super('RewriteModule');
    this.config = {
      enabled: true,
      priority: 1,
      timeout: 10000,
      methods: ['expansion', 'reformulation'],
      expansionTerms: 3,
    };
  }

  async execute(
    input: OrchestratorInput,
    previousResults?: PatternResult[],
  ): Promise<PatternResult> {
    const { query, context } = input;
    const methods = this.config.methods ?? ['reformulation'];

    const rewrittenQueries: string[] = [query]; // Original query always included

    try {
      // Apply each rewriting method
      for (const method of methods) {
        let methodResults: string[] = [];

        switch (method) {
          case 'expansion': {
            const expanded = await this.expandQuery(query);
            methodResults = expanded;
            break;
          }

          case 'reformulation': {
            const reformulated = await this.reformulateQuery(query, context);
            methodResults = [reformulated];
            break;
          }

          case 'hyde': {
            const hyde = await this.hydeGeneration(query);
            methodResults = [hyde];
            break;
          }

          case 'decomposition': {
            const decomposed = await this.decomposeQuery(query);
            methodResults = decomposed;
            break;
          }
        }

        rewrittenQueries.push(...methodResults);
      }

      // Remove duplicates
      const uniqueQueries = [...new Set(rewrittenQueries)];

      this.logger.log(
        `Query rewriting completed: ${uniqueQueries.length} queries`,
        {
          originalQuery: query.substring(0, 100),
          methods,
        },
      );

      return {
        documents: [], // Rewrite module doesn't return documents
        reasoning: `Rewritten query variations generated using methods: ${methods.join(', ')}`,
        confidence: 0.8,
        metadata: {
          methods,
          originalQuery: query,
          rewrittenQueries: uniqueQueries,
          rewrittenCount: uniqueQueries.length,
        },
      };
    } catch (error) {
      this.logger.error('Query rewriting failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return original query on failure
      return {
        documents: [],
        reasoning: 'Query rewriting failed, using original query',
        confidence: 0.5,
        metadata: {
          fallback: true,
          originalQuery: query,
        },
      };
    }
  }

  isApplicable(input: OrchestratorInput): boolean {
    return this.config.enabled && input.query.length > 0;
  }

  getConfig(): ModuleConfig {
    return this.config;
  }

  /**
   * Expand query with related terms
   */
  private async expandQuery(query: string): Promise<string[]> {
    const expansionTerms = this.config.expansionTerms ?? 3;

    try {
      const prompt = `Given this search query, generate ${expansionTerms} alternative phrasings or related search terms that capture the same intent. Each variation should be on a new line.

Query: "${query}"

Alternative queries:`;

      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const content = typeof response === 'string' ? response : '';

      // Parse alternatives
      const alternatives = content
        .split('\n')
        .map((line: string) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((line: string) => line.length > 0 && line !== query)
        .slice(0, expansionTerms);

      return alternatives;
    } catch (error) {
      this.logger.warn('Query expansion failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Reformulate query for better retrieval
   */
  private async reformulateQuery(
    query: string,
    context?: any,
  ): Promise<string> {
    try {
      let prompt = `Reformulate this search query to be more specific and effective for document retrieval. Preserve the core intent but make it clearer.

Original query: "${query}"`;

      if (
        context?.recentMessages &&
        Array.isArray(context.recentMessages) &&
        context.recentMessages.length > 0
      ) {
        const recentContext = context.recentMessages
          .slice(-2)
          .map((m: { content?: string } | string) =>
            typeof m === 'object' && m !== null && 'content' in m
              ? String(m.content)
              : '',
          )
          .filter((c: string) => c.length > 0)
          .join(' ');
        if (recentContext) {
          prompt += `\n\nConversation context: ${recentContext}`;
        }
      }

      prompt += '\n\nReformulated query:';

      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const reformulated =
        typeof response === 'string' ? response.trim() : query;

      return reformulated || query;
    } catch (error) {
      this.logger.warn('Query reformulation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return query;
    }
  }

  /**
   * HyDE: Generate hypothetical document for better retrieval
   */
  private async hydeGeneration(query: string): Promise<string> {
    try {
      const prompt = `You are an expert assistant. Given the following question, write a short paragraph (2-3 sentences) that would appear in a document that answers this question. Focus on factual content that would be in a knowledge base article.

Question: "${query}"

Hypothetical answer:`;

      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const hypothesis =
        typeof response === 'string' ? response.trim() : query;

      this.logger.log('HyDE hypothesis generated', {
        originalQuery: query.substring(0, 50),
        hypothesisLength: hypothesis.length,
      });

      return hypothesis || query;
    } catch (error) {
      this.logger.warn('HyDE generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return query;
    }
  }

  /**
   * Decompose complex query into simpler sub-queries
   */
  private async decomposeQuery(query: string): Promise<string[]> {
    try {
      const prompt = `Decompose this complex query into 2-3 simpler, focused sub-queries that together would answer the original question. Each sub-query should be on a new line.

Complex query: "${query}"

Sub-queries:`;

      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const content = typeof response === 'string' ? response : '';

      const subQueries = content
        .split('\n')
        .map((line: string) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((line: string) => line.length > 0 && line !== query)
        .slice(0, 3);

      return subQueries.length > 0 ? subQueries : [query];
    } catch (error) {
      this.logger.warn('Query decomposition failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [query];
    }
  }
}
