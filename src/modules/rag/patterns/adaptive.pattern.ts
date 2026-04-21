import { Injectable, Inject } from '@nestjs/common';
import { BaseRAGPattern } from './base.pattern';
import { OrchestratorInput, PatternResult } from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { RerankModule } from '../modules/rerank.module';
import { ReadModule } from '../modules/read.module';
import { BedrockService } from '../../bedrock/bedrock.service';

interface AdaptiveState {
  query: string;
  retrievalDecision: 'retrieve' | 'parametric' | 'hybrid';
  confidence: number;
  reasoning: string;
}

interface SelfReflectionResult {
  needsRetrieval: boolean;
  answerQuality: 'high' | 'medium' | 'low';
  confidence: number;
  missingInformation?: string[];
}

/**
 * Adaptive RAG Pattern
 * Judge module decides whether to retrieve or use parametric knowledge (Self-RAG inspired)
 */
@Injectable()
export class AdaptivePattern extends BaseRAGPattern {
  constructor(
    @Inject(RetrieveModule)
    private readonly retrieveModule: RetrieveModule,
    @Inject(RerankModule)
    private readonly rerankModule: RerankModule,
    @Inject(ReadModule)
    private readonly readModule: ReadModule,
    private readonly bedrockService: BedrockService,
  ) {
    super('AdaptivePattern');
  }

  async execute(input: OrchestratorInput): Promise<PatternResult> {
    const startTime = Date.now();

    try {
      // Step 1: Judge whether retrieval is needed
      const decision = await this.judgeRetrievalNecessity(input.query);

      this.logger.log('Retrieval decision made', {
        decision: decision.retrievalDecision,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
      });

      let answer: string;
      let documents: any[] = [];
      let sources: string[] = [];

      if (decision.retrievalDecision === 'retrieve') {
        // Standard retrieval path
        const result = await this.performRetrieval(input);
        answer = await this.generateWithContext(input.query, result.context);
        documents = result.documents;
        sources = result.sources;
      } else if (decision.retrievalDecision === 'hybrid') {
        // Hybrid: use both parametric and retrieval
        const [parametricAnswer, retrievalResult] = await Promise.all([
          this.generateParametric(input.query),
          this.retrieveModule.execute(input),
        ]);

        if (retrievalResult.documents && retrievalResult.documents.length > 0) {
          const readResult = await this.readModule.execute(input, [
            retrievalResult,
          ]);
          const extractedContext = this.extractContext(readResult);
          answer = await this.generateHybrid(
            input.query,
            parametricAnswer,
            extractedContext,
          );
          documents = retrievalResult.documents;
          sources = this.extractSources(documents);
        } else {
          answer = parametricAnswer;
        }
      } else {
        // Parametric only - no retrieval
        answer = await this.generateParametric(input.query);
      }

      // Step 2: Self-reflection on answer quality
      const reflection = await this.selfReflect(answer, documents);

      this.logger.log('Self-reflection completed', {
        answerQuality: reflection.answerQuality,
        confidence: reflection.confidence,
      });

      // Step 3: If quality is low and we didn't retrieve, try retrieval
      if (
        reflection.answerQuality === 'low' &&
        decision.retrievalDecision === 'parametric' &&
        reflection.needsRetrieval
      ) {
        this.logger.log('Triggering corrective retrieval');

        const correctiveResult = await this.correctiveRetrieval(input);
        answer = correctiveResult.answer;
        documents = correctiveResult.documents;
        sources = correctiveResult.sources;
      }

      return {
        documents,
        reasoning: `Adaptive pattern: ${decision.retrievalDecision} approach with ${reflection.answerQuality} quality answer`,
        confidence: reflection.confidence,
        metadata: {
          pattern: 'adaptive',
          retrievalDecision: decision.retrievalDecision,
          answerQuality: reflection.answerQuality,
          needsRetrieval: reflection.needsRetrieval,
          totalDocuments: documents.length,
          executionTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      this.logger.error('Adaptive pattern execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        documents: [],
        reasoning: 'Adaptive pattern failed to process query',
        confidence: 0.0,
        metadata: {
          pattern: 'adaptive',
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  isSuitable(input: OrchestratorInput): boolean {
    // Adaptive pattern is suitable for most queries - it can handle any type
    return true;
  }

  getMetadata() {
    return {
      name: 'adaptive',
      description:
        'Intelligently decides whether to retrieve or use parametric knowledge with self-reflection',
      complexity: 'medium' as const,
      expectedLatency: 2500,
    };
  }

  /**
   * Judge whether retrieval is necessary
   */
  private async judgeRetrievalNecessity(query: string): Promise<AdaptiveState> {
    const prompt = `You are a judge deciding whether external information retrieval is needed to answer a question.

<retrieval_options>
- "retrieve": External knowledge/documents needed (recent facts, specific data, detailed technical info)
- "parametric": Can be answered from general knowledge alone (common facts, general concepts)
- "hybrid": Benefits from both parametric knowledge and external sources
</retrieval_options>

Here are examples showing the correct decision for different question types:

<sample_input>
<candidate_question>What is the current price per token for GPT-4o as of this month?</candidate_question>
</sample_input>
<ideal_output>retrieve</ideal_output>
This requires up-to-date pricing data that changes frequently — general knowledge alone is insufficient.

<sample_input>
<candidate_question>What does "tokens" mean in the context of large language models?</candidate_question>
</sample_input>
<ideal_output>parametric</ideal_output>
This is a stable concept that can be explained from general knowledge without needing external documents.

<sample_input>
<candidate_question>How does prompt caching work and what are the current savings rates on AWS Bedrock?</candidate_question>
</sample_input>
<ideal_output>hybrid</ideal_output>
The concept of prompt caching can be explained from general knowledge, but current savings rates require retrieval.

Now classify the actual question below:

<candidate_question>
${query}
</candidate_question>

Respond with ONLY one of these three words: retrieve, parametric, or hybrid`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const content =
        typeof response === 'string' ? response.toLowerCase().trim() : 'hybrid';

      let decision: 'retrieve' | 'parametric' | 'hybrid' = 'hybrid';
      if (content.includes('retrieve')) decision = 'retrieve';
      else if (content.includes('parametric')) decision = 'parametric';

      // Calculate confidence based on query characteristics
      const confidence = this.calculateDecisionConfidence(query, decision);

      return {
        query,
        retrievalDecision: decision,
        confidence,
        reasoning: `Query analysis suggests ${decision} approach`,
      };
    } catch (error) {
      // Default to hybrid on error
      return {
        query,
        retrievalDecision: 'hybrid',
        confidence: 0.5,
        reasoning: 'Default to hybrid due to judgment error',
      };
    }
  }

  /**
   * Calculate confidence in the decision
   */
  private calculateDecisionConfidence(query: string, decision: string): number {
    const lowerQuery = query.toLowerCase();

    // High confidence for retrieve if query has specific indicators
    if (decision === 'retrieve') {
      if (
        lowerQuery.match(
          /\b(how|guide|documentation|specific|latest|current)\b/,
        )
      ) {
        return 0.9;
      }
      return 0.7;
    }

    // High confidence for parametric if query is general
    if (decision === 'parametric') {
      if (lowerQuery.match(/\b(what is|define|explain|general)\b/)) {
        return 0.8;
      }
      return 0.6;
    }

    return 0.7;
  }

  /**
   * Perform standard retrieval
   */
  private async performRetrieval(
    input: OrchestratorInput,
  ): Promise<{ context: string; documents: any[]; sources: string[] }> {
    const retrieveResult = await this.retrieveModule.execute(input);

    if (!retrieveResult.documents || retrieveResult.documents.length === 0) {
      throw new Error('Retrieval failed');
    }

    const rerankResult = await this.rerankModule.execute(input, [
      retrieveResult,
    ]);
    const documents = rerankResult.documents || retrieveResult.documents;

    const readResult = await this.readModule.execute(input, [retrieveResult]);
    const context = this.extractContext(readResult);

    return {
      context,
      documents,
      sources: this.extractSources(documents),
    };
  }

  /**
   * Generate answer using only parametric knowledge
   */
  private async generateParametric(query: string): Promise<string> {
    const prompt = `Answer the following question using your knowledge. Be concise and helpful.

<user_question>
${query}
</user_question>

Answer:`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      return typeof response === 'string'
        ? response.trim()
        : 'Unable to generate response';
    } catch (error) {
      return 'Unable to generate response due to processing error';
    }
  }

  /**
   * Generate answer with retrieved context
   */
  private async generateWithContext(
    query: string,
    context: string,
  ): Promise<string> {
    const prompt = `Answer the following question based on the provided context.

Here is an example input with an ideal response:

<sample_input>
<retrieved_context>
Amazon Bedrock charges per 1,000 input tokens. Nova Pro costs $0.0008 per 1K input tokens. Claude Sonnet costs $0.003 per 1K input tokens.
</retrieved_context>
<user_question>
Which is cheaper on Bedrock — Nova Pro or Claude Sonnet for input?
</user_question>
</sample_input>

<ideal_output>
Nova Pro is significantly cheaper for input tokens on Bedrock at $0.0008 per 1K tokens, versus Claude Sonnet at $0.003 per 1K — that's nearly 4x cheaper.
</ideal_output>

This example is ideal because it uses only the provided context, states exact figures, and gives a concrete comparison ratio.

Now answer the actual question:

<retrieved_context>
${context}
</retrieved_context>

<user_question>
${query}
</user_question>

Answer:`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      return typeof response === 'string'
        ? response.trim()
        : 'Unable to generate response';
    } catch (error) {
      return 'Unable to generate response due to processing error';
    }
  }

  /**
   * Generate hybrid answer combining parametric and retrieval
   */
  private async generateHybrid(
    query: string,
    parametricAnswer: string,
    context: string,
  ): Promise<string> {
    const prompt = `You have both your general knowledge and external context. Combine them to give the best answer.

Here is an example input with an ideal response:

<sample_input>
<parametric_answer>
Prompt caching reduces costs by storing and reusing previously processed prompt prefixes instead of reprocessing them on every call.
</parametric_answer>
<retrieved_context>
AWS Bedrock prompt caching offers up to 90% cost reduction on cached input tokens. Cache entries expire after 5 minutes of inactivity.
</retrieved_context>
<user_question>
How does prompt caching help reduce costs and what are the current limits?
</user_question>
</sample_input>

<ideal_output>
Prompt caching reduces costs by storing processed prompt prefixes so they don't need to be re-tokenized on every request. On AWS Bedrock specifically, this can reduce costs on cached input tokens by up to 90%. Cache entries stay active for 5 minutes — after that they expire and must be rebuilt.
</ideal_output>

This example is ideal because it weaves the conceptual explanation from general knowledge with the specific numbers from the retrieved context, producing a complete and grounded answer.

Now answer the actual question:

<parametric_answer>
${parametricAnswer}
</parametric_answer>

<retrieved_context>
${context}
</retrieved_context>

<user_question>
${query}
</user_question>

Final integrated answer:`;

    try {
      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      return typeof response === 'string' ? response.trim() : parametricAnswer;
    } catch (error) {
      return parametricAnswer;
    }
  }

  /**
   * Self-reflect on answer quality
   */
  private async selfReflect(
    answer: string,
    documents: any[],
  ): Promise<SelfReflectionResult> {
    // Simple heuristic-based reflection for efficiency
    const answerLength = answer.length;
    const hasDocuments = documents.length > 0;

    let answerQuality: 'high' | 'medium' | 'low' = 'medium';
    let confidence = 0.7;

    // Quality heuristics
    if (answerLength < 50) {
      answerQuality = 'low';
      confidence = 0.4;
    } else if (answerLength > 200 && hasDocuments) {
      answerQuality = 'high';
      confidence = 0.9;
    }

    const needsRetrieval = answerQuality === 'low' && !hasDocuments;

    return {
      needsRetrieval,
      answerQuality,
      confidence,
      missingInformation: needsRetrieval
        ? ['Additional context needed']
        : undefined,
    };
  }

  /**
   * Perform corrective retrieval if initial answer was poor
   */
  private async correctiveRetrieval(
    input: OrchestratorInput,
  ): Promise<{ answer: string; documents: any[]; sources: string[] }> {
    const retrieveResult = await this.retrieveModule.execute(input);

    if (!retrieveResult.documents || retrieveResult.documents.length === 0) {
      return {
        answer: 'Unable to retrieve additional information',
        documents: [],
        sources: [],
      };
    }

    const readResult = await this.readModule.execute(input, [retrieveResult]);
    const context = this.extractContext(readResult);
    const answer = await this.generateWithContext(input.query, context);

    return {
      answer,
      documents: retrieveResult.documents,
      sources: this.extractSources(retrieveResult.documents),
    };
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
   * Extract unique sources from documents
   */
  private extractSources(documents: any[]): string[] {
    const sources = new Set<string>();

    for (const doc of documents) {
      const source = doc.metadata?.source || doc.metadata?.fileName;
      if (source) {
        sources.add(source);
      }
    }

    return Array.from(sources);
  }
}
