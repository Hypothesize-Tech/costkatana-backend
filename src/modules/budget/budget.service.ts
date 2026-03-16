import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Usage } from '../../schemas/core/usage.schema';
import { Project } from '../../schemas/team-project/project.schema';
import { WebhookEventEmitterService } from '../webhook/webhook-event-emitter.service';
import { WEBHOOK_EVENTS } from '../webhook/webhook.types';

export interface BudgetStatusOverall {
  budget: number;
  used: number;
  remaining: number;
  cost: number;
  usagePercentage: number;
}

export interface BudgetStatusProject {
  projectId?: string;
  name: string;
  budget: number;
  used: number;
  remaining: number;
  cost: number;
  usagePercentage: number;
}

export interface BudgetAlert {
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
}

export interface BudgetRecommendation {
  type: string;
  message: string;
  impact: 'low' | 'medium' | 'high';
  estimatedSavings: number;
}

export interface BudgetStatus {
  overall: BudgetStatusOverall;
  projects: BudgetStatusProject[];
  alerts: BudgetAlert[];
  recommendations: BudgetRecommendation[];
}

const DEFAULT_USER_BUDGET_TOKENS = 100_000;
const DEFAULT_PROJECT_BUDGET_TOKENS = 10_000;

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    private readonly webhookEventEmitter: WebhookEventEmitterService,
  ) {}

  private getMonthDateRange(): { startOfMonth: Date; endOfMonth: Date } {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    return { startOfMonth, endOfMonth };
  }

  async getBudgetStatus(
    userId: string,
    projectFilter?: string,
  ): Promise<BudgetStatus> {
    const { startOfMonth, endOfMonth } = this.getMonthDateRange();
    const userBudget = DEFAULT_USER_BUDGET_TOKENS;

    const [overallUsage, projectUsage] = await Promise.all([
      this.getOverallUsage(userId, startOfMonth, endOfMonth),
      this.getProjectUsage(userId, startOfMonth, endOfMonth, projectFilter),
    ]);

    const overall: BudgetStatusOverall = {
      budget: userBudget,
      used: overallUsage.totalTokens,
      remaining: Math.max(0, userBudget - overallUsage.totalTokens),
      cost: overallUsage.totalCost,
      usagePercentage: (overallUsage.totalTokens / userBudget) * 100,
    };

    const alerts = this.generateAlerts(overall, projectUsage, userId);
    const recommendations = this.generateRecommendations(overall, projectUsage);

    return {
      overall,
      projects: projectUsage,
      alerts,
      recommendations,
    };
  }

  private async getOverallUsage(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  }> {
    const match = {
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };

    const result = await this.usageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
        },
      },
    ]);

    const usage = result[0] ?? {
      totalTokens: 0,
      totalCost: 0,
      totalRequests: 0,
    };
    return usage;
  }

  private async getProjectUsage(
    userId: string,
    startDate: Date,
    endDate: Date,
    projectFilter?: string,
  ): Promise<BudgetStatusProject[]> {
    const match: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (projectFilter) {
      const isObjectId = mongoose.Types.ObjectId.isValid(projectFilter);
      if (!isObjectId) {
        const project = await this.projectModel.findOne({
          name: projectFilter,
          ownerId: new mongoose.Types.ObjectId(userId),
        });
        if (project) {
          match.projectId = project._id;
        }
      } else {
        match.projectId = new mongoose.Types.ObjectId(projectFilter);
      }
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'projects',
          localField: 'projectId',
          foreignField: '_id',
          as: 'project',
        },
      },
      {
        $group: {
          _id: '$projectId',
          name: { $first: { $arrayElemAt: ['$project.name', 0] } },
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
        },
      },
      { $sort: { totalCost: -1 as const } },
    ];

    const results = await this.usageModel.aggregate(pipeline);

    return results.map((row) => {
      const projectBudget = DEFAULT_PROJECT_BUDGET_TOKENS;
      const usagePercentage = (row.totalTokens / projectBudget) * 100;
      return {
        projectId: row._id ? String(row._id) : undefined,
        name: row.name ?? 'Unknown Project',
        budget: projectBudget,
        used: row.totalTokens,
        remaining: Math.max(0, projectBudget - row.totalTokens),
        cost: row.totalCost,
        usagePercentage,
      };
    });
  }

  private getAlertLevel(
    percentage: number,
  ): { level: string; severity: 'low' | 'medium' | 'high' } | null {
    if (percentage >= 90) return { level: 'critical', severity: 'high' };
    if (percentage >= 75) return { level: 'warning', severity: 'medium' };
    if (percentage >= 50) return { level: 'notice', severity: 'low' };
    return null;
  }

  private createBudgetAlert(
    type: string,
    percentage: number,
    severity: 'low' | 'medium' | 'high',
    timestamp: string,
    isProject = false,
    projectName?: string,
  ): BudgetAlert {
    const target = isProject ? `Project "${projectName}"` : 'You';
    const budgetType = isProject ? 'its' : 'your monthly';

    let messagePrefix: string;
    switch (severity) {
      case 'high':
        messagePrefix = 'Critical';
        break;
      case 'medium':
        messagePrefix = 'Warning';
        break;
      default:
        messagePrefix = 'Notice';
    }

    return {
      type,
      message: `${messagePrefix}: ${target} ${isProject ? 'has' : 've'} used ${percentage.toFixed(1)}% of ${budgetType} budget`,
      severity,
      timestamp,
    };
  }

  private async emitBudgetWebhook(
    userId: string,
    overall: BudgetStatusOverall,
    eventType:
      | typeof WEBHOOK_EVENTS.BUDGET_WARNING
      | typeof WEBHOOK_EVENTS.BUDGET_EXCEEDED,
  ): Promise<void> {
    try {
      if (eventType === WEBHOOK_EVENTS.BUDGET_EXCEEDED) {
        await this.webhookEventEmitter.emitBudgetExceeded(userId, undefined, {
          title: 'Budget Exceeded',
          description: `You have exceeded your monthly budget. Usage: ${overall.usagePercentage.toFixed(1)}%.`,
          severity: 'critical',
          budget: {
            amount: overall.budget,
            currency: 'USD',
            spent: overall.used,
            exceededBy: Math.max(0, overall.used - overall.budget),
          },
        });
      } else {
        await this.webhookEventEmitter.emitBudgetWarning(userId, undefined, {
          title: 'Budget Warning',
          description: `You have used ${overall.usagePercentage.toFixed(1)}% of your monthly budget.`,
          severity: overall.usagePercentage >= 90 ? 'high' : 'medium',
          budget: {
            amount: overall.budget,
            currency: 'USD',
            spent: overall.used,
            remaining: overall.remaining,
          },
          warningThreshold: 75,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to emit budget webhook', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        eventType,
      });
    }
  }

  private generateAlerts(
    overall: BudgetStatusOverall,
    projects: BudgetStatusProject[],
    userId: string,
  ): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];
    const now = new Date().toISOString();

    if (overall.usagePercentage === 0) {
      return alerts;
    }

    const overallAlertLevel = this.getAlertLevel(overall.usagePercentage);
    if (overallAlertLevel) {
      const alertType =
        overallAlertLevel.level === 'critical'
          ? 'budget_critical'
          : overallAlertLevel.level === 'warning'
            ? 'budget_warning'
            : 'budget_notice';

      alerts.push(
        this.createBudgetAlert(
          alertType,
          overall.usagePercentage,
          overallAlertLevel.severity,
          now,
        ),
      );

      if (overallAlertLevel.severity === 'high') {
        const eventType =
          overall.usagePercentage >= 100
            ? WEBHOOK_EVENTS.BUDGET_EXCEEDED
            : WEBHOOK_EVENTS.BUDGET_WARNING;
        void this.emitBudgetWebhook(userId, overall, eventType);
      } else if (overallAlertLevel.severity === 'medium') {
        void this.emitBudgetWebhook(
          userId,
          overall,
          WEBHOOK_EVENTS.BUDGET_WARNING,
        );
      }
    }

    projects.forEach((project) => {
      const projectAlertLevel = this.getAlertLevel(project.usagePercentage);
      if (projectAlertLevel && projectAlertLevel.severity !== 'low') {
        const alertType =
          projectAlertLevel.level === 'critical'
            ? 'project_critical'
            : 'project_warning';

        alerts.push(
          this.createBudgetAlert(
            alertType,
            project.usagePercentage,
            projectAlertLevel.severity,
            now,
            true,
            project.name,
          ),
        );
      }
    });

    if (overall.cost > 50) {
      alerts.push({
        type: 'cost_high',
        message: `High cost alert: You've spent $${overall.cost.toFixed(2)} this month`,
        severity: 'medium',
        timestamp: now,
      });

      this.webhookEventEmitter
        .emitCostAlert(userId, undefined, {
          title: 'High Cost Alert',
          description: `You've spent $${overall.cost.toFixed(2)} this month.`,
          severity: 'medium',
          cost: {
            amount: overall.cost,
            currency: 'USD',
            period: 'monthly',
          },
          threshold: 50,
          changePercentage: overall.usagePercentage,
        })
        .catch((err) =>
          this.logger.warn('Failed to emit cost alert webhook', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }

    return alerts;
  }

  private generateRecommendations(
    overall: BudgetStatusOverall,
    projects: BudgetStatusProject[],
  ): BudgetRecommendation[] {
    const recommendations: BudgetRecommendation[] = [];

    if (overall.usagePercentage >= 75) {
      recommendations.push({
        type: 'budget_increase',
        message:
          'Consider increasing your monthly budget to avoid service interruptions',
        impact: 'high',
        estimatedSavings: 0,
      });
    }

    if (overall.cost > 30) {
      recommendations.push({
        type: 'cost_optimization',
        message: 'Enable prompt optimization to reduce token usage and costs',
        impact: 'high',
        estimatedSavings: overall.cost * 0.2,
      });
    }

    if (overall.usagePercentage > 50) {
      recommendations.push({
        type: 'model_optimization',
        message:
          'Consider using more cost-effective models for non-critical tasks',
        impact: 'medium',
        estimatedSavings: overall.cost * 0.15,
      });
    }

    projects.forEach((project) => {
      if (project.usagePercentage >= 75) {
        recommendations.push({
          type: 'project_optimization',
          message: `Optimize prompts in project "${project.name}" to reduce token usage`,
          impact: 'medium',
          estimatedSavings: project.cost * 0.25,
        });
      }
    });

    return recommendations;
  }
}
