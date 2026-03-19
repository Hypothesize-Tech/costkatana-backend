/**
 * Hybrid Search Service for NestJS
 * Combines sparse (BM25) and dense (vector) search with Reciprocal Rank Fusion (RRF)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FaissVectorService,
  VectorSearchOptions,
} from './faiss-vector.service';
import { LangchainVectorStoreService } from './langchain-vector-store.service';
import {
  SparseSearchService,
  SparseSearchOptions,
} from './sparse-search.service';

export interface HybridSearchOptions {
  repoFullName?: string;
  language?: string;
  chunkType?: string;
  filePath?: string;
  userId?: string;
  limit?: number;
  sparseWeight?: number; // 0-1, default 0.4
  denseWeight?: number; // 0-1, default 0.6
}

export interface HybridSearchResult {
  chunkId: string;
  content: string;
  score: number;
  sparseScore: number;
  denseScore: number;
  metadata: {
    repoFullName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    commitSha: string;
    chunkType: string;
    language: string;
    astMetadata?: any;
    /** Timestamp when the chunk was indexed (for recency boost in reranking) */
    indexedAt?: number | Date;
  };
}

export interface SparseSearchResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: any;
}

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);
  private static readonly DEFAULT_SPARSE_WEIGHT = 0.4;
  private static readonly DEFAULT_DENSE_WEIGHT = 0.6;
  private static readonly RRF_K = 60; // RRF constant

  constructor(
    private configService: ConfigService,
    private faissVectorService: FaissVectorService,
    private langchainVectorStoreService: LangchainVectorStoreService,
    private sparseSearchService: SparseSearchService,
  ) {}

  /**
   * Perform hybrid search combining sparse and dense results
   */
  async search(
    query: string,
    options: HybridSearchOptions = {},
  ): Promise<HybridSearchResult[]> {
    const startTime = Date.now();
    const limit = options.limit || 50;
    const sparseWeight =
      options.sparseWeight ?? HybridSearchService.DEFAULT_SPARSE_WEIGHT;
    const denseWeight =
      options.denseWeight ?? HybridSearchService.DEFAULT_DENSE_WEIGHT;

    try {
      this.logger.log('Starting hybrid search', {
        query: query.substring(0, 100),
        options,
      });

      // Run sparse and dense searches in parallel
      const [sparseResults, denseResults] = await Promise.all([
        this.performSparseSearch(query, options),
        this.performDenseSearch(query, options),
      ]);

      // Merge results using RRF
      const mergedResults = this.mergeResultsWithRRF(
        sparseResults,
        denseResults,
        sparseWeight,
        denseWeight,
        limit,
      );

      const elapsed = Date.now() - startTime;
      this.logger.log('Hybrid search completed', {
        query: query.substring(0, 100),
        resultsCount: mergedResults.length,
        sparseResults: sparseResults.length,
        denseResults: denseResults.length,
        elapsedMs: elapsed,
      });

      return mergedResults;
    } catch (error) {
      this.logger.error('Hybrid search failed', {
        query: query.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to dense-only search
      try {
        const denseResults = await this.performDenseSearch(query, options);
        return this.convertDenseToHybrid(denseResults).slice(0, limit);
      } catch (fallbackError) {
        this.logger.error('Fallback search also failed', {
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        });
        return [];
      }
    }
  }

  /**
   * Perform sparse search using real BM25 via MongoDB text index (SparseSearchService)
   */
  private async performSparseSearch(
    query: string,
    options: HybridSearchOptions,
  ): Promise<SparseSearchResult[]> {
    try {
      const sparseOptions: SparseSearchOptions = {
        limit: options.limit ? options.limit * 2 : 100,
        repoFullName: options.repoFullName,
        language: options.language,
        chunkType: options.chunkType,
        filePath: options.filePath,
        userId: options.userId,
      };

      const results = await this.sparseSearchService.search(
        query,
        sparseOptions,
      );

      return results.map((r) => ({
        chunkId: r.chunkId,
        content: r.content,
        score: r.score,
        metadata: {
          ...r.metadata,
          astMetadata: (r.metadata as { astMetadata?: unknown })?.astMetadata,
        },
      }));
    } catch (error) {
      this.logger.error('Sparse search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Perform dense vector search
   */
  private async performDenseSearch(
    query: string,
    options: HybridSearchOptions,
  ): Promise<
    Array<{ chunkId: string; score: number; content: string; metadata: any }>
  > {
    try {
      const limit = options.limit ? options.limit * 2 : 100;

      // Build filters for vector search
      const filters: any = {
        status: 'active',
      };

      if (options.repoFullName) {
        filters.repoFullName = options.repoFullName;
      }

      if (options.language) {
        filters.language = options.language;
      }

      if (options.chunkType) {
        filters.chunkType = options.chunkType;
      }

      if (options.userId) {
        filters.userId = options.userId;
      }

      // Perform vector search
      const searchOptions: VectorSearchOptions = {
        k: limit,
        filter: filters,
        includeScores: true,
      };

      const results = await this.faissVectorService.search(
        query,
        searchOptions,
      );

      // Convert to result format
      return results.map((result) => {
        const metadata = result.document.metadata || {};
        return {
          chunkId: metadata._id || metadata.id || '',
          score: result.score,
          content: result.document.pageContent,
          metadata: {
            repoFullName: metadata.repoFullName,
            filePath: metadata.filePath,
            startLine: metadata.startLine,
            endLine: metadata.endLine,
            commitSha: metadata.commitSha,
            chunkType: metadata.chunkType,
            language: metadata.language,
            astMetadata: metadata.astMetadata,
            indexedAt:
              metadata._createdAt ?? metadata.indexedAt ?? metadata.createdAt,
          },
        };
      });
    } catch (error) {
      this.logger.error('Dense search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Merge sparse and dense results using Reciprocal Rank Fusion (RRF)
   */
  private mergeResultsWithRRF(
    sparseResults: SparseSearchResult[],
    denseResults: Array<{
      chunkId: string;
      score: number;
      content: string;
      metadata: any;
    }>,
    sparseWeight: number,
    denseWeight: number,
    limit: number,
  ): HybridSearchResult[] {
    const scoreMap = new Map<
      string,
      {
        chunkId: string;
        content: string;
        sparseScore: number;
        denseScore: number;
        sparseRank: number;
        denseRank: number;
        metadata: any;
      }
    >();

    // Process sparse results
    sparseResults.forEach((result, index) => {
      const existing = scoreMap.get(result.chunkId);
      if (existing) {
        existing.sparseScore = result.score;
        existing.sparseRank = index + 1;
      } else {
        scoreMap.set(result.chunkId, {
          chunkId: result.chunkId,
          content: result.content,
          sparseScore: result.score,
          denseScore: 0,
          sparseRank: index + 1,
          denseRank: Infinity,
          metadata: result.metadata,
        });
      }
    });

    // Process dense results
    denseResults.forEach((result, index) => {
      const existing = scoreMap.get(result.chunkId);
      if (existing) {
        existing.denseScore = result.score;
        existing.denseRank = index + 1;
      } else {
        scoreMap.set(result.chunkId, {
          chunkId: result.chunkId,
          content: result.content,
          sparseScore: 0,
          denseScore: result.score,
          sparseRank: Infinity,
          denseRank: index + 1,
          metadata: result.metadata,
        });
      }
    });

    // Calculate RRF scores
    const finalResults: HybridSearchResult[] = Array.from(
      scoreMap.values(),
    ).map((item) => {
      // RRF formula: score = 1 / (k + rank)
      const sparseRRF =
        item.sparseRank === Infinity
          ? 0
          : 1 / (HybridSearchService.RRF_K + item.sparseRank);
      const denseRRF =
        item.denseRank === Infinity
          ? 0
          : 1 / (HybridSearchService.RRF_K + item.denseRank);

      // Weighted combination
      const finalScore = sparseRRF * sparseWeight + denseRRF * denseWeight;

      return {
        chunkId: item.chunkId,
        content: item.content,
        score: finalScore,
        sparseScore: item.sparseScore,
        denseScore: item.denseScore,
        metadata: item.metadata,
      };
    });

    // Sort by final score and return top results
    return finalResults.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Convert dense results to hybrid format (fallback)
   */
  private convertDenseToHybrid(
    denseResults: Array<{
      chunkId: string;
      score: number;
      content: string;
      metadata: any;
    }>,
  ): HybridSearchResult[] {
    return denseResults.map((result) => ({
      chunkId: result.chunkId,
      content: result.content,
      score: result.score,
      sparseScore: 0,
      denseScore: result.score,
      metadata: result.metadata,
    }));
  }
}
