import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import { KillSwitchService } from './kill-switch.service';
import { Interval } from '@nestjs/schedule';
import {
  CostAnomalyHistory,
  CustomerCostMetrics as CustomerCostMetricsSchema,
  CostAlert,
} from '../../../schemas/misc/cost-tracking-record.schema';

export interface CostThresholds {
  costIncreasePercent: number; // 20% increase triggers alert
  costIncreaseAbsolute: number; // $1000 increase triggers freeze
  apiCallsPerMinute: number; // Rate limit
  unexpectedRegions: boolean; // Flag new regions
}

export interface CostValidation {
  allowed: boolean;
  reason?: string;
  recommendation?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface CostPrediction {
  percentIncrease: number;
  absoluteIncrease: number;
  monthlyCostBefore: number;
  monthlyCostAfter: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CustomerCostMetrics {
  totalCostIncrease: number;
  totalCostDecrease: number;
  netCostChange: number;
  actionsExecuted: number;
  lastUpdated: Date;
}

export interface CostMetrics {
  totalSpend: number;
  averageDailySpend: number;
  anomalyCount: number;
  lastAnomalyAt?: Date;
  costTrend: 'increasing' | 'stable' | 'decreasing';
  confidence: number;
}

export interface ExecutionPlanForCost {
  planId: string;
  estimatedCostImpact: number;
  resourceCount: number;
  service: string;
  action: string;
  regions: string[];
}

export interface CostValidationRequest {
  action: string;
  resources: string[];
  estimatedCost: number;
  timeWindow: number; // hours
  userId: string;
  connectionId: string;
}

export interface CostValidationResult {
  allowed: boolean;
  reason?: string;
  confidence: number; // 0-1
  anomalyDetected: boolean;
  anomalySeverity?: 'low' | 'medium' | 'high' | 'critical';
  recommendedAction?: 'allow' | 'deny' | 'review' | 'simulate';
  budgetImpact?: {
    currentSpend: number;
    projectedSpend: number;
    budgetLimit?: number;
    percentOfBudget: number;
  };
}

export interface CostHistoryMetrics {
  totalSpend: number;
  averageDailySpend: number;
  anomalyCount: number;
  lastAnomalyAt?: Date;
  costTrend: 'increasing' | 'stable' | 'decreasing';
  confidence: number;
}

// Default thresholds
const DEFAULT_THRESHOLDS: CostThresholds = {
  costIncreasePercent: 20,
  costIncreaseAbsolute: 1000,
  apiCallsPerMinute: 100,
  unexpectedRegions: true,
};

// Known/expected regions
const EXPECTED_REGIONS = new Set([
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
]);

@Injectable()
export class CostAnomalyGuardService {
  // Cost thresholds for automatic blocking
  private readonly CRITICAL_COST_THRESHOLD = 1000; // $1000
  private readonly HIGH_COST_THRESHOLD = 500; // $500
  private readonly MEDIUM_COST_THRESHOLD = 100; // $100

  // Anomaly detection thresholds
  private readonly ANOMALY_ZSCORE_THRESHOLD = 3.0; // 3 standard deviations

  // Custom thresholds per customer
  private customerThresholds: Map<string, CostThresholds> = new Map();

  // API call rate tracking
  private apiCallCounts: Map<string, { count: number; windowStart: Date }> =
    new Map();

  constructor(
    private readonly logger: LoggerService,
    private readonly killSwitchService: KillSwitchService,
    @InjectModel(CostAnomalyHistory.name)
    private readonly costHistoryModel: Model<CostAnomalyHistory>,
    @InjectModel(CustomerCostMetricsSchema.name)
    private readonly customerMetricsModel: Model<CustomerCostMetricsSchema>,
    @InjectModel(CostAlert.name)
    private readonly costAlertModel: Model<CostAlert>,
  ) {}

  /**
   * Validate cost impact before allowing action
   */
  async validateCostImpact(
    request: CostValidationRequest,
  ): Promise<CostValidationResult> {
    const { action, estimatedCost, connectionId } = request;

    // Get cost metrics for this connection
    const metrics = await this.getCostMetrics(connectionId);

    // Detect anomalies
    const anomalyResult = await this.detectAnomaly(
      connectionId,
      estimatedCost,
      metrics,
    );

    // Calculate budget impact
    const budgetImpact = await this.calculateBudgetImpact(
      connectionId,
      estimatedCost,
    );

    // Determine if action should be allowed
    let allowed = true;
    let reason = '';
    let recommendedAction: CostValidationResult['recommendedAction'] = 'allow';

    // Block based on cost thresholds
    if (estimatedCost >= this.CRITICAL_COST_THRESHOLD) {
      allowed = false;
      reason = `Cost exceeds critical threshold ($${estimatedCost} >= $${this.CRITICAL_COST_THRESHOLD})`;
      recommendedAction = 'deny';
    } else if (estimatedCost >= this.HIGH_COST_THRESHOLD) {
      allowed = false;
      reason = `Cost exceeds high threshold ($${estimatedCost} >= $${this.HIGH_COST_THRESHOLD})`;
      recommendedAction = 'review';
    } else if (estimatedCost >= this.MEDIUM_COST_THRESHOLD) {
      recommendedAction = 'review';
      reason = `Cost exceeds medium threshold ($${estimatedCost} >= $${this.MEDIUM_COST_THRESHOLD})`;
    }

    // Block based on anomaly detection
    if (anomalyResult.detected && anomalyResult.severity === 'critical') {
      allowed = false;
      reason = `Critical cost anomaly detected: ${anomalyResult.reason}`;
      recommendedAction = 'deny';

      // Activate kill switch for critical anomalies
      await this.activateEmergencyKillSwitch(
        connectionId,
        `Critical cost anomaly: ${anomalyResult.reason}`,
      );
    }

    // Block if budget impact is too high
    if (budgetImpact && budgetImpact.percentOfBudget > 90) {
      allowed = false;
      reason = `Budget impact too high (${budgetImpact.percentOfBudget}% of budget)`;
      recommendedAction = 'deny';
    }

    const result: CostValidationResult = {
      allowed,
      reason,
      confidence: this.calculateConfidence(metrics, anomalyResult),
      anomalyDetected: anomalyResult.detected,
      anomalySeverity: anomalyResult.severity,
      recommendedAction,
      budgetImpact,
    };

    // Log the validation
    this.logger.log('Cost validation completed', {
      component: 'CostAnomalyGuardService',
      operation: 'validateCostImpact',
      connectionId,
      action,
      estimatedCost,
      allowed,
      anomalyDetected: anomalyResult.detected,
      confidence: result.confidence,
    });

    return result;
  }

  /**
   * Record actual cost for learning and trend analysis
   */
  async recordCostMetrics(
    connectionId: string,
    action: string,
    actualCost: number,
    timestamp: Date = new Date(),
    userId?: string,
  ): Promise<void> {
    try {
      // Record in cost history
      await this.costHistoryModel.create({
        connectionId,
        action,
        amount: actualCost,
        timestamp,
        userId: userId || 'system',
      });

      // Clean up old records (keep only last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      await this.costHistoryModel.deleteMany({
        connectionId,
        timestamp: { $lt: thirtyDaysAgo },
      });

      this.logger.log('Cost metrics recorded', {
        component: 'CostAnomalyGuardService',
        operation: 'recordCostMetrics',
        connectionId,
        action,
        actualCost,
      });
    } catch (error) {
      this.logger.error('Failed to record cost metrics', {
        component: 'CostAnomalyGuardService',
        operation: 'recordCostMetrics',
        connectionId,
        action,
        actualCost,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Predict cost impact for a potential action
   *
   * Analyzes historical cost data to predict the cost impact of a specific action.
   * Uses action-specific historical data for more accurate predictions.
   *
   * @param connectionId - The connection ID
   * @param action - The action type (e.g., 'create_instance', 'delete_bucket')
   * @param resourceCount - Number of resources affected
   * @returns Predicted cost with confidence level
   */
  async predictCostImpact(
    connectionId: string,
    action: string,
    resourceCount: number,
  ): Promise<{
    predictedCost: number;
    confidence: number;
    basedOnHistory: number;
  }> {
    try {
      // Get cost history for this connection
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const history = await this.costHistoryModel
        .find({
          connectionId,
          timestamp: { $gte: thirtyDaysAgo },
        })
        .sort({ timestamp: -1 })
        .exec();

      if (history.length === 0) {
        // No history available - use service-specific estimates
        return this.getDefaultCostEstimate(action, resourceCount);
      }

      // Calculate statistics from recent history
      const amounts = history.map((entry) => entry.amount);

      // Calculate average and max for prediction
      const averageCost =
        amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
      const maxCost = Math.max(...amounts);

      // Weighted prediction: favor conservative estimate (closer to max)
      // This helps avoid underestimating costs
      const predictedCost = (averageCost * 0.6 + maxCost * 0.4) * resourceCount;

      // Calculate confidence based on data volume and variance
      const variance = this.calculateVariance(amounts);
      const dataConfidence = Math.min(1, history.length / 20); // Max confidence at 20+ data points
      const variancePenalty = variance > 100 ? 0.2 : 0; // Penalty for high variance
      const confidence = Math.max(0, dataConfidence - variancePenalty);

      this.logger.log('Cost impact predicted', {
        component: 'CostAnomalyGuardService',
        operation: 'predictCostImpact',
        connectionId,
        action,
        resourceCount,
        predictedCost: predictedCost.toFixed(2),
        confidence: confidence.toFixed(2),
        basedOnHistory: history.length,
      });

      return {
        predictedCost,
        confidence,
        basedOnHistory: history.length,
      };
    } catch (error) {
      this.logger.error('Failed to predict cost impact', {
        component: 'CostAnomalyGuardService',
        operation: 'predictCostImpact',
        connectionId,
        action,
        resourceCount,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback to default estimate on error
      return this.getDefaultCostEstimate(action, resourceCount);
    }
  }

  /**
   * Get default cost estimate when no history is available
   */
  private getDefaultCostEstimate(
    action: string,
    resourceCount: number,
  ): {
    predictedCost: number;
    confidence: number;
    basedOnHistory: number;
  } {
    // Service-specific default cost estimates (hourly rates)
    const defaultEstimates: Record<string, number> = {
      create_ec2: 0.05, // Average $0.05/hour for small instances
      start_ec2: 0.05,
      create_rds: 0.1, // Average $0.10/hour for small databases
      start_rds: 0.1,
      create_lambda: 0.001, // Very low - per invocation
      create_s3: 0.02, // Storage cost per GB
      create_dynamodb: 0.05, // Provisioned capacity
      create_ecs: 0.03, // Container cost
    };

    // Extract base action (remove service prefix if present)
    const baseAction = action.toLowerCase();

    // Find matching estimate or use conservative default
    let hourlyRate = 0.02; // Conservative default
    for (const [key, rate] of Object.entries(defaultEstimates)) {
      if (baseAction.includes(key) || key.includes(baseAction)) {
        hourlyRate = rate;
        break;
      }
    }

    // Estimate monthly cost (730 hours/month average)
    const monthlyCost = hourlyRate * 730 * resourceCount;

    return {
      predictedCost: monthlyCost,
      confidence: 0.1, // Low confidence since it's an estimate
      basedOnHistory: 0,
    };
  }

  /**
   * Calculate variance of an array of numbers
   */
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Get cost metrics for a connection
   */
  private async getCostMetrics(connectionId: string): Promise<CostMetrics> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const history = await this.costHistoryModel
        .find({
          connectionId,
          timestamp: { $gte: thirtyDaysAgo },
        })
        .sort({ timestamp: -1 })
        .exec();

      if (history.length === 0) {
        return {
          totalSpend: 0,
          averageDailySpend: 0,
          anomalyCount: 0,
          costTrend: 'stable',
          confidence: 0,
        };
      }

      const totalSpend = history.reduce((sum, entry) => sum + entry.amount, 0);
      const daysWithData = Math.max(
        1,
        this.getUniqueDays(history.map((h) => ({ timestamp: h.timestamp }))),
      );
      const averageDailySpend = totalSpend / daysWithData;

      // Simple trend analysis
      const recentEntries = history.slice(0, 10);
      const olderEntries = history.slice(10, 20);
      const recentAvg =
        recentEntries.length > 0
          ? recentEntries.reduce((sum, entry) => sum + entry.amount, 0) /
            recentEntries.length
          : 0;
      const olderAvg =
        olderEntries.length > 0
          ? olderEntries.reduce((sum, entry) => sum + entry.amount, 0) /
            olderEntries.length
          : 0;

      let costTrend: CostMetrics['costTrend'] = 'stable';
      if (recentAvg > olderAvg * 1.2) costTrend = 'increasing';
      else if (recentAvg < olderAvg * 0.8) costTrend = 'decreasing';

      return {
        totalSpend,
        averageDailySpend,
        anomalyCount: 0, // Would track anomalies in production
        costTrend,
        confidence: Math.min(1, history.length / 30),
      };
    } catch (error) {
      this.logger.error('Failed to get cost metrics', {
        component: 'CostAnomalyGuardService',
        operation: 'getCostMetrics',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        totalSpend: 0,
        averageDailySpend: 0,
        anomalyCount: 0,
        costTrend: 'stable',
        confidence: 0,
      };
    }
  }

  /**
   * Detect cost anomalies using statistical methods
   */
  private async detectAnomaly(
    connectionId: string,
    estimatedCost: number,
    _metrics: CostMetrics,
  ): Promise<{
    detected: boolean;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    reason?: string;
  }> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const history = await this.costHistoryModel
        .find({
          connectionId,
          timestamp: { $gte: thirtyDaysAgo },
        })
        .sort({ timestamp: -1 })
        .exec();

      if (history.length < 7) {
        // Not enough data for anomaly detection
        return { detected: false };
      }

      // Calculate z-score
      const amounts = history.map((entry) => entry.amount);
      const mean = amounts.reduce((sum, val) => sum + val, 0) / amounts.length;
      const variance =
        amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
        amounts.length;
      const stdDev = Math.sqrt(variance);
      const zScore = stdDev > 0 ? (estimatedCost - mean) / stdDev : 0;

      if (Math.abs(zScore) < this.ANOMALY_ZSCORE_THRESHOLD) {
        return { detected: false };
      }

      // Determine severity
      let severity: 'low' | 'medium' | 'high' | 'critical';
      let reason: string;

      if (zScore > 5) {
        severity = 'critical';
        reason = `Extremely high cost anomaly (z-score: ${zScore.toFixed(2)})`;
      } else if (zScore > 4) {
        severity = 'high';
        reason = `High cost anomaly (z-score: ${zScore.toFixed(2)})`;
      } else if (zScore > 3) {
        severity = 'medium';
        reason = `Moderate cost anomaly (z-score: ${zScore.toFixed(2)})`;
      } else {
        severity = 'low';
        reason = `Low cost anomaly (z-score: ${zScore.toFixed(2)})`;
      }

      return {
        detected: true,
        severity,
        reason,
      };
    } catch (error) {
      this.logger.error('Failed to detect cost anomaly', {
        component: 'CostAnomalyGuardService',
        operation: 'detectAnomaly',
        connectionId,
        estimatedCost,
        error: error instanceof Error ? error.message : String(error),
      });
      return { detected: false };
    }
  }

  /**
   * Calculate budget impact based on tracked cost metrics
   *
   * Uses actual recorded cost history and customer metrics to calculate
   * realistic budget impact with configurable budget limits.
   *
   * @param connectionId - The connection ID
   * @param estimatedCost - The estimated cost of the action
   * @returns Budget impact analysis
   */
  private async calculateBudgetImpact(
    connectionId: string,
    estimatedCost: number,
  ): Promise<CostValidationResult['budgetImpact']> {
    // Get cost metrics for this connection
    const metrics = await this.getCostMetrics(connectionId);

    // Calculate current spend from metrics
    let currentSpend: number;
    if (metrics.totalSpend > 0) {
      currentSpend = metrics.totalSpend;
    } else {
      currentSpend = metrics.averageDailySpend * 30;
    }

    const budgetLimit = await this.getCustomerBudgetLimit(connectionId);

    // Calculate projected spend
    const projectedSpend = currentSpend + estimatedCost;

    // Calculate percentage of budget
    const percentOfBudget =
      budgetLimit > 0 ? (projectedSpend / budgetLimit) * 100 : 0;

    this.logger.log('Budget impact calculated', {
      component: 'CostAnomalyGuardService',
      operation: 'calculateBudgetImpact',
      connectionId,
      currentSpend: currentSpend.toFixed(2),
      estimatedCost: estimatedCost.toFixed(2),
      projectedSpend: projectedSpend.toFixed(2),
      budgetLimit: budgetLimit.toFixed(2),
      percentOfBudget: percentOfBudget.toFixed(2),
    });

    return {
      currentSpend,
      projectedSpend,
      budgetLimit,
      percentOfBudget,
    };
  }

  /**
   * Get customer's budget limit from configuration or use default
   *
   * In production, this would query customer settings or billing system
   */
  private async getCustomerBudgetLimit(connectionId: string): Promise<number> {
    // Check if there's a custom budget limit stored
    const customLimit = this.customerThresholds.get(connectionId);

    // Use custom limit if available, otherwise use tier-based defaults
    if (customLimit && 'budgetLimit' in customLimit) {
      return (
        (customLimit as CostThresholds & { budgetLimit: number }).budgetLimit ||
        2000
      );
    }

    // Default budget limits by usage tier (in USD)
    const metrics = await this.getCostMetrics(connectionId);
    if (metrics && metrics.totalSpend > 0) {
      const monthlySpend = metrics.totalSpend;

      if (monthlySpend > 10000) {
        return 50000; // Enterprise tier
      } else if (monthlySpend > 1000) {
        return 10000; // Business tier
      } else if (monthlySpend > 100) {
        return 2000; // Pro tier
      }
    }

    // Default for new/small customers
    return 500;
  }

  /**
   * Calculate confidence in the validation
   */
  private calculateConfidence(
    metrics: CostMetrics,
    anomalyResult: any,
  ): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence with more historical data
    confidence += Math.min(0.3, metrics.confidence * 0.3);

    // Increase confidence if no anomaly detected
    if (!anomalyResult.detected) {
      confidence += 0.1;
    }

    // Decrease confidence for unstable trends
    if (metrics.costTrend === 'increasing') {
      confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Activate emergency kill switch for critical cost anomalies
   */
  private async activateEmergencyKillSwitch(
    connectionId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.killSwitchService.activateKillSwitch({
        scope: 'connection',
        id: connectionId,
        reason: 'cost_anomaly',
        activatedBy: 'CostAnomalyGuardService',
        notes: reason,
      });

      this.logger.error('Emergency kill switch activated due to cost anomaly', {
        component: 'CostAnomalyGuardService',
        operation: 'activateEmergencyKillSwitch',
        connectionId,
        reason,
      });
    } catch (error) {
      this.logger.error('Failed to activate emergency kill switch', {
        component: 'CostAnomalyGuardService',
        operation: 'activateEmergencyKillSwitch',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get number of unique days in history
   */
  private getUniqueDays(history: Array<{ timestamp: Date }>): number {
    const days = new Set<string>();
    for (const entry of history) {
      days.add(entry.timestamp.toISOString().split('T')[0]);
    }
    return days.size;
  }

  // ============================================================================
  // Additional methods from Express version
  // ============================================================================

  /**
   * Validate cost impact of an execution plan
   * This is the main entry point for cost validation
   */
  validateExecutionPlanCost(
    plan: ExecutionPlanForCost,
    customerId: string,
    currentMonthlyCost?: number,
  ): CostValidation {
    const thresholds = this.getThresholds(customerId);

    // Check rate limit first
    const rateLimitCheck = this.checkRateLimit(customerId);
    if (!rateLimitCheck.allowed) {
      return {
        allowed: false,
        reason: rateLimitCheck.reason,
        recommendation: 'Wait for rate limit to reset',
        riskLevel: 'medium',
      };
    }

    // Predict cost impact
    const prediction = this.predictCostImpactForPlan(plan, currentMonthlyCost);

    // Check percent increase threshold
    if (prediction.percentIncrease > thresholds.costIncreasePercent) {
      this.recordAlert(
        customerId,
        'cost_increase',
        `Cost increase of ${prediction.percentIncrease.toFixed(1)}% exceeds threshold of ${thresholds.costIncreasePercent}%`,
        'warning',
      );

      return {
        allowed: false,
        reason: `Cost increase of ${prediction.percentIncrease.toFixed(1)}% exceeds threshold`,
        recommendation:
          'Require explicit approval or break into smaller operations',
        riskLevel: 'high',
      };
    }

    // Check absolute increase threshold
    if (prediction.absoluteIncrease > thresholds.costIncreaseAbsolute) {
      this.recordAlert(
        customerId,
        'cost_increase',
        `Cost increase of $${prediction.absoluteIncrease.toFixed(2)} exceeds threshold of $${thresholds.costIncreaseAbsolute}`,
        'critical',
      );

      return {
        allowed: false,
        reason: `Cost increase of $${prediction.absoluteIncrease.toFixed(2)} exceeds limit`,
        recommendation:
          'Break into smaller operations or get explicit approval',
        riskLevel: 'critical',
      };
    }

    // Check for unexpected regions
    if (thresholds.unexpectedRegions) {
      const unexpectedRegions = plan.regions.filter(
        (r) => !EXPECTED_REGIONS.has(r),
      );
      if (unexpectedRegions.length > 0) {
        this.recordAlert(
          customerId,
          'unexpected_region',
          `Operations in unexpected regions: ${unexpectedRegions.join(', ')}`,
          'warning',
        );

        return {
          allowed: false,
          reason: `Operations in unexpected regions: ${unexpectedRegions.join(', ')}`,
          recommendation:
            'Verify region selection or add regions to expected list',
          riskLevel: 'medium',
        };
      }
    }

    // Increment API call count
    this.incrementApiCallCount(customerId);

    // Determine risk level based on cost impact
    let riskLevel: CostValidation['riskLevel'] = 'low';
    if (prediction.absoluteIncrease > thresholds.costIncreaseAbsolute * 0.5) {
      riskLevel = 'medium';
    }
    if (prediction.percentIncrease > thresholds.costIncreasePercent * 0.5) {
      riskLevel = 'medium';
    }

    return {
      allowed: true,
      riskLevel,
    };
  }

  /**
   * Predict cost impact of a plan
   */
  predictCostImpactForPlan(
    plan: ExecutionPlanForCost,
    currentMonthlyCost?: number,
  ): CostPrediction {
    const estimatedCost = plan.estimatedCostImpact;
    const baseCost = currentMonthlyCost || 1000; // Default to $1000 if unknown

    const absoluteIncrease = Math.max(0, estimatedCost);
    const percentIncrease = (absoluteIncrease / baseCost) * 100;

    return {
      percentIncrease,
      absoluteIncrease,
      monthlyCostBefore: baseCost,
      monthlyCostAfter: baseCost + estimatedCost,
      confidence: currentMonthlyCost ? 'high' : 'low',
    };
  }

  /**
   * Record cost metrics after execution (simplified version)
   */
  async recordCostMetricsForCustomer(
    customerId: string,
    costChange: number,
    action: string,
  ): Promise<void> {
    try {
      // Update customer metrics
      let metrics = await this.customerMetricsModel
        .findOne({ customerId })
        .exec();
      if (!metrics) {
        metrics = new this.customerMetricsModel({
          customerId,
          totalCostIncrease: 0,
          totalCostDecrease: 0,
          netCostChange: 0,
          actionsExecuted: 0,
          anomalyCount: 0,
          budgetLimit: 0,
          lastUpdated: new Date(),
        });
      }

      if (costChange > 0) {
        metrics.totalCostIncrease += costChange;
      } else {
        metrics.totalCostDecrease += Math.abs(costChange);
      }
      metrics.netCostChange += costChange;
      metrics.actionsExecuted += 1;
      metrics.lastUpdated = new Date();

      await metrics.save();

      // Update global metrics (stored as customerId: 'global')
      let globalMetrics = await this.customerMetricsModel
        .findOne({ customerId: 'global' })
        .exec();
      if (!globalMetrics) {
        globalMetrics = new this.customerMetricsModel({
          customerId: 'global',
          totalCostIncrease: 0,
          totalCostDecrease: 0,
          netCostChange: 0,
          actionsExecuted: 0,
          anomalyCount: 0,
          budgetLimit: 0,
          lastUpdated: new Date(),
        });
      }

      if (costChange > 0) {
        globalMetrics.totalCostIncrease += costChange;
      } else {
        globalMetrics.totalCostDecrease += Math.abs(costChange);
      }
      globalMetrics.netCostChange += costChange;
      globalMetrics.actionsExecuted += 1;
      globalMetrics.lastUpdated = new Date();

      await globalMetrics.save();

      this.logger.log('Cost metrics recorded', {
        component: 'CostAnomalyGuardService',
        operation: 'recordCostMetricsForCustomer',
        customerId,
        costChange,
        action,
        netCostChange: metrics.netCostChange,
      });
    } catch (error) {
      this.logger.error('Failed to record cost metrics for customer', {
        component: 'CostAnomalyGuardService',
        operation: 'recordCostMetricsForCustomer',
        customerId,
        costChange,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Self-monitoring: Check if CostKatana is increasing costs more than reducing
   * Runs every minute via @Interval decorator
   */
  @Interval(60000) // Every minute
  async selfMonitor(): Promise<void> {
    try {
      // Get global metrics from database
      const globalMetrics = await this.customerMetricsModel
        .findOne({ customerId: 'global' })
        .exec();

      // Only check if we have significant data
      if (!globalMetrics || globalMetrics.actionsExecuted < 10) {
        return;
      }

      // Check if we're increasing costs more than decreasing
      if (globalMetrics.totalCostIncrease > globalMetrics.totalCostDecrease) {
        const ratio =
          globalMetrics.totalCostIncrease /
          (globalMetrics.totalCostDecrease || 1);

        if (ratio > 1.5) {
          // Critical: We're increasing costs significantly more than reducing
          await this.recordAlert(
            'system',
            'self_monitoring',
            `CostKatana is increasing costs ${ratio.toFixed(1)}x more than reducing. ` +
              `Increase: $${globalMetrics.totalCostIncrease.toFixed(2)}, ` +
              `Decrease: $${globalMetrics.totalCostDecrease.toFixed(2)}`,
            'critical',
          );

          this.logger.error(
            'CRITICAL: CostKatana increasing costs more than reducing',
            {
              component: 'CostAnomalyGuardService',
              operation: 'selfMonitor',
              totalIncrease: globalMetrics.totalCostIncrease,
              totalDecrease: globalMetrics.totalCostDecrease,
              ratio,
            },
          );

          // Auto-switch to read-only mode via kill switch
          this.killSwitchService
            .activateKillSwitch({
              scope: 'global',
              reason: 'cost_anomaly',
              activatedBy: 'CostAnomalyGuardService',
              notes: `Cost increase ratio ${ratio.toFixed(1)}x exceeds safe threshold`,
            })
            .catch((error) => {
              this.logger.error(
                'Failed to activate kill switch from self-monitor',
                {
                  component: 'CostAnomalyGuardService',
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            });
        }
      }
    } catch (error) {
      this.logger.error('Failed to run self-monitor', {
        component: 'CostAnomalyGuardService',
        operation: 'selfMonitor',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check rate limit for a customer
   */
  private checkRateLimit(customerId: string): {
    allowed: boolean;
    reason?: string;
  } {
    const thresholds = this.getThresholds(customerId);
    const callData = this.apiCallCounts.get(customerId);

    if (!callData) {
      return { allowed: true };
    }

    if (callData.count >= thresholds.apiCallsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${callData.count}/${thresholds.apiCallsPerMinute} calls per minute`,
      };
    }

    return { allowed: true };
  }

  /**
   * Increment API call count for rate limiting
   */
  private incrementApiCallCount(customerId: string): void {
    let callData = this.apiCallCounts.get(customerId);

    if (!callData) {
      callData = { count: 0, windowStart: new Date() };
      this.apiCallCounts.set(customerId, callData);
    }

    callData.count += 1;
  }

  /**
   * Reset rate limits (called every minute)
   */
  @Interval(60000)
  resetRateLimits(): void {
    this.apiCallCounts.clear();
  }

  /**
   * Get thresholds for a customer (custom or default)
   */
  getThresholds(customerId: string): CostThresholds {
    return this.customerThresholds.get(customerId) || DEFAULT_THRESHOLDS;
  }

  /**
   * Set custom thresholds for a customer
   */
  setCustomerThresholds(
    customerId: string,
    thresholds: Partial<CostThresholds>,
  ): void {
    const current = this.getThresholds(customerId);
    this.customerThresholds.set(customerId, {
      ...current,
      ...thresholds,
    });

    this.logger.log('Customer thresholds updated', {
      component: 'CostAnomalyGuardService',
      operation: 'setCustomerThresholds',
      customerId,
      thresholds,
    });
  }

  /**
   * Record an alert
   */
  private async recordAlert(
    customerId: string,
    type:
      | 'cost_increase'
      | 'rate_limit'
      | 'unexpected_region'
      | 'self_monitoring',
    message: string,
    severity: 'warning' | 'critical',
  ): Promise<void> {
    try {
      await this.costAlertModel.create({
        customerId,
        type,
        message,
        severity,
        acknowledged: false,
      });

      // Clean up old alerts (keep only last 1000 per customer)
      const customerAlerts = await this.costAlertModel
        .find({ customerId })
        .sort({ createdAt: -1 })
        .skip(1000)
        .select('_id')
        .exec();

      if (customerAlerts.length > 0) {
        await this.costAlertModel.deleteMany({
          _id: { $in: customerAlerts.map((a) => a._id) },
        });
      }

      this.logger.warn('Cost anomaly alert', {
        component: 'CostAnomalyGuardService',
        operation: 'recordAlert',
        customerId,
        type,
        message,
        severity,
      });
    } catch (error) {
      this.logger.error('Failed to record alert', {
        component: 'CostAnomalyGuardService',
        operation: 'recordAlert',
        customerId,
        type,
        message,
        severity,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cost metrics for a customer
   */
  async getCustomerMetrics(
    customerId: string,
  ): Promise<CustomerCostMetrics | null> {
    try {
      return await this.customerMetricsModel.findOne({ customerId }).exec();
    } catch (error) {
      this.logger.error('Failed to get customer metrics', {
        component: 'CostAnomalyGuardService',
        operation: 'getCustomerMetrics',
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get global metrics
   */
  async getGlobalMetrics(): Promise<CustomerCostMetrics | null> {
    return await this.getCustomerMetrics('global');
  }

  /**
   * Get alert history
   */
  async getAlertHistory(
    customerId?: string,
    limit: number = 100,
  ): Promise<CostAlert[]> {
    try {
      let query = this.costAlertModel.find();

      if (customerId) {
        query = query.where('customerId').equals(customerId);
      }

      return await query.sort({ createdAt: -1 }).limit(limit).exec();
    } catch (error) {
      this.logger.error('Failed to get alert history', {
        component: 'CostAnomalyGuardService',
        operation: 'getAlertHistory',
        customerId,
        limit,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get default thresholds
   */
  getDefaultThresholds(): CostThresholds {
    return { ...DEFAULT_THRESHOLDS };
  }

  /**
   * Add region to expected regions
   */
  addExpectedRegion(region: string): void {
    EXPECTED_REGIONS.add(region);

    this.logger.log('Added expected region', {
      component: 'CostAnomalyGuardService',
      operation: 'addExpectedRegion',
      region,
    });
  }

  /**
   * Get expected regions
   */
  getExpectedRegions(): string[] {
    return Array.from(EXPECTED_REGIONS);
  }

  /**
   * Reset global metrics (admin operation)
   */
  async resetGlobalMetrics(): Promise<void> {
    try {
      await this.customerMetricsModel
        .findOneAndUpdate(
          { customerId: 'global' },
          {
            totalCostIncrease: 0,
            totalCostDecrease: 0,
            netCostChange: 0,
            actionsExecuted: 0,
            anomalyCount: 0,
            lastUpdated: new Date(),
          },
          { upsert: true, new: true },
        )
        .exec();

      this.logger.log('Global metrics reset', {
        component: 'CostAnomalyGuardService',
        operation: 'resetGlobalMetrics',
      });
    } catch (error) {
      this.logger.error('Failed to reset global metrics', {
        component: 'CostAnomalyGuardService',
        operation: 'resetGlobalMetrics',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find idle EC2 instances based on CPU utilization metrics
   *
   * Analyzes CloudWatch CPU metrics to identify instances with low utilization
   * that could be candidates for stopping to save costs.
   *
   * @param instanceIds - List of instance IDs to analyze
   * @param cpuThreshold - CPU percentage threshold (default: 5%)
   * @param days - Number of days to look back for metrics (default: 7)
   * @param region - AWS region
   * @returns Array of instance IDs that are considered idle
   */
  async findIdleEC2Instances(
    instanceIds: string[],
    cpuThreshold: number = 5,
    days: number = 7,
    region?: string,
  ): Promise<string[]> {
    // Import CloudWatch service dynamically to avoid circular dependency
    const { CloudWatchClient, GetMetricStatisticsCommand } =
      await import('@aws-sdk/client-cloudwatch');

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const idleInstances: string[] = [];

    for (const instanceId of instanceIds) {
      try {
        // Get CPU utilization metrics for the instance
        const cloudWatchClient = new CloudWatchClient({
          region: region || 'us-east-1',
        });

        const command = new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour granularity
          Statistics: ['Average'],
        });

        const response = await cloudWatchClient.send(command);

        const dataPoints = response.Datapoints || [];

        if (dataPoints.length > 0) {
          const avgCpu =
            dataPoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) /
            dataPoints.length;

          if (avgCpu < cpuThreshold) {
            idleInstances.push(instanceId);

            this.logger.log('Idle EC2 instance detected', {
              component: 'CostAnomalyGuardService',
              operation: 'findIdleEC2Instances',
              instanceId,
              averageCpu: avgCpu.toFixed(2),
              threshold: cpuThreshold,
              days,
              region: region || 'us-east-1',
            });
          }
        } else {
          // No metrics available - instance might be stopped or new
          this.logger.debug('No CPU metrics available for instance', {
            component: 'CostAnomalyGuardService',
            operation: 'findIdleEC2Instances',
            instanceId,
            region: region || 'us-east-1',
          });
        }
      } catch (error) {
        this.logger.warn('Failed to get metrics for instance', {
          component: 'CostAnomalyGuardService',
          operation: 'findIdleEC2Instances',
          instanceId,
          region: region || 'us-east-1',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log('Idle EC2 instances analysis completed', {
      component: 'CostAnomalyGuardService',
      operation: 'findIdleEC2Instances',
      totalInstances: instanceIds.length,
      idleInstances: idleInstances.length,
      cpuThreshold,
      days,
      region: region || 'us-east-1',
    });

    return idleInstances;
  }
}
