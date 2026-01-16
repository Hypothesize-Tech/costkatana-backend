import crypto from 'crypto';
import { loggingService } from '../logging.service';
import { dslParserService } from './dslParser.service';
import { permissionBoundaryService } from './permissionBoundary.service';
import { IAWSConnection } from '../../models/AWSConnection';
import {
  ParsedIntent,
  ParsedAction,
  ExecutionPlan,
  ExecutionStep,
  PlanSummary,
  APICall,
  RiskLevel,
  ALLOWED_ACTIONS,
} from '../../types/awsDsl.types';

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

// Cost estimates per action (simplified - in production, use AWS Pricing API)
const COST_ESTIMATES: Record<string, { hourly: number; monthly: number }> = {
  'ec2.stop': { hourly: -0.10, monthly: -72 },  // Savings
  'ec2.start': { hourly: 0.10, monthly: 72 },   // Cost
  'rds.stop': { hourly: -0.50, monthly: -360 },
  'rds.start': { hourly: 0.50, monthly: 360 },
  's3.lifecycle': { hourly: 0, monthly: -50 },  // Estimated savings
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

class PlanGeneratorService {
  private static instance: PlanGeneratorService;
  
  // Plan expiration time (15 minutes)
  private readonly PLAN_EXPIRATION_MS = 15 * 60 * 1000;
  
  private constructor() {}
  
  public static getInstance(): PlanGeneratorService {
    if (!PlanGeneratorService.instance) {
      PlanGeneratorService.instance = new PlanGeneratorService();
    }
    return PlanGeneratorService.instance;
  }
  
  /**
   * Generate an execution plan from a parsed intent
   */
  public async generatePlan(
    intent: ParsedIntent,
    connection: IAWSConnection,
    resources?: string[]
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
    const parsedAction = dslParserService.parseObject({
      action: intent.suggestedAction,
      selector: {
        service: intent.entities.service as any || this.extractService(intent.suggestedAction),
        resourceType: this.extractResourceType(intent.suggestedAction),
        filters: [],
        regions: intent.entities.regions || connection.allowedRegions,
      },
      constraints: {
        maxResources: resources?.length || 5,
        regions: intent.entities.regions || connection.allowedRegions,
        requireApproval: true,
      },
    });
    
    if (!parsedAction.validation.valid) {
      throw new Error(`Invalid action: ${parsedAction.validation.errors.map(e => e.message).join(', ')}`);
    }
    
    // Validate against permission boundary
    const permissionCheck = permissionBoundaryService.validateAction(
      {
        service: parsedAction.dsl.selector.service,
        action: parsedAction.dsl.execution.action.operation,
        resources,
        region: parsedAction.dsl.constraints.regions[0],
      },
      connection
    );
    
    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }
    
    // Generate plan ID
    const planId = `plan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    // Generate execution steps
    const steps = this.generateSteps(parsedAction, resources || []);
    
    // Calculate summary
    const summary = this.calculateSummary(steps, intent.suggestedAction);
    
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
    
    loggingService.info('Execution plan generated', {
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
   * Generate execution steps from parsed action
   */
  private generateSteps(
    parsedAction: ParsedAction,
    resources: string[]
  ): ExecutionStep[] {
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
        stepId: `step-action-${i}`,
        order: steps.length,
        service: dsl.selector.service,
        action: dsl.action,
        description: `${dsl.metadata.name} (batch ${i + 1}/${resourceBatches.length})`,
        resources: batch,
        impact: {
          resourceCount: batch.length,
          costChange: this.estimateCostChange(dsl.action, batch.length),
          reversible: dsl.metadata.reversible,
          downtime: this.hasDowntime(dsl.action),
          dataLoss: false,
          riskLevel: dsl.metadata.risk,
        },
        apiCalls,
        dependsOn: steps.length > 0 ? [steps[steps.length - 1].stepId] : undefined,
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
        dependsOn: [steps[steps.length - 1].stepId],
      });
    }
    
    return steps;
  }
  
  /**
   * Generate API calls for a step
   */
  private generateApiCalls(dsl: ParsedAction['dsl'], resources: string[]): APICall[] {
    const calls: APICall[] = [];
    
    // Map action to AWS API call
    const apiMapping: Record<string, { service: string; operation: string }> = {
      'ec2.stop': { service: 'EC2', operation: 'StopInstances' },
      'ec2.start': { service: 'EC2', operation: 'StartInstances' },
      'ec2.resize': { service: 'EC2', operation: 'ModifyInstanceAttribute' },
      's3.lifecycle': { service: 'S3', operation: 'PutBucketLifecycleConfiguration' },
      's3.intelligent_tiering': { service: 'S3', operation: 'PutBucketIntelligentTieringConfiguration' },
      'rds.stop': { service: 'RDS', operation: 'StopDBInstance' },
      'rds.start': { service: 'RDS', operation: 'StartDBInstance' },
      'rds.snapshot': { service: 'RDS', operation: 'CreateDBSnapshot' },
      'rds.resize': { service: 'RDS', operation: 'ModifyDBInstance' },
      'lambda.update_memory': { service: 'Lambda', operation: 'UpdateFunctionConfiguration' },
      'lambda.update_timeout': { service: 'Lambda', operation: 'UpdateFunctionConfiguration' },
    };
    
    const mapping = apiMapping[dsl.action];
    if (!mapping) {
      return calls;
    }
    
    // Generate call with resources
    calls.push({
      service: mapping.service,
      operation: mapping.operation,
      parameters: {
        ...dsl.execution.action.parameters,
        resources,
      },
      expectedDuration: DURATION_ESTIMATES[dsl.action] || 60,
    });
    
    return calls;
  }
  
  /**
   * Calculate plan summary
   */
  private calculateSummary(steps: ExecutionStep[], action: string): PlanSummary {
    let totalDuration = 0;
    let totalCostImpact = 0;
    let resourcesAffected = 0;
    let maxRiskScore = 0;
    const servicesAffected = new Set<string>();
    let requiresApproval = false;
    let reversible = true;
    
    for (const step of steps) {
      totalDuration += DURATION_ESTIMATES[action] || 60;
      totalCostImpact += step.impact.costChange;
      resourcesAffected += step.impact.resourceCount;
      servicesAffected.add(step.service);
      
      if (!step.impact.reversible) {
        reversible = false;
      }
      
      // Calculate risk score
      const riskScores: Record<RiskLevel, number> = {
        low: 20,
        medium: 50,
        high: 75,
        critical: 100,
      };
      maxRiskScore = Math.max(maxRiskScore, riskScores[step.impact.riskLevel]);
    }
    
    // Check if approval is required
    const actionInfo = ALLOWED_ACTIONS.find(a => a.action === action);
    requiresApproval = actionInfo?.requiresApproval ?? true;
    
    return {
      totalSteps: steps.length,
      estimatedDuration: totalDuration,
      estimatedCostImpact: totalCostImpact,
      riskScore: maxRiskScore,
      resourcesAffected,
      servicesAffected: Array.from(servicesAffected),
      requiresApproval,
      reversible,
    };
  }
  
  /**
   * Generate Mermaid visualization
   */
  private generateVisualization(steps: ExecutionStep[]): string {
    let mermaid = 'graph TD\n';
    
    // Add nodes
    for (const step of steps) {
      const label = step.description.replace(/"/g, "'");
      const shape = step.action.startsWith('precheck') ? '([' : 
                    step.action.startsWith('postcheck') ? '([' : '[';
      const shapeEnd = step.action.startsWith('precheck') ? '])' : 
                       step.action.startsWith('postcheck') ? '])' : ']';
      
      mermaid += `    ${step.stepId}${shape}"${label}"${shapeEnd}\n`;
    }
    
    // Add edges
    for (const step of steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          mermaid += `    ${dep} --> ${step.stepId}\n`;
        }
      }
    }
    
    // Add styling
    mermaid += '\n    classDef precheck fill:#e1f5fe,stroke:#01579b\n';
    mermaid += '    classDef action fill:#fff3e0,stroke:#e65100\n';
    mermaid += '    classDef postcheck fill:#e8f5e9,stroke:#1b5e20\n';
    
    for (const step of steps) {
      if (step.action.startsWith('precheck')) {
        mermaid += `    class ${step.stepId} precheck\n`;
      } else if (step.action.startsWith('postcheck')) {
        mermaid += `    class ${step.stepId} postcheck\n`;
      } else {
        mermaid += `    class ${step.stepId} action\n`;
      }
    }
    
    return mermaid;
  }
  
  /**
   * Generate rollback plan
   */
  private async generateRollbackPlan(
    parsedAction: ParsedAction,
    resources: string[]
  ): Promise<ExecutionPlan | undefined> {
    const rollbackActions: Record<string, string> = {
      'ec2.stop': 'ec2.start',
      'ec2.start': 'ec2.stop',
      'rds.stop': 'rds.start',
      'rds.start': 'rds.stop',
    };
    
    const rollbackAction = rollbackActions[parsedAction.dsl.action];
    if (!rollbackAction) {
      return undefined;
    }
    
    const rollbackParsed = dslParserService.parseObject({
      action: rollbackAction,
      selector: parsedAction.dsl.selector,
      constraints: {
        ...parsedAction.dsl.constraints,
        requireApproval: false, // Auto-rollback doesn't need approval
      },
    });
    
    if (!rollbackParsed.validation.valid) {
      return undefined;
    }
    
    const steps = this.generateSteps(rollbackParsed, resources);
    const summary = this.calculateSummary(steps, rollbackAction);
    
    return {
      planId: `rollback-${Date.now()}`,
      dslHash: rollbackParsed.hash,
      dslVersion: rollbackParsed.dslVersion,
      steps,
      summary,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.PLAN_EXPIRATION_MS),
    };
  }
  
  // Helper methods
  
  private extractService(action: string): string {
    return action.split('.')[0] || '';
  }
  
  private extractResourceType(action: string): string {
    const mapping: Record<string, string> = {
      'ec2': 'instance',
      's3': 'bucket',
      'rds': 'db-instance',
      'lambda': 'function',
    };
    const service = this.extractService(action);
    return mapping[service] || 'resource';
  }
  
  private batchResources(resources: string[], batchSize: number): string[][] {
    if (resources.length === 0) {
      return [[]];
    }
    
    const batches: string[][] = [];
    for (let i = 0; i < resources.length; i += batchSize) {
      batches.push(resources.slice(i, i + batchSize));
    }
    return batches;
  }
  
  private estimateCostChange(action: string, resourceCount: number): number {
    const estimate = COST_ESTIMATES[action];
    if (!estimate) {
      return 0;
    }
    return estimate.monthly * resourceCount;
  }
  
  private hasDowntime(action: string): boolean {
    const downtimeActions = ['ec2.stop', 'ec2.resize', 'rds.stop', 'rds.resize'];
    return downtimeActions.includes(action);
  }
  
  private getPreCheckDescription(type: string): string {
    const descriptions: Record<string, string> = {
      'verify_permissions': 'Verify AWS permissions',
      'verify_backups': 'Verify backups exist',
      'check_dependencies': 'Check resource dependencies',
      'check_cost_impact': 'Estimate cost impact',
      'verify_idle': 'Verify resource is idle',
      'check_tags': 'Verify required tags',
    };
    return descriptions[type] || `Pre-check: ${type}`;
  }
  
  private getPostCheckDescription(type: string): string {
    const descriptions: Record<string, string> = {
      'verify_state': 'Verify final state',
      'verify_stopped': 'Verify resource is stopped',
      'verify_started': 'Verify resource is started',
      'verify_resized': 'Verify resize completed',
      'update_inventory': 'Update resource inventory',
      'notify': 'Send notifications',
    };
    return descriptions[type] || `Post-check: ${type}`;
  }
  
  /**
   * Validate that a plan is still valid (not expired)
   */
  public validatePlan(plan: ExecutionPlan): { valid: boolean; reason?: string } {
    if (plan.expiresAt < new Date()) {
      return { valid: false, reason: 'Plan has expired' };
    }
    
    return { valid: true };
  }
}

export const planGeneratorService = PlanGeneratorService.getInstance();
