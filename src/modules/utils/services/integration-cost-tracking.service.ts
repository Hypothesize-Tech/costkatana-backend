import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface CostMetrics {
  embeddingsProduced: number;
  vectorQueries: number;
  tokensConsumed: number;
  generationCalls: number;
  totalCost: number; // USD
  costPerEmbedding: number;
  costPerQuery: number;
  costPerGeneration: number;
}

interface BudgetAlert {
  repoFullName: string;
  currentCost: number;
  budgetLimit: number;
  percentageUsed: number;
  alertLevel: 'warning' | 'critical';
}

// Define the CostTrackingRecord schema inline for simplicity
interface CostTrackingRecord {
  repoFullName: string;
  userId: string;
  operationType: 'embedding' | 'query' | 'generation';
  count: number;
  tokensUsed?: number;
  cost: number;
  timestamp: Date;
}

/**
 * Integration cost tracking service
 * Tracks and monitors costs for embeddings, queries, and generation
 */
@Injectable()
export class IntegrationCostTrackingService {
  private readonly logger = new Logger(IntegrationCostTrackingService.name);

  private static readonly EMBEDDING_COST_PER_1K = 0.0001; // Estimated cost per 1K embeddings
  private static readonly QUERY_COST_PER_1K = 0.00005; // Estimated cost per 1K queries
  private static readonly GENERATION_COST_PER_1K_TOKENS = 0.002; // Estimated cost per 1K tokens

  constructor(
    @InjectModel('CostTrackingRecord')
    private costTrackingModel: Model<CostTrackingRecord>,
  ) {}

  /**
   * Track embedding generation
   */
  async trackEmbedding(
    repoFullName: string,
    userId: string,
    embeddingCount: number,
  ): Promise<void> {
    try {
      const cost = this.estimateEmbeddingCost(embeddingCount);

      await this.costTrackingModel.create({
        repoFullName,
        userId,
        operationType: 'embedding',
        count: embeddingCount,
        cost,
        timestamp: new Date(),
      });

      this.logger.log('Embedding tracked in database', {
        repoFullName,
        userId,
        embeddingCount,
        cost,
      });
    } catch (error) {
      this.logger.warn('Failed to track embedding in database', {
        repoFullName,
        userId,
        embeddingCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track vector query
   */
  async trackQuery(
    repoFullName: string,
    userId: string,
    tokensUsed: number,
  ): Promise<void> {
    try {
      const cost = this.estimateQueryCost(1); // Assuming 1 query

      await this.costTrackingModel.create({
        repoFullName,
        userId,
        operationType: 'query',
        count: 1,
        tokensUsed,
        cost,
        timestamp: new Date(),
      });

      this.logger.log('Vector query tracked in database', {
        repoFullName,
        userId,
        tokensUsed,
        cost,
      });
    } catch (error) {
      this.logger.warn('Failed to track query in database', {
        repoFullName,
        userId,
        tokensUsed,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track code generation
   */
  async trackGeneration(
    repoFullName: string,
    userId: string,
    tokensUsed: number,
  ): Promise<void> {
    try {
      const cost = this.estimateGenerationCost(tokensUsed);

      await this.costTrackingModel.create({
        repoFullName,
        userId,
        operationType: 'generation',
        count: 1,
        tokensUsed,
        cost,
        timestamp: new Date(),
      });

      this.logger.log('Code generation tracked in database', {
        repoFullName,
        userId,
        tokensUsed,
        cost,
      });
    } catch (error) {
      this.logger.warn('Failed to track generation in database', {
        repoFullName,
        userId,
        tokensUsed,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cost metrics for a repository
   */
  async getCostMetrics(
    repoFullName: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<CostMetrics> {
    try {
      const query: any = { repoFullName };
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = startDate;
        if (endDate) query.timestamp.$lte = endDate;
      }

      const records = await this.costTrackingModel.find(query).lean();

      let embeddingsProduced = 0;
      let vectorQueries = 0;
      let tokensConsumed = 0;
      let generationCalls = 0;
      let totalCost = 0;

      for (const record of records) {
        switch (record.operationType) {
          case 'embedding':
            embeddingsProduced += record.count;
            break;
          case 'query':
            vectorQueries += record.count;
            tokensConsumed += record.tokensUsed || 0;
            break;
          case 'generation':
            generationCalls += record.count;
            tokensConsumed += record.tokensUsed || 0;
            break;
        }
        totalCost += record.cost;
      }

      return {
        embeddingsProduced,
        vectorQueries,
        tokensConsumed,
        generationCalls,
        totalCost,
        costPerEmbedding:
          embeddingsProduced > 0 ? totalCost / embeddingsProduced : 0,
        costPerQuery: vectorQueries > 0 ? totalCost / vectorQueries : 0,
        costPerGeneration:
          generationCalls > 0 ? totalCost / generationCalls : 0,
      };
    } catch (error) {
      this.logger.error('Failed to get cost metrics', {
        repoFullName,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        embeddingsProduced: 0,
        vectorQueries: 0,
        tokensConsumed: 0,
        generationCalls: 0,
        totalCost: 0,
        costPerEmbedding: 0,
        costPerQuery: 0,
        costPerGeneration: 0,
      };
    }
  }

  /**
   * Check budget alerts for repositories
   */
  async checkBudgetAlerts(): Promise<BudgetAlert[]> {
    try {
      // Get repositories with high spending in the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const pipeline = [
        {
          $match: {
            timestamp: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: '$repoFullName',
            totalCost: { $sum: '$cost' },
          },
        },
        {
          $match: {
            totalCost: { $gt: 1.0 }, // Repositories with >$1 spending
          },
        },
      ];

      const results = await this.costTrackingModel.aggregate(pipeline);

      const alerts: BudgetAlert[] = [];

      for (const result of results) {
        const currentCost = result.totalCost;
        const budgetLimit = 10.0; // Default budget limit - could be configurable
        const percentageUsed = (currentCost / budgetLimit) * 100;

        if (percentageUsed >= 80) {
          alerts.push({
            repoFullName: result._id,
            currentCost,
            budgetLimit,
            percentageUsed,
            alertLevel: percentageUsed >= 95 ? 'critical' : 'warning',
          });
        }
      }

      return alerts;
    } catch (error) {
      this.logger.error('Failed to check budget alerts', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get spending trends for a repository
   */
  async getSpendingTrends(
    repoFullName: string,
    days: number = 30,
  ): Promise<Array<{ date: string; cost: number; operations: number }>> {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const pipeline = [
        {
          $match: {
            repoFullName,
            timestamp: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$timestamp',
              },
            },
            cost: { $sum: '$cost' },
            operations: { $sum: 1 },
          },
        },
        {
          $sort: { _id: 1 as const },
        },
      ];

      const results = await this.costTrackingModel.aggregate(pipeline);

      return results.map((result) => ({
        date: result._id,
        cost: result.cost,
        operations: result.operations,
      }));
    } catch (error) {
      this.logger.error('Failed to get spending trends', {
        repoFullName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Estimate embedding cost
   */
  private estimateEmbeddingCost(embeddingCount: number): number {
    return (
      (embeddingCount / 1000) *
      IntegrationCostTrackingService.EMBEDDING_COST_PER_1K
    );
  }

  /**
   * Estimate query cost
   */
  private estimateQueryCost(queryCount: number): number {
    return (
      (queryCount / 1000) * IntegrationCostTrackingService.QUERY_COST_PER_1K
    );
  }

  /**
   * Estimate generation cost
   */
  private estimateGenerationCost(tokensUsed: number): number {
    return (
      (tokensUsed / 1000) *
      IntegrationCostTrackingService.GENERATION_COST_PER_1K_TOKENS
    );
  }

  /**
   * Get cost breakdown by operation type
   */
  async getCostBreakdown(
    repoFullName: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Record<string, number>> {
    try {
      const query: any = { repoFullName };
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = startDate;
        if (endDate) query.timestamp.$lte = endDate;
      }

      const pipeline = [
        { $match: query },
        {
          $group: {
            _id: '$operationType',
            totalCost: { $sum: '$cost' },
          },
        },
      ];

      const results = await this.costTrackingModel.aggregate(pipeline);

      const breakdown: Record<string, number> = {
        embedding: 0,
        query: 0,
        generation: 0,
      };

      for (const result of results) {
        breakdown[result._id] = result.totalCost;
      }

      return breakdown;
    } catch (error) {
      this.logger.error('Failed to get cost breakdown', {
        repoFullName,
        error: error instanceof Error ? error.message : String(error),
      });
      return { embedding: 0, query: 0, generation: 0 };
    }
  }
}
