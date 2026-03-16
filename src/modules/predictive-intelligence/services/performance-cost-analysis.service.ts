import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import {
  QualityScore,
  QualityScoreDocument,
} from '@/schemas/analytics/quality-score.schema';

export interface PerformanceMetrics {
  latency: number;
  errorRate: number;
  qualityScore: number;
  throughput: number;
  successRate: number;
  retryRate: number;
}

export interface CostPerformanceCorrelation {
  service: string;
  model: string;
  costPerRequest: number;
  costPerToken: number;
  totalRequests?: number;
  performance: PerformanceMetrics;
  efficiency: {
    costEfficiencyScore: number;
    performanceRating: 'excellent' | 'good' | 'fair' | 'poor';
    recommendation: string;
    optimizationPotential: number;
  };
  tradeoffs: {
    costVsLatency: number;
    costVsQuality: number;
    costVsReliability: number;
  };
}

export interface OptimizationOpportunity {
  id: string;
  type:
    | 'model_switch'
    | 'parameter_tuning'
    | 'request_optimization'
    | 'caching';
  title: string;
  description: string;
  currentCost: number;
  projectedCost: number;
  savings: number;
  savingsPercentage: number;
  performanceImpact: { latency: number; quality: number; reliability: number };
  implementationComplexity: 'low' | 'medium' | 'high';
  riskAssessment: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
    mitigation: string[];
  };
  timeline: string;
  priority: number;
}

export interface ServiceComparison {
  services: CostPerformanceCorrelation[];
  bestValue: {
    service: string;
    model: string;
    reason: string;
    costSavings: number;
    performanceImpact: number;
  };
  recommendations: Array<{
    type: 'switch_service' | 'optimize_usage' | 'adjust_parameters';
    priority: 'high' | 'medium' | 'low';
    description: string;
    expectedSavings: number;
    implementationEffort: 'easy' | 'moderate' | 'complex';
    riskLevel: 'low' | 'medium' | 'high';
  }>;
}

export interface PerformanceTrend {
  period: string;
  metrics: PerformanceMetrics & { cost: number; volume: number };
  trend: 'improving' | 'degrading' | 'stable';
  alerts: Array<{
    type: 'performance_degradation' | 'cost_spike' | 'error_increase';
    severity: 'low' | 'medium' | 'high';
    message: string;
    suggestedActions: string[];
  }>;
}

const CACHE_SIZE = 500;
const USAGE_LIMIT_TRENDS = 10000;
const BATCH_SIZE = 100;

type LeanUsage = {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  service?: string;
  model?: string;
  createdAt: Date;
  cost: number;
  totalTokens?: number;
  responseTime?: number;
  metadata?: Record<string, unknown>;
};

type UsageWithMetrics = LeanUsage & {
  latency?: number;
  errorRate?: number;
  qualityScore?: number;
  retryCount?: number;
  successRate?: number;
};
const MAX_DB_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 300000;

@Injectable()
export class PerformanceCostAnalysisService {
  private readonly logger = new Logger(PerformanceCostAnalysisService.name);
  private calculationCache = new Map<string, unknown>();
  private dbFailureCount = 0;
  private lastDbFailureTime = 0;

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(QualityScore.name)
    private qualityScoreModel: Model<QualityScoreDocument>,
  ) {}

  async analyzeCostPerformanceCorrelation(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      services?: string[];
      models?: string[];
      tags?: string[];
    } = {},
  ): Promise<CostPerformanceCorrelation[]> {
    try {
      const {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate = new Date(),
        services,
        models,
        tags,
      } = options;

      const matchStage: Record<string, unknown> = {
        userId: new Types.ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate },
      };
      if (services?.length) matchStage.service = { $in: services };
      if (models?.length) matchStage.model = { $in: models };
      if (tags?.length) matchStage.tags = { $in: tags };

      if (this.isDbCircuitBreakerOpen()) {
        throw new Error('Database circuit breaker is open');
      }

      const [aggregationResult] = await this.usageModel.aggregate([
        { $match: matchStage },
        {
          $facet: {
            correlationData: [
              {
                $group: {
                  _id: { service: '$service', model: '$model' },
                  totalCost: { $sum: '$cost' },
                  totalRequests: { $sum: 1 },
                  totalTokens: { $sum: '$totalTokens' },
                  avgResponseTime: {
                    $avg: {
                      $ifNull: [
                        '$responseTime',
                        { $ifNull: ['$metadata.responseTime', 1000] },
                      ],
                    },
                  },
                  errorCount: {
                    $sum: {
                      $cond: [{ $ifNull: ['$metadata.error', false] }, 1, 0],
                    },
                  },
                  latencies: {
                    $push: {
                      $ifNull: [
                        '$responseTime',
                        { $ifNull: ['$metadata.responseTime', 1000] },
                      ],
                    },
                  },
                  costs: { $push: '$cost' },
                },
              },
              {
                $project: {
                  _id: 0,
                  service: '$_id.service',
                  model: '$_id.model',
                  totalCost: 1,
                  totalRequests: 1,
                  totalTokens: 1,
                  costPerRequest: { $divide: ['$totalCost', '$totalRequests'] },
                  costPerToken: {
                    $divide: [
                      '$totalCost',
                      {
                        $cond: [
                          { $gt: ['$totalTokens', 0] },
                          '$totalTokens',
                          1,
                        ],
                      },
                    ],
                  },
                  avgLatency: '$avgResponseTime',
                  errorRate: {
                    $multiply: [
                      { $divide: ['$errorCount', '$totalRequests'] },
                      100,
                    ],
                  },
                  latencies: 1,
                  costs: 1,
                },
              },
              { $sort: { totalCost: -1 } },
              { $limit: 20 },
            ],
          },
        },
      ]);

      const correlationData =
        (aggregationResult?.correlationData as Array<
          Record<string, unknown>
        >) || [];
      const correlationPromises = correlationData.map(
        async (data: Record<string, unknown>) => {
          const cacheKey = `correlation_${data.service}_${data.model}_${data.totalRequests}_${data.avgLatency}`;
          if (this.calculationCache.has(cacheKey)) {
            return this.calculationCache.get(
              cacheKey,
            ) as CostPerformanceCorrelation;
          }

          const avgLatency = (data.avgLatency as number) ?? 1000;
          const errorRate = (data.errorRate as number) ?? 0;
          const costPerRequest = (data.costPerRequest as number) ?? 0;
          const costPerToken = (data.costPerToken as number) ?? 0;
          const totalRequests = (data.totalRequests as number) ?? 1;

          const performance: PerformanceMetrics = {
            latency: avgLatency,
            errorRate,
            qualityScore: this.calculateQualityScoreOptimized(
              avgLatency,
              errorRate,
            ),
            throughput: totalRequests / 24,
            successRate: 100 - errorRate,
            retryRate: 0,
          };

          const costEfficiencyScore =
            this.calculateCostEfficiencyScoreOptimized(
              costPerRequest,
              performance,
            );
          const performanceRating =
            this.getPerformanceRatingOptimized(performance);
          const optimizationPotential =
            this.calculateOptimizationPotentialOptimized(
              performance,
              costPerRequest,
            );
          const recommendation = this.generateRecommendationOptimized(
            data.service as string,
            data.model as string,
            performance,
            costEfficiencyScore,
          );

          const correlation: CostPerformanceCorrelation = {
            service: data.service as string,
            model: data.model as string,
            costPerRequest,
            costPerToken,
            totalRequests,
            performance,
            efficiency: {
              costEfficiencyScore,
              performanceRating,
              recommendation,
              optimizationPotential,
            },
            tradeoffs: {
              costVsLatency: this.calculateTradeoffOptimized(
                costPerRequest,
                performance.latency,
              ),
              costVsQuality: this.calculateTradeoffOptimized(
                costPerRequest,
                performance.qualityScore,
              ),
              costVsReliability: this.calculateTradeoffOptimized(
                costPerRequest,
                performance.successRate,
              ),
            },
          };

          if (this.calculationCache.size >= CACHE_SIZE) {
            const firstKey = this.calculationCache.keys().next().value;
            if (firstKey) this.calculationCache.delete(firstKey);
          }
          this.calculationCache.set(cacheKey, correlation);
          return correlation;
        },
      );

      const correlations = await Promise.all(correlationPromises);
      this.dbFailureCount = 0;
      return correlations;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Error analyzing cost-performance correlation', {
        error: error instanceof Error ? error.message : String(error),
        failureCount: this.dbFailureCount,
      });
      throw error;
    }
  }

  async identifyOptimizationOpportunities(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      minSavings?: number;
      tags?: string[];
    } = {},
  ): Promise<OptimizationOpportunity[]> {
    try {
      const {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate = new Date(),
        minSavings = 50,
        tags,
      } = options;

      const correlations = await this.analyzeCostPerformanceCorrelation(
        userId,
        {
          startDate,
          endDate,
          tags,
        },
      );

      const modelSwitch = this.identifyModelSwitchOpportunities(correlations);
      const parameterTuning =
        this.identifyParameterTuningOpportunities(correlations);
      const requestOpt =
        this.identifyRequestOptimizationOpportunities(correlations);

      const opportunities = [...modelSwitch, ...parameterTuning, ...requestOpt];
      return opportunities
        .filter((opp) => opp.savings >= minSavings)
        .sort((a, b) => b.priority - a.priority);
    } catch (error) {
      this.logger.error('Error identifying optimization opportunities', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async compareServices(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      useCase?: string;
      tags?: string[];
    } = {},
  ): Promise<ServiceComparison> {
    const correlations = await this.analyzeCostPerformanceCorrelation(
      userId,
      options,
    );
    const bestValue = this.findBestValue(correlations);
    const recommendations = this.generateRecommendations(correlations);
    return { services: correlations, bestValue, recommendations };
  }

  async getPerformanceTrends(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      service?: string;
      model?: string;
      granularity?: 'hour' | 'day' | 'week';
    } = {},
  ): Promise<PerformanceTrend[]> {
    const startDate =
      options.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = options.endDate ?? new Date();
    const granularity = options.granularity ?? 'day';
    const usageData = await this.getUsageWithMetricsOptimized(
      userId,
      startDate,
      endDate,
      options.service ? [options.service] : undefined,
      options.model ? [options.model] : undefined,
    );
    const timeGroups = this.groupByTimePeriodOptimized(usageData, granularity);
    const periods = Array.from(timeGroups.keys()).sort();
    const trendPromises = periods.map((period, i) =>
      this.calculateTrendOptimized(
        period,
        timeGroups.get(period)!,
        i > 0 ? periods[i - 1] : null,
        timeGroups,
      ),
    );
    const trends = await Promise.all(trendPromises);
    return trends.sort((a, b) => a.period.localeCompare(b.period));
  }

  async getDetailedMetrics(
    userId: string,
    service: string,
    model: string,
    options: { startDate?: Date; endDate?: Date; tags?: string[] } = {},
  ): Promise<{
    summary: PerformanceMetrics & { cost: number; volume: number };
    timeSeries: Array<{
      timestamp: Date;
      cost: number;
      latency: number;
      errorRate: number;
      qualityScore: number;
    }>;
    percentiles: {
      latency: { p50: number; p95: number; p99: number };
      cost: { p50: number; p95: number; p99: number };
    };
    anomalies: Array<{
      timestamp: Date;
      type: 'cost_spike' | 'latency_spike' | 'error_spike' | 'quality_drop';
      severity: 'low' | 'medium' | 'high';
      value: number;
      expected: number;
      deviation: number;
    }>;
  }> {
    const startDate =
      options.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = options.endDate ?? new Date();
    const usageData = await this.getUsageWithMetrics(
      userId,
      startDate,
      endDate,
      [service],
      [model],
      options.tags,
    );
    const summary = this.calculateAggregatedMetrics(usageData);
    const timeSeries = this.generateTimeSeries(usageData);
    const percentiles = this.calculatePercentiles(usageData);
    const anomalies = this.detectPerformanceAnomalies(usageData);
    return { summary, timeSeries, percentiles, anomalies };
  }

  async getQualityScore(usage: {
    userId: Types.ObjectId;
    _id?: Types.ObjectId;
    service?: string;
    model?: string;
    createdAt: Date;
    cost: number;
    totalTokens: number;
  }): Promise<number> {
    const qualityScore = await this.qualityScoreModel
      .findOne({
        userId: usage.userId,
        ...(usage._id && { usageId: usage._id }),
        createdAt: {
          $gte: usage.createdAt,
          $lte: new Date(usage.createdAt.getTime() + 60000),
        },
      })
      .lean()
      .exec();

    if (qualityScore?.optimizedScore != null) {
      return qualityScore.optimizedScore / 100;
    }
    const baseQuality = String(usage.model || '').includes('gpt-4')
      ? 0.85
      : 0.75;
    const costInfluence = Math.min(usage.cost / 0.01, 1) * 0.1;
    return Math.min(baseQuality + costInfluence + 0.05, 1);
  }

  private findBestValue(
    correlations: CostPerformanceCorrelation[],
  ): ServiceComparison['bestValue'] {
    if (correlations.length === 0) {
      return {
        service: '',
        model: '',
        reason: 'No data',
        costSavings: 0,
        performanceImpact: 0,
      };
    }
    const best = correlations.reduce((a, b) =>
      a.efficiency.costEfficiencyScore > b.efficiency.costEfficiencyScore
        ? a
        : b,
    );
    const avgCost =
      correlations.reduce((s, c) => s + c.costPerRequest, 0) /
      correlations.length;
    return {
      service: best.service,
      model: best.model,
      reason: `Best cost-efficiency score of ${(best.efficiency.costEfficiencyScore * 100).toFixed(1)}%`,
      costSavings: Math.max(0, avgCost - best.costPerRequest),
      performanceImpact: best.performance.qualityScore * 100,
    };
  }

  private generateRecommendations(
    correlations: CostPerformanceCorrelation[],
  ): ServiceComparison['recommendations'] {
    const recs: ServiceComparison['recommendations'] = [];
    const inefficient = correlations.filter(
      (c) => c.efficiency.costEfficiencyScore < 0.6,
    );
    const efficient = correlations.filter(
      (c) => c.efficiency.costEfficiencyScore > 0.8,
    );
    if (inefficient.length > 0 && efficient.length > 0) {
      recs.push({
        type: 'switch_service',
        priority: 'high',
        description: `Switch from ${inefficient[0].service} to ${efficient[0].service} for better cost efficiency`,
        expectedSavings:
          (inefficient[0].costPerRequest - efficient[0].costPerRequest) * 1000,
        implementationEffort: 'moderate',
        riskLevel: 'medium',
      });
    }
    const highLatency = correlations.filter(
      (c) => c.performance.latency > 5000,
    );
    if (highLatency.length > 0) {
      recs.push({
        type: 'optimize_usage',
        priority: 'medium',
        description:
          'Optimize request patterns to reduce latency and improve cost efficiency',
        expectedSavings: highLatency[0].costPerRequest * 0.2 * 1000,
        implementationEffort: 'easy',
        riskLevel: 'low',
      });
    }
    return recs;
  }

  private deriveLatencyFromUsage(usage: {
    service?: string;
    totalTokens?: number;
    responseTime?: number;
    metadata?: { responseTime?: number };
  }): number {
    const fromDoc = usage.responseTime ?? usage.metadata?.responseTime;
    if (fromDoc != null && fromDoc > 0) return fromDoc;
    const base = String(usage.service || '').includes('gpt-4') ? 2000 : 1000;
    const tokenMult = (usage.totalTokens ?? 0) / 100;
    return base + tokenMult * 10 + 250;
  }

  private deriveErrorRateFromUsage(usage: {
    metadata?: { error?: boolean };
  }): number {
    return usage.metadata?.error ? 1 : 0;
  }

  private async getUsageWithMetrics(
    userId: string,
    startDate: Date,
    endDate: Date,
    services?: string[],
    models?: string[],
    tags?: string[],
  ): Promise<UsageWithMetrics[]> {
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (services?.length) query.service = { $in: services };
    if (models?.length) query.model = { $in: models };
    if (tags?.length) query.tags = { $in: tags };
    const list = await this.usageModel.find(query).lean().exec();
    const result: UsageWithMetrics[] = [];
    for (const u of list) {
      const usage = u as unknown as LeanUsage;
      const latency = this.deriveLatencyFromUsage(usage);
      const errorRate = this.deriveErrorRateFromUsage(usage);
      const qualityScore = await this.getQualityScore({
        userId: usage.userId,
        _id: usage._id,
        service: usage.service,
        model: usage.model,
        createdAt: usage.createdAt,
        cost: usage.cost,
        totalTokens: usage.totalTokens ?? 0,
      });
      result.push({
        ...usage,
        latency,
        errorRate,
        qualityScore,
        retryCount:
          (usage.metadata as { retryCount?: number })?.retryCount ?? 0,
        successRate:
          (usage.metadata as { successRate?: number })?.successRate ?? 100,
      });
    }
    return result;
  }

  private async getUsageWithMetricsOptimized(
    userId: string,
    startDate: Date,
    endDate: Date,
    services?: string[],
    models?: string[],
    tags?: string[],
  ): Promise<UsageWithMetrics[]> {
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (services?.length) query.service = { $in: services };
    if (models?.length) query.model = { $in: models };
    if (tags?.length) query.tags = { $in: tags };
    const list = await this.usageModel
      .find(query)
      .lean()
      .limit(USAGE_LIMIT_TRENDS)
      .exec();
    const result: UsageWithMetrics[] = [];
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE) as unknown as LeanUsage[];
      const batchResults = await Promise.all(
        batch.map(async (usage) => {
          const latency = this.deriveLatencyFromUsage(usage);
          const errorRate = this.deriveErrorRateFromUsage(usage);
          const qualityScore = await this.getQualityScore({
            userId: usage.userId,
            _id: usage._id,
            service: usage.service,
            model: usage.model,
            createdAt: usage.createdAt,
            cost: usage.cost,
            totalTokens: usage.totalTokens ?? 0,
          });
          return {
            ...usage,
            latency,
            errorRate,
            qualityScore,
            retryCount:
              (usage.metadata as { retryCount?: number })?.retryCount ?? 0,
            successRate:
              (usage.metadata as { successRate?: number })?.successRate ?? 100,
          } as UsageWithMetrics;
        }),
      );
      result.push(...batchResults);
    }
    return result;
  }

  private groupByTimePeriodOptimized(
    data: UsageWithMetrics[],
    granularity: 'hour' | 'day' | 'week',
  ): Map<string, UsageWithMetrics[]> {
    const groups = new Map<string, UsageWithMetrics[]>();
    const getKey = (d: Date): string => {
      const date = new Date(d);
      switch (granularity) {
        case 'hour':
          return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;
        case 'day':
          return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
        case 'week': {
          const weekStart = new Date(date);
          weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
          return `${weekStart.getUTCFullYear()}-${weekStart.getUTCMonth()}-${weekStart.getUTCDate()}`;
        }
        default:
          return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
      }
    };
    for (const u of data) {
      const key = getKey(u.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(u);
    }
    return groups;
  }

  private async calculateTrendOptimized(
    period: string,
    usages: UsageWithMetrics[],
    previousPeriod: string | null,
    timeGroups: Map<string, UsageWithMetrics[]>,
  ): Promise<PerformanceTrend> {
    const metrics = this.calculateAggregatedMetricsOptimized(usages);
    let trend: 'improving' | 'degrading' | 'stable' = 'stable';
    if (previousPeriod && timeGroups.has(previousPeriod)) {
      const prev = this.calculateAggregatedMetricsOptimized(
        timeGroups.get(previousPeriod)!,
      );
      trend = this.calculateTrendComparisonOptimized(metrics, prev);
    }
    const alerts = this.generatePerformanceAlertsOptimized(metrics, trend);
    return { period, metrics, trend, alerts };
  }

  private calculateAggregatedMetricsOptimized(
    usages: UsageWithMetrics[],
  ): PerformanceMetrics & { cost: number; volume: number } {
    if (usages.length === 0) {
      return {
        cost: 0,
        volume: 0,
        latency: 0,
        errorRate: 0,
        qualityScore: 0,
        throughput: 0,
        successRate: 100,
        retryRate: 0,
      };
    }
    const totalCost = usages.reduce((s, u) => s + u.cost, 0);
    const vol = usages.length;
    const totalLatency = usages.reduce((s, u) => s + (u.latency ?? 0), 0);
    const totalError = usages.reduce((s, u) => s + (u.errorRate ?? 0), 0);
    const totalQuality = usages.reduce((s, u) => s + (u.qualityScore ?? 0), 0);
    return {
      cost: totalCost,
      volume: vol,
      latency: totalLatency / vol,
      errorRate: totalError / vol,
      qualityScore: totalQuality / vol,
      throughput: vol / 24,
      successRate: 100 - totalError / vol,
      retryRate: 0,
    };
  }

  private calculateTrendComparisonOptimized(
    current: PerformanceMetrics & { cost: number; volume: number },
    previous: PerformanceMetrics & { cost: number; volume: number },
  ): 'improving' | 'degrading' | 'stable' {
    const costTrend = current.cost - previous.cost;
    const latencyTrend = current.latency - previous.latency;
    const qualityTrend = current.qualityScore - previous.qualityScore;
    const improving =
      (costTrend < 0 ? 1 : 0) +
      (latencyTrend < 0 ? 1 : 0) +
      (qualityTrend > 0 ? 1 : 0);
    if (improving >= 2) return 'improving';
    if (improving <= 1) return 'degrading';
    return 'stable';
  }

  private generatePerformanceAlertsOptimized(
    metrics: PerformanceMetrics & { cost: number; volume: number },
    trend: 'improving' | 'degrading' | 'stable',
  ): PerformanceTrend['alerts'] {
    const alerts: PerformanceTrend['alerts'] = [];
    if (metrics.latency > 5000) {
      alerts.push({
        type: 'performance_degradation',
        severity: trend === 'degrading' ? 'high' : 'medium',
        message: `High latency detected: ${metrics.latency.toFixed(0)}ms (trend: ${trend})`,
        suggestedActions: [
          'Optimize request parameters',
          'Consider faster model alternatives',
          'Review system performance',
        ],
      });
    }
    if (metrics.errorRate > 5) {
      alerts.push({
        type: 'error_increase',
        severity: 'high',
        message: `High error rate detected: ${metrics.errorRate.toFixed(1)}%`,
        suggestedActions: [
          'Review recent API changes',
          'Implement better error handling',
          'Consider alternative service providers',
        ],
      });
    }
    if (metrics.cost > 50) {
      alerts.push({
        type: 'cost_spike',
        severity: 'medium',
        message: `Cost spike detected: $${metrics.cost.toFixed(2)}`,
        suggestedActions: [
          'Review recent usage patterns',
          'Implement cost controls',
          'Optimize high-cost operations',
        ],
      });
    }
    return alerts;
  }

  private calculateAggregatedMetrics(
    usages: UsageWithMetrics[],
  ): PerformanceMetrics & { cost: number; volume: number } {
    return this.calculateAggregatedMetricsOptimized(usages);
  }

  private generateTimeSeries(usages: UsageWithMetrics[]): Array<{
    timestamp: Date;
    cost: number;
    latency: number;
    errorRate: number;
    qualityScore: number;
  }> {
    return usages.map((u) => ({
      timestamp: u.createdAt,
      cost: u.cost,
      latency: u.latency ?? 0,
      errorRate: u.errorRate ?? 0,
      qualityScore: u.qualityScore ?? 0,
    }));
  }

  private calculatePercentiles(usages: UsageWithMetrics[]): {
    latency: { p50: number; p95: number; p99: number };
    cost: { p50: number; p95: number; p99: number };
  } {
    const latencies = usages.map((u) => u.latency ?? 0).sort((a, b) => a - b);
    const costs = usages.map((u) => u.cost).sort((a, b) => a - b);
    const getP = (arr: number[], p: number) =>
      arr[
        Math.max(
          0,
          Math.min(Math.ceil((arr.length * p) / 100) - 1, arr.length - 1),
        )
      ] ?? 0;
    return {
      latency: {
        p50: getP(latencies, 50),
        p95: getP(latencies, 95),
        p99: getP(latencies, 99),
      },
      cost: {
        p50: getP(costs, 50),
        p95: getP(costs, 95),
        p99: getP(costs, 99),
      },
    };
  }

  private detectPerformanceAnomalies(usages: UsageWithMetrics[]): Array<{
    timestamp: Date;
    type: 'cost_spike' | 'latency_spike' | 'error_spike' | 'quality_drop';
    severity: 'low' | 'medium' | 'high';
    value: number;
    expected: number;
    deviation: number;
  }> {
    if (usages.length === 0) return [];
    const avgCost = usages.reduce((s, u) => s + u.cost, 0) / usages.length;
    const avgLatency =
      usages.reduce((s, u) => s + (u.latency ?? 0), 0) / usages.length;
    const avgQuality =
      usages.reduce((s, u) => s + (u.qualityScore ?? 0), 0) / usages.length;
    const anomalies: Array<{
      timestamp: Date;
      type: 'cost_spike' | 'latency_spike' | 'error_spike' | 'quality_drop';
      severity: 'low' | 'medium' | 'high';
      value: number;
      expected: number;
      deviation: number;
    }> = [];
    for (const u of usages) {
      if (u.cost > avgCost * 3) {
        anomalies.push({
          timestamp: u.createdAt,
          type: 'cost_spike',
          severity: 'high',
          value: u.cost,
          expected: avgCost,
          deviation: (u.cost - avgCost) / avgCost,
        });
      }
      if ((u.latency ?? 0) > avgLatency * 3) {
        anomalies.push({
          timestamp: u.createdAt,
          type: 'latency_spike',
          severity: 'high',
          value: u.latency!,
          expected: avgLatency,
          deviation: (u.latency! - avgLatency) / avgLatency,
        });
      }
      if ((u.qualityScore ?? 0) < avgQuality * 0.7) {
        anomalies.push({
          timestamp: u.createdAt,
          type: 'quality_drop',
          severity: 'medium',
          value: u.qualityScore!,
          expected: avgQuality,
          deviation: (avgQuality - u.qualityScore!) / avgQuality,
        });
      }
    }
    return anomalies.sort((a, b) => b.deviation - a.deviation).slice(0, 20);
  }

  private isDbCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount >= MAX_DB_FAILURES) {
      const elapsed = Date.now() - this.lastDbFailureTime;
      if (elapsed < CIRCUIT_BREAKER_RESET_MS) return true;
      this.dbFailureCount = 0;
    }
    return false;
  }

  private recordDbFailure(): void {
    this.dbFailureCount++;
    this.lastDbFailureTime = Date.now();
  }

  private calculateQualityScoreOptimized(
    latency: number,
    errorRate: number,
  ): number {
    const latencyScore = Math.max(0, 100 - latency / 10);
    const errorScore = Math.max(0, 100 - errorRate * 2);
    return (latencyScore + errorScore) / 200;
  }

  private calculateCostEfficiencyScoreOptimized(
    costPerRequest: number,
    performance: PerformanceMetrics,
  ): number {
    const scores = [
      Math.max(0, 1 - performance.latency / 10000),
      performance.qualityScore,
      performance.successRate / 100,
      Math.max(0, 1 - costPerRequest / 0.1),
    ];
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private getPerformanceRatingOptimized(
    performance: PerformanceMetrics,
  ): 'excellent' | 'good' | 'fair' | 'poor' {
    const score =
      performance.qualityScore * 0.4 +
      ((10000 - performance.latency) / 10000) * 0.3 +
      (performance.successRate / 100) * 0.3;
    if (score > 0.8) return 'excellent';
    if (score > 0.6) return 'good';
    if (score > 0.4) return 'fair';
    return 'poor';
  }

  private calculateOptimizationPotentialOptimized(
    performance: PerformanceMetrics,
    costPerRequest: number,
  ): number {
    const performanceScore =
      performance.latency > 0 ? 100 / performance.latency : 0;
    const costScore = Math.max(0, 1 - costPerRequest / 0.1);
    const adjusted = costScore * (1 + performanceScore / 1000);
    return Math.max(0, (1 - adjusted) * 100);
  }

  private generateRecommendationOptimized(
    service: string,
    model: string,
    performance: PerformanceMetrics,
    efficiencyScore: number,
  ): string {
    if (efficiencyScore > 0.8) {
      return `Excellent cost-performance ratio for ${service} ${model}. Continue current usage.`;
    }
    if (efficiencyScore > 0.6) {
      return `Good performance for ${service} ${model} but consider optimizing for better cost efficiency.`;
    }
    if (performance.latency > 5000) {
      return `High latency detected for ${service} ${model}. Consider switching to a faster model or optimizing requests.`;
    }
    if (performance.errorRate > 5) {
      return `High error rate detected for ${service} ${model}. Consider switching to a more reliable service.`;
    }
    return `Poor cost-performance ratio for ${service} ${model}. Consider alternative services or optimization strategies.`;
  }

  private calculateTradeoffOptimized(
    cost: number,
    performanceMetric: number,
  ): number {
    return Math.min(1, cost / (performanceMetric + 0.01));
  }

  private identifyModelSwitchOpportunities(
    correlations: CostPerformanceCorrelation[],
  ): OptimizationOpportunity[] {
    return correlations.map((correlation, index) => {
      const requests = correlation.totalRequests ?? 1;
      const totalCurrent = correlation.costPerRequest * requests;
      const savingsTotal = totalCurrent * 0.2;
      return {
        id: `model_switch_${index}`,
        title: `Model Switch for ${correlation.service} ${correlation.model}`,
        type: 'model_switch' as const,
        description: `Consider switching from ${correlation.service} ${correlation.model} to a more cost-effective model`,
        currentCost: totalCurrent,
        projectedCost: totalCurrent * 0.8,
        savings: savingsTotal,
        savingsPercentage: 20,
        performanceImpact: { latency: 0, quality: -5, reliability: 10 },
        implementationComplexity: 'high' as const,
        riskAssessment: {
          level: 'high' as const,
          factors: [
            'Model switch requires extensive testing',
            'Quality impact assessment needed',
          ],
          mitigation: [
            'Comprehensive testing',
            'Gradual migration',
            'Fallback strategy',
          ],
        },
        timeline: '1-2 weeks',
        priority: 1,
      };
    });
  }

  private identifyParameterTuningOpportunities(
    correlations: CostPerformanceCorrelation[],
  ): OptimizationOpportunity[] {
    return correlations.map((correlation, index) => {
      const requests = correlation.totalRequests ?? 1;
      const totalCurrent = correlation.costPerRequest * requests;
      const savingsTotal = totalCurrent * 0.1;
      return {
        id: `param_tuning_${index}`,
        title: `Parameter Tuning for ${correlation.service} ${correlation.model}`,
        type: 'parameter_tuning' as const,
        description: `Optimize parameters for ${correlation.service} ${correlation.model}`,
        currentCost: totalCurrent,
        projectedCost: totalCurrent * 0.9,
        savings: savingsTotal,
        savingsPercentage: 10,
        performanceImpact: { latency: -5, quality: 10, reliability: 0 },
        implementationComplexity: 'medium' as const,
        riskAssessment: {
          level: 'medium' as const,
          factors: [
            'Parameter optimization required',
            'Performance testing needed',
          ],
          mitigation: ['A/B testing', 'Rollback plan'],
        },
        timeline: '3-5 days',
        priority: 3,
      };
    });
  }

  private identifyRequestOptimizationOpportunities(
    correlations: CostPerformanceCorrelation[],
  ): OptimizationOpportunity[] {
    return correlations.map((correlation, index) => {
      const requests = correlation.totalRequests ?? 1;
      const totalCurrent = correlation.costPerRequest * requests;
      const savingsTotal = totalCurrent * 0.05;
      return {
        id: `request_opt_${index}`,
        title: `Request Optimization for ${correlation.service} ${correlation.model}`,
        type: 'request_optimization' as const,
        description: `Optimize request patterns for ${correlation.service} ${correlation.model}`,
        currentCost: totalCurrent,
        projectedCost: totalCurrent * 0.95,
        savings: savingsTotal,
        savingsPercentage: 5,
        performanceImpact: { latency: -10, quality: 0, reliability: 5 },
        implementationComplexity: 'low' as const,
        riskAssessment: {
          level: 'low' as const,
          factors: ['Minor code changes required'],
          mitigation: ['Thorough testing', 'Gradual rollout'],
        },
        timeline: '1-2 days',
        priority: 2,
      };
    });
  }

  onModuleDestroy(): void {
    this.calculationCache.clear();
  }
}
