/**
 * Recursive RAG Pattern
 * Question decomposition and multi-hop reasoning
 */

import { BaseRAGPattern } from './base.pattern';
import {
  RAGConfig,
  RAGContext,
  RAGResult,
  PatternDescription,
  RecursiveState,
  SubQuestion,
  SubQuestionResult,
} from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { RerankModule } from '../modules/rerank.module';
import { ReadModule } from '../modules/read.module';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';
import { Document } from '@langchain/core/documents';

export class RecursiveRAGPattern extends BaseRAGPattern {
  private retrieveModule: RetrieveModule;
  private rerankModule: RerankModule;
  private readModule: ReadModule;
  private llm: ChatBedrockConverse;

  constructor(config: RAGConfig) {
    super('RecursiveRAG', 'recursive', config);
    
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
    const maxDepth = this.config.maxDepth || 2;
    const modulesUsed: any[] = ['retrieve', 'rerank', 'read'];

    const state: RecursiveState = {
      originalQuery: query,
      subQuestions: [],
      depth: 0,
      maxDepth,
      results: new Map(),
    };

    let allDocuments: Document[] = [];
    let totalRetrievalDuration = 0;
    let totalGenerationDuration = 0;

    try {
      // Step 1: Decompose query into sub-questions
      loggingService.info('Recursive RAG: Decomposing query', {
        component: 'RecursiveRAGPattern',
        query: query.substring(0, 100),
      });

      state.subQuestions = await this.decomposeQuery(query);

      loggingService.info('Recursive RAG: Query decomposed', {
        component: 'RecursiveRAGPattern',
        subQuestionsCount: state.subQuestions.length,
        subQuestions: state.subQuestions.map(sq => sq.question.substring(0, 50)),
      });

      // Step 2: Process sub-questions recursively
      // Process in parallel where possible (no dependencies)
      const independentQuestions = state.subQuestions.filter(sq => !sq.dependencies || sq.dependencies.length === 0);
      const dependentQuestions = state.subQuestions.filter(sq => sq.dependencies && sq.dependencies.length > 0);

      // Process independent questions in parallel
      if (independentQuestions.length > 0) {
        const independentResults = await Promise.all(
          independentQuestions.map(sq => this.processSubQuestion(sq, state, context))
        );

        for (let i = 0; i < independentQuestions.length; i++) {
          const sq = independentQuestions[i];
          const result = independentResults[i];
          state.results.set(sq.id, result);
          allDocuments.push(...result.documents);
          totalRetrievalDuration += 500; // Estimate
          totalGenerationDuration += 500; // Estimate
        }
      }

      // Process dependent questions sequentially
      for (const sq of dependentQuestions) {
        const result = await this.processSubQuestion(sq, state, context);
        state.results.set(sq.id, result);
        allDocuments.push(...result.documents);
        totalRetrievalDuration += 500; // Estimate
        totalGenerationDuration += 500; // Estimate
      }

      // Step 3: Synthesize final answer from sub-question results
      loggingService.info('Recursive RAG: Synthesizing final answer', {
        component: 'RecursiveRAGPattern',
        subResultsCount: state.results.size,
      });

      const synthStart = Date.now();
      const finalAnswer = await this.synthesizeAnswer(
        query,
        state.subQuestions,
        state.results
      );
      totalGenerationDuration += Date.now() - synthStart;

      // Deduplicate documents
      const uniqueDocuments = this.deduplicateDocuments(allDocuments);
      const sources = this.extractSources(uniqueDocuments);

      loggingService.info('Recursive RAG: Completed', {
        component: 'RecursiveRAGPattern',
        subQuestions: state.subQuestions.length,
        totalDocuments: uniqueDocuments.length,
      });

      return {
        success: true,
        answer: finalAnswer,
        documents: uniqueDocuments,
        sources,
        metadata: {
          pattern: 'recursive',
          modulesUsed,
          retrievalCount: state.subQuestions.length,
          totalDocuments: uniqueDocuments.length,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration: totalRetrievalDuration,
            generationDuration: totalGenerationDuration,
            moduleDurations: {
              subQuestions: state.subQuestions.length,
              avgSubQuestionTime: (Date.now() - startTime) / state.subQuestions.length,
            },
          },
          cacheHit: false,
        },
      };
    } catch (error) {
      loggingService.error('Recursive RAG pattern failed', {
        component: 'RecursiveRAGPattern',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        answer: 'I apologize, but I encountered an error while processing your request.',
        documents: [],
        sources: [],
        metadata: {
          pattern: 'recursive',
          modulesUsed,
          retrievalCount: 0,
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
      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      
      // Parse sub-questions
      const lines = content.split('\n').filter(line => line.trim().length > 0);
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
        return [{
          id: 'sq_1',
          question: query,
          depth: 0,
        }];
      }

      return subQuestions;
    } catch (error) {
      loggingService.warn('Query decomposition failed, using original query', {
        component: 'RecursiveRAGPattern',
        error: error instanceof Error ? error.message : String(error),
      });

      return [{
        id: 'sq_1',
        question: query,
        depth: 0,
      }];
    }
  }

  /**
   * Process a single sub-question
   */
  private async processSubQuestion(
    subQuestion: SubQuestion,
    state: RecursiveState,
    context: RAGContext
  ): Promise<SubQuestionResult> {
    loggingService.info('Recursive RAG: Processing sub-question', {
      component: 'RecursiveRAGPattern',
      questionId: subQuestion.id,
      question: subQuestion.question.substring(0, 100),
    });

    try {
      // Build context from dependencies if any
      let dependencyContext = '';
      if (subQuestion.dependencies && subQuestion.dependencies.length > 0) {
        for (const depId of subQuestion.dependencies) {
          const depResult = state.results.get(depId);
          if (depResult) {
            dependencyContext += `\n\nFrom ${depId}: ${depResult.answer}`;
          }
        }
      }

      // Retrieve documents for this sub-question
      const retrieveResult = await this.retrieveModule.execute({
        query: subQuestion.question + (dependencyContext ? `\n\nContext: ${dependencyContext}` : ''),
        context,
        config: this.config.modules.retrieve,
      });

      if (!retrieveResult.success || !retrieveResult.documents || retrieveResult.documents.length === 0) {
        // Return empty result if retrieval fails
        return {
          questionId: subQuestion.id,
          answer: 'Unable to retrieve information for this sub-question.',
          documents: [],
          confidence: 0.3,
        };
      }

      // Rerank documents
      const rerankResult = await this.rerankModule.execute({
        query: subQuestion.question,
        documents: retrieveResult.documents,
        config: this.config.modules.rerank,
      });

      const docs = rerankResult.success && rerankResult.documents
        ? rerankResult.documents
        : retrieveResult.documents;

      // Extract context
      const readResult = await this.readModule.execute({
        query: subQuestion.question,
        documents: docs,
        context,
        config: this.config.modules.read,
      });

      const extractedContext = typeof readResult.data === 'object' && readResult.data !== null && 'extractedContext' in readResult.data
        ? String(readResult.data.extractedContext)
        : '';

      // Generate answer
      const answer = await this.generateSubAnswer(
        subQuestion.question,
        extractedContext,
        dependencyContext
      );

      // Calculate confidence based on documents and answer quality
      const confidence = this.calculateConfidence(answer, docs);

      return {
        questionId: subQuestion.id,
        answer,
        documents: docs,
        confidence,
      };
    } catch (error) {
      loggingService.error('Sub-question processing failed', {
        component: 'RecursiveRAGPattern',
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
    subQuestion: string,
    context: string,
    dependencyContext: string
  ): Promise<string> {
    let prompt = `Answer the following sub-question based on the provided context. Be concise and focused.

Context:
${context}`;

    if (dependencyContext) {
      prompt += `\n\nPrevious answers:\n${dependencyContext}`;
    }

    prompt += `\n\nSub-question: ${subQuestion}\n\nAnswer:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string' 
      ? response.content.trim() 
      : 'Unable to generate answer';
  }

  /**
   * Synthesize final answer from sub-question results
   */
  private async synthesizeAnswer(
    originalQuery: string,
    subQuestions: SubQuestion[],
    results: Map<string, SubQuestionResult>
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
      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      return typeof response.content === 'string' 
        ? response.content.trim() 
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
  private calculateConfidence(answer: string, documents: Document[]): number {
    let confidence = 0.5;

    // More documents = higher confidence
    if (documents.length >= 3) confidence += 0.2;
    
    // Longer answer = higher confidence
    if (answer.length > 200) confidence += 0.2;
    
    // Has specific details = higher confidence
    if (answer.match(/\d+/) || answer.includes('specifically')) confidence += 0.1;

    return Math.min(confidence, 1.0);
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
      name: 'Recursive RAG',
      type: 'recursive',
      description: 'Decomposes complex questions into sub-questions and synthesizes comprehensive answers',
      useCases: [
        'Multi-part analytical queries',
        'Comparative analysis (compare X, Y, Z)',
        'Complex reasoning tasks',
        'Comprehensive topic exploration',
      ],
      complexity: 'high',
      avgLatency: 8000, // ~8 seconds for decomposition and synthesis
      avgCost: 0.004,
    };
  }
}

