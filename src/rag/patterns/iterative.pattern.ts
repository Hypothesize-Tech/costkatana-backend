/**
 * Iterative RAG Pattern
 * Multi-round retrieval with progressive answer building (ITER-RETGEN inspired)
 */

import { BaseRAGPattern } from './base.pattern';
import {
  RAGConfig,
  RAGContext,
  RAGResult,
  PatternDescription,
  IterativeState,
} from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { RerankModule } from '../modules/rerank.module';
import { ReadModule } from '../modules/read.module';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';
import { Document } from '@langchain/core/documents';

export class IterativeRAGPattern extends BaseRAGPattern {
  private retrieveModule: RetrieveModule;
  private rerankModule: RerankModule;
  private readModule: ReadModule;
  private llm: ChatBedrockConverse;

  constructor(config: RAGConfig) {
    super('IterativeRAG', 'iterative', config);
    
    this.retrieveModule = new RetrieveModule(config.modules.retrieve);
    this.rerankModule = new RerankModule(config.modules.rerank);
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
    const maxIterations = this.config.iterations || 3;
    const modulesUsed: any[] = ['retrieve', 'rerank', 'read'];

    const state: IterativeState = {
      currentIteration: 0,
      maxIterations,
      partialAnswer: '',
      retrievedDocuments: [],
      refinementQuery: query,
      converged: false,
    };

    let allDocuments: Document[] = [];
    let totalRetrievalDuration = 0;
    let totalGenerationDuration = 0;

    try {
      // Iterative retrieval-generation loop
      while (state.currentIteration < maxIterations && !state.converged) {
        loggingService.info(`Iterative RAG: Iteration ${state.currentIteration + 1}`, {
          component: 'IterativeRAGPattern',
          iteration: state.currentIteration + 1,
          maxIterations,
          refinementQuery: state.refinementQuery.substring(0, 100),
        });

        // Retrieve documents for this iteration
        const retrieveStart = Date.now();
        const retrieveResult = await this.retrieveModule.execute({
          query: state.refinementQuery,
          context,
          config: this.config.modules.retrieve,
        });
        totalRetrievalDuration += Date.now() - retrieveStart;

        if (!retrieveResult.success || !retrieveResult.documents) {
          loggingService.warn('Iterative RAG: Retrieval failed, stopping iteration', {
            component: 'IterativeRAGPattern',
            iteration: state.currentIteration + 1,
          });
          break;
        }

        // Rerank and filter
        const rerankResult = await this.rerankModule.execute({
          query: state.refinementQuery,
          documents: retrieveResult.documents,
          config: this.config.modules.rerank,
        });

        const iterationDocs = rerankResult.success && rerankResult.documents
          ? rerankResult.documents
          : retrieveResult.documents;

        state.retrievedDocuments.push(iterationDocs);
        allDocuments.push(...iterationDocs);

        // Extract context
        const readResult = await this.readModule.execute({
          query: state.refinementQuery,
          documents: iterationDocs,
          context,
          config: this.config.modules.read,
        });

        const extractedContext = typeof readResult.data === 'object' && readResult.data !== null && 'extractedContext' in readResult.data
          ? String(readResult.data.extractedContext)
          : '';

        // Generate or refine answer
        const genStart = Date.now();
        if (state.currentIteration === 0) {
          // First iteration: generate initial answer
          state.partialAnswer = await this.generateInitialAnswer(
            query,
            extractedContext
          );
        } else {
          // Subsequent iterations: refine answer
          state.partialAnswer = await this.refineAnswer(
            query,
            state.partialAnswer,
            extractedContext
          );
        }
        totalGenerationDuration += Date.now() - genStart;

        loggingService.info(`Iterative RAG: Answer generated for iteration ${state.currentIteration + 1}`, {
          component: 'IterativeRAGPattern',
          answerLength: state.partialAnswer.length,
        });

        // Check convergence
        state.converged = await this.checkConvergence(
          query,
          state.partialAnswer,
        );

        if (state.converged) {
          loggingService.info('Iterative RAG: Converged early', {
            component: 'IterativeRAGPattern',
            iteration: state.currentIteration + 1,
          });
          break;
        }

        // Generate refinement query for next iteration
        if (state.currentIteration < maxIterations - 1) {
          state.refinementQuery = await this.generateRefinementQuery(
            query,
            state.partialAnswer
          );
        }

        state.currentIteration++;
      }

      // Final synthesis if multiple iterations
      let finalAnswer = state.partialAnswer;
      if (state.currentIteration > 1) {
        const synthStart = Date.now();
        finalAnswer = await this.synthesizeFinalAnswer(
          query,
          state.partialAnswer,
        );
        totalGenerationDuration += Date.now() - synthStart;
      }

      // Deduplicate documents
      const uniqueDocuments = this.deduplicateDocuments(allDocuments);
      const sources = this.extractSources(uniqueDocuments);

      loggingService.info('Iterative RAG: Completed', {
        component: 'IterativeRAGPattern',
        iterations: state.currentIteration,
        converged: state.converged,
        totalDocuments: uniqueDocuments.length,
      });

      return {
        success: true,
        answer: finalAnswer,
        documents: uniqueDocuments,
        sources,
        metadata: {
          pattern: 'iterative',
          modulesUsed,
          retrievalCount: state.currentIteration,
          totalDocuments: uniqueDocuments.length,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration: totalRetrievalDuration,
            generationDuration: totalGenerationDuration,
            moduleDurations: {
              iterations: state.currentIteration,
              avgIterationTime: (Date.now() - startTime) / state.currentIteration,
            },
          },
          cacheHit: false,
        },
      };
    } catch (error) {
      loggingService.error('Iterative RAG pattern failed', {
        component: 'IterativeRAGPattern',
        error: error instanceof Error ? error.message : String(error),
        iteration: state.currentIteration,
      });

      // Return partial answer if we have one
      if (state.partialAnswer) {
        const uniqueDocuments = this.deduplicateDocuments(allDocuments);
        return {
          success: true,
          answer: state.partialAnswer,
          documents: uniqueDocuments,
          sources: this.extractSources(uniqueDocuments),
          metadata: {
            pattern: 'iterative',
            modulesUsed,
            retrievalCount: state.currentIteration,
            totalDocuments: uniqueDocuments.length,
            performance: {
              totalDuration: Date.now() - startTime,
              retrievalDuration: totalRetrievalDuration,
              generationDuration: totalGenerationDuration,
              moduleDurations: {},
            },
            cacheHit: false,
          },
        };
      }

      return {
        success: false,
        answer: 'I apologize, but I encountered an error while processing your request.',
        documents: [],
        sources: [],
        metadata: {
          pattern: 'iterative',
          modulesUsed,
          retrievalCount: state.currentIteration,
          totalDocuments: 0,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration: totalRetrievalDuration,
            generationDuration: totalGenerationDuration,
            moduleDurations: {},
          },
          cacheHit: false,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate initial answer from first retrieval
   */
  private async generateInitialAnswer(
    query: string,
    context: string
  ): Promise<string> {
    const prompt = `Based on the following context, provide an initial answer to the question. Be comprehensive but acknowledge if more information might be needed.

Context:
${context}

Question: ${query}

Initial Answer:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string' 
      ? response.content.trim() 
      : 'Unable to generate initial answer';
  }

  /**
   * Refine existing answer with new context
   */
  private async refineAnswer(
    query: string,
    previousAnswer: string,
    newContext: string
  ): Promise<string> {
    const prompt = `You previously answered a question, but now have additional context. Refine and expand your answer incorporating the new information.

Original Question: ${query}

Previous Answer:
${previousAnswer}

Additional Context:
${newContext}

Refined Answer:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string' 
      ? response.content.trim() 
      : previousAnswer;
  }

  /**
   * Check if answer has converged (no significant improvement likely)
   */
  private async checkConvergence(
    answer: string,
    latestContext: string
  ): Promise<boolean> {
    // Simple heuristic: if answer is comprehensive and long enough, consider converged
    if (answer.length > 500) {
      // Check if latest context adds significant new information
      const contextWords = new Set(latestContext.toLowerCase().split(/\s+/));
      const answerWords = new Set(answer.toLowerCase().split(/\s+/));
      
      const newWords = [...contextWords].filter(word => !answerWords.has(word));
      const overlapRatio = newWords.length / contextWords.size;

      // If very little new information, consider converged
      return overlapRatio < 0.2;
    }

    return false;
  }

  /**
   * Generate refinement query for next iteration
   */
  private async generateRefinementQuery(
    originalQuery: string,
    currentAnswer: string
  ): Promise<string> {
    const prompt = `Given the original question and current answer, generate a focused follow-up question to retrieve additional specific information that would improve the answer.

Original Question: ${originalQuery}

Current Answer:
${currentAnswer.substring(0, 500)}...

Follow-up question for more information:`;

    try {
      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const refinement = typeof response.content === 'string' 
        ? response.content.trim() 
        : originalQuery;
      
      return refinement || originalQuery;
    } catch (error) {
      return originalQuery;
    }
  }

  /**
   * Synthesize final comprehensive answer
   */
  private async synthesizeFinalAnswer(
    query: string,
    iterativeAnswer: string,
  ): Promise<string> {
    const prompt = `Synthesize a final comprehensive answer by consolidating the iterative answer and ensuring all key points are covered.

Question: ${query}

Iterative Answer:
${iterativeAnswer}

Final Synthesized Answer (comprehensive and well-structured):`;

    try {
      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      return typeof response.content === 'string' 
        ? response.content.trim() 
        : iterativeAnswer;
    } catch (error) {
      return iterativeAnswer;
    }
  }

  /**
   * Deduplicate documents
   */
  private deduplicateDocuments(documents: Document[]): Document[] {
    const seen = new Set<string>();
    const deduplicated: Document[] = [];

    for (const doc of documents) {
      const key = doc.metadata._id as string || doc.pageContent.substring(0, 100);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(doc);
      }
    }

    return deduplicated;
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
      name: 'Iterative RAG',
      type: 'iterative',
      description: 'Multi-round retrieval with progressive answer building and refinement',
      useCases: [
        'Comprehensive research queries',
        'Complex multi-aspect questions',
        'Deep exploration topics',
        'Thorough analysis requirements',
      ],
      complexity: 'high',
      avgLatency: 6000, // ~6 seconds for multiple iterations
      avgCost: 0.003,
    };
  }
}

