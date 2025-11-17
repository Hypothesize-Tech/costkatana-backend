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
import { loggingService } from '../../services/logging.service';

export class RewriteModule extends BaseRAGModule {
  protected config: RewriteConfig;
  private llm: ChatBedrockConverse;

  constructor(
    config: RewriteConfig = {
      enabled: true,
      methods: ['expansion', 'reformulation'],
      expansionTerms: 3,
    }
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
    input: RAGModuleInput
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

      loggingService.info('Query rewriting completed', {
        component: 'RewriteModule',
        originalQuery: query.substring(0, 100),
        methods,
        rewrittenCount: uniqueQueries.length,
      });

      return {
        ...this.createSuccessOutput(
          { queries: uniqueQueries },
          {
            methods,
            originalQuery: query,
            rewrittenQueries: uniqueQueries,
          }
        ),
        query: uniqueQueries[0], // Return best rewritten query
      };
    } catch (error) {
      loggingService.error('Query rewriting failed', {
        component: 'RewriteModule',
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Return original query on failure
      return {
        ...this.createSuccessOutput(
          { queries: [query] },
          { fallback: true }
        ),
        query,
      };
    }
  }

  /**
   * Expand query with related terms
   */
  private async expandQuery(
    query: string,
    config: RewriteConfig
  ): Promise<string[]> {
    const expansionTerms = config.expansionTerms ?? 3;

    try {
      const prompt = `Given this search query, generate ${expansionTerms} alternative phrasings or related search terms that capture the same intent. Each variation should be on a new line.

Query: "${query}"

Alternative queries:`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      
      // Parse alternatives
      const alternatives = content
        .split('\n')
        .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(line => line.length > 0 && line !== query)
        .slice(0, expansionTerms);

      return alternatives;
    } catch (error) {
      loggingService.warn('Query expansion failed', {
        component: 'RewriteModule',
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
    context?: RAGContext
  ): Promise<string> {
    try {
      let prompt = `Reformulate this search query to be more specific and effective for document retrieval. Preserve the core intent but make it clearer.

Original query: "${query}"`;

      if (context?.recentMessages && Array.isArray(context.recentMessages) && context.recentMessages.length > 0) {
        const recentContext = context.recentMessages
          .slice(-2)
          .map((m) => (typeof m === 'object' && m !== null && 'content' in m ? String(m.content) : ''))
          .filter(c => c.length > 0)
          .join(' ');
        if (recentContext) {
          prompt += `\n\nConversation context: ${recentContext}`;
        }
      }

      prompt += '\n\nReformulated query:';

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const reformulated = typeof response.content === 'string' 
        ? response.content.trim() 
        : query;

      return reformulated || query;
    } catch (error) {
      loggingService.warn('Query reformulation failed', {
        component: 'RewriteModule',
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

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const hypothesis = typeof response.content === 'string' 
        ? response.content.trim() 
        : query;

      loggingService.info('HyDE hypothesis generated', {
        component: 'RewriteModule',
        originalQuery: query.substring(0, 50),
        hypothesisLength: hypothesis.length,
      });

      return hypothesis || query;
    } catch (error) {
      loggingService.warn('HyDE generation failed', {
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
    try {
      const prompt = `Decompose this complex query into 2-3 simpler, focused sub-queries that together would answer the original question. Each sub-query should be on a new line.

Complex query: "${query}"

Sub-queries:`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      
      const subQueries = content
        .split('\n')
        .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(line => line.length > 0 && line !== query)
        .slice(0, 3);

      return subQueries.length > 0 ? subQueries : [query];
    } catch (error) {
      loggingService.warn('Query decomposition failed', {
        component: 'RewriteModule',
        error: error instanceof Error ? error.message : String(error),
      });
      return [query];
    }
  }

  protected getDescription(): string {
    return 'Rewrites queries using expansion, reformulation, HyDE, and decomposition';
  }

  protected getCapabilities(): string[] {
    return [
      'query_expansion',
      'query_reformulation',
      'hyde_generation',
      'query_decomposition',
    ];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      methods: ['expansion', 'reformulation'],
      expansionTerms: 3,
    };
  }

  validateConfig(): boolean {
    if (this.config.expansionTerms && this.config.expansionTerms < 1) {
      return false;
    }
    return true;
  }
}

