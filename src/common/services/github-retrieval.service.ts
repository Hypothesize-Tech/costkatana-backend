/**
 * GitHub Retrieval Service for NestJS
 * Unified retrieval service for GitHub code that orchestrates hybrid search, reranking, and context assembly
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export interface GitHubRetrievalOptions {
  repoFullName?: string;
  language?: string;
  chunkType?: 'function' | 'class' | 'method' | 'file' | 'block';
  filePath?: string;
  userId?: string;
  limit?: number;
  rerank?: boolean;
  rerankTopK?: number;
  useLLMReranking?: boolean;
  maxContextTokens?: number;
  includeProvenance?: boolean;
  prioritizeIntegrationPoints?: boolean;
  sparseWeight?: number;
  denseWeight?: number;
}

export interface GitHubRetrievalResult {
  assembledContext: AssembledContext;
  rawResults: HybridSearchResult[];
  rerankedResults?: HybridSearchResult[];
  exactMatches?: Array<{
    chunkId: string;
    filePath: string;
    startLine: number;
    endLine: number;
    symbolName?: string;
    symbolType?: string;
  }>;
  metadata: {
    query: string;
    totalCandidates: number;
    rerankedCount?: number;
    assemblyTime: number;
    searchTime: number;
  };
}

export interface HybridSearchResult {
  chunkId: string;
  content: string;
  score: number;
  relevanceScore?: number;
  rank?: number;
  title?: string;
  description?: string;
  code?: string;
  metadata: {
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    repoFullName: string;
    symbolName?: string;
    symbolType?: string;
    chunkType: string;
    lastModified?: number;
  };
}

export interface AssembledContext {
  context: string;
  tokens: number;
  chunks: Array<{
    chunkId: string;
    content: string;
    score: number;
    metadata: HybridSearchResult['metadata'];
  }>;
  provenance?: Array<{
    source: string;
    confidence: number;
    reasoning: string;
  }>;
}

@Injectable()
export class GitHubRetrievalService {
  private readonly logger = new Logger(GitHubRetrievalService.name);

  private stats = {
    totalQueries: 0,
    totalSearchTimeMs: 0,
    totalAssemblyTimeMs: 0,
    cacheHits: 0,
  };

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Retrieve code context for a query
   */
  async retrieve(
    query: string,
    options: GitHubRetrievalOptions = {},
  ): Promise<GitHubRetrievalResult> {
    const startTime = Date.now();
    const searchStartTime = Date.now();

    try {
      this.logger.log('Starting GitHub retrieval', {
        query: query.substring(0, 100),
        options,
      });

      // Step 1: Hybrid search (sparse + dense)
      const hybridResults = await this.performHybridSearch(query, {
        repoFullName: options.repoFullName,
        language: options.language,
        chunkType: options.chunkType,
        filePath: options.filePath,
        userId: options.userId,
        limit: options.limit || 200, // Get more for reranking
        sparseWeight: options.sparseWeight,
        denseWeight: options.denseWeight,
      });

      const searchTime = Date.now() - searchStartTime;

      // Step 2: Extract identifiers for exact matching
      const identifiers = this.extractIdentifiers(query);
      let exactMatches: GitHubRetrievalResult['exactMatches'] = [];

      if (identifiers.length > 0) {
        try {
          const exactResults = await this.performExactSearch(
            identifiers[0],
            'function', // Default to function, could be enhanced
            {
              repoFullName: options.repoFullName,
              language: options.language,
              userId: options.userId,
              limit: 5,
            },
          );

          exactMatches = exactResults.map((result) => ({
            chunkId: result.chunkId,
            filePath: result.metadata.filePath,
            startLine: result.metadata.startLine,
            endLine: result.metadata.endLine,
            symbolName: result.metadata.symbolName,
            symbolType: result.metadata.symbolType,
          }));
        } catch (error) {
          this.logger.warn('Exact search failed', {
            query: query.substring(0, 100),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Step 3: Optional reranking
      let rerankedResults: HybridSearchResult[] | undefined;
      if (options.rerank && hybridResults.length > 0) {
        rerankedResults = await this.performReranking(
          query,
          hybridResults,
          options.rerankTopK || 10,
          options.useLLMReranking,
        );
      }

      // Step 4: Context assembly
      const assemblyStartTime = Date.now();
      const assembledContext = await this.assembleContext(
        query,
        rerankedResults || hybridResults,
        {
          maxContextTokens: options.maxContextTokens || 4000,
          includeProvenance: options.includeProvenance,
          prioritizeIntegrationPoints: options.prioritizeIntegrationPoints,
        },
      );

      const assemblyTime = Date.now() - assemblyStartTime;
      const totalTime = Date.now() - startTime;

      this.stats.totalQueries += 1;
      this.stats.totalSearchTimeMs += searchTime;
      this.stats.totalAssemblyTimeMs += assemblyTime;

      this.logger.log('GitHub retrieval completed', {
        query: query.substring(0, 100),
        totalCandidates: hybridResults.length,
        rerankedCount: rerankedResults?.length,
        assemblyTime,
        searchTime,
        totalTime,
      });

      return {
        assembledContext,
        rawResults: hybridResults,
        rerankedResults,
        exactMatches,
        metadata: {
          query,
          totalCandidates: hybridResults.length,
          rerankedCount: rerankedResults?.length,
          assemblyTime,
          searchTime,
        },
      };
    } catch (error) {
      this.logger.error('GitHub retrieval failed', {
        query: query.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Perform hybrid search (returns empty until vector/search service is integrated)
   */
  private async performHybridSearch(
    query: string,
    options: GitHubRetrievalOptions,
  ): Promise<HybridSearchResult[]> {
    this.logger.debug(
      'Hybrid search requires vector database integration (Pinecone, Weaviate, or Elasticsearch). Returning empty results.',
    );
    return [];
  }

  /**
   * Perform exact search (returns empty until search service is integrated)
   */
  private async performExactSearch(
    symbolName: string,
    symbolType: string,
    options: any,
  ): Promise<HybridSearchResult[]> {
    this.logger.debug(
      'Exact search requires search service integration (Elasticsearch, OpenSearch, or GitHub Code Search API). Returning empty results.',
    );
    return [];
  }

  /**
   * Perform reranking with semantic relevance scoring
   */
  private async performReranking(
    query: string,
    results: HybridSearchResult[],
    topK: number,
    useLLM?: boolean,
  ): Promise<HybridSearchResult[]> {
    if (results.length === 0) return [];

    const queryTerms = this.extractQueryTerms(query);

    // Calculate relevance scores for each result
    const scoredResults = results.map((result) => ({
      ...result,
      relevanceScore: this.calculateRelevanceScore(result, queryTerms),
    }));

    // Sort by combined score (original score + relevance score)
    const reranked = scoredResults
      .sort((a, b) => {
        const scoreA = (a.score || 0) + a.relevanceScore;
        const scoreB = (b.score || 0) + b.relevanceScore;
        return scoreB - scoreA;
      })
      .slice(0, topK);

    // Update scores to reflect reranking
    reranked.forEach((result, index) => {
      result.score = Math.max(result.score || 0, 1.0 - index * 0.1); // Boost top results
      result.rank = index + 1;
    });

    this.logger.debug('Reranking completed', {
      query: query.substring(0, 50),
      originalCount: results.length,
      finalCount: reranked.length,
      useLLM,
      topRelevanceScore: reranked[0]?.relevanceScore || 0,
    });

    return reranked;
  }

  /**
   * Extract meaningful terms from query for relevance scoring
   */
  private extractQueryTerms(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter((term) => term.length > 2) // Filter out short terms
      .filter((term) => !this.isStopWord(term)); // Remove stop words
  }

  /**
   * Check if a term is a common stop word
   */
  private isStopWord(term: string): boolean {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'up',
      'about',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'among',
      'this',
      'that',
      'these',
      'those',
      'i',
      'me',
      'my',
      'myself',
      'we',
      'our',
      'ours',
      'ourselves',
      'you',
      'your',
      'yours',
      'yourself',
      'yourselves',
      'he',
      'him',
      'his',
      'himself',
      'she',
      'her',
      'hers',
      'herself',
      'it',
      'its',
      'itself',
      'they',
      'them',
      'their',
      'theirs',
      'themselves',
      'what',
      'which',
      'who',
      'whom',
      'whose',
      'this',
      'that',
      'these',
      'those',
      'am',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'having',
      'do',
      'does',
      'did',
      'doing',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'ought',
    ]);
    return stopWords.has(term);
  }

  /**
   * Calculate relevance score based on term frequency and importance
   */
  private calculateRelevanceScore(
    result: HybridSearchResult,
    queryTerms: string[],
  ): number {
    let score = 0;
    const content =
      `${result.title ?? ''} ${result.description ?? ''} ${result.content ?? result.code ?? ''}`.toLowerCase();

    for (const term of queryTerms) {
      // Exact matches get higher score
      const exactMatches = (
        content.match(new RegExp(`\\b${term}\\b`, 'gi')) || []
      ).length;
      score += exactMatches * 2;

      // Partial matches get lower score
      const partialMatches = (content.match(new RegExp(term, 'gi')) || [])
        .length;
      score += (partialMatches - exactMatches) * 1;

      // Boost for matches in title
      if ((result.title ?? result.content).toLowerCase().includes(term)) {
        score += 3;
      }

      // Boost for matches in code
      if (result.code && result.code.toLowerCase().includes(term)) {
        score += 2;
      }
    }

    // Boost for results with higher original scores
    score += (result.score || 0) * 0.5;

    // Boost for more recent results (assuming timestamp is available)
    const lastModified = result.metadata?.lastModified;
    if (lastModified !== undefined) {
      const daysSinceModified =
        (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
      if (daysSinceModified < 30) {
        score += Math.max(0, 2 - daysSinceModified / 15); // Boost recent results
      }
    }

    return score;
  }

  /**
   * Assemble context from search results
   */
  private async assembleContext(
    query: string,
    results: HybridSearchResult[],
    options: {
      maxContextTokens?: number;
      includeProvenance?: boolean;
      prioritizeIntegrationPoints?: boolean;
    },
  ): Promise<AssembledContext> {
    const maxTokens = options.maxContextTokens || 4000;
    let totalTokens = 0;
    const selectedChunks: AssembledContext['chunks'] = [];
    const contextParts: string[] = [];

    // Sort by score and prioritize integration points if requested
    const sortedResults = [...results].sort((a, b) => {
      if (options.prioritizeIntegrationPoints) {
        // Prioritize files that are likely integration points
        const aIsIntegration = this.isIntegrationPoint(a.metadata.filePath);
        const bIsIntegration = this.isIntegrationPoint(b.metadata.filePath);

        if (aIsIntegration && !bIsIntegration) return -1;
        if (!aIsIntegration && bIsIntegration) return 1;
      }

      return b.score - a.score;
    });

    for (const result of sortedResults) {
      const chunkTokens = this.estimateTokens(result.content);

      if (totalTokens + chunkTokens > maxTokens) {
        break;
      }

      selectedChunks.push({
        chunkId: result.chunkId,
        content: result.content,
        score: result.score,
        metadata: result.metadata,
      });

      contextParts.push(result.content);
      totalTokens += chunkTokens;
    }

    const assembledContext: AssembledContext = {
      context: contextParts.join('\n\n'),
      tokens: totalTokens,
      chunks: selectedChunks,
    };

    if (options.includeProvenance) {
      assembledContext.provenance = this.generateProvenance(
        query,
        selectedChunks,
      );
    }

    return assembledContext;
  }

  /**
   * Extract identifiers from query for exact matching
   */
  private extractIdentifiers(query: string): string[] {
    // Extract function names, class names, variable names, etc.
    const patterns = [
      /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /\bconst\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /\blet\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, // Function calls
    ];

    const identifiers = new Set<string>();

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(query)) !== null) {
        if (match[1] && match[1].length > 2) {
          identifiers.add(match[1]);
        }
      }
    }

    return Array.from(identifiers);
  }

  /**
   * Check if a file path represents an integration point
   */
  private isIntegrationPoint(filePath: string): boolean {
    const integrationPatterns = [
      /api/i,
      /service/i,
      /controller/i,
      /route/i,
      /middleware/i,
      /config/i,
      /index/i,
      /main/i,
    ];

    return integrationPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * Generate provenance information
   */
  private generateProvenance(
    query: string,
    chunks: AssembledContext['chunks'],
  ): AssembledContext['provenance'] {
    return chunks.map((chunk) => ({
      source: `${chunk.metadata.repoFullName}:${chunk.metadata.filePath}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`,
      confidence: chunk.score,
      reasoning: `Retrieved via hybrid search for query: "${query.substring(0, 50)}..."`,
    }));
  }

  /**
   * Estimate token count for a string
   */
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get retrieval statistics
   */
  getStatistics(): {
    totalQueries: number;
    averageSearchTime: number;
    averageAssemblyTime: number;
    cacheHitRate: number;
    mostCommonLanguages: string[];
  } {
    const q = this.stats.totalQueries || 1;
    return {
      totalQueries: this.stats.totalQueries,
      averageSearchTime: this.stats.totalSearchTimeMs / q,
      averageAssemblyTime: this.stats.totalAssemblyTimeMs / q,
      cacheHitRate: this.stats.cacheHits / q,
      mostCommonLanguages: [],
    };
  }
}
