/**
 * Adaptive RAG Pattern
 * Judge module decides whether to retrieve or use parametric knowledge (Self-RAG inspired)
 */

import { BaseRAGPattern } from './base.pattern';
import {
  RAGConfig,
  RAGContext,
  RAGResult,
  PatternDescription,
  AdaptiveState,
  SelfReflectionResult,
} from '../types/rag.types';
import { RetrieveModule } from '../modules/retrieve.module';
import { RerankModule } from '../modules/rerank.module';
import { ReadModule } from '../modules/read.module';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../common/services/logging.service';

export class AdaptiveRAGPattern extends BaseRAGPattern {
  private retrieveModule: RetrieveModule;
  private rerankModule: RerankModule;
  private readModule: ReadModule;
  private llm: ChatBedrockConverse;

  constructor(config: RAGConfig) {
    super('AdaptiveRAG', 'adaptive', config);

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
    const modulesUsed: any[] = [];
    let retrievalCount = 0;

    try {
      // Step 1: Judge whether retrieval is needed
      const decision = await this.judgeRetrievalNecessity(query, context);

      loggingService.info('Adaptive RAG: Retrieval decision made', {
        component: 'AdaptiveRAGPattern',
        decision: decision.retrievalDecision,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
      });

      let answer: string;
      let documents: any[] = [];
      let sources: string[] = [];
      let retrievalDuration = 0;
      let generationDuration = 0;

      if (decision.retrievalDecision === 'retrieve') {
        // Standard retrieval path
        modulesUsed.push('retrieve', 'rerank', 'read');
        retrievalCount = 1;

        const retrieveStart = Date.now();
        const retrieveResult = await this.retrieveModule.execute({
          query,
          context,
          config: this.config.modules.retrieve,
        });
        retrievalDuration = Date.now() - retrieveStart;

        if (retrieveResult.success && retrieveResult.documents) {
          documents = retrieveResult.documents;

          // Rerank documents
          const rerankResult = await this.rerankModule.execute({
            query,
            documents,
            config: this.config.modules.rerank,
          });

          if (rerankResult.success && rerankResult.documents) {
            documents = rerankResult.documents;
          }

          // Read and extract context
          const readResult = await this.readModule.execute({
            query,
            documents,
            context,
            config: this.config.modules.read,
          });

          const extractedContext =
            typeof readResult.data === 'object' &&
            readResult.data !== null &&
            'extractedContext' in readResult.data
              ? String(readResult.data.extractedContext)
              : '';

          // Generate answer with context
          const genStart = Date.now();
          answer = await this.generateWithContext(query, extractedContext);
          generationDuration = Date.now() - genStart;

          sources = this.extractSources(documents);
        } else {
          throw new Error('Retrieval failed');
        }
      } else if (decision.retrievalDecision === 'hybrid') {
        // Hybrid: use both parametric and retrieval
        modulesUsed.push('retrieve', 'rerank', 'read');
        retrievalCount = 1;

        const [parametricAnswer, retrievalResult] = await Promise.all([
          this.generateParametric(query),
          this.retrieveModule.execute({
            query,
            context,
            config: { ...this.config.modules.retrieve, limit: 3 }, // Fewer docs for hybrid
          }),
        ]);

        if (retrievalResult.success && retrievalResult.documents) {
          documents = retrievalResult.documents;

          const readResult = await this.readModule.execute({
            query,
            documents,
            context,
            config: this.config.modules.read,
          });

          const extractedContext =
            typeof readResult.data === 'object' &&
            readResult.data !== null &&
            'extractedContext' in readResult.data
              ? String(readResult.data.extractedContext)
              : '';

          const genStart = Date.now();
          answer = await this.generateHybrid(
            query,
            parametricAnswer,
            extractedContext,
          );
          generationDuration = Date.now() - genStart;

          sources = this.extractSources(documents);
        } else {
          answer = parametricAnswer;
        }
      } else {
        // Parametric only - no retrieval
        const genStart = Date.now();
        answer = await this.generateParametric(query);
        generationDuration = Date.now() - genStart;
      }

      // Step 2: Self-reflection on answer quality
      const reflection = await this.selfReflect(answer, documents);

      loggingService.info('Adaptive RAG: Self-reflection completed', {
        component: 'AdaptiveRAGPattern',
        answerQuality: reflection.answerQuality,
        confidence: reflection.confidence,
      });

      // Step 3: If quality is low and we didn't retrieve, try retrieval
      if (
        reflection.answerQuality === 'low' &&
        decision.retrievalDecision === 'parametric' &&
        reflection.needsRetrieval
      ) {
        loggingService.info('Adaptive RAG: Triggering corrective retrieval', {
          component: 'AdaptiveRAGPattern',
        });

        const correctiveResult = await this.correctiveRetrieval(query, context);
        answer = correctiveResult.answer;
        documents = correctiveResult.documents;
        sources = correctiveResult.sources;
        retrievalCount = 1;
        modulesUsed.push('retrieve', 'rerank', 'read');
      }

      return {
        success: true,
        answer,
        documents,
        sources,
        metadata: {
          pattern: 'adaptive',
          modulesUsed,
          retrievalCount,
          totalDocuments: documents.length,
          performance: {
            totalDuration: Date.now() - startTime,
            retrievalDuration,
            generationDuration,
            moduleDurations: {},
          },
          cacheHit: false,
          evaluation: {
            answerRelevance: reflection.confidence,
          },
        },
      };
    } catch (error) {
      loggingService.error('Adaptive RAG pattern failed', {
        component: 'AdaptiveRAGPattern',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        answer:
          'I apologize, but I encountered an error while processing your request.',
        documents: [],
        sources: [],
        metadata: {
          pattern: 'adaptive',
          modulesUsed,
          retrievalCount,
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
   * Judge whether retrieval is necessary
   */
  private async judgeRetrievalNecessity(
    query: string,
    _context: RAGContext,
  ): Promise<AdaptiveState> {
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
      const response = await this.llm.invoke([
        { role: 'user', content: prompt },
      ]);
      const content =
        typeof response.content === 'string'
          ? response.content.toLowerCase().trim()
          : 'hybrid';

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
   * Generate answer using only parametric knowledge
   */
  private async generateParametric(query: string): Promise<string> {
    const prompt = `Answer the following question using your knowledge. Be concise and helpful.

<user_question>
${query}
</user_question>

Answer:`;

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string'
      ? response.content.trim()
      : 'Unable to generate response';
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

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string'
      ? response.content.trim()
      : 'Unable to generate response';
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

    const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
    return typeof response.content === 'string'
      ? response.content.trim()
      : parametricAnswer;
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
    query: string,
    context: RAGContext,
  ): Promise<{ answer: string; documents: any[]; sources: string[] }> {
    const retrieveResult = await this.retrieveModule.execute({
      query,
      context,
      config: this.config.modules.retrieve,
    });

    if (!retrieveResult.success || !retrieveResult.documents) {
      return {
        answer: 'Unable to retrieve additional information',
        documents: [],
        sources: [],
      };
    }

    const readResult = await this.readModule.execute({
      query,
      documents: retrieveResult.documents,
      context,
      config: this.config.modules.read,
    });

    const extractedContext =
      typeof readResult.data === 'object' &&
      readResult.data !== null &&
      'extractedContext' in readResult.data
        ? String(readResult.data.extractedContext)
        : '';
    const answer = await this.generateWithContext(query, extractedContext);

    return {
      answer,
      documents: retrieveResult.documents,
      sources: this.extractSources(retrieveResult.documents),
    };
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
      name: 'Adaptive RAG',
      type: 'adaptive',
      description:
        'Intelligently decides whether to retrieve or use parametric knowledge with self-reflection',
      useCases: [
        "Mixed query types (some need retrieval, some don't)",
        'Cost-optimized scenarios',
        'Latency-sensitive applications',
        'General-purpose assistants',
      ],
      complexity: 'medium',
      avgLatency: 2500,
      avgCost: 0.0015,
    };
  }
}
