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
    static trackEmbedding(
        repoFullName: string,
        userId: string,
        embeddingCount: number
    ): void {
        // In production, this would store in a database
        loggingService.info('Embedding tracked', {
            component: 'IntegrationCostTrackingService',
            repoFullName,
            userId,
            embeddingCount
        });
    }

    /**
     * Track vector query
     */
    static trackQuery(
        repoFullName: string,
        userId: string,
        tokensUsed: number
    ): void {
        loggingService.info('Vector query tracked', {
            component: 'IntegrationCostTrackingService',
            repoFullName,
            userId,
            tokensUsed
        });
    }

    /**
     * Track code generation
     */
    static trackGeneration(
        repoFullName: string,
        userId: string,
        tokensUsed: number
    ): void {
        loggingService.info('Code generation tracked', {
            component: 'IntegrationCostTrackingService',
            repoFullName,
            userId,
            tokensUsed
        });
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
        // In production, this would query a metrics database
        // For now, return placeholder
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

