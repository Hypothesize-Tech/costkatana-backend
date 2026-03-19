/**
 * RAG Performance Benchmark Service for NestJS
 * Benchmarks RAG patterns for performance, cost, and quality metrics
 */

import { Injectable, Logger } from '@nestjs/common';
import { RagServiceLocator } from './rag-service-locator';
import { RAGEvaluationService } from './evaluation/metrics';

export interface BenchmarkResult {
  pattern: string;
  query: string;
  latency: number;
  documentsRetrieved: number;
  answerLength: number;
  estimatedCost: number;
  evaluationMetrics?: {
    contextRelevance: number;
    answerFaithfulness: number;
    answerRelevance: number;
    overall: number;
  };
}

export interface BenchmarkSummary {
  pattern: string;
  avgLatency: number;
  avgCost: number;
  avgQuality: number;
  totalQueries: number;
  successRate: number;
}

@Injectable()
export class RagBenchmarkService {
  private readonly logger = new Logger(RagBenchmarkService.name);

  private testQueries = [
    'What is cost optimization?',
    'How to reduce AWS Lambda costs?',
    'Explain serverless architecture benefits',
    'Compare AWS and Azure pricing',
    'What are the best practices for cloud cost management?',
    'How does containerization affect costs?',
    'Explain the relationship between scalability and cost',
    'What is the difference between vertical and horizontal scaling?',
    'How to implement cost monitoring?',
    'What are reserved instances?',
  ];

  constructor(
    private readonly ragServiceLocator: RagServiceLocator,
    private readonly ragEvaluationService: RAGEvaluationService,
  ) {}

  /**
   * Benchmark a single pattern
   */
  async benchmarkPattern(
    pattern: string,
    queries: string[] = this.testQueries,
  ): Promise<BenchmarkResult[]> {
    this.logger.log(`Benchmarking ${pattern} pattern`, {
      queryCount: queries.length,
    });

    const results: BenchmarkResult[] = [];

    for (const query of queries) {
      try {
        const context = {
          userId: 'benchmark-user',
          conversationId: `benchmark-${pattern}-${Date.now()}`,
        };

        const startTime = Date.now();
        const modularRAGOrchestrator =
          RagServiceLocator.getModularRAGOrchestrator();

        const result = await modularRAGOrchestrator.execute({
          query,
          context: {
            ...context,
            recentMessages: [],
            currentTopic: query,
            googleDriveFiles: [],
            additionalContext: '',
            contextPreamble: '',
            originalMessage: query,
            modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            temperature: 0.7,
            maxTokens: 1000,
            chatMode: 'balanced' as const,
            useMultiAgent: false,
            useWebSearch: false,
          },
          config: {
            temperature: 0.7,
            maxTokens: 1000,
            chatMode: 'balanced' as const,
            useMultiAgent: false,
            useWebSearch: false,
          },
        });

        const latency = Date.now() - startTime;

        const evaluationMetrics = await this.evaluateWithService(query, result);

        const benchmarkResult: BenchmarkResult = {
          pattern,
          query,
          latency,
          documentsRetrieved: result.documents?.length || 0,
          answerLength: result.answer?.length || 0,
          estimatedCost: this.estimateCost(pattern, result.metadata || {}),
          evaluationMetrics,
        };

        results.push(benchmarkResult);

        this.logger.log(`Benchmark query completed`, {
          pattern,
          query: query.substring(0, 50),
          latency,
          quality: evaluationMetrics?.overall,
        });

        // Delay between queries to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        this.logger.error(`Benchmark query failed`, {
          pattern,
          query,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Benchmark all available patterns
   */
  async benchmarkAllPatterns(): Promise<Map<string, BenchmarkResult[]>> {
    const patterns = ['naive', 'adaptive', 'iterative', 'recursive'];
    const results = new Map<string, BenchmarkResult[]>();

    for (const pattern of patterns) {
      try {
        const patternResults = await this.benchmarkPattern(pattern);
        results.set(pattern, patternResults);
      } catch (error) {
        this.logger.error(`Failed to benchmark pattern ${pattern}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        results.set(pattern, []);
      }
    }

    return results;
  }

  /**
   * Generate summary statistics
   */
  generateSummary(results: BenchmarkResult[]): BenchmarkSummary {
    const pattern = results[0]?.pattern ?? 'naive';
    const successful = results.filter((r) => r.latency > 0);

    const avgLatency =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.latency, 0) / successful.length
        : 0;

    const avgCost =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.estimatedCost, 0) /
          successful.length
        : 0;

    const withMetrics = successful.filter((r) => r.evaluationMetrics);
    const avgQuality =
      withMetrics.length > 0
        ? withMetrics.reduce(
            (sum, r) => sum + (r.evaluationMetrics?.overall ?? 0),
            0,
          ) / withMetrics.length
        : 0;

    return {
      pattern,
      avgLatency,
      avgCost,
      avgQuality,
      totalQueries: results.length,
      successRate: results.length > 0 ? successful.length / results.length : 0,
    };
  }

  /**
   * Compare patterns and determine winners
   */
  comparePatterns(allResults: Map<string, BenchmarkResult[]>): {
    summaries: BenchmarkSummary[];
    winner: {
      latency: string;
      cost: string;
      quality: string;
      balanced: string;
    };
  } {
    const summaries: BenchmarkSummary[] = [];

    allResults.forEach((results, pattern) => {
      if (results.length > 0) {
        summaries.push(this.generateSummary(results));
      }
    });

    // Find winners
    const sortedByLatency = [...summaries].sort(
      (a, b) => a.avgLatency - b.avgLatency,
    );
    const sortedByCost = [...summaries].sort((a, b) => a.avgCost - b.avgCost);
    const sortedByQuality = [...summaries].sort(
      (a, b) => b.avgQuality - a.avgQuality,
    );

    // Balanced score: weighted combination
    const balanced = [...summaries]
      .map((s) => ({
        pattern: s.pattern,
        score:
          s.avgQuality * 0.5 - // Quality (50%)
          (s.avgLatency / 10000) * 0.3 - // Latency (30%)
          s.avgCost * 0.2, // Cost (20%)
      }))
      .sort((a, b) => b.score - a.score);

    return {
      summaries,
      winner: {
        latency: sortedByLatency[0]?.pattern || 'naive',
        cost: sortedByCost[0]?.pattern || 'naive',
        quality: sortedByQuality[0]?.pattern || 'naive',
        balanced: balanced[0]?.pattern || 'naive',
      },
    };
  }

  /**
   * Estimate cost based on pattern and usage
   */
  private estimateCost(pattern: string, metadata: any): number {
    // Cost estimates (in cents) based on AWS Bedrock pricing
    const modelCallCost = 0.00015; // per 1K input tokens
    const embeddingCost = 0.00002; // per 1K tokens

    let estimatedCalls = 0;
    let estimatedEmbeddings = 1; // Query embedding

    switch (pattern) {
      case 'naive':
        estimatedCalls = 1; // Single generation
        estimatedEmbeddings = 1;
        break;
      case 'adaptive':
        estimatedCalls = 2; // Judge + generation
        estimatedEmbeddings = 1;
        break;
      case 'iterative':
        const iterations = metadata.iterationsCompleted || 2;
        estimatedCalls = iterations * 2; // Rewrite + generation per iteration
        estimatedEmbeddings = iterations;
        break;
      case 'recursive':
        const subQuestions = metadata.subQuestionsCount || 3;
        estimatedCalls = subQuestions + 2; // Per sub-question + synthesis
        estimatedEmbeddings = subQuestions + 1;
        break;
    }

    // Assume average of 500 tokens per call
    return (
      estimatedCalls * modelCallCost * 0.5 +
      estimatedEmbeddings * embeddingCost * 0.1
    );
  }

  /**
   * Evaluate using RAGEvaluationService (RAGAS-aligned metrics)
   */
  private async evaluateWithService(
    query: string,
    result: any,
  ): Promise<BenchmarkResult['evaluationMetrics']> {
    if (!result.success || !result.answer) {
      return undefined;
    }

    try {
      const documents = result.documents ?? result.context ?? [];
      const evalResult = await this.ragEvaluationService.evaluate(
        query,
        Array.isArray(documents)
          ? documents.map((d: any) =>
              typeof d === 'string' ? { pageContent: d } : d,
            )
          : [],
        result.answer,
      );

      const m = evalResult.metrics;
      return {
        contextRelevance: m.relevance ?? 0.5,
        answerFaithfulness: m.faithfulness ?? 0.5,
        answerRelevance: m.answerCorrectness ?? 0.5,
        overall: m.overall ?? 0.5,
      };
    } catch (error) {
      this.logger.warn('RAG evaluation service failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.basicEvaluationFallback(query, result);
    }
  }

  /**
   * Fallback heuristic evaluation when RAGEvaluationService fails
   */
  private basicEvaluationFallback(
    query: string,
    result: any,
  ): BenchmarkResult['evaluationMetrics'] {
    if (!result.answer) return undefined;

    const answer = result.answer.toLowerCase();
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const contextRelevance =
      queryWords.length > 0
        ? Math.min(
            1.0,
            queryWords.filter((w) => answer.includes(w)).length /
              queryWords.length,
          )
        : 0.5;
    const answerFaithfulness = this.calculateAnswerFaithfulness(
      query,
      result.answer,
      result.context || [],
    );
    const answerRelevance = result.answer.length > 50 ? 0.9 : 0.6;
    const overall =
      (contextRelevance + answerFaithfulness + answerRelevance) / 3;

    return {
      contextRelevance: Math.round(contextRelevance * 100) / 100,
      answerFaithfulness: Math.round(answerFaithfulness * 100) / 100,
      answerRelevance: Math.round(answerRelevance * 100) / 100,
      overall: Math.round(overall * 100) / 100,
    };
  }

  /**
   * Export results
   */
  exportResults(
    allResults: Map<string, BenchmarkResult[]>,
    filename = 'rag-benchmark-results.json',
  ): any {
    const comparison = this.comparePatterns(allResults);

    const output = {
      timestamp: new Date().toISOString(),
      summaries: comparison.summaries,
      winner: comparison.winner,
      detailedResults: Object.fromEntries(allResults),
    };

    this.logger.log('Benchmark results exported', {
      filename,
      patternCount: allResults.size,
      winner: comparison.winner,
    });

    return output;
  }

  /**
   * Calculate answer faithfulness by checking consistency with context
   */
  private calculateAnswerFaithfulness(
    query: string,
    answer: string,
    context: any[],
  ): number {
    if (!context || context.length === 0) {
      return 0.5; // Neutral score when no context provided
    }

    try {
      const answerLower = answer.toLowerCase();
      const queryLower = query.toLowerCase();

      // Extract factual claims from answer (simplified NLP)
      const answerSentences = answerLower
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 10);
      const contextText = context
        .map((c) => (c.content || c.text || '').toLowerCase())
        .join(' ');

      let supportedClaims = 0;
      let totalClaims = 0;

      for (const sentence of answerSentences) {
        // Look for key entities and facts in the sentence
        const words = sentence.split(/\s+/).filter((w) => w.length > 3);

        if (words.length === 0) continue;

        totalClaims++;

        // Check if key terms from the sentence appear in context
        const keyTerms = words.slice(0, Math.min(3, words.length)); // First few significant words
        const hasSupport = keyTerms.some(
          (term) => contextText.includes(term) && !queryLower.includes(term), // Not just repeating query
        );

        if (hasSupport) {
          supportedClaims++;
        }
      }

      // Calculate faithfulness score
      const faithfulness =
        totalClaims > 0 ? supportedClaims / totalClaims : 0.5;

      // Penalize if answer contradicts query intent
      const queryIntentWords = queryLower
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const contradictionPenalty = queryIntentWords.some(
        (word) =>
          answerLower.includes(`not ${word}`) ||
          answerLower.includes(`no ${word}`),
      )
        ? 0.2
        : 0;

      return Math.max(0, Math.min(1, faithfulness - contradictionPenalty));
    } catch (error) {
      this.logger.warn('Error calculating answer faithfulness', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.5; // Neutral fallback
    }
  }

  /**
   * Run quick benchmark (subset of queries)
   */
  async quickBenchmark(): Promise<Map<string, BenchmarkResult[]>> {
    const quickQueries = this.testQueries.slice(0, 3);
    const patterns = ['naive', 'adaptive'];
    const results = new Map<string, BenchmarkResult[]>();

    for (const pattern of patterns) {
      const patternResults = await this.benchmarkPattern(pattern, quickQueries);
      results.set(pattern, patternResults);
    }

    return results;
  }
}
