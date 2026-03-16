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
    context: RAGContext,
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

    const allDocuments: Document[] = [];
    let totalRetrievalDuration = 0;
    let totalGenerationDuration = 0;

    try {
      // Iterative retrieval-generation loop
      while (state.currentIteration < maxIterations && !state.converged) {
        this.logger.log(
          `Iterative RAG: Iteration ${state.currentIteration + 1}`,
          {
            component: 'IterativeRAGPattern',
            iteration: state.currentIteration + 1,
            maxIterations,
            refinementQuery: state.refinementQuery.substring(0, 100),
          },
        );

        // Retrieve documents for this iteration
        const retrieveStart = Date.now();
        const retrieveResult = await this.retrieveModule.execute({
          query: state.refinementQuery,
          context,
          config: this.config.modules.retrieve,
        });
        totalRetrievalDuration += Date.now() - retrieveStart;

        if (!retrieveResult.success || !retrieveResult.documents) {
          this.logger.warn(
            'Iterative RAG: Retrieval failed, stopping iteration',
            {
              component: 'IterativeRAGPattern',
              iteration: state.currentIteration + 1,
            },
          );
          break;
        }

        // Rerank and filter
        const rerankResult = await this.rerankModule.execute({
          query: state.refinementQuery,
          documents: retrieveResult.documents,
          config: this.config.modules.rerank,
        });

        const iterationDocs =
          rerankResult.success && rerankResult.documents
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

        const extractedContext =
          typeof readResult.data === 'object' &&
          readResult.data !== null &&
          'extractedContext' in readResult.data
            ? String(readResult.data.extractedContext)
            : '';

        // Generate or refine answer
        const genStart = Date.now();
        if (state.currentIteration === 0) {
          // First iteration: generate initial answer
          state.partialAnswer = await this.generateInitialAnswer(
            query,
            extractedContext,
          );
        } else {
          // Subsequent iterations: refine answer
          state.partialAnswer = await this.refineAnswer(
            query,
            state.partialAnswer,
            extractedContext,
          );
        }
        totalGenerationDuration += Date.now() - genStart;

        this.logger.log(
          `Iterative RAG: Answer generated for iteration ${state.currentIteration + 1}`,
          {
            component: 'IterativeRAGPattern',
            answerLength: state.partialAnswer.length,
          },
        );

        // Check convergence
        state.converged = await this.checkConvergence(
          query,
          state.partialAnswer,
        );

        if (state.converged) {
          this.logger.log('Iterative RAG: Converged early', {
            component: 'IterativeRAGPattern',
            iteration: state.currentIteration + 1,
          });
          break;
        }

        // Generate refinement query for next iteration
        if (state.currentIteration < maxIterations - 1) {
          state.refinementQuery = await this.generateRefinementQuery(
            query,
            state.partialAnswer,
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

      this.logger.log('Iterative RAG: Completed', {
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
              avgIterationTime:
                (Date.now() - startTime) / state.currentIteration,
            },
          },
          cacheHit: false,
        },
      };
    } catch (error) {
      this.logger.error('Iterative RAG pattern failed', {
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
        answer:
          'I apologize, but I encountered an error while processing your request.',
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
    context: string,
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
    newContext: string,
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
    _query: string,
  ): Promise<boolean> {
    // Simple heuristic: if answer is long enough and contains specific details, consider converged
    const hasEnoughDetail = answer.length > 300;
    const hasSpecificContent = /\d+|[A-Z][a-z]+/.test(answer); // Numbers or capitalized words as proxy for specificity

    return hasEnoughDetail && hasSpecificContent;
  }

  /**
   * Generate refinement query for next iteration
   */
  private async generateRefinementQuery(
    originalQuery: string,
    currentAnswer: string,
  ): Promise<string> {
    const prompt = `Given the original question and current answer, generate a more specific follow-up query to gather additional relevant information.

Original Question: "${originalQuery}"

Current Answer:
${currentAnswer}

Generate a focused follow-up query to find more specific or detailed information:`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string'
          ? response.content.trim()
          : originalQuery;

      // If the response is too similar to original, keep original
      if (this.calculateSimilarity(content, originalQuery) > 0.8) {
        return originalQuery;
      }

      return content;
    } catch (error) {
      this.logger.warn('Refinement query generation failed', {
        component: 'IterativeRAGPattern',
        error: error instanceof Error ? error.message : String(error),
      });
      return originalQuery;
    }
  }

  /**
   * Synthesize final answer from iterative results
   */
  private async synthesizeFinalAnswer(
    originalQuery: string,
    iterativeAnswer: string,
  ): Promise<string> {
    const prompt = `Synthesize a final, comprehensive answer from the iterative refinement process.

Original Question: ${originalQuery}

Iterative Answer:
${iterativeAnswer}

Provide a final, well-structured answer:`;

    try {
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      return typeof response.content === 'string'
        ? response.content.trim()
        : iterativeAnswer;
    } catch (error) {
      this.logger.warn('Final synthesis failed, using iterative answer', {
        component: 'IterativeRAGPattern',
        error: error instanceof Error ? error.message : String(error),
      });
      return iterativeAnswer;
    }
  }

  /**
   * Simple text similarity calculation
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Deduplicate documents
   */
  private deduplicateDocuments(documents: Document[]): Document[] {
    const seen = new Set<string>();
    const deduplicated: Document[] = [];

    for (const doc of documents) {
      const key =
        (doc.metadata._id as string) || doc.pageContent.substring(0, 100);
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
      description: 'Multi-round retrieval with progressive answer building',
      useCases: [
        'Complex analytical queries',
        'Multi-step reasoning tasks',
        'Research-style questions',
        'Detailed explanations needed',
      ],
      complexity: 'high',
      avgLatency: 5000,
      avgCost: 0.003,
    };
  }
}
