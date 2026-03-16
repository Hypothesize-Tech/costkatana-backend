import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  IntegrationStats,
  IntegrationTrend,
  IntegrationHealth,
} from '../interfaces';

@Injectable()
export class AdminIntegrationAnalyticsService {
  private readonly logger = new Logger(AdminIntegrationAnalyticsService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Get integration statistics
   */
  async getIntegrationStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<IntegrationStats[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Group by service to get integration stats
      const integrationStats = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$service',
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            uniqueUsers: { $addToSet: '$userId' },
            uniqueProjects: { $addToSet: '$projectId' },
            errorCount: {
              $sum: {
                $cond: ['$errorOccurred', 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $not: '$errorOccurred' }, 1, 0],
              },
            },
            avgResponseTime: { $avg: '$responseTime' },
            lastRequest: { $max: '$createdAt' },
            firstRequest: { $min: '$createdAt' },
          },
        },
        {
          $project: {
            service: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            uniqueUsersCount: { $size: '$uniqueUsers' },
            uniqueProjectsCount: { $size: '$uniqueProjects' },
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
            avgResponseTime: 1,
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

      const integrations: IntegrationStats[] = integrationStats.map((stat) => ({
        service: stat.service,
        totalRequests: stat.totalRequests,
        totalCost: stat.totalCost,
        totalTokens: stat.totalTokens,
        uniqueUsersCount: stat.uniqueUsersCount,
        uniqueProjectsCount: stat.uniqueProjectsCount,
        errorRate: stat.errorRate,
        successRate: stat.successRate,
        avgResponseTime: stat.avgResponseTime,
        throughput: stat.throughput,
        lastRequest: stat.lastRequest,
        health: this.mapHealthToStats(this.calculateIntegrationHealth(stat)),
      }));

      return integrations;
    } catch (error) {
      this.logger.error('Error getting integration stats:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminIntegrationAnalyticsService',
        operation: 'getIntegrationStats',
      });
      throw error;
    }
  }

  /**
   * Get integration trends
   */
  async getIntegrationTrends(
    service?: string,
    startDate?: Date,
    endDate?: Date,
    period: string = 'daily',
  ): Promise<IntegrationTrend[]> {
    try {
      const matchQuery: any = {};

      if (service) {
        matchQuery.service = service;
      }

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Group by period
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
            _id: {
              service: '$service',
              date: dateFormat,
            },
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            errorCount: {
              $sum: {
                $cond: ['$errorOccurred', 1, 0],
              },
            },
            successCount: {
              $sum: {
                $cond: [{ $not: '$errorOccurred' }, 1, 0],
              },
            },
            avgResponseTime: { $avg: '$responseTime' },
          },
        },
        {
          $project: {
            service: '$_id.service',
            date: '$_id.date',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
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
            avgResponseTime: 1,
          },
        },
        {
          $sort: { date: 1 },
        },
      ]);

      const integrationTrends: IntegrationTrend[] = trends.map((trend) => ({
        service: trend.service,
        date: trend.date,
        totalRequests: trend.totalRequests,
        totalCost: trend.totalCost,
        totalTokens: trend.totalTokens,
        errorRate: trend.errorRate,
        successRate: trend.successRate,
        avgResponseTime: trend.avgResponseTime,
      }));

      return integrationTrends;
    } catch (error) {
      this.logger.error('Error getting integration trends:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminIntegrationAnalyticsService',
        operation: 'getIntegrationTrends',
      });
      throw error;
    }
  }

  /**
   * Get integration health status
   */
  async getIntegrationHealth(): Promise<IntegrationHealth[]> {
    try {
      const integrations = await this.getIntegrationStats();

      const health: IntegrationHealth[] = integrations.map((integration) => {
        const healthScore = this.calculateHealthScore(integration);

        const healthMapped: 'healthy' | 'degraded' | 'down' =
          integration.health === 'unhealthy'
            ? 'down'
            : integration.health === 'degraded'
              ? 'degraded'
              : integration.health === 'healthy'
                ? 'healthy'
                : 'degraded'; // unknown -> degraded

        return {
          service: integration.service,
          health: healthMapped,
          healthScore,
          issues: this.identifyHealthIssues(integration),
          recommendations: this.generateHealthRecommendations(integration),
          lastChecked: new Date(),
          uptime: this.calculateUptime(integration),
        };
      });

      return health.sort((a, b) => (a.healthScore ?? 0) - (b.healthScore ?? 0)); // Sort by health score (lower is better)
    } catch (error) {
      this.logger.error('Error getting integration health:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminIntegrationAnalyticsService',
        operation: 'getIntegrationHealth',
      });
      throw error;
    }
  }

  /**
   * Get top integrations by usage
   */
  async getTopIntegrations(
    metric: string = 'requests',
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<IntegrationStats[]> {
    try {
      const integrations = await this.getIntegrationStats(startDate, endDate);

      const sortField =
        metric === 'cost'
          ? 'totalCost'
          : metric === 'tokens'
            ? 'totalTokens'
            : metric === 'users'
              ? 'uniqueUsersCount'
              : 'totalRequests';

      return integrations
        .sort((a, b) => (b as any)[sortField] - (a as any)[sortField])
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting top integrations:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminIntegrationAnalyticsService',
        operation: 'getTopIntegrations',
      });
      throw error;
    }
  }

  /**
   * Get integrations with high error rates
   */
  async getIntegrationsWithHighErrors(
    threshold: number = 10,
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<IntegrationStats[]> {
    try {
      const integrations = await this.getIntegrationStats(startDate, endDate);

      return integrations
        .filter((integration) => integration.errorRate > threshold)
        .sort((a, b) => b.errorRate - a.errorRate)
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting integrations with high errors:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminIntegrationAnalyticsService',
        operation: 'getIntegrationsWithHighErrors',
      });
      throw error;
    }
  }

  /**
   * Get integrations with performance issues
   */
  async getIntegrationsWithPerformanceIssues(
    responseTimeThreshold: number = 5000, // 5 seconds
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<IntegrationStats[]> {
    try {
      const integrations = await this.getIntegrationStats(startDate, endDate);

      return integrations
        .filter(
          (integration) => integration.avgResponseTime > responseTimeThreshold,
        )
        .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting integrations with performance issues:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminIntegrationAnalyticsService',
        operation: 'getIntegrationsWithPerformanceIssues',
      });
      throw error;
    }
  }

  /**
   * Calculate integration health based on metrics
   */
  private calculateIntegrationHealth(
    stat: any,
  ): 'healthy' | 'warning' | 'critical' | 'unknown' {
    if (stat.totalRequests === 0) {
      return 'unknown';
    }

    const healthScore = this.calculateHealthScore(stat);

    if (healthScore >= 80) return 'healthy';
    if (healthScore >= 60) return 'warning';
    return 'critical';
  }

  /**
   * Map internal health to IntegrationStats health type
   */
  private mapHealthToStats(
    health: 'healthy' | 'warning' | 'critical' | 'unknown',
  ): 'unknown' | 'healthy' | 'degraded' | 'unhealthy' {
    if (health === 'warning') return 'degraded';
    if (health === 'critical') return 'unhealthy';
    return health;
  }

  /**
   * Calculate health score (0-100, higher is better)
   */
  private calculateHealthScore(stat: any): number {
    if (stat.totalRequests === 0) return 0;

    let score = 100;

    // Error rate penalty (max 40 points)
    const errorPenalty = Math.min(stat.errorRate * 4, 40);
    score -= errorPenalty;

    // Response time penalty (max 30 points)
    const avgResponseTime = stat.avgResponseTime || 0;
    let responseTimePenalty = 0;
    if (avgResponseTime > 10000)
      responseTimePenalty = 30; // > 10s
    else if (avgResponseTime > 5000)
      responseTimePenalty = 20; // > 5s
    else if (avgResponseTime > 2000) responseTimePenalty = 10; // > 2s
    score -= responseTimePenalty;

    // Low usage penalty (max 10 points)
    if (stat.totalRequests < 10) score -= 10;

    // Recency bonus (max 10 points)
    const daysSinceLastRequest = stat.lastRequest
      ? (Date.now() - new Date(stat.lastRequest).getTime()) /
        (1000 * 60 * 60 * 24)
      : 999;
    if (daysSinceLastRequest < 1)
      score += 10; // Used today
    else if (daysSinceLastRequest < 7) score += 5; // Used this week

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Identify health issues
   */
  private identifyHealthIssues(stat: any): string[] {
    const issues: string[] = [];

    if (stat.errorRate > 5) {
      issues.push(`High error rate: ${stat.errorRate.toFixed(1)}%`);
    }

    if (stat.avgResponseTime > 5000) {
      issues.push(
        `Slow response time: ${(stat.avgResponseTime / 1000).toFixed(1)}s average`,
      );
    }

    if (stat.totalRequests < 10) {
      issues.push('Low usage volume');
    }

    const daysSinceLastRequest = stat.lastRequest
      ? (Date.now() - new Date(stat.lastRequest).getTime()) /
        (1000 * 60 * 60 * 24)
      : 999;

    if (daysSinceLastRequest > 30) {
      issues.push('Not used recently');
    }

    return issues;
  }

  /**
   * Generate health recommendations
   */
  private generateHealthRecommendations(stat: any): string[] {
    const recommendations: string[] = [];

    if (stat.errorRate > 5) {
      recommendations.push('Investigate and fix error causes');
      recommendations.push('Implement retry mechanisms');
    }

    if (stat.avgResponseTime > 5000) {
      recommendations.push('Optimize API calls and caching');
      recommendations.push('Consider rate limiting adjustments');
    }

    if (stat.totalRequests < 10) {
      recommendations.push('Monitor usage patterns');
      recommendations.push('Consider deprecation if no longer needed');
    }

    const daysSinceLastRequest = stat.lastRequest
      ? (Date.now() - new Date(stat.lastRequest).getTime()) /
        (1000 * 60 * 60 * 24)
      : 999;

    if (daysSinceLastRequest > 30) {
      recommendations.push('Review if integration is still needed');
    }

    return recommendations;
  }

  /**
   * Calculate uptime (simplified - based on error rates)
   */
  private calculateUptime(stat: any): number {
    if (stat.totalRequests === 0) return 0;

    // Simple uptime calculation: 100% - error rate
    return Math.max(0, 100 - stat.errorRate);
  }
}
