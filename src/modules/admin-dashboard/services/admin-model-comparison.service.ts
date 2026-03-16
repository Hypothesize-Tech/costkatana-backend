import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  ModelComparison,
  ServiceComparison,
  AdminModelComparisonFilters,
} from '../interfaces';

@Injectable()
export class AdminModelComparisonService {
  private readonly logger = new Logger(AdminModelComparisonService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Get model comparison statistics
   */
  async getModelComparison(
    filters: AdminModelComparisonFilters = {},
  ): Promise<ModelComparison[]> {
    try {
      const matchStage: any = {};

      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
      }

      if (filters.service) {
        matchStage.service = filters.service;
      }

      if (filters.userId) {
        matchStage.userId = filters.userId;
      }

      // Aggregate by model
      const modelStats = await this.usageModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$model',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
            totalResponseTime: { $sum: '$responseTime' },
          },
        },
        {
          $project: {
            model: '$_id',
            totalCost: 1,
            totalTokens: 1,
            totalRequests: 1,
            errorCount: 1,
            errorRate: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$errorCount', '$totalRequests'] },
                0,
              ],
            },
            averageResponseTime: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$totalResponseTime', '$totalRequests'] },
                0,
              ],
            },
            averageCostPerRequest: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$totalCost', '$totalRequests'] },
                0,
              ],
            },
            averageTokensPerRequest: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$totalTokens', '$totalRequests'] },
                0,
              ],
            },
          },
        },
      ]);

      // Calculate efficiency metrics
      const comparisons: ModelComparison[] = modelStats.map((stat: any) => {
        const costPerToken =
          stat.totalTokens > 0 ? stat.totalCost / stat.totalTokens : 0;
        const tokensPerDollar =
          stat.totalCost > 0 ? stat.totalTokens / stat.totalCost : 0;
        const requestsPerDollar =
          stat.totalCost > 0 ? stat.totalRequests / stat.totalCost : 0;

        // Calculate efficiency score using normalized metrics
        // Higher score = better efficiency (cost-effectiveness + reliability + performance)
        const efficiencyScore = this.calculateEfficiencyScore(
          tokensPerDollar,
          requestsPerDollar,
          stat.errorRate,
          stat.averageResponseTime,
          modelStats, // Pass all stats for normalization
        );

        return {
          model: stat.model || 'Unknown',
          totalCost: stat.totalCost || 0,
          totalTokens: stat.totalTokens || 0,
          totalRequests: stat.totalRequests || 0,
          errorCount: stat.errorCount || 0,
          errorRate: stat.errorRate || 0,
          averageResponseTime: stat.averageResponseTime || 0,
          averageCostPerRequest: stat.averageCostPerRequest || 0,
          averageTokensPerRequest: stat.averageTokensPerRequest || 0,
          efficiencyScore: Math.round(efficiencyScore * 100) / 100,
          costPerToken,
          tokensPerDollar: Math.round(tokensPerDollar),
          requestsPerDollar: Math.round(requestsPerDollar * 100) / 100,
        };
      });

      return comparisons.sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      this.logger.error('Error getting model comparison:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminModelComparisonService',
        operation: 'getModelComparison',
      });
      throw error;
    }
  }

  /**
   * Get service comparison statistics
   */
  async getServiceComparison(
    filters: AdminModelComparisonFilters = {},
  ): Promise<ServiceComparison[]> {
    try {
      const matchStage: any = {};

      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
      }

      if (filters.userId) {
        matchStage.userId = filters.userId;
      }

      // Aggregate by service
      const serviceStats = await this.usageModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$service',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
            totalResponseTime: { $sum: '$responseTime' },
            models: { $addToSet: '$model' },
          },
        },
        {
          $project: {
            service: '$_id',
            totalCost: 1,
            totalTokens: 1,
            totalRequests: 1,
            errorCount: 1,
            errorRate: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$errorCount', '$totalRequests'] },
                0,
              ],
            },
            averageResponseTime: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$totalResponseTime', '$totalRequests'] },
                0,
              ],
            },
            averageCostPerRequest: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$totalCost', '$totalRequests'] },
                0,
              ],
            },
            averageTokensPerRequest: {
              $cond: [
                { $gt: ['$totalRequests', 0] },
                { $divide: ['$totalTokens', '$totalRequests'] },
                0,
              ],
            },
            uniqueModels: '$models',
          },
        },
      ]);

      // Calculate efficiency metrics
      const comparisons: ServiceComparison[] = serviceStats.map((stat: any) => {
        const costPerToken =
          stat.totalTokens > 0 ? stat.totalCost / stat.totalTokens : 0;
        const tokensPerDollar =
          stat.totalCost > 0 ? stat.totalTokens / stat.totalCost : 0;
        const requestsPerDollar =
          stat.totalCost > 0 ? stat.totalRequests / stat.totalCost : 0;

        const efficiencyScore = Math.max(
          0,
          (tokensPerDollar / 10000) * 40 +
            (requestsPerDollar / 100) * 40 -
            stat.errorRate * 20,
        );

        return {
          service: stat.service || 'Unknown',
          totalCost: stat.totalCost || 0,
          totalTokens: stat.totalTokens || 0,
          totalRequests: stat.totalRequests || 0,
          errorCount: stat.errorCount || 0,
          errorRate: stat.errorRate || 0,
          averageResponseTime: stat.averageResponseTime || 0,
          averageCostPerRequest: stat.averageCostPerRequest || 0,
          averageTokensPerRequest: stat.averageTokensPerRequest || 0,
          efficiencyScore: Math.round(efficiencyScore * 100) / 100,
          uniqueModels: Array.isArray(stat.uniqueModels)
            ? stat.uniqueModels
            : [],
          costPerToken,
          tokensPerDollar: Math.round(tokensPerDollar),
          requestsPerDollar: Math.round(requestsPerDollar * 100) / 100,
        };
      });

      return comparisons.sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      this.logger.error('Error getting service comparison:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminModelComparisonService',
        operation: 'getServiceComparison',
      });
      throw error;
    }
  }

  /**
   * Calculate comprehensive efficiency score for a model or service
   */
  private calculateEfficiencyScore(
    tokensPerDollar: number,
    requestsPerDollar: number,
    errorRate: number,
    averageResponseTime: number,
    allStats: any[],
  ): number {
    // Calculate global statistics for normalization
    const allTokensPerDollar = allStats.map((s) =>
      s.totalTokens > 0 ? s.totalTokens / s.totalCost : 0,
    );
    const allRequestsPerDollar = allStats.map((s) =>
      s.totalCost > 0 ? s.totalRequests / s.totalCost : 0,
    );
    const allResponseTimes = allStats
      .map((s) => s.averageResponseTime || 0)
      .filter((t) => t > 0);

    const maxTokensPerDollar = Math.max(...allTokensPerDollar);
    const maxRequestsPerDollar = Math.max(...allRequestsPerDollar);
    const minResponseTime = Math.min(...allResponseTimes);

    // Cost-effectiveness score (40% weight)
    const tokenEfficiency =
      maxTokensPerDollar > 0 ? tokensPerDollar / maxTokensPerDollar : 0;
    const requestEfficiency =
      maxRequestsPerDollar > 0 ? requestsPerDollar / maxRequestsPerDollar : 0;
    const costScore = (tokenEfficiency * 0.6 + requestEfficiency * 0.4) * 0.4;

    // Reliability score (30% weight)
    const reliabilityScore = (1 - errorRate) * 0.3;

    // Performance score (30% weight)
    const responseTimeScore =
      minResponseTime > 0 && averageResponseTime > 0
        ? Math.max(0, minResponseTime / averageResponseTime) * 0.3
        : 0.15; // Default if no response time data

    // Combined score (0-100 scale)
    const rawScore = (costScore + reliabilityScore + responseTimeScore) * 100;

    return Math.max(0, Math.min(100, rawScore));
  }
}
