/**
 * Recommendation Engine Service (NestJS)
 *
 * Port from Express recommendationEngine.service.ts.
 * Generates production recommendations from real usage windows and model pricing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { UsageService } from '../usage/services/usage.service';
import { v4 as uuidv4 } from 'uuid';
import {
  PricingService,
  ModelPricing,
} from '../utils/services/pricing.service';

export interface DemandPrediction {
  modelId: string;
  timestamp: Date;
  currentLoad: number;
  predictedLoad: number;
  confidence: number;
  timeWindow: string;
}

export interface ServingConfiguration {
  name: string;
  instanceType: string;
  maxConcurrency: number;
  autoScaling: boolean;
  costPerHour: number;
}

export interface CostPerformanceAnalysis {
  recommendations: Array<{
    action: string;
    type: string;
    expectedSavings: number;
    performanceImpact: number;
    reasoning: string;
    configuration: ServingConfiguration;
    impact: {
      costSavings: number;
      performanceChange: number;
    };
  }>;
}

export interface ScalingRecommendation {
  id: string;
  modelId: string;
  timestamp: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  action:
    | 'scale_up'
    | 'scale_down'
    | 'switch_instance'
    | 'optimize_cost'
    | 'no_action';
  currentConfiguration: ServingConfiguration;
  recommendedConfiguration: ServingConfiguration;
  reasoning: string;
  impact: {
    costSavings: number;
    performanceChange: number;
    riskLevel: 'low' | 'medium' | 'high';
  };
  implementation: {
    complexity: 'low' | 'medium' | 'high';
    estimatedTime: number;
    rollbackPlan: string;
  };
  metrics: {
    currentLoad: number;
    predictedLoad: number;
    confidence: number;
    timeWindow: string;
  };
}

export interface RecommendationSummary {
  totalRecommendations: number;
  potentialSavings: number;
  highPriorityCount: number;
  byAction: Record<string, number>;
  byPriority: Record<string, number>;
  modelCoverage: number;
}

export interface AlertNotification {
  id: string;
  type:
    | 'scaling_needed'
    | 'cost_optimization'
    | 'performance_degradation'
    | 'capacity_warning';
  severity: 'info' | 'warning' | 'error' | 'critical';
  modelId: string;
  message: string;
  timestamp: Date;
  recommendation?: ScalingRecommendation;
  autoActionAvailable: boolean;
}

interface UsageRow {
  model?: string;
  cost?: number;
  totalTokens?: number;
  responseTime?: number;
  errorOccurred?: boolean;
}

interface ModelUsageMetrics {
  requests: number;
  totalCost: number;
  totalTokens: number;
  avgResponseTime: number;
  errorRate: number;
}

const DEFAULT_CONFIG: ServingConfiguration = {
  name: 'default',
  instanceType: 'standard',
  maxConcurrency: 10,
  autoScaling: true,
  costPerHour: 1.5,
};

const SCALE_UP_CONFIG: ServingConfiguration = {
  name: 'scaled-up',
  instanceType: 'high-throughput',
  maxConcurrency: 50,
  autoScaling: true,
  costPerHour: 4.0,
};

const SCALE_DOWN_CONFIG: ServingConfiguration = {
  name: 'scaled-down',
  instanceType: 'cost-optimized',
  maxConcurrency: 5,
  autoScaling: true,
  costPerHour: 0.8,
};

/** Cost per model above which we recommend optimize_cost (USD per period) */
const HIGH_COST_THRESHOLD = 50;
/** Relative growth in usage over time that triggers scale_up */
const LOAD_GROWTH_THRESHOLD = 1.3;
/** Low load ratio (current vs capacity) that triggers scale_down */
const LOW_LOAD_RATIO = 0.25;
/** Recent and baseline windows for demand and trend estimates */
const WINDOW_HOURS = 24;
/** Skip low-signal models to avoid noisy recommendations */
const MIN_REQUESTS_FOR_RECOMMENDATION = 10;
/** High latency threshold for scaling pressure (ms) */
const HIGH_LATENCY_MS = 4000;
/** Error-rate threshold to prioritize reliability actions */
const HIGH_ERROR_RATE = 0.08;
/** Maximum usage rows to pull per window */
const MAX_USAGE_FETCH_LIMIT = 5000;

@Injectable()
export class RecommendationEngineService {
  private readonly logger = new Logger(RecommendationEngineService.name);
  private readonly recommendationCache = new Map<
    string,
    ScalingRecommendation
  >();
  private readonly executedRecommendationIds = new Set<string>();

  constructor(
    private readonly usageService: UsageService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Generate recommendations for all active models using two rolling windows:
   * - recent window (last 24h)
   * - baseline window (24h before recent)
   */
  async generateRecommendations(
    userId: string,
    hoursAhead: number = 4,
  ): Promise<ScalingRecommendation[]> {
    if (hoursAhead <= 0) {
      throw new Error('hoursAhead must be greater than 0');
    }

    try {
      const now = new Date();
      const recentStart = new Date(
        now.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
      );
      const baselineStart = new Date(
        now.getTime() - WINDOW_HOURS * 2 * 60 * 60 * 1000,
      );

      const [recentRows, baselineRows] = await Promise.all([
        this.fetchUsageWindow(userId, recentStart, now),
        this.fetchUsageWindow(userId, baselineStart, recentStart),
      ]);

      const recentByModel = this.aggregateByModel(recentRows);
      const baselineByModel = this.aggregateByModel(baselineRows);
      const allModels = new Set<string>([
        ...Object.keys(recentByModel),
        ...Object.keys(baselineByModel),
      ]);

      const recommendations: ScalingRecommendation[] = [];

      for (const modelId of allModels) {
        const recent = recentByModel[modelId] ?? this.emptyMetrics();
        const baseline = baselineByModel[modelId] ?? this.emptyMetrics();

        if (recent.requests < MIN_REQUESTS_FOR_RECOMMENDATION) {
          continue;
        }

        const growthRate = this.calculateGrowthRate(
          baseline.requests,
          recent.requests,
        );
        const currentLoad = recent.requests / WINDOW_HOURS;
        const predictedRequests = this.predictRequests(
          recent.requests,
          growthRate,
          hoursAhead,
        );
        const predictedLoad = predictedRequests / hoursAhead;
        const confidence = this.calculatePredictionConfidence(
          recent.requests,
          growthRate,
          recent.errorRate,
        );

        const prediction: DemandPrediction = {
          modelId,
          timestamp: now,
          currentLoad,
          predictedLoad,
          confidence,
          timeWindow: `${hoursAhead}h`,
        };

        const modelRecommendations = this.buildRecommendationsForModel(
          prediction,
          recent,
          baseline,
        );
        recommendations.push(...modelRecommendations);
      }

      this.cacheRecommendations(recommendations);

      return recommendations.sort((a, b) => {
        const priorityRank =
          this.priorityRank(b.priority) - this.priorityRank(a.priority);
        if (priorityRank !== 0) return priorityRank;
        return b.impact.costSavings - a.impact.costSavings;
      });
    } catch (error) {
      this.logger.error('Error generating recommendations', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to generate scaling recommendations');
    }
  }

  /**
   * Generate recommendations for a specific model from a demand prediction.
   */
  async generateModelRecommendations(
    prediction: DemandPrediction,
    _userId: string,
  ): Promise<ScalingRecommendation[]> {
    const recommendations = this.buildRecommendationsForModel(
      prediction,
      this.emptyMetrics(),
      this.emptyMetrics(),
    );
    this.cacheRecommendations(recommendations);
    return recommendations;
  }

  /**
   * Get recommendation summary from a list of recommendations.
   */
  getRecommendationSummary(
    recommendations: ScalingRecommendation[],
  ): RecommendationSummary {
    const byAction: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let totalSavings = 0;
    let highPriorityCount = 0;

    recommendations.forEach((rec) => {
      byAction[rec.action] = (byAction[rec.action] || 0) + 1;
      byPriority[rec.priority] = (byPriority[rec.priority] || 0) + 1;
      totalSavings += rec.impact.costSavings;
      if (rec.priority === 'high' || rec.priority === 'urgent') {
        highPriorityCount++;
      }
    });

    const uniqueModels = new Set(recommendations.map((r) => r.modelId)).size;

    return {
      totalRecommendations: recommendations.length,
      potentialSavings: totalSavings,
      highPriorityCount,
      byAction,
      byPriority,
      modelCoverage: uniqueModels,
    };
  }

  /**
   * Generate alert notifications from recommendations.
   */
  generateAlerts(
    recommendations: ScalingRecommendation[],
  ): AlertNotification[] {
    const alerts: AlertNotification[] = [];

    recommendations.forEach((rec) => {
      if (rec.priority === 'urgent' || rec.priority === 'high') {
        alerts.push({
          id: `alert-${rec.id}`,
          type: this.getAlertType(rec.action),
          severity: this.getAlertSeverity(rec.priority),
          modelId: rec.modelId,
          message: this.generateAlertMessage(rec),
          timestamp: new Date(),
          recommendation: rec,
          autoActionAvailable:
            rec.implementation.complexity === 'low' &&
            rec.impact.riskLevel === 'low',
        });
      }
    });

    return alerts;
  }

  /**
   * Execute a recommendation. Dry run validates only; non-dry run requires infrastructure API integration.
   */
  async executeRecommendation(
    recommendationId: string,
    userId: string,
    dryRun: boolean = true,
  ): Promise<{
    success: boolean;
    message: string;
    changes: {
      previousConfig: ServingConfiguration;
      newConfig: ServingConfiguration;
      estimatedSavings: number;
    } | null;
  }> {
    const recommendation = this.recommendationCache.get(recommendationId);
    if (!recommendation) {
      return {
        success: false,
        message:
          'Recommendation not found or expired. Generate recommendations again before execution.',
        changes: null,
      };
    }

    const changeSet = {
      previousConfig: recommendation.currentConfiguration,
      newConfig: recommendation.recommendedConfiguration,
      estimatedSavings: recommendation.impact.costSavings,
    };

    if (dryRun) {
      return {
        success: true,
        message: 'Dry run completed successfully. No actual changes made.',
        changes: changeSet,
      };
    }

    this.executedRecommendationIds.add(recommendationId);
    this.logger.log(
      `Recommendation ${recommendationId} executed for user ${userId}`,
    );

    return {
      success: true,
      message:
        'Recommendation marked as executed. Integrate infrastructure orchestration hooks to apply automatic scaling changes.',
      changes: changeSet,
    };
  }

  private async fetchUsageWindow(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageRow[]> {
    const response = await this.usageService.getUsage(
      {
        userId,
        startDate,
        endDate,
      } as never,
      {
        page: 1,
        limit: MAX_USAGE_FETCH_LIMIT,
        sort: 'createdAt',
        order: 'desc',
      } as never,
    );

    return (response.data as unknown as UsageRow[]).map((row) => ({
      model: row.model,
      cost: typeof row.cost === 'number' ? row.cost : 0,
      totalTokens: typeof row.totalTokens === 'number' ? row.totalTokens : 0,
      responseTime: typeof row.responseTime === 'number' ? row.responseTime : 0,
      errorOccurred: Boolean(row.errorOccurred),
    }));
  }

  private aggregateByModel(
    rows: UsageRow[],
  ): Record<string, ModelUsageMetrics> {
    const acc: Record<
      string,
      {
        requests: number;
        totalCost: number;
        totalTokens: number;
        totalResponseTime: number;
        errors: number;
      }
    > = {};

    for (const row of rows) {
      const modelId = row.model || 'unknown';
      if (!acc[modelId]) {
        acc[modelId] = {
          requests: 0,
          totalCost: 0,
          totalTokens: 0,
          totalResponseTime: 0,
          errors: 0,
        };
      }
      acc[modelId].requests += 1;
      acc[modelId].totalCost += row.cost || 0;
      acc[modelId].totalTokens += row.totalTokens || 0;
      acc[modelId].totalResponseTime += row.responseTime || 0;
      if (row.errorOccurred) {
        acc[modelId].errors += 1;
      }
    }

    const metrics: Record<string, ModelUsageMetrics> = {};
    for (const [modelId, value] of Object.entries(acc)) {
      metrics[modelId] = {
        requests: value.requests,
        totalCost: value.totalCost,
        totalTokens: value.totalTokens,
        avgResponseTime:
          value.requests > 0 ? value.totalResponseTime / value.requests : 0,
        errorRate: value.requests > 0 ? value.errors / value.requests : 0,
      };
    }
    return metrics;
  }

  private buildRecommendationsForModel(
    prediction: DemandPrediction,
    recent: ModelUsageMetrics,
    baseline: ModelUsageMetrics,
  ): ScalingRecommendation[] {
    const recommendations: ScalingRecommendation[] = [];
    const { modelId, currentLoad, predictedLoad, confidence, timeWindow } =
      prediction;
    const growthRate = this.calculateGrowthRate(
      baseline.requests,
      recent.requests,
    );
    const loadRatio = currentLoad > 0 ? predictedLoad / currentLoad : 0;

    if (
      loadRatio >= LOAD_GROWTH_THRESHOLD ||
      recent.avgResponseTime >= HIGH_LATENCY_MS ||
      recent.errorRate >= HIGH_ERROR_RATE
    ) {
      recommendations.push(
        this.createRecommendation({
          modelId,
          priority:
            recent.errorRate >= HIGH_ERROR_RATE ||
            recent.avgResponseTime >= HIGH_LATENCY_MS
              ? 'high'
              : confidence >= 0.8
                ? 'high'
                : 'medium',
          action: 'scale_up',
          currentConfiguration: DEFAULT_CONFIG,
          recommendedConfiguration: SCALE_UP_CONFIG,
          reasoning: `Projected demand/latency pressure detected (load ratio ${loadRatio.toFixed(2)}, avg latency ${recent.avgResponseTime.toFixed(0)}ms, error rate ${(recent.errorRate * 100).toFixed(1)}%).`,
          impact: {
            costSavings: 0,
            performanceChange: 1.25,
            riskLevel: 'medium',
          },
          implementation: {
            complexity: 'medium',
            estimatedTime: 20,
            rollbackPlan:
              'Rollback to previous concurrency profile if p95 latency does not improve within one observation window.',
          },
          metrics: {
            currentLoad,
            predictedLoad,
            confidence,
            timeWindow,
          },
        }),
      );
    } else if (
      currentLoad > 0 &&
      loadRatio <= LOW_LOAD_RATIO &&
      recent.errorRate < HIGH_ERROR_RATE / 2
    ) {
      recommendations.push(
        this.createRecommendation({
          modelId,
          priority: 'medium',
          action: 'scale_down',
          currentConfiguration: DEFAULT_CONFIG,
          recommendedConfiguration: SCALE_DOWN_CONFIG,
          reasoning: `Sustained low projected utilization detected (load ratio ${loadRatio.toFixed(2)}).`,
          impact: {
            costSavings:
              Math.max(
                0,
                DEFAULT_CONFIG.costPerHour - SCALE_DOWN_CONFIG.costPerHour,
              ) * 24,
            performanceChange: -0.05,
            riskLevel: 'low',
          },
          implementation: {
            complexity: 'low',
            estimatedTime: 10,
            rollbackPlan:
              'Rollback to previous profile if queue depth or timeout rate increases.',
          },
          metrics: {
            currentLoad,
            predictedLoad,
            confidence,
            timeWindow,
          },
        }),
      );
    }

    const optimizeCostRecommendation = this.buildCostOptimizationRecommendation(
      modelId,
      recent,
      prediction,
      growthRate,
    );
    if (optimizeCostRecommendation) {
      recommendations.push(optimizeCostRecommendation);
    }

    return recommendations;
  }

  private buildCostOptimizationRecommendation(
    modelId: string,
    recent: ModelUsageMetrics,
    prediction: DemandPrediction,
    growthRate: number,
  ): ScalingRecommendation | null {
    if (recent.totalCost < HIGH_COST_THRESHOLD) {
      return null;
    }

    const currentPricing = this.pricingService.getModelPricing(modelId);
    if (!currentPricing) {
      return null;
    }

    const alternatives = this.pricingService.getModelsByCapabilities(
      currentPricing.capabilities,
    );
    const currentUnitCost =
      currentPricing.inputCostPerToken + currentPricing.outputCostPerToken;
    const cheaperAlternative = alternatives
      .filter((model) => model.model !== currentPricing.model)
      .filter(
        (model) =>
          model.inputCostPerToken + model.outputCostPerToken < currentUnitCost,
      )
      .sort(
        (a, b) =>
          a.inputCostPerToken +
          a.outputCostPerToken -
          (b.inputCostPerToken + b.outputCostPerToken),
      )[0];

    if (!cheaperAlternative) {
      return null;
    }

    const estimatedAlternativeCost = this.estimateCostByPricing(
      cheaperAlternative,
      recent.totalTokens,
    );
    const savings = Math.max(0, recent.totalCost - estimatedAlternativeCost);

    if (savings <= 0) {
      return null;
    }

    const riskLevel: 'low' | 'medium' | 'high' =
      cheaperAlternative.tier === currentPricing.tier ? 'low' : 'medium';
    const priority: ScalingRecommendation['priority'] =
      savings > HIGH_COST_THRESHOLD ? 'high' : 'medium';

    return this.createRecommendation({
      modelId,
      priority,
      action: 'optimize_cost',
      currentConfiguration: DEFAULT_CONFIG,
      recommendedConfiguration: {
        ...SCALE_DOWN_CONFIG,
        name: `switch-to-${cheaperAlternative.model}`,
      },
      reasoning: `Switch candidate ${cheaperAlternative.model} can reduce cost by ~$${savings.toFixed(2)} over the last window while preserving required capabilities.`,
      impact: {
        costSavings: savings,
        performanceChange: growthRate > 0.2 ? -0.03 : 0,
        riskLevel,
      },
      implementation: {
        complexity: 'medium',
        estimatedTime: 20,
        rollbackPlan:
          'Revert to current model if quality or completion rates degrade after rollout.',
      },
      metrics: {
        currentLoad: prediction.currentLoad,
        predictedLoad: prediction.predictedLoad,
        confidence: prediction.confidence,
        timeWindow: prediction.timeWindow,
      },
    });
  }

  private createRecommendation(
    params: Omit<ScalingRecommendation, 'id' | 'timestamp'>,
  ): ScalingRecommendation {
    return {
      ...params,
      id: `rec_${uuidv4().slice(0, 8)}`,
      timestamp: new Date(),
    };
  }

  private estimateCostByPricing(
    pricing: ModelPricing,
    totalTokens: number,
  ): number {
    const inputTokens = Math.floor(totalTokens * 0.5);
    const outputTokens = totalTokens - inputTokens;
    const inputCost = (inputTokens / 1000) * pricing.inputCostPerToken;
    const outputCost = (outputTokens / 1000) * pricing.outputCostPerToken;
    return inputCost + outputCost;
  }

  private predictRequests(
    currentRequests: number,
    growthRate: number,
    hoursAhead: number,
  ): number {
    const factor = 1 + growthRate * (hoursAhead / WINDOW_HOURS);
    return Math.max(0, currentRequests * Math.max(0.1, factor));
  }

  private calculateGrowthRate(baseline: number, recent: number): number {
    if (baseline <= 0) {
      return recent > 0 ? 0.2 : 0;
    }
    return (recent - baseline) / baseline;
  }

  private calculatePredictionConfidence(
    recentRequests: number,
    growthRate: number,
    errorRate: number,
  ): number {
    const volumeFactor = Math.min(1, recentRequests / 200);
    const trendFactor = Math.min(1, Math.abs(growthRate));
    const errorPenalty = Math.min(0.25, errorRate);
    const confidence =
      0.55 + volumeFactor * 0.25 + trendFactor * 0.15 - errorPenalty;
    return Math.max(0.35, Math.min(0.95, confidence));
  }

  private cacheRecommendations(recommendations: ScalingRecommendation[]): void {
    for (const recommendation of recommendations) {
      this.recommendationCache.set(recommendation.id, recommendation);
    }
  }

  private emptyMetrics(): ModelUsageMetrics {
    return {
      requests: 0,
      totalCost: 0,
      totalTokens: 0,
      avgResponseTime: 0,
      errorRate: 0,
    };
  }

  private priorityRank(priority: ScalingRecommendation['priority']): number {
    switch (priority) {
      case 'urgent':
        return 4;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      default:
        return 1;
    }
  }

  private getAlertType(action: string): AlertNotification['type'] {
    switch (action) {
      case 'scale_up':
        return 'scaling_needed';
      case 'scale_down':
      case 'optimize_cost':
        return 'cost_optimization';
      case 'switch_instance':
        return 'performance_degradation';
      default:
        return 'capacity_warning';
    }
  }

  private getAlertSeverity(priority: string): AlertNotification['severity'] {
    switch (priority) {
      case 'urgent':
        return 'critical';
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      default:
        return 'info';
    }
  }

  private generateAlertMessage(recommendation: ScalingRecommendation): string {
    const { modelId, action, impact, metrics } = recommendation;
    const actionMessages: Record<string, string> = {
      scale_up: `Model ${modelId} requires scaling up. Predicted load (${metrics.predictedLoad.toFixed(0)}) exceeds current capacity.`,
      scale_down: `Model ${modelId} can be scaled down. Predicted load (${metrics.predictedLoad.toFixed(0)}) is below current capacity.`,
      switch_instance: `Model ${modelId} would benefit from switching instance types for better performance.`,
      optimize_cost: `Model ${modelId} has cost optimization opportunities. Potential savings: $${impact.costSavings.toFixed(2)}.`,
      no_action: `Model ${modelId} is operating normally.`,
    };
    return actionMessages[action] ?? `Model ${modelId} requires attention.`;
  }
}
