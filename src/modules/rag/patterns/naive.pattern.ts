import { Injectable, Inject } from '@nestjs/common';
import { BaseRAGPattern } from './base.pattern';
import { RetrieveModule } from '../modules/retrieve.module';
import { OrchestratorInput, PatternResult } from '../types/rag.types';

@Injectable()
export class NaivePattern extends BaseRAGPattern {
  constructor(
    @Inject(RetrieveModule)
    private readonly retrieveModule: RetrieveModule,
  ) {
    super('NaivePattern');
  }

  async execute(input: OrchestratorInput): Promise<PatternResult> {
    try {
      const startTime = Date.now();
      this.logger.debug('Executing naive RAG pattern', {
        query: input.query.substring(0, 50),
        contextSize: input.context ? Object.keys(input.context).length : 0,
      });

      // Simple retrieve → return pattern
      const retrieveResult = await this.retrieveModule.execute(input);

      // Enhance results with pattern-specific processing
      const enhancedDocuments = this.enhanceDocumentsForNaivePattern(
        retrieveResult.documents,
        input.query,
      );

      const executionTime = Date.now() - startTime;
      const confidence = this.calculateNaivePatternConfidence(
        retrieveResult,
        input,
      );

      return {
        documents: enhancedDocuments,
        reasoning: `Used naive retrieval pattern: direct vector search with ${retrieveResult.documents.length} retrieved documents. Pattern completed in ${executionTime}ms with ${confidence.toFixed(2)} confidence.`,
        confidence,
        metadata: {
          pattern: 'naive',
          steps: ['retrieve'],
          executionTime,
          retrieveResult: retrieveResult.metadata,
          documentsEnhanced:
            enhancedDocuments.length !== retrieveResult.documents.length,
          queryAnalysis: {
            length: input.query.length,
            hasCodeTerms: this.detectCodeTerms(input.query),
            hasTechnicalTerms: this.detectTechnicalTerms(input.query),
          },
        },
      };
    } catch (error: any) {
      this.logger.error('Naive pattern execution failed', {
        error: error.message,
      });
      return {
        documents: [],
        reasoning: `Naive pattern failed to retrieve documents: ${error.message}`,
        confidence: 0,
        metadata: {
          error: error.message,
          pattern: 'naive',
          steps: ['retrieve'],
          failed: true,
        },
      };
    }
  }

  private enhanceDocumentsForNaivePattern(
    documents: any[],
    query: string,
  ): any[] {
    return documents.map((doc, index) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        patternProcessed: true,
        naiveRank: index + 1,
        queryRelevance: this.calculateQueryRelevance(doc.content, query),
        contentQuality: this.assessContentQuality(doc.content),
        timestamp: new Date().toISOString(),
      },
    }));
  }

  private calculateNaivePatternConfidence(
    retrieveResult: any,
    input: OrchestratorInput,
  ): number {
    let confidence = retrieveResult.confidence;

    // Boost confidence for simple queries
    if (input.query.length < 200) {
      confidence += 0.1;
    }

    // Reduce confidence if no documents retrieved
    if (retrieveResult.documents.length === 0) {
      confidence = 0;
    }

    // Boost confidence for high-quality matches
    const avgScore =
      retrieveResult.documents.reduce(
        (sum: number, doc: any) => sum + (doc.metadata?.score || 0),
        0,
      ) / Math.max(retrieveResult.documents.length, 1);

    if (avgScore > 0.8) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  private calculateQueryRelevance(content: string, query: string): number {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2);
    const contentLower = content.toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matches++;
      }
    }

    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  private assessContentQuality(content: string): 'high' | 'medium' | 'low' {
    let score = 0;

    // Length assessment
    if (content.length > 1000) score += 1;
    else if (content.length > 500) score += 0.5;

    // Structure assessment
    if (content.includes('\n-') || content.includes('\n*')) score += 0.5; // Lists
    if (content.includes('```')) score += 0.5; // Code blocks
    if (content.match(/\d+\./g)) score += 0.5; // Numbered items

    // Content richness
    if (content.includes('example') || content.includes('Example'))
      score += 0.5;
    if (content.includes('important') || content.includes('note')) score += 0.5;

    if (score >= 2) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
  }

  private detectCodeTerms(query: string): boolean {
    const codeTerms = [
      'function',
      'class',
      'import',
      'const',
      'let',
      'var',
      'async',
      'await',
      'try',
      'catch',
    ];
    return codeTerms.some((term) => query.toLowerCase().includes(term));
  }

  private detectTechnicalTerms(query: string): boolean {
    const techTerms = [
      'api',
      'database',
      'server',
      'client',
      'endpoint',
      'token',
      'authentication',
    ];
    return techTerms.some((term) => query.toLowerCase().includes(term));
  }

  isSuitable(input: OrchestratorInput): boolean {
    // Naive pattern is suitable for simple queries
    return input.query.length < 200 && !input.preferredPattern;
  }

  getMetadata() {
    return {
      name: 'naive',
      description: 'Simple retrieve and return pattern',
      complexity: 'simple' as const,
      expectedLatency: 2000,
    };
  }
}
