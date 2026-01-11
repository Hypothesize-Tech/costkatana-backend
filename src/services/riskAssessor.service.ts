import { loggingService } from './logging.service';
import { ExecutionPlan } from './governedAgent.service';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  requiresApproval: boolean;
  mitigationStrategies?: string[];
  estimatedImpact?: {
    cost?: number; // dollars
    dataRecords?: number;
    resourcesCreated?: number;
  };
}

export class RiskAssessorService {
  /**
   * Assess risk of an execution plan
   * Dynamically determines if approval is needed based on plan actions
   */
  static assessRisk(plan: ExecutionPlan): RiskAssessment {
    let riskLevel: RiskLevel = 'none';
    const reasons: string[] = [];
    const mitigationStrategies: string[] = [];

    try {
      loggingService.info('🔍 Assessing risk', {
        component: 'RiskAssessorService',
        operation: 'assessRisk',
        phasesCount: plan.phases.length
      });

      // Check for write operations
      const hasWrites = plan.phases.some(phase =>
        phase.steps.some(step =>
          ['create', 'update', 'delete', 'insert', 'modify', 'deploy'].some(action =>
            step.action.toLowerCase().includes(action)
          )
        )
      );

      if (hasWrites) {
        riskLevel = this.escalateRisk(riskLevel, 'medium');
        reasons.push('Performs write operations (creates or modifies data)');
        mitigationStrategies.push('Review all changes before approval');
      }

      // Check for cloud resource provisioning
      const createsCloudResources = plan.phases.some(phase =>
        phase.steps.some(step =>
          step.tool === 'aws_integration' && 
          ['provision', 'create', 'deploy'].some(action => step.action.includes(action))
        )
      );

      if (createsCloudResources) {
        riskLevel = this.escalateRisk(riskLevel, 'high');
        reasons.push('Provisions cloud resources (incurs ongoing costs)');
        mitigationStrategies.push('Set up cost alerts and budget limits');
        mitigationStrategies.push('Review AWS estimated costs before approval');
      }

      // Check for external service integrations
      const integrationTypes = new Set<string>();
      plan.phases.forEach(phase => {
        phase.steps.forEach(step => {
          if (step.tool.includes('_integration')) {
            const integration = step.tool.replace('_integration', '');
            integrationTypes.add(integration);
          }
        });
      });

      if (integrationTypes.size > 2) {
        riskLevel = this.escalateRisk(riskLevel, 'low');
        reasons.push(`Interacts with ${integrationTypes.size} external services`);
        mitigationStrategies.push('Verify all integration connections are active');
      }

      // Check for data deletion
      const hasDeletes = plan.phases.some(phase =>
        phase.steps.some(step =>
          step.action.toLowerCase().includes('delete') || 
          step.action.toLowerCase().includes('remove')
        )
      );

      if (hasDeletes) {
        riskLevel = this.escalateRisk(riskLevel, 'high');
        reasons.push('Deletes or removes data (potentially irreversible)');
        mitigationStrategies.push('Ensure backups exist before proceeding');
        mitigationStrategies.push('Consider soft-delete instead of hard-delete');
      }

      // Check for notification/communication actions
      const sendsNotifications = plan.phases.some(phase =>
        phase.steps.some(step =>
          ['notify', 'send', 'email', 'message', 'alert'].some(action =>
            step.action.toLowerCase().includes(action)
          )
        )
      );

      if (sendsNotifications) {
        riskLevel = this.escalateRisk(riskLevel, 'medium');
        reasons.push('Sends notifications or messages to users/team');
        mitigationStrategies.push('Review notification recipients and content');
      }

      // Check for ticket/issue creation
      const createsTickets = plan.phases.some(phase =>
        phase.steps.some(step =>
          (step.tool === 'jira_integration' || step.tool === 'github_integration') &&
          step.action.toLowerCase().includes('create')
        )
      );

      if (createsTickets) {
        riskLevel = this.escalateRisk(riskLevel, 'medium');
        reasons.push('Creates tickets/issues (notifies team members)');
        mitigationStrategies.push('Review ticket details and assignees');
      }

      // Check for code deployment
      const deploysCode = plan.phases.some(phase =>
        phase.steps.some(step =>
          (step.tool === 'vercel_integration' || step.tool === 'aws_integration') &&
          step.action.toLowerCase().includes('deploy')
        )
      );

      if (deploysCode) {
        riskLevel = this.escalateRisk(riskLevel, 'high');
        reasons.push('Deploys code to production/staging environments');
        mitigationStrategies.push('Review generated code before deployment');
        mitigationStrategies.push('Ensure rollback plan is available');
      }

      // Check estimated cost
      if (plan.estimatedCost && plan.estimatedCost > 10) {
        riskLevel = this.escalateRisk(riskLevel, 'high');
        reasons.push(`Estimated cost: $${plan.estimatedCost.toFixed(2)}/month`);
        mitigationStrategies.push('Set up cost monitoring and alerts');
      } else if (plan.estimatedCost && plan.estimatedCost > 1) {
        riskLevel = this.escalateRisk(riskLevel, 'medium');
        reasons.push(`Estimated cost: $${plan.estimatedCost.toFixed(2)}/month`);
      }

      // Determine if approval required
      const requiresApproval = ['medium', 'high'].includes(riskLevel);

      // If no reasons found, it's read-only
      if (reasons.length === 0) {
        reasons.push('Read-only operation with no side effects');
      }

      const assessment: RiskAssessment = {
        level: riskLevel,
        reasons,
        requiresApproval,
        mitigationStrategies: mitigationStrategies.length > 0 ? mitigationStrategies : undefined,
        estimatedImpact: {
          cost: plan.estimatedCost,
          resourcesCreated: this.countResourcesCreated(plan)
        }
      };

      loggingService.info('✅ Risk assessment complete', {
        component: 'RiskAssessorService',
        operation: 'assessRisk',
        riskLevel,
        requiresApproval,
        reasonsCount: reasons.length
      });

      return assessment;

    } catch (error) {
      loggingService.error('Risk assessment failed', {
        component: 'RiskAssessorService',
        operation: 'assessRisk',
        error: error instanceof Error ? error.message : String(error)
      });

      // Default to safe: high risk, requires approval
      return {
        level: 'high',
        reasons: ['Risk assessment failed - defaulting to high risk for safety'],
        requiresApproval: true
      };
    }
  }

  /**
   * Escalate risk level if new level is higher
   */
  private static escalateRisk(currentLevel: RiskLevel, newLevel: RiskLevel): RiskLevel {
    const levels: RiskLevel[] = ['none', 'low', 'medium', 'high'];
    const currentIndex = levels.indexOf(currentLevel);
    const newIndex = levels.indexOf(newLevel);

    return newIndex > currentIndex ? newLevel : currentLevel;
  }

  /**
   * Count how many resources will be created
   */
  private static countResourcesCreated(plan: ExecutionPlan): number {
    let count = 0;

    plan.phases.forEach(phase => {
      phase.steps.forEach(step => {
        if (step.action.toLowerCase().includes('create') || 
            step.action.toLowerCase().includes('provision')) {
          count++;
        }
      });
    });

    return count;
  }

  /**
   * Check if a specific risk factor is present in the plan
   */
  static hasRiskFactor(plan: ExecutionPlan, factor: string): boolean {
    const lowerFactor = factor.toLowerCase();

    return plan.phases.some(phase =>
      phase.steps.some(step =>
        step.action.toLowerCase().includes(lowerFactor) ||
        step.tool.toLowerCase().includes(lowerFactor) ||
        JSON.stringify(step.params).toLowerCase().includes(lowerFactor)
      )
    );
  }

  /**
   * Get human-readable risk description
   */
  static getRiskDescription(level: RiskLevel): string {
    const descriptions: Record<RiskLevel, string> = {
      none: 'No risk - Read-only operation with no side effects',
      low: 'Low risk - External API calls with minimal impact',
      medium: 'Medium risk - Creates or modifies data, may notify users',
      high: 'High risk - Provisions resources, deploys code, or incurs costs'
    };

    return descriptions[level];
  }
}
