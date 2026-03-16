import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { DslParserService } from './dsl-parser.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { AwsPricingService } from './aws-pricing.service';
import { randomBytes } from 'crypto';
import {
  ParsedIntent,
  ParsedAction,
  ExecutionPlan,
  ExecutionStep,
  PlanSummary,
  APICall,
  RiskLevel,
  ALLOWED_ACTIONS,
} from '../types/aws-dsl.types';
import { AWSConnectionDocument } from '../../../schemas/integration/aws-connection.schema';

/**
 * Plan Generator Service - Convert Intent to Execution Plan
 *
 * Security Guarantees:
 * - Convert intent to execution plan
 * - Step-by-step breakdown with API calls
 * - Cost impact prediction
 * - Reversibility assessment
 * - Mermaid diagram visualization
 * - Rollback plan generation
 * - Plans expire after 15 minutes
 */

// Fallback cost estimates (used when AWS Pricing API is unavailable)
const FALLBACK_COST_ESTIMATES: Record<
  string,
  { hourly: number; monthly: number }
> = {
  'ec2.stop': { hourly: -0.1, monthly: -72 }, // Savings
  'ec2.start': { hourly: 0.1, monthly: 72 }, // Cost
  'rds.stop': { hourly: -0.5, monthly: -360 },
  'rds.start': { hourly: 0.5, monthly: 360 },
  's3.lifecycle': { hourly: 0, monthly: -50 }, // Estimated savings
  's3.intelligent_tiering': { hourly: 0, monthly: -30 },
};

// Estimated durations per action (seconds)
const DURATION_ESTIMATES: Record<string, number> = {
  'ec2.stop': 60,
  'ec2.start': 120,
  'ec2.resize': 300,
  's3.lifecycle': 30,
  's3.intelligent_tiering': 30,
  'rds.stop': 180,
  'rds.start': 300,
  'rds.snapshot': 600,
  'rds.resize': 900,
  'lambda.update_memory': 30,
  'lambda.update_timeout': 30,
};

@Injectable()
export class PlanGeneratorService {
  // Plan expiration time (15 minutes)
  private readonly PLAN_EXPIRATION_MS = 15 * 60 * 1000;

  constructor(
    private readonly logger: LoggerService,
    private readonly dslParserService: DslParserService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly awsPricingService: AwsPricingService,
  ) {}

  /**
   * Get cost estimate for an action using AWS Pricing API
   */
  private async getActionCostEstimate(
    action: string,
    resourceDetails?: any,
    region: string = 'us-east-1',
  ): Promise<{ hourly: number; monthly: number }> {
    try {
      // Extract service and operation from action
      const [service, operation] = action.split('.');

      let pricing;
      switch (service) {
        case 'ec2':
          if (resourceDetails?.instanceType) {
            pricing = await this.awsPricingService.getPricing({
              serviceCode: 'AmazonEC2',
              region,
              instanceType: resourceDetails.instanceType,
              operation:
                operation === 'start' ? 'RunInstances' : 'StopInstances',
            });
          }
          break;

        case 'rds':
          if (resourceDetails?.instanceType) {
            pricing = await this.awsPricingService.getPricing({
              serviceCode: 'AmazonRDS',
              region,
              instanceType: resourceDetails.instanceType,
              operation:
                operation === 'start' ? 'CreateDBInstance' : 'StopDBInstance',
            });
          }
          break;

        case 's3':
          pricing = await this.awsPricingService.getPricing({
            serviceCode: 'AmazonS3',
            region,
            operation:
              operation === 'lifecycle'
                ? 'PutBucketLifecycleConfiguration'
                : 'PutBucketIntelligentTieringConfiguration',
          });
          break;
      }

      if (pricing?.pricePerHour !== undefined) {
        const hourly = pricing.pricePerHour;
        const monthly = hourly * 24 * 30; // Rough monthly estimate

        return {
          hourly: operation === 'stop' ? -hourly : hourly, // Negative for savings
          monthly: operation === 'stop' ? -monthly : monthly,
        };
      }

      // Fallback to hardcoded values if pricing API fails
      this.logger.warn(
        'AWS Pricing API unavailable, using fallback estimates',
        {
          action,
          region,
        },
      );

      return FALLBACK_COST_ESTIMATES[action] || { hourly: 0, monthly: 0 };
    } catch (error) {
      this.logger.error('Failed to get action cost estimate', {
        action,
        region,
        error: error instanceof Error ? error.message : String(error),
      });

      return FALLBACK_COST_ESTIMATES[action] || { hourly: 0, monthly: 0 };
    }
  }

  /**
   * Generate an execution plan from a parsed intent
   */
  async generatePlan(
    intent: ParsedIntent,
    connection: AWSConnectionDocument,
    resources?: string[],
  ): Promise<ExecutionPlan> {
    // Check if intent is blocked
    if (intent.blocked) {
      throw new Error(`Cannot generate plan: ${intent.blockReason}`);
    }

    // Check if action is suggested
    if (!intent.suggestedAction) {
      throw new Error('No valid action identified from intent');
    }

    // Parse the DSL for this action
    const parsedAction = this.dslParserService.parseObject({
      action: intent.suggestedAction,
      selector: {
        service:
          (intent.entities.service as any) ||
          this.extractService(intent.suggestedAction),
        resourceType: this.extractResourceType(intent.suggestedAction),
        filters: [],
        regions: intent.entities.regions ?? connection.allowedRegions ?? [],
      },
      constraints: {
        maxResources: resources?.length || 5,
        regions: intent.entities.regions ?? connection.allowedRegions ?? [],
        requireApproval: true,
      },
    });

    if (!parsedAction.validation.valid) {
      throw new Error(
        `Invalid action: ${parsedAction.validation.errors.map((e) => e.message).join(', ')}`,
      );
    }

    // Validate against permission boundary
    const permissionCheck = this.permissionBoundaryService.validateAction(
      {
        service: parsedAction.dsl.selector.service,
        action: parsedAction.dsl.execution.action.operation,
        region: parsedAction.dsl.constraints.regions[0],
      },
      connection,
    );

    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }

    const region = parsedAction.dsl.constraints.regions?.[0] ?? 'us-east-1';

    // Generate plan ID
    const planId = `plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Generate execution steps
    const steps = await this.generateSteps(
      parsedAction,
      resources || [],
      region,
    );

    // Calculate summary
    const summary = await this.calculateSummary(
      steps,
      intent.suggestedAction,
      region,
    );

    // Generate visualization
    const visualization = this.generateVisualization(steps);

    // Generate rollback plan if applicable
    const rollbackPlan = parsedAction.dsl.metadata.reversible
      ? await this.generateRollbackPlan(parsedAction, resources || [])
      : undefined;

    const plan: ExecutionPlan = {
      planId,
      dslHash: parsedAction.hash,
      dslVersion: parsedAction.dslVersion,
      steps,
      summary,
      visualization,
      rollbackPlan,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.PLAN_EXPIRATION_MS),
    };

    this.logger.log('Execution plan generated', {
      component: 'PlanGeneratorService',
      operation: 'generatePlan',
      planId,
      action: intent.suggestedAction,
      stepCount: steps.length,
      estimatedDuration: summary.estimatedDuration,
      riskScore: summary.riskScore,
    });

    return plan;
  }

  /**
   * Validate an existing plan
   */
  validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check plan expiration
    if (plan.expiresAt < new Date()) {
      errors.push('Plan has expired');
    }

    // Check if plan has any steps
    if (plan.steps.length === 0) {
      errors.push('Plan must have at least one step');
    }

    // Check step dependencies and build adjacency list for cycle detection
    const stepIds = new Set(plan.steps.map((s) => s.stepId));
    const adjacencyList: Record<string, string[]> = {};

    for (const step of plan.steps) {
      adjacencyList[step.stepId] = step.dependsOn || [];

      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            errors.push(
              `Step ${step.stepId} depends on non-existent step ${dep}`,
            );
          }
        }
      }

      // Validate step has required properties
      if (!step.service) {
        errors.push(`Step ${step.stepId} is missing service`);
      }
      if (!step.action) {
        errors.push(`Step ${step.stepId} is missing action`);
      }
      if (step.order < 0) {
        errors.push(`Step ${step.stepId} has invalid order`);
      }

      // Validate impact properties
      if (step.impact.resourceCount < 0) {
        errors.push(`Step ${step.stepId} has negative resource count`);
      }
      if (
        !['low', 'medium', 'high', 'critical'].includes(step.impact.riskLevel)
      ) {
        errors.push(
          `Step ${step.stepId} has invalid risk level: ${step.impact.riskLevel}`,
        );
      }
    }

    // Check for cycles in dependencies using DFS
    const cycles = this.detectCycles(adjacencyList);
    for (const cycle of cycles) {
      errors.push(`Dependency cycle detected: ${cycle.join(' -> ')}`);
    }

    // Check for duplicate step orders
    const orders = plan.steps.map((s) => s.order);
    const uniqueOrders = new Set(orders);
    if (orders.length !== uniqueOrders.size) {
      errors.push('Duplicate step orders found');
    }

    // Validate planId format
    if (!plan.planId || plan.planId.length < 5) {
      errors.push('Invalid plan ID');
    }

    // Validate timestamps
    if (plan.createdAt > plan.expiresAt) {
      errors.push('Plan created date is after expiration date');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Detect cycles in dependency graph using DFS
   * Returns array of cycles, each cycle is an array of step IDs
   */
  private detectCycles(adjacencyList: Record<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      if (recursionStack.has(node)) {
        // Found a cycle - extract it from the path
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).concat([node]);
        cycles.push(cycle);
        return;
      }

      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = adjacencyList[node] || [];
      for (const neighbor of neighbors) {
        if (adjacencyList[neighbor]) {
          // Only follow if neighbor is a valid step
          dfs(neighbor, [...path]);
        }
      }

      recursionStack.delete(node);
    };

    for (const node of Object.keys(adjacencyList)) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Generate execution steps from parsed action
   */
  private async generateSteps(
    parsedAction: ParsedAction,
    resources: string[],
    region: string,
  ): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    const dsl = parsedAction.dsl;

    // Pre-check steps
    for (let i = 0; i < dsl.execution.preChecks.length; i++) {
      const preCheck = dsl.execution.preChecks[i];
      steps.push({
        stepId: `step-precheck-${i}`,
        order: steps.length,
        service: dsl.selector.service,
        action: `precheck:${preCheck.type}`,
        description: this.getPreCheckDescription(preCheck.type),
        resources: [],
        impact: {
          resourceCount: 0,
          costChange: 0,
          reversible: true,
          downtime: false,
          dataLoss: false,
          riskLevel: 'low',
        },
        apiCalls: [],
      });
    }

    // Main action step(s) - one per resource or batched
    const resourceBatches = this.batchResources(resources, 10);

    for (let i = 0; i < resourceBatches.length; i++) {
      const batch = resourceBatches[i];
      const apiCalls = this.generateApiCalls(dsl, batch);

      steps.push({
        stepId: `step-main-${i}`,
        order: steps.length,
        service: dsl.selector.service,
        action: dsl.action,
        description: this.getActionDescription(dsl.action, batch),
        resources: batch,
        impact: await this.calculateStepImpact(dsl.action, batch, region),
        apiCalls,
      });
    }

    // Post-check steps
    for (let i = 0; i < dsl.execution.postChecks.length; i++) {
      const postCheck = dsl.execution.postChecks[i];
      steps.push({
        stepId: `step-postcheck-${i}`,
        order: steps.length,
        service: dsl.selector.service,
        action: `postcheck:${postCheck.type}`,
        description: this.getPostCheckDescription(postCheck.type),
        resources: [],
        impact: {
          resourceCount: 0,
          costChange: 0,
          reversible: true,
          downtime: false,
          dataLoss: false,
          riskLevel: 'low',
        },
        apiCalls: [],
      });
    }

    return steps;
  }

  /**
   * Generate API calls for a step
   */
  private generateApiCalls(
    dsl: ParsedAction['dsl'],
    resources: string[],
  ): APICall[] {
    const apiCalls: APICall[] = [];
    const action = dsl.execution.action;

    if (action.operation) {
      apiCalls.push({
        service: dsl.selector.service,
        operation: action.operation,
        parameters: {
          ...action.parameters,
          resources,
        },
        expectedDuration: DURATION_ESTIMATES[dsl.action] || 60,
      });
    }

    return apiCalls;
  }

  /**
   * Calculate step impact
   */
  private async calculateStepImpact(
    action: string,
    resources: string[],
    region: string = 'us-east-1',
  ) {
    const costEstimate = await this.getActionCostEstimate(
      action,
      undefined,
      region,
    );
    const resourceCount = resources.length || 1;

    return {
      resourceCount,
      costChange: costEstimate.monthly * resourceCount,
      reversible: this.isActionReversible(action),
      downtime: this.causesDowntime(action),
      dataLoss: this.causesDataLoss(action),
      riskLevel: this.getActionRiskLevel(action),
    };
  }

  /**
   * Calculate plan summary
   */
  private async calculateSummary(
    steps: ExecutionStep[],
    action: string,
    region: string = 'us-east-1',
  ): Promise<PlanSummary> {
    const totalSteps = steps.length;

    // Calculate total duration from all API calls across all steps
    const estimatedDuration = steps.reduce((sum, step) => {
      const stepDuration = step.apiCalls.reduce(
        (callSum, call) => callSum + (call.expectedDuration || 60),
        0,
      );
      return sum + stepDuration;
    }, 0);

    // Calculate total cost impact (monthly)
    const estimatedCostImpact = steps.reduce(
      (sum, step) => sum + step.impact.costChange,
      0,
    );

    // Calculate hourly cost impact using AWS Pricing API
    let estimatedHourlyCost = 0;
    for (const step of steps) {
      const actionKey = `${step.service}.${step.action}`;
      const costEstimate = await this.getActionCostEstimate(
        actionKey,
        undefined,
        region,
      );
      estimatedHourlyCost += costEstimate.hourly;
    }

    const riskScore = this.calculateRiskScore(steps);

    const resourcesAffected = steps.reduce(
      (sum, step) => sum + step.impact.resourceCount,
      0,
    );

    const servicesAffected = Array.from(new Set(steps.map((s) => s.service)));

    const requiresApproval = steps.some(
      (step) =>
        step.impact.riskLevel === 'high' ||
        step.impact.riskLevel === 'critical',
    );

    const reversible = steps.every((step) => step.impact.reversible);

    // Additional metrics
    const causesDowntime = steps.some((step) => step.impact.downtime);
    const causesDataLoss = steps.some((step) => step.impact.dataLoss);
    const totalApiCalls = steps.reduce(
      (sum, step) => sum + step.apiCalls.length,
      0,
    );

    // Calculate max parallel execution time (if steps can be parallelized)
    const criticalPathDuration = this.calculateCriticalPathDuration(steps);

    this.logger.debug('Plan summary calculated', {
      component: 'PlanGeneratorService',
      operation: 'calculateSummary',
      action,
      totalSteps,
      estimatedDuration,
      criticalPathDuration,
      estimatedCostImpact,
      estimatedHourlyCost,
      riskScore,
      resourcesAffected,
      servicesAffected,
      reversible,
      causesDowntime,
      causesDataLoss,
      totalApiCalls,
    });

    return {
      totalSteps,
      estimatedDuration,
      criticalPathDuration,
      estimatedCostImpact,
      riskScore,
      resourcesAffected,
      servicesAffected,
      requiresApproval,
      reversible,
    };
  }

  /**
   * Calculate the critical path duration (minimum time if steps run optimally)
   * Uses topological sort to find the longest path through dependencies
   */
  private calculateCriticalPathDuration(steps: ExecutionStep[]): number {
    if (steps.length === 0) return 0;

    // Build dependency graph
    const stepMap = new Map(steps.map((s) => [s.stepId, s]));
    const inDegree: Record<string, number> = {};
    const stepDuration: Record<string, number> = {};

    for (const step of steps) {
      inDegree[step.stepId] = step.dependsOn?.length || 0;
      stepDuration[step.stepId] = step.apiCalls.reduce(
        (sum, call) => sum + (call.expectedDuration || 60),
        0,
      );
    }

    // Topological sort using Kahn's algorithm
    const queue: string[] = [];
    const earliestStart: Record<string, number> = {};

    // Find all steps with no dependencies
    for (const step of steps) {
      if (inDegree[step.stepId] === 0) {
        queue.push(step.stepId);
        earliestStart[step.stepId] = 0;
      }
    }

    let processedCount = 0;

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentStep = stepMap.get(currentId);
      processedCount++;

      if (!currentStep) continue;

      const currentEnd = earliestStart[currentId] + stepDuration[currentId];

      // Find steps that depend on current step
      for (const step of steps) {
        if (step.dependsOn?.includes(currentId)) {
          // Update earliest start time
          earliestStart[step.stepId] = Math.max(
            earliestStart[step.stepId] || 0,
            currentEnd,
          );

          inDegree[step.stepId]--;
          if (inDegree[step.stepId] === 0) {
            queue.push(step.stepId);
          }
        }
      }
    }

    // Find the maximum end time (critical path duration)
    let criticalPathDuration = 0;
    for (const stepId of Object.keys(earliestStart)) {
      const endTime = earliestStart[stepId] + stepDuration[stepId];
      criticalPathDuration = Math.max(criticalPathDuration, endTime);
    }

    return criticalPathDuration;
  }

  /**
   * Generate Mermaid visualization
   */
  private generateVisualization(steps: ExecutionStep[]): string {
    let mermaid = 'graph TD\n';

    for (const step of steps) {
      const label = `${step.service}:${step.action}`;
      mermaid += `  ${step.stepId}["${label}"]\n`;

      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          mermaid += `  ${dep} --> ${step.stepId}\n`;
        }
      }
    }

    return mermaid;
  }

  /**
   * Generate rollback plan
   * Creates a comprehensive rollback plan that reverses the original action
   */
  private async generateRollbackPlan(
    parsedAction: ParsedAction,
    resources: string[],
  ): Promise<ExecutionPlan> {
    const dsl = parsedAction.dsl;
    const region = dsl.constraints.regions?.[0] ?? 'us-east-1';
    const rollbackSteps: ExecutionStep[] = [];
    const rollbackAction = this.getRollbackAction(dsl.action);

    // If no rollback action is defined, mark as non-reversible
    if (rollbackAction === 'unknown' || rollbackAction === dsl.action) {
      this.logger.warn('No rollback action available for this operation', {
        component: 'PlanGeneratorService',
        operation: 'generateRollbackPlan',
        originalAction: dsl.action,
      });

      // Add a step indicating non-reversibility
      rollbackSteps.push({
        stepId: 'rollback-unavailable',
        order: 0,
        service: dsl.selector.service,
        action: 'no-rollback',
        description: `No automatic rollback available for ${dsl.action}. Manual intervention may be required.`,
        resources,
        impact: {
          resourceCount: resources.length,
          costChange: 0,
          reversible: false,
          downtime: false,
          dataLoss: false,
          riskLevel: 'high',
        },
        apiCalls: [],
      });
    } else {
      // Generate pre-checks for rollback
      rollbackSteps.push({
        stepId: 'rollback-precheck-verify-current-state',
        order: 0,
        service: dsl.selector.service,
        action: 'precheck:verify_current_state',
        description: `Verify current state of resources before rollback`,
        resources,
        impact: {
          resourceCount: resources.length,
          costChange: 0,
          reversible: true,
          downtime: false,
          dataLoss: false,
          riskLevel: 'low',
        },
        apiCalls: this.generateRollbackPreCheckCalls(
          dsl.selector.service,
          resources,
        ),
      });

      // Main rollback action
      rollbackSteps.push({
        stepId: 'rollback-main-action',
        order: 1,
        service: dsl.selector.service,
        action: rollbackAction,
        description: this.getRollbackActionDescription(dsl.action, resources),
        resources,
        impact: {
          resourceCount: resources.length,
          costChange: await this.getRollbackCostImpact(dsl.action, region),
          reversible: true,
          downtime: this.causesDowntime(rollbackAction),
          dataLoss: false,
          riskLevel: this.getActionRiskLevel(rollbackAction),
        },
        apiCalls: this.generateRollbackApiCalls(dsl, resources, rollbackAction),
      });

      // Post-checks for rollback verification
      rollbackSteps.push({
        stepId: 'rollback-postcheck-verify-restored',
        order: 2,
        service: dsl.selector.service,
        action: 'postcheck:verify_restored',
        description: `Verify resources have been restored to original state`,
        resources,
        impact: {
          resourceCount: resources.length,
          costChange: 0,
          reversible: true,
          downtime: false,
          dataLoss: false,
          riskLevel: 'low',
        },
        apiCalls: [],
      });
    }

    // Calculate cost impact for rollback (typically the inverse of original)
    const originalCost = await this.getActionCostEstimate(
      dsl.action,
      undefined,
      region,
    );
    const rollbackCostEstimate = {
      hourly: -originalCost.hourly,
      monthly: -originalCost.monthly,
    };

    // Update step impacts with calculated costs
    for (const step of rollbackSteps) {
      if (step.stepId === 'rollback-main-action') {
        step.impact.costChange =
          rollbackCostEstimate.monthly * resources.length;
      }
    }

    const planId = `rollback-${Date.now()}-${randomBytes(4).toString('hex')}`;

    const plan: ExecutionPlan = {
      planId,
      dslHash: parsedAction.hash,
      dslVersion: parsedAction.dslVersion,
      steps: rollbackSteps,
      summary: await this.calculateSummary(
        rollbackSteps,
        rollbackAction,
        region,
      ),
      visualization: this.generateVisualization(rollbackSteps),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.PLAN_EXPIRATION_MS),
    };

    this.logger.log('Rollback plan generated', {
      component: 'PlanGeneratorService',
      operation: 'generateRollbackPlan',
      planId,
      originalAction: dsl.action,
      rollbackAction: rollbackAction,
      resourceCount: resources.length,
      stepCount: rollbackSteps.length,
    });

    return plan;
  }

  /**
   * Generate API calls for rollback pre-checks
   */
  private generateRollbackPreCheckCalls(
    service: string,
    resources: string[],
  ): APICall[] {
    const apiCalls: APICall[] = [];

    switch (service) {
      case 'ec2':
        apiCalls.push({
          service: 'ec2',
          operation: 'DescribeInstances',
          parameters: { InstanceIds: resources },
          expectedDuration: 30,
        });
        break;
      case 'rds':
        apiCalls.push({
          service: 'rds',
          operation: 'DescribeDBInstances',
          parameters: { DBInstanceIdentifiers: resources },
          expectedDuration: 30,
        });
        break;
      case 's3':
        for (const bucket of resources) {
          apiCalls.push({
            service: 's3',
            operation: 'ListBucket',
            parameters: { Bucket: bucket },
            expectedDuration: 15,
          });
        }
        break;
      default:
        // Generic describe call for unknown services
        apiCalls.push({
          service,
          operation: 'DescribeResource',
          parameters: { resourceIds: resources },
          expectedDuration: 30,
        });
    }

    return apiCalls;
  }

  /**
   * Generate API calls for rollback actions
   */
  private generateRollbackApiCalls(
    dsl: ParsedAction['dsl'],
    resources: string[],
    rollbackAction: string,
  ): APICall[] {
    const apiCalls: APICall[] = [];
    const service = dsl.selector.service;

    const duration = DURATION_ESTIMATES[rollbackAction] || 60;

    for (const resource of resources) {
      apiCalls.push({
        service,
        operation: this.getRollbackOperation(rollbackAction),
        parameters: {
          resourceId: resource,
          service,
          action: rollbackAction,
        },
        expectedDuration: duration,
      });
    }

    return apiCalls;
  }

  /**
   * Get the AWS API operation name for a rollback action
   */
  private getRollbackOperation(rollbackAction: string): string {
    const operationMap: Record<string, string> = {
      'ec2.start': 'StartInstances',
      'ec2.stop': 'StopInstances',
      'ec2.terminate': 'TerminateInstances',
      'rds.start': 'StartDBInstance',
      'rds.stop': 'StopDBInstance',
      'rds.delete': 'DeleteDBInstance',
      'lambda.enable': 'UpdateFunctionConfiguration',
      'lambda.disable': 'UpdateFunctionConfiguration',
      's3.enable_versioning': 'PutBucketVersioning',
      's3.disable_versioning': 'PutBucketVersioning',
    };

    return operationMap[rollbackAction] || 'UnknownOperation';
  }

  /**
   * Get cost impact for rollback (typically inverse of original action)
   */
  private async getRollbackCostImpact(
    originalAction: string,
    region: string = 'us-east-1',
  ): Promise<number> {
    const original = await this.getActionCostEstimate(
      originalAction,
      undefined,
      region,
    );

    // Rollback cost is typically the inverse
    return -original.monthly;
  }

  /**
   * Get descriptive text for rollback action
   */
  private getRollbackActionDescription(
    action: string,
    resources: string[],
  ): string {
    const rollbackAction = this.getRollbackAction(action);
    const actionTemplate = ALLOWED_ACTIONS.find(
      (a) => a.action === rollbackAction,
    );

    if (actionTemplate) {
      return actionTemplate.description;
    }

    const resourceText =
      resources.length > 0 ? ` on ${resources.length} resource(s)` : '';
    return `Rollback ${action}${resourceText}`;
  }

  // Helper methods
  private extractService(action: string): string {
    return action.split(':')[0];
  }

  private extractResourceType(action: string): string {
    const service = this.extractService(action);

    if (service === 'ec2') return 'instance';
    if (service === 'rds') return 'db-instance';
    if (service === 's3') return 'bucket';
    if (service === 'lambda') return 'function';

    return 'resource';
  }

  private batchResources(resources: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < resources.length; i += batchSize) {
      batches.push(resources.slice(i, i + batchSize));
    }
    return batches.length > 0 ? batches : [[]];
  }

  private getPreCheckDescription(type: string): string {
    const descriptions: Record<string, string> = {
      verify_backups: 'Verify backups exist before making changes',
      check_dependencies: 'Check resource dependencies',
      verify_permissions: 'Verify execution permissions',
      check_cost_impact: 'Assess cost impact',
      verify_idle: 'Verify resource is idle',
      check_tags: 'Check resource tags',
    };
    return descriptions[type] || `Pre-check: ${type}`;
  }

  private getPostCheckDescription(type: string): string {
    const descriptions: Record<string, string> = {
      verify_state: 'Verify resource state after change',
      verify_stopped: 'Verify resource is stopped',
      verify_started: 'Verify resource is started',
      verify_resized: 'Verify resource size changed',
      update_inventory: 'Update resource inventory',
      notify: 'Send notifications',
    };
    return descriptions[type] || `Post-check: ${type}`;
  }

  private getActionDescription(action: string, resources: string[]): string {
    const actionTemplate = ALLOWED_ACTIONS.find((a) => a.action === action);
    if (actionTemplate) {
      return actionTemplate.description;
    }

    const resourceText =
      resources.length > 0 ? ` on ${resources.length} resource(s)` : '';
    return `${action}${resourceText}`;
  }

  private isActionReversible(action: string): boolean {
    const actionTemplate = ALLOWED_ACTIONS.find((a) => a.action === action);
    return actionTemplate?.template?.metadata?.reversible ?? false;
  }

  private causesDowntime(action: string): boolean {
    return ['rds.stop', 'rds.resize', 'ec2.stop', 'ec2.resize'].includes(
      action,
    );
  }

  private causesDataLoss(action: string): boolean {
    // Actions that can cause data loss
    const dataLossActions = [
      // EC2 actions
      'ec2.terminate', // Terminating instances can lose ephemeral storage data
      'ec2.delete_volume', // Deleting EBS volumes loses all data
      'ec2.delete_snapshot', // Deleting snapshots
      'ec2.deregister_image', // Deregistering AMIs

      // RDS actions
      'rds.delete', // Deleting database instances
      'rds.delete_snapshot', // Deleting DB snapshots

      // S3 actions
      's3.delete_bucket', // Deleting buckets (with contents)
      's3.delete_object', // Deleting objects
      's3.delete_version', // Deleting object versions
      's3.disable_versioning', // Disabling versioning prevents recovery

      // Lambda actions
      'lambda.delete', // Deleting functions
      'lambda.delete_version', // Deleting specific versions

      // DynamoDB actions
      'dynamodb.delete_table', // Deleting tables

      // General destructive actions
      'delete',
      'terminate',
      'purge',
      'empty',
    ];

    // Check for exact matches
    if (dataLossActions.includes(action)) {
      return true;
    }

    // Check for partial matches (e.g., 'ec2.terminate_instances' contains 'terminate')
    for (const dataLossAction of dataLossActions) {
      if (action.includes(dataLossAction) || dataLossAction.includes(action)) {
        return true;
      }
    }

    return false;
  }

  private getActionRiskLevel(action: string): RiskLevel {
    const actionTemplate = ALLOWED_ACTIONS.find((a) => a.action === action);
    return actionTemplate?.risk || 'medium';
  }

  private calculateRiskScore(steps: ExecutionStep[]): number {
    const riskLevels: Record<RiskLevel, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };

    const totalRisk = steps.reduce(
      (sum, step) => sum + riskLevels[step.impact.riskLevel],
      0,
    );
    return Math.min(100, (totalRisk / steps.length) * 25);
  }

  private getRollbackAction(action: string): string {
    const rollbackMap: Record<string, string> = {
      'ec2.stop': 'ec2.start',
      'ec2.start': 'ec2.stop',
      'rds.stop': 'rds.start',
      'rds.start': 'rds.stop',
    };
    return rollbackMap[action] || 'unknown';
  }
}
