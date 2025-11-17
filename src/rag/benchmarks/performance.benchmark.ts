import { modularRAGOrchestrator } from '../index';
import { RAGContext, RAGPatternType } from '../types/rag.types';
import { ragEvaluator, EvaluationInput } from '../evaluation/metrics';
import { loggingService } from '../../services/logging.service';

/**
 * Performance benchmarking for RAG patterns
 */

export interface BenchmarkResult {
  pattern: RAGPatternType;
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
  pattern: RAGPatternType;
  avgLatency: number;
  avgCost: number;
  avgQuality: number;
  totalQueries: number;
  successRate: number;
}

export class RAGBenchmark {
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

  /**
   * Benchmark a single pattern
   */
  async benchmarkPattern(
    pattern: RAGPatternType,
    queries: string[] = this.testQueries
  ): Promise<BenchmarkResult[]> {
    loggingService.info(`Benchmarking ${pattern} pattern`, {
      queryCount: queries.length,
    });

    const results: BenchmarkResult[] = [];

    for (const query of queries) {
      try {
        const context: RAGContext = {
          userId: 'benchmark-user',
          conversationId: `benchmark-${pattern}-${Date.now()}`,
        };

        const startTime = Date.now();
        const result = await modularRAGOrchestrator.execute({
          query,
          context,
          preferredPattern: pattern,
        });
        const latency = Date.now() - startTime;

        // Evaluate quality
        let evaluationMetrics;
        if (result.success && result.documents.length > 0) {
          const evalInput: EvaluationInput = {
            query,
            answer: result.answer,
            documents: result.documents,
          };

          const metrics = await ragEvaluator.evaluate(evalInput);
          evaluationMetrics = {
            contextRelevance: metrics.contextRelevance,
            answerFaithfulness: metrics.answerFaithfulness,
            answerRelevance: metrics.answerRelevance,
            overall: metrics.overall,
          };
        }

        const benchmarkResult: BenchmarkResult = {
          pattern,
          query,
          latency,
          documentsRetrieved: result.documents.length,
          answerLength: result.answer.length,
          estimatedCost: this.estimateCost(pattern, result.metadata as unknown as Record<string, unknown>),
          evaluationMetrics,
        };

        results.push(benchmarkResult);

        loggingService.info(`Benchmark query completed`, {
          pattern,
          query: query.substring(0, 50),
          latency,
          quality: evaluationMetrics?.overall,
        });

        // Delay between queries to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        loggingService.error(`Benchmark query failed`, {
          pattern,
          query,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Benchmark all patterns
   */
  async benchmarkAllPatterns(): Promise<Map<RAGPatternType, BenchmarkResult[]>> {
    const patterns: RAGPatternType[] = ['naive', 'adaptive', 'iterative', 'recursive'];
    const results = new Map<RAGPatternType, BenchmarkResult[]>();

    for (const pattern of patterns) {
      const patternResults = await this.benchmarkPattern(pattern);
      results.set(pattern, patternResults);
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
      successful.reduce((sum, r) => sum + r.latency, 0) / successful.length;

    const avgCost =
      successful.reduce((sum, r) => sum + r.estimatedCost, 0) / successful.length;

    const withMetrics = successful.filter((r) => r.evaluationMetrics);
    const avgQuality =
      withMetrics.length > 0
        ? withMetrics.reduce((sum, r) => sum + (r.evaluationMetrics?.overall ?? 0), 0) /
          withMetrics.length
        : 0;

    return {
      pattern,
      avgLatency,
      avgCost,
      avgQuality,
      totalQueries: results.length,
      successRate: successful.length / results.length,
    };
  }

  /**
   * Compare patterns
   */
  comparePatterns(
    allResults: Map<RAGPatternType, BenchmarkResult[]>
  ): {
    summaries: BenchmarkSummary[];
    winner: {
      latency: RAGPatternType;
      cost: RAGPatternType;
      quality: RAGPatternType;
      balanced: RAGPatternType;
    };
  } {
    const summaries: BenchmarkSummary[] = [];

    allResults.forEach((results, pattern) => {
      summaries.push(this.generateSummary(results));
    });

    // Find winners
    const sortedByLatency = [...summaries].sort((a, b) => a.avgLatency - b.avgLatency);
    const sortedByCost = [...summaries].sort((a, b) => a.avgCost - b.avgCost);
    const sortedByQuality = [...summaries].sort((a, b) => b.avgQuality - a.avgQuality);

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
        latency: sortedByLatency[0].pattern,
        cost: sortedByCost[0].pattern,
        quality: sortedByQuality[0].pattern,
        balanced: balanced[0].pattern,
      },
    };
  }

  /**
   * Estimate cost based on pattern and usage
   */
  private estimateCost(pattern: RAGPatternType, metadata: Record<string, unknown> | { [key: string]: unknown }): number {
    // Cost estimates (in cents) based on AWS Bedrock Nova Micro pricing
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
        const iterations = (metadata.iterationsCompleted as number) ?? 2;
        estimatedCalls = iterations * 2; // Rewrite + generation per iteration
        estimatedEmbeddings = iterations;
        break;
      case 'recursive':
        const subQuestions = (metadata.subQuestionsCount as number) ?? 3;
        estimatedCalls = subQuestions + 2; // Per sub-question + synthesis
        estimatedEmbeddings = subQuestions + 1;
        break;
    }

    // Assume average of 500 tokens per call
    return estimatedCalls * modelCallCost * 0.5 + estimatedEmbeddings * embeddingCost * 0.1;
  }

  /**
   * Export results to JSON
   */
  exportResults(
    allResults: Map<RAGPatternType, BenchmarkResult[]>,
    filename = 'rag-benchmark-results.json'
  ): void {
    const comparison = this.comparePatterns(allResults);

    const output = {
      timestamp: new Date().toISOString(),
      summaries: comparison.summaries,
      winner: comparison.winner,
      detailedResults: Object.fromEntries(allResults),
    };

    loggingService.info('Benchmark results', output);
  }

  /**
   * Run quick benchmark (subset of queries)
   */
  async quickBenchmark(): Promise<Map<RAGPatternType, BenchmarkResult[]>> {
    const quickQueries = this.testQueries.slice(0, 3);
    const patterns: RAGPatternType[] = ['naive', 'adaptive'];
    const results = new Map<RAGPatternType, BenchmarkResult[]>();

    for (const pattern of patterns) {
      const patternResults = await this.benchmarkPattern(pattern, quickQueries);
      results.set(pattern, patternResults);
    }

    return results;
  }
}

export const ragBenchmark = new RAGBenchmark();

