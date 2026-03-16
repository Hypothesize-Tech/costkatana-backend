import { Injectable, Inject } from '@nestjs/common';
import { BaseRAGPattern } from './base.pattern';
import { OrchestratorInput, PatternResult } from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { RerankModule } from '../modules/rerank.module';
import { ReadModule } from '../modules/read.module';
import { BedrockService } from '../../../services/bedrock.service';

interface IterativeState {
  currentIteration: number;
  maxIterations: number;
  partialAnswer: string;
  retrievedDocuments: any[][];
  refinementQuery: string;
  converged: boolean;
}

/**
 * Iterative RAG Pattern
 * Multi-round retrieval with progressive answer building
 */
@Injectable()
export class IterativePattern extends BaseRAGPattern {
  constructor(
    @Inject(RetrieveModule)
    private readonly retrieveModule: RetrieveModule,
    @Inject(RerankModule)
    private readonly rerankModule: RerankModule,
    @Inject(ReadModule)
    private readonly readModule: ReadModule,
    private readonly bedrockService: BedrockService,
  ) {
    super('IterativePattern');
  }

  async execute(input: OrchestratorInput): Promise<PatternResult> {
    const startTime = Date.now();
    const maxIterations = 3;

    const state: IterativeState = {
      currentIteration: 0,
      maxIterations,
      partialAnswer: '',
      retrievedDocuments: [],
      refinementQuery: input.query,
      converged: false,
    };

    try {
      // Iterative retrieval-generation loop
      while (state.currentIteration < maxIterations && !state.converged) {
        this.logger.log(
          `Iteration ${state.currentIteration + 1}/${maxIterations}`,
          {
            query: state.refinementQuery.substring(0, 100),
          },
        );

        // Retrieve documents for this iteration
        const retrieveInput = {
          ...input,
          query: state.refinementQuery,
        };

        const retrieveResult = await this.retrieveModule.execute(retrieveInput);

        if (
          !retrieveResult.documents ||
          retrieveResult.documents.length === 0
        ) {
          this.logger.warn('Retrieval failed, stopping iteration');
          break;
        }

        // Rerank and filter
        const rerankResult = await this.rerankModule.execute(retrieveInput, [
          retrieveResult,
        ]);
        const iterationDocs =
          rerankResult.documents || retrieveResult.documents;

        state.retrievedDocuments.push(iterationDocs);

        // Extract context
        const readResult = await this.readModule.execute(retrieveInput, [
          retrieveResult,
        ]);
        const extractedContext = this.extractContext(readResult);

        // Generate or refine answer
        if (state.currentIteration === 0) {
          // First iteration: generate initial answer
          state.partialAnswer = await this.generateInitialAnswer(
            input.query,
            extractedContext,
          );
        } else {
          // Subsequent iterations: refine answer
          state.partialAnswer = await this.refineAnswer(
            input.query,
            state.partialAnswer,
            extractedContext,
          );
        }

        // Check convergence
        state.converged = await this.checkConvergence(
          input.query,
          state.partialAnswer,
        );

        if (state.converged) {
          this.logger.log('Converged early', {
            iteration: state.currentIteration + 1,
          });
          break;
        }

        // Generate refinement query for next iteration
        if (state.currentIteration < maxIterations - 1) {
          state.refinementQuery = await this.generateRefinementQuery(
            input.query,
            state.partialAnswer,
          );
        }

        state.currentIteration++;
      }

      // Final synthesis if multiple iterations
      let finalAnswer = state.partialAnswer;
      if (state.currentIteration > 1) {
        finalAnswer = await this.synthesizeFinalAnswer(
          input.query,
          state.partialAnswer,
        );
      }

      // Collect all documents
      const allDocuments = state.retrievedDocuments.flat();
      const uniqueDocuments = this.deduplicateDocuments(allDocuments);

      return {
        documents: uniqueDocuments,
        reasoning: `Iterative pattern: ${state.currentIteration} iterations, ${state.converged ? 'converged' : 'completed'} with ${uniqueDocuments.length} documents`,
        confidence: 0.8,
        metadata: {
          pattern: 'iterative',
          iterations: state.currentIteration,
          converged: state.converged,
          totalDocuments: uniqueDocuments.length,
          executionTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      this.logger.error('Iterative pattern execution failed', {
        error: error instanceof Error ? error.message : String(error),
        iterations: state.currentIteration,
      });

      // Return partial answer if we have one
      if (state.partialAnswer) {
        const allDocuments = state.retrievedDocuments.flat();
        const uniqueDocuments = this.deduplicateDocuments(allDocuments);

        return {
          documents: uniqueDocuments,
          reasoning: 'Iterative pattern failed but returning partial results',
          confidence: 0.6,
          metadata: {
            pattern: 'iterative',
            iterations: state.currentIteration,
            partial: true,
            totalDocuments: uniqueDocuments.length,
          },
        };
      }

      return {
        documents: [],
        reasoning: 'Iterative pattern failed completely',
        confidence: 0.0,
        metadata: {
          pattern: 'iterative',
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  isSuitable(input: OrchestratorInput): boolean {
    // Suitable for comprehensive research queries
    const queryLength = input.query.length;
    const hasResearchKeywords =
      /\b(how|what|why|explain|analyze|research|deep|comprehensive|detailed)\b/i.test(
        input.query,
      );
    const hasMultipleAspects =
      (input.query.match(/[,;]|\band\b|\bor\b/) || []).length > 2;

    return queryLength > 150 && (hasResearchKeywords || hasMultipleAspects);
  }

  getMetadata() {
    return {
      name: 'iterative',
      description:
        'Multi-round retrieval with progressive answer building and refinement',
      complexity: 'complex' as const,
      expectedLatency: 6000,
    };
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

    try {
      const response = await this.bedrockService.invoke([
        { role: 'user', content: prompt },
      ]);
      return typeof response.content === 'string'
        ? response.content.trim()
        : 'Unable to generate initial answer';
    } catch (error) {
      return 'Unable to generate initial answer due to processing error';
    }
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

    try {
      const response = await this.bedrockService.invoke([
        { role: 'user', content: prompt },
      ]);
      return typeof response.content === 'string'
        ? response.content.trim()
        : previousAnswer;
    } catch (error) {
      return previousAnswer;
    }
  }

  /**
   * Check if answer has converged (no significant improvement likely)
   */
  private async checkConvergence(
    answer: string,
    latestContext: string,
  ): Promise<boolean> {
    // Simple heuristic: if answer is comprehensive and long enough, consider converged
    if (answer.length > 500) {
      // Check if latest context adds significant new information
      const contextWords = new Set(latestContext.toLowerCase().split(/\s+/));
      const answerWords = new Set(answer.toLowerCase().split(/\s+/));

      const newWords = [...contextWords].filter(
        (word) => !answerWords.has(word),
      );
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
    currentAnswer: string,
  ): Promise<string> {
    const prompt = `Given the original question and current answer, generate a focused follow-up question to retrieve additional specific information that would improve the answer.

Original Question: ${originalQuery}

Current Answer:
${currentAnswer.substring(0, 500)}...

Follow-up question for more information:`;

    try {
      const response = await this.bedrockService.invoke([
        { role: 'user', content: prompt },
      ]);
      const refinement =
        typeof response.content === 'string'
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
      const response = await this.bedrockService.invoke([
        { role: 'user', content: prompt },
      ]);
      return typeof response.content === 'string'
        ? response.content.trim()
        : iterativeAnswer;
    } catch (error) {
      return iterativeAnswer;
    }
  }

  /**
   * Extract context from read result
   */
  private extractContext(readResult: any): string {
    if (readResult.documents && readResult.documents.length > 0) {
      return readResult.documents
        .map((doc: any) => doc.content)
        .join('\n\n')
        .substring(0, 2000);
    }
    return '';
  }

  /**
   * Deduplicate documents
   */
  private deduplicateDocuments(documents: any[]): any[] {
    const seen = new Set<string>();
    const deduplicated: any[] = [];

    for (const doc of documents) {
      const key = doc.metadata?._id || doc.content?.substring(0, 100) || doc.id;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(doc);
      }
    }

    return deduplicated;
  }
}
