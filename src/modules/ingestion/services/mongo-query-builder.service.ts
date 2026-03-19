/**
 * Mongo Query Builder Service
 * Translates ParsedQueryParams into MongoDB aggregation pipelines
 * for Usage and Telemetry collections.
 *
 * Handles:
 * - Date range filtering (createdAt)
 * - Model/provider filtering (exact match)
 * - Cost threshold filters ($gt, $lt)
 * - Token threshold filters
 * - Aggregation stages for totals/averages
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';
import type {
  ParsedQueryParams,
  StructuredQueryType,
} from './structured-query-detector.service';

export interface StructuredQueryOptions {
  userId?: string;
  projectId?: string;
  limit?: number;
}

export interface StructuredQueryResult {
  id: string;
  content: string;
  model?: string;
  service?: string;
  cost?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MongoQueryBuilderService {
  private readonly logger = new Logger(MongoQueryBuilderService.name);

  private static readonly DEFAULT_LIMIT = 20;

  constructor(
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
  ) {}

  /**
   * Build and execute an aggregation pipeline against Usage collection.
   * Returns formatted documents for RAG context assembly.
   */
  async executeQuery(
    params: ParsedQueryParams,
    queryType: StructuredQueryType,
    options: StructuredQueryOptions = {},
  ): Promise<StructuredQueryResult[]> {
    const pipeline = this.buildPipeline(params, queryType, options);

    try {
      const results = await this.usageModel
        .aggregate(pipeline)
        .exec();

      return this.formatResults(results, queryType);
    } catch (error) {
      this.logger.error('Structured query execution failed', {
        error: error instanceof Error ? error.message : String(error),
        queryType,
      });
      throw error;
    }
  }

  /**
   * Build MongoDB aggregation pipeline from parsed params.
   */
  buildPipeline(
    params: ParsedQueryParams,
    queryType: StructuredQueryType,
    options: StructuredQueryOptions,
  ): PipelineStage[] {
    const limit = options.limit ?? MongoQueryBuilderService.DEFAULT_LIMIT;
    const stages: PipelineStage[] = [];

    // $match stage
    const match: Record<string, unknown> = {};

    if (options.userId) {
      match.userId = new Types.ObjectId(options.userId);
    }

    if (options.projectId) {
      match.projectId = new Types.ObjectId(options.projectId);
    }

    if (params.models && params.models.length > 0) {
      match.model = { $in: params.models };
    }

    if (params.providers && params.providers.length > 0) {
      match.service = { $in: params.providers };
    }

    if (params.startDate || params.endDate) {
      match.createdAt = {};
      if (params.startDate) {
        (match.createdAt as Record<string, Date>).$gte = params.startDate;
      }
      if (params.endDate) {
        (match.createdAt as Record<string, Date>).$lte = params.endDate;
      }
    }

    if (params.costThreshold !== undefined && params.costOperator) {
      const op = params.costOperator === 'gt' ? '$gt' : params.costOperator === 'gte' ? '$gte' : params.costOperator === 'lt' ? '$lt' : '$lte';
      match.cost = { [op]: params.costThreshold };
    }

    if (params.tokenThreshold !== undefined && params.tokenOperator) {
      const op = params.tokenOperator === 'gt' ? '$gt' : params.tokenOperator === 'gte' ? '$gte' : params.tokenOperator === 'lt' ? '$lt' : '$lte';
      match.totalTokens = { [op]: params.tokenThreshold };
    }

    if (Object.keys(match).length > 0) {
      stages.push({ $match: match });
    }

    if (queryType === 'model_comparison') {
      stages.push(
        {
          $group: {
            _id: '$model',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            callCount: { $sum: 1 },
            avgCost: { $avg: '$cost' },
            samples: { $push: { cost: '$cost', tokens: '$totalTokens', createdAt: '$createdAt' } },
          },
        },
        { $limit: limit },
      );
    } else {
      stages.push(
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            model: 1,
            service: 1,
            cost: 1,
            totalTokens: 1,
            promptTokens: 1,
            completionTokens: 1,
            createdAt: 1,
          },
        },
      );
    }

    return stages;
  }

  private formatResults(
    results: Array<Record<string, unknown>>,
    queryType: StructuredQueryType,
  ): StructuredQueryResult[] {
    if (queryType === 'model_comparison') {
      return results.map((r) => {
        const id = (r._id as string) ?? 'unknown';
        const totalCost = (r.totalCost as number) ?? 0;
        const totalTokens = (r.totalTokens as number) ?? 0;
        const callCount = (r.callCount as number) ?? 0;
        const avgCost = (r.avgCost as number) ?? 0;
        const content = `Model: ${id}\nTotal cost: $${totalCost.toFixed(4)}\nTotal tokens: ${totalTokens}\nCalls: ${callCount}\nAverage cost per call: $${avgCost.toFixed(4)}`;
        return {
          id: `model_${String(id).replace(/\s/g, '_')}`,
          content,
          model: id as string,
          cost: totalCost,
          totalTokens,
          metadata: {
            callCount,
            avgCost,
            queryType: 'model_comparison',
          },
        };
      });
    }

    return results.map((r, idx) => {
      const id = (r._id as { toString?: () => string })?.toString?.() ?? `usage_${idx}`;
      const model = r.model as string;
      const service = r.service as string;
      const cost = (r.cost as number) ?? 0;
      const totalTokens = (r.totalTokens as number) ?? 0;
      const promptTokens = (r.promptTokens as number) ?? 0;
      const completionTokens = (r.completionTokens as number) ?? 0;
      const createdAt = r.createdAt as Date;

      const content = [
        `Model: ${model}`,
        `Service: ${service}`,
        `Cost: $${cost.toFixed(4)}`,
        `Tokens: ${totalTokens} (prompt: ${promptTokens}, completion: ${completionTokens})`,
        createdAt ? `Date: ${createdAt.toISOString()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        id: String(id),
        content,
        model,
        service,
        cost,
        totalTokens,
        promptTokens,
        completionTokens,
        createdAt,
        metadata: {
          queryType,
        },
      };
    });
  }
}
