import { loggingService } from './logging.service';

export interface CostMetrics {
    embeddingsProduced: number;
    vectorQueries: number;
    tokensConsumed: number;
    generationCalls: number;
    totalCost: number; // USD
    costPerEmbedding: number;
    costPerQuery: number;
    costPerGeneration: number;
}

export interface BudgetAlert {
    repoFullName: string;
    currentCost: number;
    budgetLimit: number;
    percentageUsed: number;
    alertLevel: 'warning' | 'critical';
}

/**
 * Integration cost tracking service
 * Tracks and monitors costs for embeddings, queries, and generation
 */
export class IntegrationCostTrackingService {
    private static readonly EMBEDDING_COST_PER_1K = 0.0001; // Estimated cost per 1K embeddings
    private static readonly QUERY_COST_PER_1K = 0.00005; // Estimated cost per 1K queries
    private static readonly GENERATION_COST_PER_1K_TOKENS = 0.002; // Estimated cost per 1K tokens

    /**
     * Track embedding generation
     */
    static async trackEmbedding(
        repoFullName: string,
        userId: string,
        embeddingCount: number
    ): Promise<void> {
        try {
            const { CostTrackingRecord } = await import('../models/CostTrackingRecord');
            const cost = this.estimateEmbeddingCost(embeddingCount);

            await CostTrackingRecord.create({
                repoFullName,
                userId,
                operationType: 'embedding',
                count: embeddingCount,
                cost,
                timestamp: new Date()
            });

            loggingService.info('Embedding tracked in database', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                embeddingCount,
                cost
            });
        } catch (error) {
            loggingService.warn('Failed to track embedding in database', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                embeddingCount,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Track vector query
     */
    static async trackQuery(
        repoFullName: string,
        userId: string,
        tokensUsed: number
    ): Promise<void> {
        try {
            const { CostTrackingRecord } = await import('../models/CostTrackingRecord');
            const cost = this.estimateQueryCost(1); // Assuming 1 query

            await CostTrackingRecord.create({
                repoFullName,
                userId,
                operationType: 'query',
                count: 1,
                tokensUsed,
                cost,
                timestamp: new Date()
            });

            loggingService.info('Vector query tracked in database', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                tokensUsed,
                cost
            });
        } catch (error) {
            loggingService.warn('Failed to track query in database', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                tokensUsed,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Track code generation
     */
    static async trackGeneration(
        repoFullName: string,
        userId: string,
        tokensUsed: number
    ): Promise<void> {
        try {
            const { CostTrackingRecord } = await import('../models/CostTrackingRecord');
            const cost = this.estimateGenerationCost(tokensUsed);

            await CostTrackingRecord.create({
                repoFullName,
                userId,
                operationType: 'generation',
                count: 1,
                tokensUsed,
                cost,
                timestamp: new Date()
            });

            loggingService.info('Code generation tracked in database', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                tokensUsed,
                cost
            });
        } catch (error) {
            loggingService.warn('Failed to track generation in database', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                tokensUsed,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Estimate cost for embedding generation
     */
    static estimateEmbeddingCost(embeddingCount: number): number {
        return (embeddingCount / 1000) * this.EMBEDDING_COST_PER_1K;
    }

    /**
     * Estimate cost for vector query
     */
    static estimateQueryCost(queryCount: number): number {
        return (queryCount / 1000) * this.QUERY_COST_PER_1K;
    }

    /**
     * Estimate cost for code generation
     */
    static estimateGenerationCost(tokens: number): number {
        return (tokens / 1000) * this.GENERATION_COST_PER_1K_TOKENS;
    }

    /**
     * Get cost metrics for a repository
     */
    static async getCostMetrics(
        repoFullName: string,
        userId: string,
        period: 'day' | 'week' | 'month' = 'month'
    ): Promise<CostMetrics> {
        try {
            // Calculate date range based on period
            const endDate = new Date();
            const startDate = new Date();
            
            switch (period) {
                case 'day':
                    startDate.setDate(endDate.getDate() - 1);
                    break;
                case 'week':
                    startDate.setDate(endDate.getDate() - 7);
                    break;
                case 'month':
                    startDate.setMonth(endDate.getMonth() - 1);
                    break;
            }

            // Query cost tracking records from database
            const { CostTrackingRecord } = await import('../models/CostTrackingRecord');
            const costRecords = await CostTrackingRecord.find({
                repoFullName,
                userId,
                timestamp: {
                    $gte: startDate,
                    $lte: endDate
                }
            }).sort({ timestamp: -1 });

            // Aggregate metrics
            let embeddingsProduced = 0;
            let vectorQueries = 0;
            let tokensConsumed = 0;
            let generationCalls = 0;
            let totalCost = 0;

            for (const record of costRecords) {
                switch (record.operationType) {
                    case 'embedding':
                        embeddingsProduced += record.count || 0;
                        totalCost += record.cost || 0;
                        break;
                    case 'query':
                        vectorQueries += record.count || 0;
                        totalCost += record.cost || 0;
                        break;
                    case 'generation':
                        generationCalls += record.count || 0;
                        tokensConsumed += record.tokensUsed || 0;
                        totalCost += record.cost || 0;
                        break;
                }
            }

            loggingService.info('Cost metrics retrieved', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                period,
                totalCost,
                recordsProcessed: costRecords.length
            });

            return {
                embeddingsProduced,
                vectorQueries,
                tokensConsumed,
                generationCalls,
                totalCost,
                costPerEmbedding: this.EMBEDDING_COST_PER_1K / 1000,
                costPerQuery: this.QUERY_COST_PER_1K / 1000,
                costPerGeneration: this.GENERATION_COST_PER_1K_TOKENS / 1000
            };
        } catch (error) {
            loggingService.error('Failed to get cost metrics', {
                component: 'IntegrationCostTrackingService',
                repoFullName,
                userId,
                period,
                error: error instanceof Error ? error.message : String(error)
            });

            // Return zero metrics on error
            return {
                embeddingsProduced: 0,
                vectorQueries: 0,
                tokensConsumed: 0,
                generationCalls: 0,
                totalCost: 0,
                costPerEmbedding: this.EMBEDDING_COST_PER_1K / 1000,
                costPerQuery: this.QUERY_COST_PER_1K / 1000,
                costPerGeneration: this.GENERATION_COST_PER_1K_TOKENS / 1000
            };
        }
    }

    /**
     * Check budget and return alerts if exceeded
     */
    static async checkBudget(
        repoFullName: string,
        userId: string,
        budgetLimit: number
    ): Promise<BudgetAlert | null> {
        const metrics = await this.getCostMetrics(repoFullName, userId);
        const percentageUsed = (metrics.totalCost / budgetLimit) * 100;

        if (percentageUsed >= 100) {
            return {
                repoFullName,
                currentCost: metrics.totalCost,
                budgetLimit,
                percentageUsed,
                alertLevel: 'critical'
            };
        } else if (percentageUsed >= 80) {
            return {
                repoFullName,
                currentCost: metrics.totalCost,
                budgetLimit,
                percentageUsed,
                alertLevel: 'warning'
            };
        }

        return null;
    }
}

