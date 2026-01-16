import { Types } from 'mongoose';
import { loggingService } from '../logging.service';
import { planGeneratorService } from './planGenerator.service';
import { permissionBoundaryService } from './permissionBoundary.service';
import { AWSConnection, IAWSConnection } from '../../models/AWSConnection';
import { ExecutionPlan, ExecutionStep } from '../../types/awsDsl.types';

/**
 * Simulation Engine Service - Dry-Run Execution
 * 
 * Security Guarantees:
 * - Dry-run execution without AWS API calls
 * - Permission validation simulation
 * - Cost impact prediction
 * - Plan storage with simulation results
 * - Promotion workflow after simulation period
 * - Supports enterprise "simulate for N days before live" requirement
 */

export interface SimulationResult {
  planId: string;
  status: 'simulated' | 'failed';
  steps: SimulatedStep[];
  startedAt: Date;
  completedAt: Date;
  duration: number;
  
  // Simulation-specific
  permissionValidation: PermissionValidationResult;
  costPrediction: CostPrediction;
  riskAssessment: RiskAssessment;
  
  // Promotion info
  canPromoteToLive: boolean;
  promotionBlockers?: string[];
  simulationPeriodRemaining?: number;  // days
}

export interface SimulatedStep {
  stepId: string;
  action: string;
  description: string;
  simulationStatus: 'would_succeed' | 'would_fail' | 'unknown';
  permissionCheck: {
    allowed: boolean;
    reason?: string;
  };
  estimatedDuration: number;
  estimatedCost: number;
  warnings: string[];
}

export interface PermissionValidationResult {
  valid: boolean;
  checkedPermissions: Array<{
    action: string;
    allowed: boolean;
    reason?: string;
  }>;
  missingPermissions: string[];
}

export interface CostPrediction {
  immediate: number;  // One-time cost
  hourly: number;
  daily: number;
  monthly: number;
  annual: number;
  confidence: 'high' | 'medium' | 'low';
  breakdown: Array<{
    resource: string;
    costChange: number;
    reason: string;
  }>;
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;  // 0-100
  factors: Array<{
    factor: string;
    impact: 'low' | 'medium' | 'high';
    description: string;
  }>;
  mitigations: string[];
}

class SimulationEngineService {
  private static instance: SimulationEngineService;
  
  // Stored simulation results (for promotion workflow)
  private simulationResults: Map<string, {
    result: SimulationResult;
    connectionId: string;
    userId: string;
    simulatedAt: Date;
  }> = new Map();
  
  private constructor() {
    // Clean up old simulations periodically
    setInterval(() => this.cleanupOldSimulations(), 3600000); // Every hour
  }
  
  public static getInstance(): SimulationEngineService {
    if (!SimulationEngineService.instance) {
      SimulationEngineService.instance = new SimulationEngineService();
    }
    return SimulationEngineService.instance;
  }
  
  /**
   * Simulate execution of a plan without making actual AWS API calls
   */
  public async simulate(
    plan: ExecutionPlan,
    connection: IAWSConnection
  ): Promise<SimulationResult> {
    const startedAt = new Date();
    
    loggingService.info('Starting simulation', {
      component: 'SimulationEngineService',
      operation: 'simulate',
      planId: plan.planId,
      connectionId: connection._id.toString(),
    });
    
    // Validate plan
    const planValidation = planGeneratorService.validatePlan(plan);
    if (!planValidation.valid) {
      throw new Error(`Plan validation failed: ${planValidation.reason}`);
    }
    
    // Simulate each step
    const simulatedSteps: SimulatedStep[] = [];
    let allStepsWouldSucceed = true;
    
    for (const step of plan.steps) {
      const simulatedStep = await this.simulateStep(step, connection);
      simulatedSteps.push(simulatedStep);
      
      if (simulatedStep.simulationStatus !== 'would_succeed') {
        allStepsWouldSucceed = false;
      }
    }
    
    // Validate permissions
    const permissionValidation = this.validatePermissions(plan, connection);
    
    // Predict costs
    const costPrediction = this.predictCosts(simulatedSteps);
    
    // Assess risks
    const riskAssessment = this.assessRisks(plan, simulatedSteps, connection);
    
    // Check if can promote to live
    const { canPromote, blockers, daysRemaining } = this.checkPromotionEligibility(
      connection,
      allStepsWouldSucceed,
      permissionValidation.valid,
      riskAssessment.overallRisk
    );
    
    const result: SimulationResult = {
      planId: plan.planId,
      status: allStepsWouldSucceed ? 'simulated' : 'failed',
      steps: simulatedSteps,
      startedAt,
      completedAt: new Date(),
      duration: Date.now() - startedAt.getTime(),
      permissionValidation,
      costPrediction,
      riskAssessment,
      canPromoteToLive: canPromote,
      promotionBlockers: blockers,
      simulationPeriodRemaining: daysRemaining,
    };
    
    // Store simulation result
    this.simulationResults.set(plan.planId, {
      result,
      connectionId: connection._id.toString(),
      userId: connection.userId.toString(),
      simulatedAt: new Date(),
    });
    
    loggingService.info('Simulation completed', {
      component: 'SimulationEngineService',
      operation: 'simulate',
      planId: plan.planId,
      status: result.status,
      canPromoteToLive: result.canPromoteToLive,
    });
    
    return result;
  }
  
  /**
   * Simulate a single step
   */
  private async simulateStep(
    step: ExecutionStep,
    connection: IAWSConnection
  ): Promise<SimulatedStep> {
    const warnings: string[] = [];
    
    // Check permissions for this step
    let permissionCheck = { allowed: true, reason: undefined as string | undefined };
    
    if (!step.action.startsWith('precheck:') && !step.action.startsWith('postcheck:')) {
      const validation = permissionBoundaryService.validateAction(
        {
          service: step.service,
          action: step.apiCalls[0]?.operation || step.action,
          resources: step.resources,
        },
        connection
      );
      
      permissionCheck = {
        allowed: validation.allowed,
        reason: validation.reason,
      };
      
      warnings.push(...validation.warnings);
    }
    
    // Determine simulation status
    let simulationStatus: 'would_succeed' | 'would_fail' | 'unknown' = 'unknown';
    
    if (!permissionCheck.allowed) {
      simulationStatus = 'would_fail';
    } else if (step.action.startsWith('precheck:') || step.action.startsWith('postcheck:')) {
      simulationStatus = 'would_succeed';
    } else {
      // For actual actions, we assume success if permissions are OK
      simulationStatus = 'would_succeed';
    }
    
    // Add warnings for high-risk actions
    if (step.impact.riskLevel === 'high' || step.impact.riskLevel === 'critical') {
      warnings.push(`High-risk action: ${step.description}`);
    }
    
    if (step.impact.downtime) {
      warnings.push('This action may cause downtime');
    }
    
    if (step.impact.dataLoss) {
      warnings.push('This action may result in data loss');
    }
    
    return {
      stepId: step.stepId,
      action: step.action,
      description: step.description,
      simulationStatus,
      permissionCheck,
      estimatedDuration: step.apiCalls.reduce(
        (sum, call) => sum + (call.expectedDuration || 60), 0
      ),
      estimatedCost: step.impact.costChange,
      warnings,
    };
  }
  
  /**
   * Validate all permissions for a plan
   */
  private validatePermissions(
    plan: ExecutionPlan,
    connection: IAWSConnection
  ): PermissionValidationResult {
    const checkedPermissions: PermissionValidationResult['checkedPermissions'] = [];
    const missingPermissions: string[] = [];
    
    for (const step of plan.steps) {
      if (step.action.startsWith('precheck:') || step.action.startsWith('postcheck:')) {
        continue;
      }
      
      for (const apiCall of step.apiCalls) {
        const action = `${apiCall.service}:${apiCall.operation}`;
        
        const validation = permissionBoundaryService.validateAction(
          {
            service: apiCall.service.toLowerCase(),
            action: apiCall.operation,
            resources: step.resources,
          },
          connection
        );
        
        checkedPermissions.push({
          action,
          allowed: validation.allowed,
          reason: validation.reason,
        });
        
        if (!validation.allowed) {
          missingPermissions.push(action);
        }
      }
    }
    
    return {
      valid: missingPermissions.length === 0,
      checkedPermissions,
      missingPermissions,
    };
  }
  
  /**
   * Predict costs for a plan
   */
  private predictCosts(
    simulatedSteps: SimulatedStep[]
  ): CostPrediction {
    let totalMonthlyCost = 0;
    const breakdown: CostPrediction['breakdown'] = [];
    
    for (const step of simulatedSteps) {
      totalMonthlyCost += step.estimatedCost;
      
      if (step.estimatedCost !== 0) {
        breakdown.push({
          resource: step.description,
          costChange: step.estimatedCost,
          reason: step.estimatedCost < 0 ? 'Resource optimization' : 'Resource activation',
        });
      }
    }
    
    // Calculate other timeframes
    const hourly = totalMonthlyCost / (30 * 24);
    const daily = totalMonthlyCost / 30;
    const annual = totalMonthlyCost * 12;
    
    // Determine confidence based on data quality
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (breakdown.length > 0 && simulatedSteps.every(s => s.simulationStatus === 'would_succeed')) {
      confidence = 'high';
    } else if (simulatedSteps.some(s => s.simulationStatus === 'unknown')) {
      confidence = 'low';
    }
    
    return {
      immediate: 0,  // No immediate cost for most operations
      hourly,
      daily,
      monthly: totalMonthlyCost,
      annual,
      confidence,
      breakdown,
    };
  }
  
  /**
   * Assess risks for a plan
   */
  private assessRisks(
    plan: ExecutionPlan,
    simulatedSteps: SimulatedStep[],
    connection: IAWSConnection
  ): RiskAssessment {
    const factors: RiskAssessment['factors'] = [];
    const mitigations: string[] = [];
    let riskScore = 0;
    
    // Check resource count
    if (plan.summary.resourcesAffected > 10) {
      factors.push({
        factor: 'High resource count',
        impact: 'high',
        description: `${plan.summary.resourcesAffected} resources will be affected`,
      });
      riskScore += 20;
      mitigations.push('Consider splitting into smaller batches');
    }
    
    // Check for production environment
    if (connection.environment === 'production') {
      factors.push({
        factor: 'Production environment',
        impact: 'high',
        description: 'Changes will affect production resources',
      });
      riskScore += 30;
      mitigations.push('Test in staging environment first');
      mitigations.push('Schedule during maintenance window');
    }
    
    // Check for downtime
    if (simulatedSteps.some(s => s.warnings.some(w => w.includes('downtime')))) {
      factors.push({
        factor: 'Potential downtime',
        impact: 'high',
        description: 'Some actions may cause service interruption',
      });
      riskScore += 25;
      mitigations.push('Notify stakeholders before execution');
    }
    
    // Check reversibility
    if (!plan.summary.reversible) {
      factors.push({
        factor: 'Non-reversible action',
        impact: 'high',
        description: 'Some changes cannot be automatically rolled back',
      });
      riskScore += 20;
      mitigations.push('Create backups before proceeding');
    }
    
    // Check permission failures
    const failedSteps = simulatedSteps.filter(s => s.simulationStatus === 'would_fail');
    if (failedSteps.length > 0) {
      factors.push({
        factor: 'Permission issues',
        impact: 'high',
        description: `${failedSteps.length} steps would fail due to permission issues`,
      });
      riskScore += 30;
      mitigations.push('Review and update IAM role permissions');
    }
    
    // Determine overall risk level
    let overallRisk: RiskAssessment['overallRisk'] = 'low';
    if (riskScore >= 75) {
      overallRisk = 'critical';
    } else if (riskScore >= 50) {
      overallRisk = 'high';
    } else if (riskScore >= 25) {
      overallRisk = 'medium';
    }
    
    return {
      overallRisk,
      riskScore: Math.min(riskScore, 100),
      factors,
      mitigations,
    };
  }
  
  /**
   * Check if a simulation can be promoted to live execution
   */
  private checkPromotionEligibility(
    connection: IAWSConnection,
    allStepsWouldSucceed: boolean,
    permissionsValid: boolean,
    riskLevel: RiskAssessment['overallRisk']
  ): { canPromote: boolean; blockers: string[]; daysRemaining?: number } {
    const blockers: string[] = [];
    
    // Check simulation mode
    if (connection.executionMode === 'simulation') {
      if (!connection.simulationConfig.startedAt) {
        blockers.push('Simulation period has not started');
      } else {
        const daysSinceStart = (Date.now() - connection.simulationConfig.startedAt.getTime()) / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.max(0, connection.simulationConfig.periodDays - daysSinceStart);
        
        if (daysRemaining > 0) {
          blockers.push(`Simulation period: ${Math.ceil(daysRemaining)} days remaining`);
          return { canPromote: false, blockers, daysRemaining };
        }
      }
    }
    
    // Check simulation results
    if (!allStepsWouldSucceed) {
      blockers.push('Some steps would fail - fix issues before promoting');
    }
    
    if (!permissionsValid) {
      blockers.push('Permission issues detected - update IAM role');
    }
    
    if (riskLevel === 'critical') {
      blockers.push('Critical risk level - review and mitigate risks');
    }
    
    return {
      canPromote: blockers.length === 0,
      blockers,
    };
  }
  
  /**
   * Get stored simulation result
   */
  public getSimulationResult(planId: string, userId: string): SimulationResult | null {
    const stored = this.simulationResults.get(planId);
    
    if (!stored || stored.userId !== userId) {
      return null;
    }
    
    return stored.result;
  }
  
  /**
   * Promote a connection from simulation to live mode
   */
  public async promoteToLive(
    connectionId: Types.ObjectId,
    userId: Types.ObjectId
  ): Promise<{ success: boolean; reason?: string }> {
    const connection = await AWSConnection.findOne({
      _id: connectionId,
      userId,
    });
    
    if (!connection) {
      return { success: false, reason: 'Connection not found' };
    }
    
    if (connection.executionMode === 'live') {
      return { success: false, reason: 'Connection is already in live mode' };
    }
    
    if (!connection.canExecuteLive()) {
      return { success: false, reason: 'Simulation period not completed' };
    }
    
    connection.executionMode = 'live';
    connection.simulationConfig.promotedToLiveAt = new Date();
    await connection.save();
    
    loggingService.info('Connection promoted to live mode', {
      component: 'SimulationEngineService',
      operation: 'promoteToLive',
      connectionId: connectionId.toString(),
      userId: userId.toString(),
    });
    
    return { success: true };
  }
  
  /**
   * Clean up old simulation results
   */
  private cleanupOldSimulations(): void {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    let cleaned = 0;
    
    for (const [planId, data] of this.simulationResults) {
      if (now - data.simulatedAt.getTime() > maxAge) {
        this.simulationResults.delete(planId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      loggingService.info('Cleaned up old simulation results', {
        component: 'SimulationEngineService',
        operation: 'cleanupOldSimulations',
        resultsRemoved: cleaned,
      });
    }
  }
}

export const simulationEngineService = SimulationEngineService.getInstance();
