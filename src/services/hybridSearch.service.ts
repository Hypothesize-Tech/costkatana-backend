import { SparseSearchService, SparseSearchResult } from './sparseSearch.service';
import { VectorStoreService } from './vectorStore.service';
import { loggingService } from './logging.service';
import { Document } from '@langchain/core/documents';

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
    };
}

/**
 * Hybrid search combining sparse (BM25) and dense (vector) search
 * Uses Reciprocal Rank Fusion (RRF) for result merging
 */
export class HybridSearchService {
    private static readonly DEFAULT_SPARSE_WEIGHT = 0.4;
    private static readonly DEFAULT_DENSE_WEIGHT = 0.6;
    private static readonly RRF_K = 60; // RRF constant

    /**
     * Perform hybrid search combining sparse and dense results
     */
    static async search(
        query: string,
        options: HybridSearchOptions = {}
    ): Promise<HybridSearchResult[]> {
        const startTime = Date.now();
        const limit = options.limit || 50;
        const sparseWeight = options.sparseWeight ?? this.DEFAULT_SPARSE_WEIGHT;
        const denseWeight = options.denseWeight ?? this.DEFAULT_DENSE_WEIGHT;

        try {
            loggingService.info('Starting hybrid search', {
                component: 'HybridSearchService',
                query: query.substring(0, 100),
                options
            });

            // Run sparse and dense searches in parallel
            const [sparseResults, denseResults] = await Promise.all([
                this.performSparseSearch(query, options),
                this.performDenseSearch(query, options)
            ]);

            // Merge results using RRF
            const mergedResults = this.mergeResultsWithRRF(
                sparseResults,
                denseResults,
                sparseWeight,
                denseWeight,
                limit
            );

            const elapsed = Date.now() - startTime;
            loggingService.info('Hybrid search completed', {
                component: 'HybridSearchService',
                query: query.substring(0, 100),
                resultsCount: mergedResults.length,
                sparseResults: sparseResults.length,
                denseResults: denseResults.length,
                elapsedMs: elapsed
            });

            return mergedResults;
        } catch (error) {
            loggingService.error('Hybrid search failed', {
                component: 'HybridSearchService',
                query: query.substring(0, 100),
                error: error instanceof Error ? error.message : 'Unknown'
            });

            // Fallback to sparse-only search
            const sparseResults = await this.performSparseSearch(query, options);
            return this.convertSparseToHybrid(sparseResults).slice(0, limit);
        }
    }

    /**
     * Perform sparse search
     */
    private static async performSparseSearch(
        query: string,
        options: HybridSearchOptions
    ): Promise<SparseSearchResult[]> {
        // Extract identifiers for exact matching
        const identifiers = SparseSearchService.extractIdentifiers(query);

        // Combine keyword search with exact identifier search
        const [keywordResults, exactResults] = await Promise.all([
            SparseSearchService.search(query, {
                repoFullName: options.repoFullName,
                language: options.language,
                chunkType: options.chunkType,
                filePath: options.filePath,
                userId: options.userId,
                limit: options.limit ? options.limit * 2 : 100
            }),
            identifiers.length > 0
                ? SparseSearchService.searchExactIdentifiers(identifiers, {
                      repoFullName: options.repoFullName,
                      language: options.language,
                      userId: options.userId,
                      limit: 20
                  })
                : Promise.resolve([])
        ]);

        // Combine and deduplicate
        const allResults = [...keywordResults, ...exactResults];
        const seen = new Set<string>();
        const uniqueResults: SparseSearchResult[] = [];

        for (const result of allResults) {
            if (!seen.has(result.chunkId)) {
                seen.add(result.chunkId);
                // Boost exact matches
                if (exactResults.some(r => r.chunkId === result.chunkId)) {
                    result.score = Math.min(result.score * 1.5, 1.0);
                }
                uniqueResults.push(result);
            }
        }

        return uniqueResults;
    }

    /**
     * Perform dense vector search
     */
    private static async performDenseSearch(
        query: string,
        options: HybridSearchOptions
    ): Promise<Array<{ chunkId: string; score: number; content: string; metadata: any }>> {
        try {
            const vectorStoreService = new VectorStoreService();
            await vectorStoreService.initialize();

            // Build filters for MongoDB
            const filters: any = {
                status: 'active'
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

            // Search using MongoDB vector search
            const limit = options.limit ? options.limit * 2 : 100;
            const documents = await vectorStoreService.searchMongoDB(query, limit, filters);

            // Convert to result format
            return documents.map((doc: Document) => {
                const metadata = doc.metadata || {};
                return {
                    chunkId: metadata._id || '',
                    score: metadata.score || 0,
                    content: doc.pageContent,
                    metadata: {
                        repoFullName: metadata.repoFullName,
                        filePath: metadata.filePath,
                        startLine: metadata.startLine,
                        endLine: metadata.endLine,
                        commitSha: metadata.commitSha,
                        chunkType: metadata.chunkType,
                        language: metadata.language,
                        astMetadata: metadata.astMetadata
                    }
                };
            });
        } catch (error) {
            loggingService.error('Dense search failed', {
                component: 'HybridSearchService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Merge sparse and dense results using Reciprocal Rank Fusion (RRF)
     */
    private static mergeResultsWithRRF(
        sparseResults: SparseSearchResult[],
        denseResults: Array<{ chunkId: string; score: number; content: string; metadata: any }>,
        sparseWeight: number,
        denseWeight: number,
        limit: number
    ): HybridSearchResult[] {
        const scoreMap = new Map<string, {
            chunkId: string;
            content: string;
            sparseScore: number;
            denseScore: number;
            sparseRank: number;
            denseRank: number;
            metadata: any;
        }>();

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
                    metadata: result.metadata
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
                    metadata: result.metadata
                });
            }
        });

        // Calculate RRF scores
        const finalResults: HybridSearchResult[] = Array.from(scoreMap.values()).map(item => {
            // RRF formula: score = 1 / (k + rank)
            const sparseRRF = item.sparseRank === Infinity ? 0 : 1 / (this.RRF_K + item.sparseRank);
            const denseRRF = item.denseRank === Infinity ? 0 : 1 / (this.RRF_K + item.denseRank);

            // Weighted combination
            const finalScore = (sparseRRF * sparseWeight) + (denseRRF * denseWeight);

            return {
                chunkId: item.chunkId,
                content: item.content,
                score: finalScore,
                sparseScore: item.sparseScore,
                denseScore: item.denseScore,
                metadata: item.metadata
            };
        });

        // Sort by final score and return top results
        return finalResults
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Convert sparse results to hybrid format (fallback)
     */
    private static convertSparseToHybrid(
        sparseResults: SparseSearchResult[]
    ): HybridSearchResult[] {
        return sparseResults.map(result => ({
            chunkId: result.chunkId,
            content: result.content,
            score: result.score,
            sparseScore: result.score,
            denseScore: 0,
            metadata: result.metadata
        }));
    }
}

