import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggingService } from '../../common/services/logging.service';
import { PricingService } from '../utils/services/pricing.service';
import {
  AICallRecord as AICallRecordModel,
  AICallRecordDocument,
} from '../../schemas/ai/ai-call-record.schema';
import type {
  AICallRecord,
  AICostSummary,
} from './interfaces/ai-cost-tracking.interface';

/** Fallback cost per 1K tokens when model is not in pricing registry (conservative estimate) */
const DEFAULT_COST_PER_1K_TOKENS = 0.01;

@Injectable()
export class AICostTrackingService {
  private readonly logger = new Logger(AICostTrackingService.name);

  constructor(
    private readonly loggingService: LoggingService,
    private readonly pricingService: PricingService,
    @InjectModel(AICallRecordModel.name)
    private readonly aiCallRecordModel: Model<AICallRecordDocument>,
  ) {}

  /**
   * Track an AI request with usage details
   */
  async trackRequest(
    prompt: { prompt: string; model: string; promptTokens?: number },
    response: {
      content: string;
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    },
    userId: string,
    metadata?: any,
  ): Promise<any> {
    try {
      // Calculate cost based on usage using PricingService
      const cost = this.calculateCost(
        prompt.model,
        response.usage.promptTokens,
        response.usage.completionTokens,
      );

      // Create usage record for storage (AICallRecord format)
      const usageRecord: AICallRecord = {
        timestamp: new Date(),
        service: 'ai_completion',
        operation: 'chat_completion',
        model: prompt.model,
        inputTokens: response.usage.promptTokens,
        outputTokens: response.usage.completionTokens,
        estimatedCost: cost,
        userId,
        metadata: {
          prompt: prompt.prompt,
          response: response.content,
          totalTokens: response.usage.totalTokens,
          ...metadata,
        },
      };

      // Persist to database
      await this.aiCallRecordModel.create({
        service: usageRecord.service,
        operation: usageRecord.operation,
        model: usageRecord.model,
        inputTokens: usageRecord.inputTokens,
        outputTokens: usageRecord.outputTokens,
        estimatedCost: usageRecord.estimatedCost,
        latency: usageRecord.latency,
        success: usageRecord.success,
        error: usageRecord.error,
        userId: usageRecord.userId,
        metadata: usageRecord.metadata,
      });

      this.loggingService.debug('AI request tracked', {
        userId,
        model: prompt.model,
        totalTokens: response.usage.totalTokens,
        cost,
      });

      return usageRecord;
    } catch (error) {
      this.loggingService.error('Failed to track AI request', error);
      throw error;
    }
  }

  /**
   * Calculate cost based on model and token usage using PricingService.
   * Falls back to conservative default when model is not in pricing registry.
   */
  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const estimate = this.pricingService.estimateCost(
      model,
      inputTokens,
      outputTokens,
    );
    if (estimate !== null) {
      return estimate.totalCost;
    }
    const totalTokens = inputTokens + outputTokens;
    return (totalTokens / 1000) * DEFAULT_COST_PER_1K_TOKENS;
  }

  /**
   * Track an internal AI call
   */
  async trackCall(record: Omit<AICallRecord, 'timestamp'>): Promise<void> {
    try {
      await this.aiCallRecordModel.create({
        service: record.service,
        operation: record.operation,
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        estimatedCost: record.estimatedCost,
        latency: record.latency,
        success: record.success,
        error: record.error,
        userId: record.userId,
        metadata: record.metadata,
      });

      this.loggingService.debug('Internal AI call tracked', {
        service: record.service,
        operation: record.operation,
        cost: record.estimatedCost,
      });
    } catch (error) {
      this.loggingService.error('Failed to track internal AI call', error);
    }
  }

  /**
   * Get cost summary for a time period
   */
  async getSummary(startDate: Date, endDate: Date): Promise<AICostSummary> {
    try {
      // Query database for records in the time range
      const relevantCalls = await this.aiCallRecordModel
        .find({
          createdAt: { $gte: startDate, $lte: endDate },
        })
        .sort({ estimatedCost: -1 })
        .limit(1000) // Limit for performance, get top expensive
        .lean();

      // Get aggregated data
      const aggregationResult = await this.aiCallRecordModel.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            totalCost: { $sum: '$estimatedCost' },
            byService: {
              $push: {
                service: '$service',
                cost: '$estimatedCost',
              },
            },
            byOperation: {
              $push: {
                operation: '$operation',
                cost: '$estimatedCost',
              },
            },
          },
        },
      ]);

      const aggData = aggregationResult[0] || {
        totalCalls: 0,
        totalCost: 0,
        byService: [],
        byOperation: [],
      };

      // Process service aggregation
      const byService: Record<string, { calls: number; cost: number }> = {};
      aggData.byService.forEach((item: any) => {
        if (!byService[item.service]) {
          byService[item.service] = { calls: 0, cost: 0 };
        }
        byService[item.service].calls++;
        byService[item.service].cost += item.cost;
      });

      // Process operation aggregation
      const byOperation: Record<string, { calls: number; cost: number }> = {};
      aggData.byOperation.forEach((item: any) => {
        if (!byOperation[item.operation]) {
          byOperation[item.operation] = { calls: 0, cost: 0 };
        }
        byOperation[item.operation].calls++;
        byOperation[item.operation].cost += item.cost;
      });

      // Get top 10 expensive calls
      const topExpensive = relevantCalls.slice(0, 10).map((call) => ({
        timestamp: call.createdAt,
        service: call.service,
        operation: call.operation,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        estimatedCost: call.estimatedCost,
        latency: call.latency,
        success: call.success,
        error: call.error,
        userId: call.userId,
        metadata: call.metadata,
      }));

      return {
        totalCalls: aggData.totalCalls,
        totalCost: aggData.totalCost,
        byService,
        byOperation,
        topExpensive,
      };
    } catch (error) {
      this.loggingService.error('Failed to get cost summary', error);
      return {
        totalCalls: 0,
        totalCost: 0,
        byService: {},
        byOperation: {},
        topExpensive: [],
      };
    }
  }

  /**
   * Get monthly summary
   */
  async getMonthlySummary(): Promise<AICostSummary> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.getSummary(startOfMonth, now);
  }

  /**
   * Get top cost drivers
   */
  async getTopCostDrivers(
    limit: number = 10,
  ): Promise<
    Array<{ service: string; operation: string; cost: number; calls: number }>
  > {
    const aggregationResult = await this.aiCallRecordModel.aggregate([
      {
        $group: {
          _id: { service: '$service', operation: '$operation' },
          cost: { $sum: '$estimatedCost' },
          calls: { $sum: 1 },
        },
      },
      { $sort: { cost: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          service: '$_id.service',
          operation: '$_id.operation',
          cost: 1,
          calls: 1,
        },
      },
    ]);
    return aggregationResult;
  }

  /**
   * Get service summary with avgLatency and failureRate
   */
  async getServiceSummary(): Promise<
    Record<
      string,
      { calls: number; cost: number; avgLatency: number; failureRate: number }
    >
  > {
    const aggregationResult = await this.aiCallRecordModel.aggregate([
      {
        $group: {
          _id: '$service',
          calls: { $sum: 1 },
          cost: { $sum: '$estimatedCost' },
          totalLatency: { $sum: { $ifNull: ['$latency', 0] } },
          failures: { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          service: '$_id',
          calls: 1,
          cost: 1,
          avgLatency: {
            $cond: [
              { $gt: ['$calls', 0] },
              { $divide: ['$totalLatency', '$calls'] },
              0,
            ],
          },
          failureRate: {
            $cond: [
              { $gt: ['$calls', 0] },
              { $multiply: [{ $divide: ['$failures', '$calls'] }, 100] },
              0,
            ],
          },
        },
      },
    ]);
    const result: Record<
      string,
      { calls: number; cost: number; avgLatency: number; failureRate: number }
    > = {};
    for (const row of aggregationResult) {
      result[row.service] = {
        calls: row.calls,
        cost: row.cost,
        avgLatency: row.avgLatency,
        failureRate: row.failureRate,
      };
    }
    return result;
  }

  /**
   * Clear old records
   */
  async clearOldRecords(daysToKeep: number = 30): Promise<{
    removed: number;
    remaining: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const deleteResult = await this.aiCallRecordModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });
    const remaining = await this.aiCallRecordModel.countDocuments();
    this.loggingService.info('Cleared old AI call records', {
      removed: deleteResult.deletedCount,
      remaining,
    });
    return { removed: deleteResult.deletedCount, remaining };
  }
}
