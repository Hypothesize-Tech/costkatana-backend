import { Document } from '@langchain/core/documents';
import { ChatBedrockConverse } from '@langchain/aws';
import { loggingService } from '../../services/logging.service';

/**
 * Evaluation metrics for RAG system quality assessment (RAGAS-aligned).
 * Eval LLM calls use the default Bedrock client and are not attributed to the cost
 * pipeline; when using a traced LLM client, pass sourceTag: 'rag_eval' in options
 * so eval cost can be attributed separately.
 */

export interface EvaluationMetrics {
  contextRelevance: number;
  answerFaithfulness: number;
  answerRelevance: number;
  retrievalPrecision: number;
  retrievalRecall: number;
  overall: number;
}

export interface EvaluationInput {
  query: string;
  answer: string;
  documents: Document[];
  groundTruth?: string;
}

export interface RAGEvaluatorOptions {
  /**
   * When using a traced LLM client that supports metadata, pass sourceTag: 'rag_eval'
   * so eval cost can be attributed separately from production traffic.
   * Ignored when using the default Bedrock client.
   */
  sourceTag?: string;
}

export class RAGEvaluator {
  private llm: ChatBedrockConverse;
  /** Reserved for future cost attribution when traced LLM is injected */
  private readonly sourceTag: string | undefined;

  constructor(options?: RAGEvaluatorOptions) {
    this.sourceTag = options?.sourceTag;
    this.llm = new ChatBedrockConverse({
      model: 'amazon.nova-micro-v1:0',
      region: process.env.AWS_REGION ?? 'us-east-1',
      temperature: 0.1,
      maxTokens: 500,
    });
  }

  /**
   * Evaluate all metrics for a RAG response
   */
  async evaluate(input: EvaluationInput): Promise<EvaluationMetrics> {
    const [
      contextRelevance,
      answerFaithfulness,
      answerRelevance,
      retrievalPrecision,
    ] = await Promise.all([
      this.evaluateContextRelevance(input.query, input.documents),
      this.evaluateAnswerFaithfulness(input.answer, input.documents),
      this.evaluateAnswerRelevance(input.query, input.answer),
      this.evaluateRetrievalPrecision(input.query, input.documents),
    ]);

    const retrievalRecall = input.groundTruth
      ? await this.evaluateRetrievalRecall(input.query, input.documents, input.groundTruth)
      : 0;

    const overall = this.calculateOverallScore({
      contextRelevance,
      answerFaithfulness,
      answerRelevance,
      retrievalPrecision,
      retrievalRecall,
      overall: 0,
    });

    return {
      contextRelevance,
      answerFaithfulness,
      answerRelevance,
      retrievalPrecision,
      retrievalRecall,
      overall,
    };
  }

  /**
   * Context Relevance: Measures how relevant retrieved documents are to the query
   * Score: 0-1 (higher is better)
   */
  async evaluateContextRelevance(
    query: string,
    documents: Document[]
  ): Promise<number> {
    if (documents.length === 0) return 0;

    try {
      const context = documents
        .slice(0, 5)
        .map((doc, idx) => `[${idx + 1}] ${doc.pageContent.substring(0, 300)}`)
        .join('\n\n');

      const prompt = `Evaluate how relevant these documents are to the query.
Query: "${query}"

Documents:
${context}

Rate the overall relevance from 0.0 (completely irrelevant) to 1.0 (highly relevant).
Respond with only a number between 0.0 and 1.0.`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      const score = parseFloat(content.trim());

      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch (error) {
      loggingService.warn('Context relevance evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  /**
   * Answer Faithfulness: Measures if the answer is grounded in retrieved context
   * Score: 0-1 (higher is better)
   */
  async evaluateAnswerFaithfulness(
    answer: string,
    documents: Document[]
  ): Promise<number> {
    if (documents.length === 0) return 0;

    try {
      const context = documents
        .slice(0, 5)
        .map((doc) => doc.pageContent.substring(0, 300))
        .join('\n\n');

      const prompt = `Evaluate if this answer is faithful to the provided context.
An answer is faithful if all claims can be verified from the context.

Context:
${context}

Answer: "${answer}"

Rate faithfulness from 0.0 (not grounded) to 1.0 (fully grounded).
Respond with only a number between 0.0 and 1.0.`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      const score = parseFloat(content.trim());

      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch (error) {
      loggingService.warn('Answer faithfulness evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  /**
   * Answer Relevance: Measures how relevant the answer is to the query
   * Score: 0-1 (higher is better)
   */
  async evaluateAnswerRelevance(
    query: string,
    answer: string
  ): Promise<number> {
    try {
      const prompt = `Evaluate how relevant this answer is to the query.

Query: "${query}"
Answer: "${answer}"

Rate relevance from 0.0 (completely irrelevant) to 1.0 (highly relevant).
Respond with only a number between 0.0 and 1.0.`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      const score = parseFloat(content.trim());

      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch (error) {
      loggingService.warn('Answer relevance evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  /**
   * Retrieval Precision: What percentage of retrieved docs are relevant
   * Score: 0-1 (higher is better)
   */
  async evaluateRetrievalPrecision(
    query: string,
    documents: Document[]
  ): Promise<number> {
    if (documents.length === 0) return 0;

    try {
      let relevantCount = 0;

      for (const doc of documents.slice(0, 5)) {
        const prompt = `Is this document relevant to the query?

Query: "${query}"
Document: "${doc.pageContent.substring(0, 200)}"

Answer with only "yes" or "no".`;

        const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
        const content = typeof response.content === 'string' ? response.content.toLowerCase() : '';

        if (content.includes('yes')) {
          relevantCount++;
        }
      }

      return relevantCount / Math.min(documents.length, 5);
    } catch (error) {
      loggingService.warn('Retrieval precision evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  /**
   * Retrieval Recall: Were all relevant docs retrieved
   * Requires ground truth
   * Score: 0-1 (higher is better)
   */
  async evaluateRetrievalRecall(
    query: string,
    documents: Document[],
    groundTruth: string
  ): Promise<number> {
    try {
      const retrievedContent = documents
        .map((doc) => doc.pageContent.substring(0, 200))
        .join('\n');

      const prompt = `Does the retrieved content contain the information needed to answer based on ground truth?

Query: "${query}"
Ground Truth: "${groundTruth}"
Retrieved Content:
${retrievedContent}

Rate from 0.0 (missing critical info) to 1.0 (has all needed info).
Respond with only a number between 0.0 and 1.0.`;

      const response = await this.llm.invoke([{ role: 'user', content: prompt }]);
      const content = typeof response.content === 'string' ? response.content : '';
      const score = parseFloat(content.trim());

      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch (error) {
      loggingService.warn('Retrieval recall evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5;
    }
  }

  /**
   * Calculate weighted overall score
   */
  private calculateOverallScore(metrics: EvaluationMetrics): number {
    const weights = {
      contextRelevance: 0.2,
      answerFaithfulness: 0.3,
      answerRelevance: 0.3,
      retrievalPrecision: 0.15,
      retrievalRecall: 0.05,
    };

    return (
      metrics.contextRelevance * weights.contextRelevance +
      metrics.answerFaithfulness * weights.answerFaithfulness +
      metrics.answerRelevance * weights.answerRelevance +
      metrics.retrievalPrecision * weights.retrievalPrecision +
      metrics.retrievalRecall * weights.retrievalRecall
    );
  }

  /**
   * Batch evaluate multiple queries
   */
  async batchEvaluate(inputs: EvaluationInput[]): Promise<EvaluationMetrics[]> {
    const results = await Promise.all(inputs.map((input) => this.evaluate(input)));
    return results;
  }

  /**
   * Calculate aggregate statistics
   */
  calculateAggregateStats(metrics: EvaluationMetrics[]): {
    mean: EvaluationMetrics;
    std: EvaluationMetrics;
    min: EvaluationMetrics;
    max: EvaluationMetrics;
  } {
    const keys: (keyof EvaluationMetrics)[] = [
      'contextRelevance',
      'answerFaithfulness',
      'answerRelevance',
      'retrievalPrecision',
      'retrievalRecall',
      'overall',
    ];

    const mean: Partial<EvaluationMetrics> = {};
    const std: Partial<EvaluationMetrics> = {};
    const min: Partial<EvaluationMetrics> = {};
    const max: Partial<EvaluationMetrics> = {};

    keys.forEach((key) => {
      const values = metrics.map((m) => m[key]);
      mean[key] = values.reduce((a, b) => a + b, 0) / values.length;
      min[key] = Math.min(...values);
      max[key] = Math.max(...values);

      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean[key]!, 2), 0) / values.length;
      std[key] = Math.sqrt(variance);
    });

    return {
      mean: mean as EvaluationMetrics,
      std: std as EvaluationMetrics,
      min: min as EvaluationMetrics,
      max: max as EvaluationMetrics,
    };
  }
}

export const ragEvaluator = new RAGEvaluator();

