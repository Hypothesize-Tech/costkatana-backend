import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  EndpointPerformance,
  EndpointTrend,
  TopEndpoints,
} from '../interfaces';

@Injectable()
export class AdminEndpointPerformanceService {
  private readonly logger = new Logger(AdminEndpointPerformanceService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Get endpoint performance metrics
   */
  async getEndpointPerformance(
    startDate?: Date,
    endDate?: Date,
  ): Promise<EndpointPerformance[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      const endpointStats = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$endpoint',
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
            avgResponseTime: { $avg: '$responseTime' },
            minResponseTime: { $min: '$responseTime' },
            maxResponseTime: { $max: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$errorCode', 0] }, 1, 0],
              },
            },
            lastRequest: { $max: '$createdAt' },
            firstRequest: { $min: '$createdAt' },
          },
        },
        {
          $project: {
            endpoint: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            avgResponseTime: 1,
            minResponseTime: 1,
            maxResponseTime: 1,
            errorCount: 1,
            successCount: 1,
            errorRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            successRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$successCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            throughput: {
              $cond: [
                { $eq: ['$firstRequest', '$lastRequest'] },
                0,
                {
                  $divide: [
                    '$totalRequests',
                    {
                      $divide: [
                        { $subtract: ['$lastRequest', '$firstRequest'] },
                        1000, // Convert to seconds
                      ],
                    },
                  ],
                },
              ],
            },
            lastRequest: 1,
          },
        },
        {
          $sort: { totalRequests: -1 },
        },
      ]);

      const endpoints: EndpointPerformance[] = endpointStats.map((stat) => ({
        endpoint: stat.endpoint,
        totalRequests: stat.totalRequests,
        totalCost: stat.totalCost,
        totalTokens: stat.totalTokens,
        avgResponseTime: stat.avgResponseTime,
        minResponseTime: stat.minResponseTime,
        maxResponseTime: stat.maxResponseTime,
        errorRate: stat.errorRate,
        successRate: stat.successRate,
        throughput: stat.throughput,
        lastRequest: stat.lastRequest,
      }));

      return endpoints;
    } catch (error) {
      this.logger.error('Error getting endpoint performance:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminEndpointPerformanceService',
        operation: 'getEndpointPerformance',
      });
      throw error;
    }
  }

  /**
   * Get endpoint performance trends
   */
  async getEndpointTrends(
    endpoint?: string,
    startDate?: Date,
    endDate?: Date,
    period: string = 'daily',
  ): Promise<EndpointTrend[]> {
    try {
      const matchQuery: any = {};
      if (endpoint) {
        matchQuery.endpoint = endpoint;
      }

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Group by period (daily, hourly, etc.)
      const dateFormat =
        period === 'hourly'
          ? {
              $dateToString: {
                format: '%Y-%m-%d %H:00:00',
                date: '$createdAt',
              },
            }
          : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };

      const trends = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: dateFormat,
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
            avgResponseTime: { $avg: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$errorCode', 0] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            date: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            avgResponseTime: 1,
            errorRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            successRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$successCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
          },
        },
        {
          $sort: { date: 1 },
        },
      ]);

      const endpointTrends: EndpointTrend[] = trends.map((trend) => ({
        date: trend.date,
        totalRequests: trend.totalRequests,
        totalCost: trend.totalCost,
        totalTokens: trend.totalTokens,
        avgResponseTime: trend.avgResponseTime,
        errorRate: trend.errorRate,
        successRate: trend.successRate,
      }));

      return endpointTrends;
    } catch (error) {
      this.logger.error('Error getting endpoint trends:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminEndpointPerformanceService',
        operation: 'getEndpointTrends',
      });
      throw error;
    }
  }

  /**
   * Get top performing endpoints
   */
  async getTopEndpoints(
    metric: string = 'requests',
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TopEndpoints[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      const sortField =
        metric === 'cost'
          ? 'totalCost'
          : metric === 'tokens'
            ? 'totalTokens'
            : 'totalRequests';

      const topEndpoints = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$endpoint',
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
            avgResponseTime: { $avg: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$errorCode', 0] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            endpoint: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            avgResponseTime: 1,
            errorRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            successRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$successCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
          },
        },
        {
          $sort: { [sortField]: -1 },
        },
        {
          $limit: limit,
        },
      ]);

      const endpoints: TopEndpoints[] = topEndpoints.map((endpoint) => ({
        endpoint: endpoint.endpoint,
        totalRequests: endpoint.totalRequests,
        totalCost: endpoint.totalCost,
        totalTokens: endpoint.totalTokens,
        avgResponseTime: endpoint.avgResponseTime,
        errorRate: endpoint.errorRate,
        successRate: endpoint.successRate,
        rank:
          topEndpoints.findIndex((e) => e.endpoint === endpoint.endpoint) + 1,
      }));

      return endpoints;
    } catch (error) {
      this.logger.error('Error getting top endpoints:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminEndpointPerformanceService',
        operation: 'getTopEndpoints',
      });
      throw error;
    }
  }

  /**
   * Get slowest endpoints
   */
  async getSlowestEndpoints(
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TopEndpoints[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      const slowestEndpoints = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$endpoint',
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
            avgResponseTime: { $avg: '$responseTime' },
            maxResponseTime: { $max: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$errorCode', 0] }, 1, 0],
              },
            },
          },
        },
        {
          $match: {
            totalRequests: { $gte: 10 }, // Only endpoints with at least 10 requests
          },
        },
        {
          $project: {
            endpoint: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            avgResponseTime: 1,
            maxResponseTime: 1,
            errorRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            successRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$successCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
          },
        },
        {
          $sort: { avgResponseTime: -1 },
        },
        {
          $limit: limit,
        },
      ]);

      const endpoints: TopEndpoints[] = slowestEndpoints.map((endpoint) => ({
        endpoint: endpoint.endpoint,
        totalRequests: endpoint.totalRequests,
        totalCost: endpoint.totalCost,
        totalTokens: endpoint.totalTokens,
        avgResponseTime: endpoint.avgResponseTime,
        errorRate: endpoint.errorRate,
        successRate: endpoint.successRate,
        rank:
          slowestEndpoints.findIndex((e) => e.endpoint === endpoint.endpoint) +
          1,
      }));

      return endpoints;
    } catch (error) {
      this.logger.error('Error getting slowest endpoints:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminEndpointPerformanceService',
        operation: 'getSlowestEndpoints',
      });
      throw error;
    }
  }

  /**
   * Get endpoints with highest error rates
   */
  async getErrorProneEndpoints(
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TopEndpoints[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      const errorEndpoints = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$endpoint',
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$tokens' },
            avgResponseTime: { $avg: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $eq: ['$errorCode', 0] }, 1, 0],
              },
            },
          },
        },
        {
          $match: {
            totalRequests: { $gte: 10 }, // Only endpoints with at least 10 requests
          },
        },
        {
          $project: {
            endpoint: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            avgResponseTime: 1,
            errorCount: 1,
            errorRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            successRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$successCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
          },
        },
        {
          $sort: { errorRate: -1 },
        },
        {
          $limit: limit,
        },
      ]);

      const endpoints: TopEndpoints[] = errorEndpoints.map((endpoint) => ({
        endpoint: endpoint.endpoint,
        totalRequests: endpoint.totalRequests,
        totalCost: endpoint.totalCost,
        totalTokens: endpoint.totalTokens,
        avgResponseTime: endpoint.avgResponseTime,
        errorRate: endpoint.errorRate,
        successRate: endpoint.successRate,
        rank:
          errorEndpoints.findIndex((e) => e.endpoint === endpoint.endpoint) + 1,
      }));

      return endpoints;
    } catch (error) {
      this.logger.error('Error getting error prone endpoints:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminEndpointPerformanceService',
        operation: 'getErrorProneEndpoints',
      });
      throw error;
    }
  }
}
