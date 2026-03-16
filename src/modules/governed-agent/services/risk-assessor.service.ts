import { Injectable } from '@nestjs/common';
import { ExecutionPlan } from '../interfaces/governed-agent.interfaces';

@Injectable()
export class RiskAssessorService {
  /**
   * Assess the overall risk of an execution plan
   */
  static assessRisk(plan: ExecutionPlan): {
    level: 'none' | 'low' | 'medium' | 'high';
    reasons: string[];
    requiresApproval: boolean;
  } {
    const reasons: string[] = [];
    let riskScore = 0;
    const maxScore = 100;

    // Analyze each phase
    plan.phases.forEach((phase, phaseIndex) => {
      const phaseRisk = this.assessPhaseRisk(phase, phaseIndex);
      riskScore += phaseRisk.score;
      reasons.push(...phaseRisk.reasons);
    });

    // Assess cost risk
    if (plan.estimatedCost && plan.estimatedCost > 50) {
      riskScore += 20;
      reasons.push(`High estimated cost: $${plan.estimatedCost}`);
    } else if (plan.estimatedCost && plan.estimatedCost > 25) {
      riskScore += 10;
      reasons.push(`Moderate estimated cost: $${plan.estimatedCost}`);
    }

    // Assess duration risk
    if (plan.estimatedDuration > 3600) {
      // > 1 hour
      riskScore += 15;
      reasons.push(
        `Long execution time: ${Math.round(plan.estimatedDuration / 60)} minutes`,
      );
    } else if (plan.estimatedDuration > 1800) {
      // > 30 minutes
      riskScore += 8;
      reasons.push(
        `Extended execution time: ${Math.round(plan.estimatedDuration / 60)} minutes`,
      );
    }

    // Assess integration complexity
    const uniqueIntegrations = new Set<string>();
    plan.phases.forEach((phase) => {
      phase.steps.forEach((step) => {
        // Extract integration from tool name (e.g., "github_integration" -> "github")
        const integration = step.tool
          .replace(/_integration$/, '')
          .toLowerCase();
        uniqueIntegrations.add(integration);
      });
    });

    if (uniqueIntegrations.size > 3) {
      riskScore += 12;
      reasons.push(
        `Complex multi-integration: ${uniqueIntegrations.size} services`,
      );
    } else if (uniqueIntegrations.size > 1) {
      riskScore += 5;
      reasons.push(`Multi-integration: ${uniqueIntegrations.size} services`);
    }

    // Determine risk level
    let level: 'none' | 'low' | 'medium' | 'high';
    let requiresApproval = false;

    if (riskScore >= 60) {
      level = 'high';
      requiresApproval = true;
    } else if (riskScore >= 30) {
      level = 'medium';
      requiresApproval = true;
    } else if (riskScore >= 10) {
      level = 'low';
      requiresApproval = false;
    } else {
      level = 'none';
      requiresApproval = false;
    }

    // Special cases that always require approval
    const alwaysHighRisk = reasons.some(
      (reason) =>
        reason.includes('Production deployment') ||
        reason.includes('Data deletion') ||
        reason.includes('Database modification') ||
        reason.includes('Cloud resource creation') ||
        reason.includes('Critical infrastructure'),
    );

    if (alwaysHighRisk) {
      level = 'high';
      requiresApproval = true;
      reasons.push('Always requires approval due to critical operations');
    }

    return {
      level,
      reasons:
        reasons.length > 0 ? reasons : ['No significant risks identified'],
      requiresApproval,
    };
  }

  /**
   * Assess risk for a single phase
   */
  private static assessPhaseRisk(
    phase: any,
    phaseIndex: number,
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Phase-level risk assessment
    if (phase.approvalRequired) {
      score += 15;
      reasons.push(`Phase ${phaseIndex + 1} explicitly requires approval`);
    }

    if (phase.riskLevel === 'high') {
      score += 20;
      reasons.push(`Phase ${phaseIndex + 1} marked as high risk`);
    } else if (phase.riskLevel === 'medium') {
      score += 10;
      reasons.push(`Phase ${phaseIndex + 1} marked as medium risk`);
    }

    // Step-level risk assessment
    phase.steps.forEach((step: any, stepIndex: number) => {
      const stepRisk = this.assessStepRisk(step, phaseIndex, stepIndex);
      score += stepRisk.score;
      reasons.push(...stepRisk.reasons);
    });

    return { score, reasons };
  }

  /**
   * Assess risk for a single step
   */
  private static assessStepRisk(
    step: any,
    phaseIndex: number,
    stepIndex: number,
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const tool = step.tool.toLowerCase();
    const action = step.action.toLowerCase();
    const description = step.description.toLowerCase();

    // High-risk actions
    if (
      action.includes('delete') ||
      action.includes('remove') ||
      action.includes('destroy')
    ) {
      score += 25;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Data deletion operation`,
      );
    }

    if (action.includes('deploy') || action.includes('production')) {
      score += 20;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Production deployment`,
      );
    }

    // Medium-risk actions
    if (
      action.includes('create') ||
      action.includes('update') ||
      action.includes('modify')
    ) {
      score += 12;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Data modification`,
      );
    }

    if (
      action.includes('send') ||
      action.includes('notify') ||
      action.includes('email')
    ) {
      score += 8;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Notification/emails sent`,
      );
    }

    // Tool-specific risks
    if (tool.includes('aws') || tool.includes('cloud')) {
      score += 15;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Cloud infrastructure changes`,
      );
    }

    if (tool.includes('database') || tool.includes('mongo')) {
      score += 10;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Database operations`,
      );
    }

    if (tool.includes('github')) {
      score += 5;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Repository modifications`,
      );
    }

    // Description-based risk assessment
    if (description.includes('production') || description.includes('live')) {
      score += 15;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Production environment`,
      );
    }

    if (
      description.includes('critical') ||
      description.includes('infrastructure')
    ) {
      score += 12;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Critical infrastructure`,
      );
    }

    if (description.includes('backup') || description.includes('restore')) {
      score += 8;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Backup/restore operations`,
      );
    }

    // Cost-based risk
    if (
      description.includes('cost') ||
      description.includes('billing') ||
      description.includes('payment')
    ) {
      score += 10;
      reasons.push(
        `Step ${phaseIndex + 1}.${stepIndex + 1}: Financial operations`,
      );
    }

    return { score, reasons };
  }

  /**
   * Get risk mitigation recommendations
   */
  static getRiskMitigations(riskLevel: string): string[] {
    const mitigations: string[] = [];

    switch (riskLevel) {
      case 'high':
        mitigations.push('Manual approval required before execution');
        mitigations.push('Execute in staging environment first');
        mitigations.push('Ensure proper backups are in place');
        mitigations.push('Limit scope to minimal required changes');
        mitigations.push('Monitor execution closely');
        break;

      case 'medium':
        mitigations.push('Execute during low-traffic hours');
        mitigations.push('Have rollback plan ready');
        mitigations.push('Test in development environment');
        mitigations.push('Monitor resource usage');
        break;

      case 'low':
        mitigations.push('Monitor execution for any anomalies');
        mitigations.push('Ensure proper logging is in place');
        break;

      case 'none':
        mitigations.push('Standard monitoring is sufficient');
        break;
    }

    return mitigations;
  }
}
