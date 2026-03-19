import { Injectable, Inject } from '@nestjs/common';
import { BaseRAGPattern } from './base.pattern';
import {
  OrchestratorInput,
  PatternResult,
  RAGDocument,
} from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { RerankModule } from '../modules/rerank.module';
import { ReadModule } from '../modules/read.module';
import { BedrockService } from '../../bedrock/bedrock.service';

interface SubQuestion {
  id: string;
  question: string;
  depth: number;
  dependencies?: string[];
}

interface SubQuestionResult {
  questionId: string;
  answer: string;
  documents: any[];
  confidence: number;
}

interface RecursiveState {
  originalQuery: string;
  subQuestions: SubQuestion[];
  depth: number;
  maxDepth: number;
  results: Map<string, SubQuestionResult>;
}

/**
 * Recursive RAG Pattern
 * Question decomposition and multi-hop reasoning
 */
@Injectable()
export class RecursivePattern extends BaseRAGPattern {
  constructor(
    @Inject(RetrieveModule)
    private readonly retrieveModule: RetrieveModule,
    @Inject(RerankModule)
    private readonly rerankModule: RerankModule,
    @Inject(ReadModule)
    private readonly readModule: ReadModule,
    private readonly bedrockService: BedrockService,
  ) {
    super('RecursivePattern');
  }

  async execute(input: OrchestratorInput): Promise<PatternResult> {
    const startTime = Date.now();
    const maxDepth = 2;

    const state: RecursiveState = {
      originalQuery: input.query,
      subQuestions: [],
      depth: 0,
      maxDepth,
      results: new Map(),
    };

    try {
      // Step 1: Decompose query into sub-questions
      this.logger.log('Decomposing query into sub-questions', {
        query: input.query.substring(0, 100),
      });

      state.subQuestions = await this.decomposeQuery(input.query);

      // Step 2: Process sub-questions recursively
      const independentQuestions = state.subQuestions.filter(
        (sq) => !sq.dependencies || sq.dependencies.length === 0,
      );
      const dependentQuestions = state.subQuestions.filter(
        (sq) => sq.dependencies && sq.dependencies.length > 0,
      );

      // Process independent questions in parallel
      if (independentQuestions.length > 0) {
        const independentResults = await Promise.all(
          independentQuestions.map((sq) => this.processSubQuestion(sq, input)),
        );

        for (let i = 0; i < independentQuestions.length; i++) {
          const sq = independentQuestions[i];
          const result = independentResults[i];
          state.results.set(sq.id, result);
        }
      }

      // Process dependent questions sequentially
      for (const sq of dependentQuestions) {
        const result = await this.processSubQuestion(sq, input);
        state.results.set(sq.id, result);
      }

      // Step 3: Synthesize final answer
      await this.synthesizeAnswer(
        input.query,
        state.subQuestions,
        state.results,
      );

      // Collect all documents
      const allDocuments = Array.from(state.results.values()).flatMap(
        (result) => result.documents,
      );
      const uniqueDocuments = this.deduplicateDocuments(allDocuments);

      return {
        documents: uniqueDocuments,
        reasoning: `Recursive pattern: Decomposed query into ${state.subQuestions.length} sub-questions and synthesized comprehensive answer`,
        confidence: 0.8,
        metadata: {
          pattern: 'recursive',
          subQuestionsCount: state.subQuestions.length,
          totalDocuments: uniqueDocuments.length,
          executionTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      this.logger.error('Recursive pattern execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        documents: [],
        reasoning: 'Recursive pattern failed to decompose and process query',
        confidence: 0.0,
        metadata: {
          pattern: 'recursive',
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  isSuitable(input: OrchestratorInput): boolean {
    // Suitable for complex, multi-part queries
    const queryLength = input.query.length;
    const hasMultipleClauses =
      (input.query.match(/[,;]|\band\b|\bor\b|\bvs\b/i) || []).length > 1;
    const hasComparisonWords =
      /\b(compare|versus|vs|difference|similar|different|better|worse|advantages|disadvantages)\b/i.test(
        input.query,
      );

    return queryLength > 100 && (hasMultipleClauses || hasComparisonWords);
  }

  getMetadata() {
    return {
      name: 'recursive',
      description:
        'Decomposes complex questions into sub-questions for comprehensive answers',
      complexity: 'complex' as const,
      expectedLatency: 8000,
    };
  }

  /**
   * Decompose complex query into sub-questions
   */
  private async decomposeQuery(query: string): Promise<SubQuestion[]> {
    const prompt = `Decompose this complex question into 2-4 simpler, focused sub-questions that together would answer the original question. Each sub-question should be independent and answerable on its own.

Complex question: "${query}"

Provide the sub-questions as a numbered list:
1. [First sub-question]
2. [Second sub-question]
3. [Third sub-question]
...`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const content = typeof response === 'string' ? response : '';

      // Parse sub-questions
      const lines = content
        .split('\n')
        .filter((line: string) => line.trim().length > 0);
      const subQuestions: SubQuestion[] = [];

      for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+)$/);
        if (match) {
          const question = match[1].trim();
          subQuestions.push({
            id: `sq_${subQuestions.length + 1}`,
            question,
            depth: 0,
          });
        }
      }

      // If decomposition failed, return original query as single sub-question
      if (subQuestions.length === 0) {
        return [
          {
            id: 'sq_1',
            question: query,
            depth: 0,
          },
        ];
      }

      return subQuestions;
    } catch (error) {
      this.logger.warn('Query decomposition failed, using original query', {
        error: error instanceof Error ? error.message : String(error),
      });

      return [
        {
          id: 'sq_1',
          question: query,
          depth: 0,
        },
      ];
    }
  }

  /**
   * Process a single sub-question
   */
  private async processSubQuestion(
    subQuestion: SubQuestion,
    input: OrchestratorInput,
  ): Promise<SubQuestionResult> {
    try {
      // Retrieve documents for this sub-question
      const retrieveInput = {
        ...input,
        query: subQuestion.question,
      };

      const retrieveResult = await this.retrieveModule.execute(retrieveInput);

      if (!retrieveResult.documents || retrieveResult.documents.length === 0) {
        return {
          questionId: subQuestion.id,
          answer: 'Unable to retrieve information for this sub-question.',
          documents: [],
          confidence: 0.3,
        };
      }

      // Rerank documents
      const rerankResult = await this.rerankModule.execute(retrieveInput, [
        retrieveResult,
      ]);

      const docs = rerankResult.documents || retrieveResult.documents;

      // Read and extract context
      await this.readModule.execute(retrieveInput, [retrieveResult]);

      // Generate answer
      const context = docs
        .map((doc: RAGDocument) => doc.content)
        .join('\n\n')
        .substring(0, 2000);
      const answer = await this.generateSubAnswer(
        subQuestion.question,
        context,
      );

      // Calculate confidence
      const confidence = this.calculateConfidence(answer, docs);

      return {
        questionId: subQuestion.id,
        answer,
        documents: docs,
        confidence,
      };
    } catch (error) {
      this.logger.error('Sub-question processing failed', {
        questionId: subQuestion.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        questionId: subQuestion.id,
        answer: 'Error processing this sub-question.',
        documents: [],
        confidence: 0.1,
      };
    }
  }

  /**
   * Generate answer for a sub-question
   */
  private async generateSubAnswer(
    question: string,
    context: string,
  ): Promise<string> {
    const prompt = `Answer the following sub-question based on the provided context. Be concise and focused.

Context:
${context}

Sub-question: ${question}

Answer:`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      return typeof response === 'string'
        ? response.trim()
        : 'Unable to generate answer';
    } catch (error) {
      return 'Unable to generate answer due to processing error';
    }
  }

  /**
   * Synthesize final answer from sub-question results
   */
  private async synthesizeAnswer(
    originalQuery: string,
    subQuestions: SubQuestion[],
    results: Map<string, SubQuestionResult>,
  ): Promise<string> {
    // Build synthesis prompt with all sub-answers
    let synthesisContext = '';

    for (const sq of subQuestions) {
      const result = results.get(sq.id);
      if (result) {
        synthesisContext += `\n\nQ: ${sq.question}\nA: ${result.answer}`;
      }
    }

    const prompt = `Given the following sub-questions and their answers, synthesize a comprehensive, well-structured answer to the original question.

Original Question: ${originalQuery}

Sub-questions and answers:${synthesisContext}

Synthesized comprehensive answer:`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      return typeof response === 'string'
        ? response.trim()
        : 'Unable to synthesize final answer';
    } catch (error) {
      // Fallback: concatenate sub-answers
      let fallback = '';
      for (const sq of subQuestions) {
        const result = results.get(sq.id);
        if (result) {
          fallback += `${result.answer}\n\n`;
        }
      }
      return fallback.trim();
    }
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(answer: string, documents: any[]): number {
    let confidence = 0.5;

    // More documents = higher confidence
    if (documents.length >= 3) confidence += 0.2;

    // Longer answer = higher confidence
    if (answer.length > 200) confidence += 0.2;

    // Has specific details = higher confidence
    if (answer.match(/\d+/) || answer.includes('specifically'))
      confidence += 0.1;

    return Math.min(confidence, 1.0);
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
