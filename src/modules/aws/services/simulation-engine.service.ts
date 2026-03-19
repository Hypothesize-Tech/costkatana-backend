import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import { PlanGeneratorService } from './plan-generator.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '../../../schemas/integration/aws-connection.schema';
import {
  AwsSimulationResult,
  AwsSimulationResultDocument,
} from '../../../schemas/integration/aws-simulation-result.schema';
import { ExecutionPlan, ExecutionStep } from '../types/aws-dsl.types';

/**
 * Simulation Engine Service - Dry-run Execution with Safety Checks
 *
 * Security Guarantees:
 * - Zero actual AWS API calls during simulation
 * - Permission validation without execution
 * - Cost impact prediction
 * - Risk assessment and safety checks
 * - Simulation results stored for audit
 * - No side effects or state changes
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
  simulationPeriodRemaining?: number; // days
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
  immediate: number; // One-time cost
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
  riskScore: number; // 0-100
  factors: Array<{
    factor: string;
    impact: 'low' | 'medium' | 'high';
    description: string;
  }>;
  mitigations: string[];
}

@Injectable()
export class SimulationEngineService implements OnModuleInit, OnModuleDestroy {
  // Cleanup interval reference
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnectionDocument>,
    @InjectModel(AwsSimulationResult.name)
    private awsSimulationResultModel: Model<AwsSimulationResultDocument>,
    private readonly logger: LoggerService,
    private readonly planGeneratorService: PlanGeneratorService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
  ) {}

  onModuleInit() {
    // Start cleanup interval (every hour)
    this.cleanupInterval = setInterval(
      () => this.cleanupOldSimulations().catch((e) => this.logger.warn('Cleanup failed', e)),
      3600000,
    );
    this.logger.log('SimulationEngineService initialized', {
      component: 'SimulationEngineService',
      operation: 'onModuleInit',
    });
  }

  onModuleDestroy() {
    // Clean up interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Simulate execution of a plan without making actual AWS API calls
   */
  async simulate(
    plan: ExecutionPlan,
    connectionId: string,
    userId: string,
  ): Promise<SimulationResult> {
    const startedAt = new Date();

    this.logger.log('Starting simulation', {
      component: 'SimulationEngineService',
      operation: 'simulate',
      planId: plan.planId,
      connectionId,
      userId,
    });

    try {
      // Get connection details
      const connection = await this.awsConnectionModel.findOne({
        _id: connectionId,
        userId,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Validate plan
      const planValidation = this.planGeneratorService.validatePlan(plan);
      if (!planValidation.valid) {
        throw new Error(
          `Plan validation failed: ${planValidation.errors?.join(', ')}`,
        );
      }

      // Simulate each step
      const simulatedSteps: SimulatedStep[] = [];
      let allStepsWouldSucceed = true;

      for (const step of plan.steps) {
        const simulatedStep = this.simulateStep(step, connection);
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
      const { canPromote, blockers, daysRemaining } =
        this.checkPromotionEligibility(
          connection,
          allStepsWouldSucceed,
          permissionValidation.valid,
          riskAssessment.overallRisk,
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

      // Store simulation result in MongoDB for persistence across restarts
      await this.awsSimulationResultModel
        .findOneAndUpdate(
          { planId: plan.planId },
          {
            planId: plan.planId,
            userId: new Types.ObjectId(userId),
            connectionId: connection._id,
            result: result as unknown as Record<string, unknown>,
            simulatedAt: new Date(),
            updatedAt: new Date(),
          },
          { upsert: true, new: true },
        )
        .lean();

      this.logger.log('Simulation completed', {
        component: 'SimulationEngineService',
        operation: 'simulate',
        planId: plan.planId,
        status: result.status,
        canPromoteToLive: result.canPromoteToLive,
        stepCount: simulatedSteps.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Simulation failed', {
        component: 'SimulationEngineService',
        operation: 'simulate',
        planId: plan.planId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return failed simulation result
      return {
        planId: plan.planId,
        status: 'failed',
        steps: [],
        startedAt,
        completedAt: new Date(),
        duration: Date.now() - startedAt.getTime(),
        permissionValidation: {
          valid: false,
          checkedPermissions: [],
          missingPermissions: [],
        },
        costPrediction: {
          immediate: 0,
          hourly: 0,
          daily: 0,
          monthly: 0,
          annual: 0,
          confidence: 'low',
          breakdown: [],
        },
        riskAssessment: {
          overallRisk: 'critical',
          riskScore: 100,
          factors: [
            {
              factor: 'Simulation failure',
              impact: 'high',
              description:
                error instanceof Error
                  ? error.message
                  : 'Unknown error during simulation',
            },
          ],
          mitigations: ['Review error details and retry simulation'],
        },
        canPromoteToLive: false,
        promotionBlockers: [
          error instanceof Error
            ? error.message
            : 'Unknown error during simulation',
        ],
      };
    }
  }

  /**
   * Simulate a single step
   */
  private simulateStep(
    step: ExecutionStep,
    connection: AWSConnectionDocument,
  ): SimulatedStep {
    const warnings: string[] = [];

    // Check permissions for this step
    let permissionCheck: { allowed: boolean; reason?: string } = {
      allowed: true,
      reason: undefined,
    };

    if (
      !step.action.startsWith('precheck:') &&
      !step.action.startsWith('postcheck:')
    ) {
      const validation = this.permissionBoundaryService.validateAction(
        {
          service: step.service,
          action: step.action,
          region: connection.allowedRegions?.[0],
        },
        connection,
      );

      permissionCheck = {
        allowed: validation.allowed,
        reason: validation.reason,
      };
    }

    // Determine simulation status
    let simulationStatus: 'would_succeed' | 'would_fail' | 'unknown' =
      'unknown';

    if (!permissionCheck.allowed) {
      simulationStatus = 'would_fail';
    } else if (
      step.action.startsWith('precheck:') ||
      step.action.startsWith('postcheck:')
    ) {
      simulationStatus = 'would_succeed';
    } else {
      // For actual actions, we assume success if permissions are OK
      simulationStatus = 'would_succeed';
    }

    // Add warnings for high-risk actions based on step impact
    const stepImpact = step.impact;
    if (
      stepImpact.riskLevel === 'high' ||
      stepImpact.riskLevel === 'critical'
    ) {
      warnings.push(`High-risk action: ${step.description || step.action}`);
    }

    if (stepImpact.downtime) {
      warnings.push('This action may cause downtime');
    }

    if (stepImpact.dataLoss) {
      warnings.push('This action may result in data loss');
    }

    // Calculate estimated duration from API calls
    const estimatedDuration = step.apiCalls.reduce(
      (sum, call) => sum + (call.expectedDuration || 60),
      0,
    );

    return {
      stepId: step.stepId,
      action: step.action,
      description: step.description || step.action,
      simulationStatus,
      permissionCheck,
      estimatedDuration,
      estimatedCost: stepImpact.costChange,
      warnings,
    };
  }

  /**
   * Validate all permissions for a plan
   */
  private validatePermissions(
    plan: ExecutionPlan,
    connection: AWSConnectionDocument,
  ): PermissionValidationResult {
    const checkedPermissions: PermissionValidationResult['checkedPermissions'] =
      [];
    const missingPermissions: string[] = [];

    for (const step of plan.steps) {
      // Skip precheck/postcheck steps
      if (
        step.action.startsWith('precheck:') ||
        step.action.startsWith('postcheck:')
      ) {
        continue;
      }

      // Check permission for this step
      const action = `${step.service}:${step.action}`;

      const validation = this.permissionBoundaryService.validateAction(
        {
          service: step.service.toLowerCase(),
          action: step.action,
          region: connection.allowedRegions?.[0],
        },
        connection,
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

    return {
      valid: missingPermissions.length === 0,
      checkedPermissions,
      missingPermissions,
    };
  }

  /**
   * Predict costs for a plan
   */
  private predictCosts(simulatedSteps: SimulatedStep[]): CostPrediction {
    let totalMonthlyCost = 0;
    const breakdown: CostPrediction['breakdown'] = [];

    for (const step of simulatedSteps) {
      totalMonthlyCost += step.estimatedCost;

      if (step.estimatedCost !== 0) {
        breakdown.push({
          resource: step.description,
          costChange: step.estimatedCost,
          reason:
            step.estimatedCost < 0
              ? 'Resource optimization'
              : 'Resource activation',
        });
      }
    }

    // Calculate other timeframes
    const hourly = totalMonthlyCost / (30 * 24);
    const daily = totalMonthlyCost / 30;
    const annual = totalMonthlyCost * 12;

    // Determine confidence based on data quality
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (
      breakdown.length > 0 &&
      simulatedSteps.every((s) => s.simulationStatus === 'would_succeed')
    ) {
      confidence = 'high';
    } else if (simulatedSteps.some((s) => s.simulationStatus === 'unknown')) {
      confidence = 'low';
    }

    return {
      immediate: 0, // No immediate cost for most operations
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
    connection: AWSConnectionDocument,
  ): RiskAssessment {
    const factors: RiskAssessment['factors'] = [];
    const mitigations: string[] = [];

    let riskScore = 0;

    // Check resource count
    const resourcesAffected =
      plan.summary?.resourcesAffected || plan.steps.length;
    if (resourcesAffected > 10) {
      factors.push({
        factor: 'High resource count',
        impact: 'high',
        description: `${resourcesAffected} resources will be affected`,
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
    if (
      simulatedSteps.some((s) => s.warnings.some((w) => w.includes('downtime')))
    ) {
      factors.push({
        factor: 'Potential downtime',
        impact: 'high',
        description: 'Some actions may cause service interruption',
      });
      riskScore += 25;
      mitigations.push('Notify stakeholders before execution');
    }

    // Check reversibility
    if (plan.summary?.reversible === false) {
      factors.push({
        factor: 'Non-reversible action',
        impact: 'high',
        description: 'Some changes cannot be automatically rolled back',
      });
      riskScore += 20;
      mitigations.push('Create backups before proceeding');
    }

    // Check permission failures
    const failedSteps = simulatedSteps.filter(
      (s) => s.simulationStatus === 'would_fail',
    );
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
    connection: AWSConnectionDocument,
    allStepsWouldSucceed: boolean,
    permissionsValid: boolean,
    riskLevel: RiskAssessment['overallRisk'],
  ): { canPromote: boolean; blockers: string[]; daysRemaining?: number } {
    const blockers: string[] = [];

    // Check simulation mode
    if (connection.executionMode === 'simulation') {
      if (!connection.simulationConfig?.startedAt) {
        blockers.push('Simulation period has not started');
      } else {
        const daysSinceStart =
          (Date.now() - connection.simulationConfig.startedAt.getTime()) /
          (1000 * 60 * 60 * 24);
        const daysRemaining = Math.max(
          0,
          (connection.simulationConfig.periodDays || 7) - daysSinceStart,
        );

        if (daysRemaining > 0) {
          blockers.push(
            `Simulation period: ${Math.ceil(daysRemaining)} days remaining`,
          );
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
  async getSimulationResult(
    planId: string,
    userId: string,
  ): Promise<SimulationResult | null> {
    const stored = await this.awsSimulationResultModel
      .findOne({ planId, userId: new Types.ObjectId(userId) })
      .lean();

    if (!stored?.result) {
      return null;
    }

    return stored.result as unknown as SimulationResult;
  }

  /**
   * Promote a connection from simulation to live mode
   */
  async promoteToLive(
    connectionId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<{ success: boolean; reason?: string }> {
    const connection = await this.awsConnectionModel.findOne({
      _id: connectionId,
      userId,
    });

    if (!connection) {
      return { success: false, reason: 'Connection not found' };
    }

    if (connection.executionMode === 'live') {
      return { success: false, reason: 'Connection is already in live mode' };
    }

    // Check if simulation period is complete
    if (connection.executionMode === 'simulation') {
      if (!connection.simulationConfig?.startedAt) {
        return { success: false, reason: 'Simulation period has not started' };
      }

      const daysSinceStart =
        (Date.now() - connection.simulationConfig.startedAt.getTime()) /
        (1000 * 60 * 60 * 24);
      const daysRemaining =
        (connection.simulationConfig.periodDays || 7) - daysSinceStart;

      if (daysRemaining > 0) {
        return {
          success: false,
          reason: `Simulation period not completed. ${Math.ceil(daysRemaining)} days remaining.`,
        };
      }
    }

    // Update to live mode
    connection.executionMode = 'live';
    if (!connection.simulationConfig) {
      connection.simulationConfig = {
        enabled: false,
        periodDays: 7,
        startedAt: new Date(),
      };
    }
    connection.simulationConfig.promotedToLiveAt = new Date();
    await connection.save();

    this.logger.log('Connection promoted to live mode', {
      component: 'SimulationEngineService',
      operation: 'promoteToLive',
      connectionId: connectionId.toString(),
      userId: userId.toString(),
    });

    return { success: true };
  }

  /**
   * Clean up old simulation results (older than 24 hours)
   */
  private async cleanupOldSimulations(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleteResult = await this.awsSimulationResultModel.deleteMany({
      simulatedAt: { $lt: cutoff },
    });

    if (deleteResult.deletedCount > 0) {
      this.logger.log('Cleaned up old simulation results', {
        component: 'SimulationEngineService',
        operation: 'cleanupOldSimulations',
        resultsRemoved: deleteResult.deletedCount,
      });
    }
  }

  /**
   * Get all stored simulation results for a user
   */
  async getUserSimulations(userId: string): Promise<
    Array<{
      planId: string;
      simulatedAt: Date;
      status: string;
      canPromoteToLive: boolean;
    }>
  > {
    const docs = await this.awsSimulationResultModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ simulatedAt: -1 })
      .lean();

    return docs.map((d) => ({
      planId: d.planId,
      simulatedAt: d.simulatedAt,
      status: (d.result as { status?: string }).status ?? 'unknown',
      canPromoteToLive:
        (d.result as { canPromoteToLive?: boolean }).canPromoteToLive ?? false,
    }));
  }

  /**
   * Delete a stored simulation result
   */
  async deleteSimulation(planId: string, userId: string): Promise<boolean> {
    const deleted = await this.awsSimulationResultModel.deleteOne({
      planId,
      userId: new Types.ObjectId(userId),
    });

    if (deleted.deletedCount === 0) {
      return false;
    }

    this.logger.log('Simulation deleted', {
      component: 'SimulationEngineService',
      operation: 'deleteSimulation',
      planId,
      userId,
    });

    return true;
  }

  /**
   * Get simulation statistics
   */
  async getStatistics(): Promise<{
    totalSimulations: number;
    successfulSimulations: number;
    failedSimulations: number;
    averageDuration: number;
  }> {
    const docs = await this.awsSimulationResultModel.find().lean();
    let successful = 0;
    let failed = 0;
    let totalDuration = 0;

    for (const d of docs) {
      const result = d.result as { status?: string; duration?: number };
      if (result?.status === 'simulated') {
        successful++;
      } else {
        failed++;
      }
      totalDuration += result?.duration ?? 0;
    }

    const total = docs.length;
    const averageDuration = total > 0 ? totalDuration / total : 0;

    return {
      totalSimulations: total,
      successfulSimulations: successful,
      failedSimulations: failed,
      averageDuration,
    };
  }
}
