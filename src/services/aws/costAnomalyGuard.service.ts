import { loggingService } from '../logging.service';
import { killSwitchService } from './killSwitch.service';

/**
 * Cost Anomaly Guard Service - Cost Protection
 * 
 * Security Guarantees:
 * - Cost increase threshold checks (20% / $1000)
 * - Rate limit API calls per minute
 * - Unexpected region flagging
 * - Self-monitoring: alert if CostKatana increases costs more than reduces
 * - Auto-switch to read-only mode on anomaly
 */

export interface CostThresholds {
  costIncreasePercent: number;    // 20% increase triggers alert
  costIncreaseAbsolute: number;   // $1000 increase triggers freeze
  apiCallsPerMinute: number;      // Rate limit
  unexpectedRegions: boolean;     // Flag new regions
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

export interface CostMetrics {
  totalCostIncrease: number;
  totalCostDecrease: number;
  netCostChange: number;
  actionsExecuted: number;
  lastUpdated: Date;
}

export interface ExecutionPlanForCost {
  planId: string;
  estimatedCostImpact: number;
  resourceCount: number;
  service: string;
  action: string;
  regions: string[];
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

class CostAnomalyGuardService {
  private static instance: CostAnomalyGuardService;
  
  // Custom thresholds per customer
  private customerThresholds: Map<string, CostThresholds> = new Map();
  
  // Cost metrics tracking
  private costMetrics: Map<string, CostMetrics> = new Map();
  
  // Global metrics (for self-monitoring)
  private globalMetrics: CostMetrics = {
    totalCostIncrease: 0,
    totalCostDecrease: 0,
    netCostChange: 0,
    actionsExecuted: 0,
    lastUpdated: new Date(),
  };
  
  // API call rate tracking
  private apiCallCounts: Map<string, { count: number; windowStart: Date }> = new Map();
  
  // Alert history
  private alertHistory: Array<{
    timestamp: Date;
    customerId: string;
    type: 'cost_increase' | 'rate_limit' | 'unexpected_region' | 'self_monitoring';
    message: string;
    severity: 'warning' | 'critical';
  }> = [];
  
  private constructor() {
    // Start self-monitoring interval
    setInterval(() => this.selfMonitor(), 60000); // Every minute
    
    // Reset rate limits every minute
    setInterval(() => this.resetRateLimits(), 60000);
  }
  
  public static getInstance(): CostAnomalyGuardService {
    if (!CostAnomalyGuardService.instance) {
      CostAnomalyGuardService.instance = new CostAnomalyGuardService();
    }
    return CostAnomalyGuardService.instance;
  }
  
  /**
   * Validate cost impact of an execution plan
   * This is the main entry point for cost validation
   */
  public async validateCostImpact(
    plan: ExecutionPlanForCost,
    customerId: string,
    currentMonthlyCost?: number
  ): Promise<CostValidation> {
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
    const prediction = this.predictCostImpact(plan, currentMonthlyCost);
    
    // Check percent increase threshold
    if (prediction.percentIncrease > thresholds.costIncreasePercent) {
      this.recordAlert(customerId, 'cost_increase', 
        `Cost increase of ${prediction.percentIncrease.toFixed(1)}% exceeds threshold of ${thresholds.costIncreasePercent}%`,
        'warning'
      );
      
      return {
        allowed: false,
        reason: `Cost increase of ${prediction.percentIncrease.toFixed(1)}% exceeds threshold`,
        recommendation: 'Require explicit approval or break into smaller operations',
        riskLevel: 'high',
      };
    }
    
    // Check absolute increase threshold
    if (prediction.absoluteIncrease > thresholds.costIncreaseAbsolute) {
      this.recordAlert(customerId, 'cost_increase',
        `Cost increase of $${prediction.absoluteIncrease.toFixed(2)} exceeds threshold of $${thresholds.costIncreaseAbsolute}`,
        'critical'
      );
      
      return {
        allowed: false,
        reason: `Cost increase of $${prediction.absoluteIncrease.toFixed(2)} exceeds limit`,
        recommendation: 'Break into smaller operations or get explicit approval',
        riskLevel: 'critical',
      };
    }
    
    // Check for unexpected regions
    if (thresholds.unexpectedRegions) {
      const unexpectedRegions = plan.regions.filter(r => !EXPECTED_REGIONS.has(r));
      if (unexpectedRegions.length > 0) {
        this.recordAlert(customerId, 'unexpected_region',
          `Operations in unexpected regions: ${unexpectedRegions.join(', ')}`,
          'warning'
        );
        
        return {
          allowed: false,
          reason: `Operations in unexpected regions: ${unexpectedRegions.join(', ')}`,
          recommendation: 'Verify region selection or add regions to expected list',
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
  public predictCostImpact(
    plan: ExecutionPlanForCost,
    currentMonthlyCost?: number
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
   * Record cost metrics after execution
   */
  public recordCostMetrics(
    customerId: string,
    costChange: number,
    action: string
  ): void {
    // Update customer metrics
    let metrics = this.costMetrics.get(customerId);
    if (!metrics) {
      metrics = {
        totalCostIncrease: 0,
        totalCostDecrease: 0,
        netCostChange: 0,
        actionsExecuted: 0,
        lastUpdated: new Date(),
      };
      this.costMetrics.set(customerId, metrics);
    }
    
    if (costChange > 0) {
      metrics.totalCostIncrease += costChange;
    } else {
      metrics.totalCostDecrease += Math.abs(costChange);
    }
    metrics.netCostChange += costChange;
    metrics.actionsExecuted += 1;
    metrics.lastUpdated = new Date();
    
    // Update global metrics
    if (costChange > 0) {
      this.globalMetrics.totalCostIncrease += costChange;
    } else {
      this.globalMetrics.totalCostDecrease += Math.abs(costChange);
    }
    this.globalMetrics.netCostChange += costChange;
    this.globalMetrics.actionsExecuted += 1;
    this.globalMetrics.lastUpdated = new Date();
    
    loggingService.info('Cost metrics recorded', {
      component: 'CostAnomalyGuardService',
      operation: 'recordCostMetrics',
      customerId,
      costChange,
      action,
      netCostChange: metrics.netCostChange,
    });
  }
  
  /**
   * Self-monitoring: Check if CostKatana is increasing costs more than reducing
   */
  private selfMonitor(): void {
    // Only check if we have significant data
    if (this.globalMetrics.actionsExecuted < 10) {
      return;
    }
    
    // Check if we're increasing costs more than decreasing
    if (this.globalMetrics.totalCostIncrease > this.globalMetrics.totalCostDecrease) {
      const ratio = this.globalMetrics.totalCostIncrease / 
                   (this.globalMetrics.totalCostDecrease || 1);
      
      if (ratio > 1.5) {
        // Critical: We're increasing costs significantly more than reducing
        this.recordAlert('system', 'self_monitoring',
          `CostKatana is increasing costs ${ratio.toFixed(1)}x more than reducing. ` +
          `Increase: $${this.globalMetrics.totalCostIncrease.toFixed(2)}, ` +
          `Decrease: $${this.globalMetrics.totalCostDecrease.toFixed(2)}`,
          'critical'
        );
        
        loggingService.error('CRITICAL: CostKatana increasing costs more than reducing', {
          component: 'CostAnomalyGuardService',
          operation: 'selfMonitor',
          totalIncrease: this.globalMetrics.totalCostIncrease,
          totalDecrease: this.globalMetrics.totalCostDecrease,
          ratio,
        });
        
        // Auto-switch to read-only mode
        killSwitchService.enableReadOnlyMode(
          'CostAnomalyGuard',
          'cost_anomaly'
        );
      }
    }
  }
  
  /**
   * Check rate limit for a customer
   */
  private checkRateLimit(customerId: string): { allowed: boolean; reason?: string } {
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
  private resetRateLimits(): void {
    this.apiCallCounts.clear();
  }
  
  /**
   * Get thresholds for a customer (custom or default)
   */
  private getThresholds(customerId: string): CostThresholds {
    return this.customerThresholds.get(customerId) || DEFAULT_THRESHOLDS;
  }
  
  /**
   * Set custom thresholds for a customer
   */
  public setCustomerThresholds(
    customerId: string,
    thresholds: Partial<CostThresholds>
  ): void {
    const current = this.getThresholds(customerId);
    this.customerThresholds.set(customerId, {
      ...current,
      ...thresholds,
    });
    
    loggingService.info('Customer thresholds updated', {
      component: 'CostAnomalyGuardService',
      operation: 'setCustomerThresholds',
      customerId,
      thresholds,
    });
  }
  
  /**
   * Record an alert
   */
  private recordAlert(
    customerId: string,
    type: 'cost_increase' | 'rate_limit' | 'unexpected_region' | 'self_monitoring',
    message: string,
    severity: 'warning' | 'critical'
  ): void {
    this.alertHistory.push({
      timestamp: new Date(),
      customerId,
      type,
      message,
      severity,
    });
    
    // Keep only last 1000 alerts
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-1000);
    }
    
    loggingService.warn('Cost anomaly alert', {
      component: 'CostAnomalyGuardService',
      operation: 'recordAlert',
      customerId,
      type,
      message,
      severity,
    });
  }
  
  /**
   * Get cost metrics for a customer
   */
  public getCustomerMetrics(customerId: string): CostMetrics | null {
    return this.costMetrics.get(customerId) || null;
  }
  
  /**
   * Get global metrics
   */
  public getGlobalMetrics(): CostMetrics {
    return { ...this.globalMetrics };
  }
  
  /**
   * Get alert history
   */
  public getAlertHistory(
    customerId?: string,
    limit: number = 100
  ): typeof this.alertHistory {
    let alerts = [...this.alertHistory];
    
    if (customerId) {
      alerts = alerts.filter(a => a.customerId === customerId);
    }
    
    return alerts.slice(-limit);
  }
  
  /**
   * Get default thresholds
   */
  public getDefaultThresholds(): CostThresholds {
    return { ...DEFAULT_THRESHOLDS };
  }
  
  /**
   * Add region to expected regions
   */
  public addExpectedRegion(region: string): void {
    EXPECTED_REGIONS.add(region);
    
    loggingService.info('Added expected region', {
      component: 'CostAnomalyGuardService',
      operation: 'addExpectedRegion',
      region,
    });
  }
  
  /**
   * Get expected regions
   */
  public getExpectedRegions(): string[] {
    return Array.from(EXPECTED_REGIONS);
  }
  
  /**
   * Reset global metrics (admin operation)
   */
  public resetGlobalMetrics(): void {
    this.globalMetrics = {
      totalCostIncrease: 0,
      totalCostDecrease: 0,
      netCostChange: 0,
      actionsExecuted: 0,
      lastUpdated: new Date(),
    };
    
    loggingService.info('Global metrics reset', {
      component: 'CostAnomalyGuardService',
      operation: 'resetGlobalMetrics',
    });
  }
}

export const costAnomalyGuardService = CostAnomalyGuardService.getInstance();
