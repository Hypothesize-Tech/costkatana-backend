import { loggingService } from './logging.service';
import { GitHubCodeChunkModel } from '../models/GitHubCodeChunk';

export interface IndexingHealth {
    queueLength: number;
    processingTime: number; // Average in ms
    errorRate: number; // 0-1
    successRate: number; // 0-1
    lastIndexedAt?: Date;
}

export interface SearchPerformance {
    averageLatency: number; // ms
    p95Latency: number; // ms
    recall: number; // 0-1, if ground truth available
    costPerQuery: number; // Estimated cost in USD
}

export interface GenerationMetrics {
    successRate: number; // 0-1
    applyRate: number; // 0-1, % of generated code that was applied
    ciPassRate: number; // 0-1, % that passed CI
    averageLatency: number; // ms
}

export interface ObservabilityMetrics {
    indexing: IndexingHealth;
    search: SearchPerformance;
    generation: GenerationMetrics;
    timestamp: Date;
}

/**
 * Integration observability service
 * Tracks and reports metrics for indexing, search, and generation
 */
export class IntegrationObservabilityService {
    /**
     * Get indexing health metrics
     */
    static async getIndexingHealth(
        repoFullName?: string,
        userId?: string
    ): Promise<IndexingHealth> {
        try {
            const query: Record<string, unknown> = {};
            if (repoFullName) {
                query.repoFullName = repoFullName;
            }
            if (userId) {
                query.userId = userId;
            }

            const totalChunks = await GitHubCodeChunkModel.countDocuments(query);
            const activeChunks = await GitHubCodeChunkModel.countDocuments({
                ...query,
                status: 'active'
            });

            // Get most recent indexing time
            const mostRecent = await GitHubCodeChunkModel.findOne(query)
                .sort({ indexedAt: -1 })
                .select('indexedAt')
                .lean();

            return {
                queueLength: 0, // Would be tracked separately in a queue system
                processingTime: 0, // Would be calculated from job metrics
                errorRate: 0, // Would be tracked from job failures
                successRate: activeChunks / Math.max(totalChunks, 1),
                lastIndexedAt: mostRecent?.indexedAt ? new Date(mostRecent.indexedAt) : undefined
            };
        } catch (error) {
            loggingService.error('Failed to get indexing health', {
                component: 'IntegrationObservabilityService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return {
                queueLength: 0,
                processingTime: 0,
                errorRate: 1,
                successRate: 0
            };
        }
    }

    /**
     * Track search performance
     */
    static trackSearchPerformance(
        query: string,
        latency: number,
        resultsCount: number
    ): void {
        // In production, this would store metrics in a time-series database
        loggingService.info('Search performance tracked', {
            component: 'IntegrationObservabilityService',
            queryLength: query.length,
            latency,
            resultsCount
        });
    }

    /**
     * Track generation metrics
     */
    static trackGeneration(
        success: boolean,
        applied: boolean,
        ciPassed: boolean,
        latency: number
    ): void {
        // In production, this would store metrics in a database
        loggingService.info('Generation tracked', {
            component: 'IntegrationObservabilityService',
            success,
            applied,
            ciPassed,
            latency
        });
    }

    /**
     * Get comprehensive observability metrics
     */
    static async getMetrics(
        repoFullName?: string,
        userId?: string
    ): Promise<ObservabilityMetrics> {
        const indexing = await this.getIndexingHealth(repoFullName, userId);

        return {
            indexing,
            search: {
                averageLatency: 0, // Would be calculated from tracked searches
                p95Latency: 0,
                recall: 0,
                costPerQuery: 0
            },
            generation: {
                successRate: 0,
                applyRate: 0,
                ciPassRate: 0,
                averageLatency: 0
            },
            timestamp: new Date()
        };
    }
}

