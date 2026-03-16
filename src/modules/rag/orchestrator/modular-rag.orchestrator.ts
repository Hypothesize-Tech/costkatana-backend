import { Injectable, Logger, Inject } from '@nestjs/common';
import { OrchestratorInput, RAGResult } from '../types/rag.types';
import { NaivePattern } from '../patterns/naive.pattern';
import { RAGEvaluationService } from '../evaluation/metrics';

@Injectable()
export class ModularRAGOrchestrator {
  private readonly logger = new Logger(ModularRAGOrchestrator.name);

  constructor(
    @Inject(NaivePattern)
    private readonly naivePattern: NaivePattern,
    @Inject(RAGEvaluationService)
    private readonly evaluationService: RAGEvaluationService,
  ) {}

  /**
   * Execute RAG pipeline for the given input
   */
  async execute(input: OrchestratorInput): Promise<RAGResult> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting RAG orchestration', {
        query: input.query.substring(0, 100),
        preferredPattern: input.preferredPattern,
        hasEvaluation: !!input.config?.evaluation,
      });

      // Pre-process input
      const processedInput = this.preprocessInput(input);

      // Select pattern
      const pattern = this.selectPattern(processedInput);
      this.logger.debug(`Selected pattern: ${pattern.getMetadata().name}`, {
        suitability: pattern.isSuitable(processedInput),
        patternMetadata: pattern.getMetadata(),
      });

      // Execute pattern
      const patternResult = await pattern.execute(processedInput);

      // Post-process results
      const enhancedDocuments = this.postprocessDocuments(
        patternResult.documents,
        processedInput,
      );

      // Extract sources with metadata
      const sources = this.extractSources(enhancedDocuments);

      // Calculate overall confidence
      const overallConfidence = this.calculateOverallConfidence(
        patternResult,
        processedInput,
      );

      // Prepare result
      const result: RAGResult = {
        success: true,
        documents: enhancedDocuments,
        sources,
        pattern: pattern.getMetadata().name,
        confidence: overallConfidence,
        metadata: {
          processingTime: Date.now() - startTime,
          totalDocuments: enhancedDocuments.length,
          patternUsed: pattern.getMetadata().name,
          queryProcessed: processedInput.query !== input.query,
          preprocessingTime: processedInput.metadata?.preprocessingTime || 0,
        },
      };

      // Optional evaluation
      if (input.config?.evaluation) {
        try {
          const evaluation = await this.evaluationService.evaluate(
            input.query,
            enhancedDocuments,
            input.config.generatedResponse ||
              'Generated response would go here', // Allow passing actual response
          );
          result.metadata.evaluation = evaluation.metrics;
          result.metadata.evaluationFeedback = Array.isArray(
            evaluation.feedback,
          )
            ? evaluation.feedback
            : [evaluation.feedback];
          result.metadata.evaluationRecommendations =
            evaluation.recommendations;

          this.logger.debug('RAG evaluation completed', {
            overall: evaluation.metrics.overall?.toFixed(3),
            faithfulness: evaluation.metrics.faithfulness?.toFixed(3),
            relevance: evaluation.metrics.relevance?.toFixed(3),
          });
        } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn('RAG evaluation failed', { error: err.message });
          result.metadata.evaluationError = err.message;
        }
      }

      this.logger.log('RAG orchestration completed', {
        success: true,
        documents: result.documents.length,
        pattern: result.pattern,
        confidence: result.confidence.toFixed(3),
        processingTime: result.metadata.processingTime,
        hasEvaluation: !!result.metadata.evaluation,
      });

      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('RAG orchestration failed', { error: err.message });

      return {
        success: false,
        documents: [],
        sources: [],
        pattern: 'failed',
        confidence: 0,
        metadata: {
          processingTime: Date.now() - startTime,
          totalDocuments: 0,
          patternUsed: 'error',
          error: err.message,
          errorType: err.constructor?.name ?? 'Error',
        },
      };
    }
  }

  private preprocessInput(input: OrchestratorInput): OrchestratorInput {
    const preprocessStart = Date.now();

    // Query cleaning and normalization
    let processedQuery = input.query.trim();

    // Remove excessive whitespace
    processedQuery = processedQuery.replace(/\s+/g, ' ');

    // Basic query expansion for common terms
    processedQuery = this.expandQueryTerms(processedQuery);

    const processed: OrchestratorInput = {
      ...input,
      query: processedQuery,
      metadata: {
        ...(input.metadata ?? {}),
        preprocessingTime: Date.now() - preprocessStart,
        originalQueryLength: input.query.length,
        processedQueryLength: processedQuery.length,
      },
    };

    return processed;
  }

  private expandQueryTerms(query: string): string {
    // Simple term expansion for common abbreviations
    const expansions: Record<string, string> = {
      api: 'API application programming interface',
      db: 'database',
      ml: 'machine learning',
      ai: 'artificial intelligence AI',
      nlp: 'natural language processing NLP',
    };

    let expanded = query;
    for (const [abbr, expansion] of Object.entries(expansions)) {
      // Only expand if it's a standalone word to avoid false positives
      const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
      if (regex.test(expanded)) {
        expanded = expanded.replace(regex, `${abbr} ${expansion}`);
      }
    }

    return expanded;
  }

  private postprocessDocuments(
    documents: any[],
    input: OrchestratorInput,
  ): any[] {
    return documents
      .map((doc, index) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          orchestratorRank: index + 1,
          finalScore: this.calculateFinalDocumentScore(doc, input, index),
          processingTimestamp: new Date().toISOString(),
          orchestratorProcessed: true,
        },
      }))
      .sort(
        (a, b) => (b.metadata.finalScore || 0) - (a.metadata.finalScore || 0),
      );
  }

  private calculateFinalDocumentScore(
    doc: any,
    input: OrchestratorInput,
    rank: number,
  ): number {
    let score = doc.metadata?.score || 0;

    // Boost for higher relevance to query
    if (doc.metadata?.queryRelevance) {
      score += doc.metadata.queryRelevance * 0.2;
    }

    // Boost for content quality
    if (doc.metadata?.contentQuality === 'high') {
      score += 0.1;
    } else if (doc.metadata?.contentQuality === 'medium') {
      score += 0.05;
    }

    // Penalize for low rank (recency bias in ranking)
    score -= rank * 0.01;

    return Math.max(0, Math.min(1, score));
  }

  private calculateOverallConfidence(
    patternResult: any,
    input: OrchestratorInput,
  ): number {
    let confidence = patternResult.confidence;

    // Boost confidence for successful retrieval
    if (patternResult.documents.length > 0) {
      confidence += 0.1;
    }

    // Boost confidence for high-quality documents
    const highQualityDocs = patternResult.documents.filter(
      (doc: any) => doc.metadata?.contentQuality === 'high',
    ).length;

    if (highQualityDocs > patternResult.documents.length * 0.5) {
      confidence += 0.1;
    }

    // Reduce confidence for short queries (less context)
    if (input.query.length < 50) {
      confidence -= 0.05;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Select the appropriate RAG pattern based on input
   */
  private selectPattern(input: OrchestratorInput) {
    // Check if specific pattern is requested
    if (input.preferredPattern) {
      switch (input.preferredPattern) {
        case 'naive':
          return this.naivePattern;
        // Add other patterns here when implemented
        default:
          this.logger.warn(
            `Unknown preferred pattern: ${input.preferredPattern}, falling back to naive`,
          );
          return this.naivePattern;
      }
    }

    // Auto-select based on suitability
    if (this.naivePattern.isSuitable(input)) {
      return this.naivePattern;
    }

    // Default fallback
    return this.naivePattern;
  }

  /**
   * Extract unique sources from documents
   */
  private extractSources(documents: any[]): string[] {
    const sources = new Set<string>();

    for (const doc of documents) {
      if (doc.metadata?.source) {
        sources.add(doc.metadata.source);
      }
    }

    return Array.from(sources);
  }
}
