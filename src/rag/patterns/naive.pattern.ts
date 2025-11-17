/**
 * Naive RAG Pattern
 * Simple retrieve-then-read pattern (baseline)
 */

import { BaseRAGPattern } from './base.pattern';
import {
  RAGConfig,
  RAGContext,
  RAGResult,
  PatternDescription,
} from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { ReadModule } from '../modules/read.module';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';

export class NaiveRAGPattern extends BaseRAGPattern {
  private retrieveModule: RetrieveModule;
  private readModule: ReadModule;
  private llm: ChatBedrockConverse;

  constructor(config: RAGConfig) {
    super('NaiveRAG', 'naive', config);
    
    this.retrieveModule = new RetrieveModule(config.modules.retrieve);
    this.readModule = new ReadModule(config.modules.read);
    
    this.llm = new ChatBedrockConverse({
      model: 'anthropic.claude-3-sonnet-20240229-v1:0',
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.7,
      maxTokens: 2000,
    });
  }

  protected async executePattern(
    query: string,
    context: RAGContext
  ): Promise<RAGResult> {
    const startTime = Date.now();
    const modulesUsed: any[] = ['retrieve', 'read'];

    try {
      // Step 1: Retrieve documents
      const retrieveStart = Date.now();
      const retrieveResult = await this.retrieveModule.execute({
        query,
        context,
        config: this.config.modules.retrieve,
      });
      const retrievalDuration = Date.now() - retrieveStart;

      if (!retrieveResult.success || !retrieveResult.documents) {
        throw new Error('Retrieval failed');
      }

      loggingService.info('Naive RAG: Documents retrieved', {
        component: 'NaiveRAGPattern',
        documentCount: retrieveResult.documents.length,
      });

      // Step 2: Read and extract context
      const readStart = Date.now();
      const readResult = await this.readModule.execute({
        query,
        documents: retrieveResult.documents,
        context,
        config: this.config.modules.read,
      });

      if (!readResult.success || !readResult.data) {
        throw new Error('Context extraction failed');
      }

      const extractedContext = typeof readResult.data === 'object' && readResult.data !== null && 'extractedContext' in readResult.data
        ? String(readResult.data.extractedContext)
        : '';

      // Step 3: Generate answer
      const generationStart = Date.now();
      const answer = await this.generateAnswer(query, extractedContext);
      const generationDuration = Date.now() - generationStart;

      // Extract sources
      const sources = this.extractSources(retrieveResult.documents);

      return {
        success: true,
        answer,
        documents: retrieveResult.documents,
        sources,
        metadata: {
          pattern: 'naive',
          modulesUsed,
          retrievalCount: 1,
          totalDocuments: retrieveResult.documents.length,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration,
            generationDuration,
            moduleDurations: {
              retrieve: retrievalDuration,
              read: Date.now() - readStart,
              generate: generationDuration,
            },
          },
          cacheHit: (retrieveResult.metadata?.cacheHit as boolean | undefined) ?? false,
        },
      };
    } catch (error) {
      loggingService.error('Naive RAG pattern failed', {
        component: 'NaiveRAGPattern',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        answer: 'I apologize, but I encountered an error while processing your request.',
        documents: [],
        sources: [],
        metadata: {
          pattern: 'naive',
          modulesUsed,
          retrievalCount: 0,
          totalDocuments: 0,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration: 0,
            generationDuration: 0,
            moduleDurations: {},
          },
          cacheHit: false,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate answer using LLM
   */
  private async generateAnswer(
    query: string,
    context: string
  ): Promise<string> {
    const prompt = `You are a helpful AI assistant. Answer the following question based on the provided context. If the context doesn't contain enough information to answer the question, say so.

Context:
${context}

Question: ${query}

Answer:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string' 
      ? response.content.trim() 
      : 'Unable to generate response';
  }

  /**
   * Extract unique sources from documents
   */
  private extractSources(documents: any[]): string[] {
    const sources = new Set<string>();
    
    for (const doc of documents) {
      const source = doc.metadata?.fileName || doc.metadata?.source;
      if (source) {
        sources.add(source);
      }
    }

    return Array.from(sources);
  }

  getDescription(): PatternDescription {
    return {
      name: 'Naive RAG',
      type: 'naive',
      description: 'Simple retrieve-then-read pattern with single-pass retrieval and generation',
      useCases: [
        'Simple factual queries',
        'Quick lookups',
        'Low-latency requirements',
        'Basic knowledge base search',
      ],
      complexity: 'low',
      avgLatency: 2000, // ~2 seconds
      avgCost: 0.001, // Low cost
    };
  }
}

