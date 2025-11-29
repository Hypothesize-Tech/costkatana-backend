import { GitHubCodeChunkModel } from '../models/GitHubCodeChunk';
import { loggingService } from './logging.service';

export interface IndexingMetrics {
    recallAtK: number; // Recall@K for retrieval (if ground truth available)
    mrr: number; // Mean Reciprocal Rank
    embeddingComputeCost: number; // USD
    vectorDBCost: number; // USD
    averageLatency: number; // ms
    indexingTime: number; // ms per file
    chunkCounts: {
        total: number;
        byType: Record<string, number>;
        byLanguage: Record<string, number>;
    };
    searchPerformance: {
        averageLatency: number;
        p95Latency: number;
        queriesPerSecond: number;
    };
}

/**
 * Indexing metrics service
 * Tracks and reports metrics for indexing and search performance
 */
export class IndexingMetricsService {
    /**
     * Get indexing metrics for a repository
     */
    static async getMetrics(
        repoFullName?: string,
        userId?: string
    ): Promise<IndexingMetrics> {
        try {
            const query: Record<string, unknown> = {};
            if (repoFullName) {
                query.repoFullName = repoFullName;
            }
            if (userId) {
                query.userId = userId;
            }

            const totalChunks = await GitHubCodeChunkModel.countDocuments(query);
            
            // Get chunk counts by type
            const byType: Record<string, number> = {};
            const chunkTypes = ['function', 'class', 'method', 'doc', 'config', 'other'];
            for (const type of chunkTypes) {
                const count = await GitHubCodeChunkModel.countDocuments({
                    ...query,
                    chunkType: type
                });
                byType[type] = count;
            }

            // Get chunk counts by language
            const byLanguage: Record<string, number> = {};
            const languages = await GitHubCodeChunkModel.distinct('language', query);
            for (const lang of languages) {
                const count = await GitHubCodeChunkModel.countDocuments({
                    ...query,
                    language: lang
                });
                byLanguage[lang] = count;
            }

            return {
                recallAtK: 0, // Would be calculated from ground truth data
                mrr: 0, // Would be calculated from search results
                embeddingComputeCost: 0, // Would be tracked from embedding calls
                vectorDBCost: 0, // Would be tracked from vector DB usage
                averageLatency: 0, // Would be tracked from search operations
                indexingTime: 0, // Would be tracked from indexing operations
                chunkCounts: {
                    total: totalChunks,
                    byType,
                    byLanguage
                },
                searchPerformance: {
                    averageLatency: 0,
                    p95Latency: 0,
                    queriesPerSecond: 0
                }
            };
        } catch (error) {
            loggingService.error('Failed to get indexing metrics', {
                component: 'IndexingMetricsService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Track indexing operation
     */
    static trackIndexing(
        repoFullName: string,
        fileCount: number,
        chunkCount: number,
        duration: number
    ): void {
        loggingService.info('Indexing tracked', {
            component: 'IndexingMetricsService',
            repoFullName,
            fileCount,
            chunkCount,
            duration
        });
    }

    /**
     * Track search operation
     */
    static trackSearch(
        query: string,
        resultsCount: number,
        latency: number
    ): void {
        loggingService.info('Search tracked', {
            component: 'IndexingMetricsService',
            queryLength: query.length,
            resultsCount,
            latency
        });
    }
}

