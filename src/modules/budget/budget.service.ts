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

export interface BudgetPacing {
  isOverPacing: boolean;
  dailyBurnUsd: number;
  projectedMonthlyCostUsd: number;
  projectedHitDate?: string;
  daysUntilHit?: number;
  daysOfRunway: number;
  topOffenderModel?: string;
  topOffenderCostUsd?: number;
}

export interface BudgetStatus {
  overall: BudgetStatusOverall;
  projects: BudgetStatusProject[];
  alerts: BudgetAlert[];
  recommendations: BudgetRecommendation[];
  pacing?: BudgetPacing;
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
    const pacing = await this.computePacing(
      userId,
      startOfMonth,
      endOfMonth,
      overall,
    );

    if (pacing.isOverPacing) {
      alerts.push({
        type: 'budget_pacing',
        message: pacing.projectedHitDate
          ? `At the current burn rate, you'll blow the monthly budget by ${pacing.projectedHitDate}.`
          : `Current burn rate is trending over monthly budget.`,
        severity: 'high',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      overall,
      projects: projectUsage,
      alerts,
      recommendations,
      pacing,
    };
  }

  /**
   * Compute burn rate + projection so the decision layer can surface
   * "you'll blow budget by Friday" instead of a static threshold alert.
   */
  private async computePacing(
    userId: string,
    startOfMonth: Date,
    endOfMonth: Date,
    overall: BudgetStatusOverall,
  ): Promise<BudgetPacing> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const windowStart = sevenDaysAgo > startOfMonth ? sevenDaysAgo : startOfMonth;
    const windowDays = Math.max(
      1,
      (now.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000),
    );

    const recentAgg = await this.usageModel
      .aggregate<{ _id: string; totalCost: number }>([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: windowStart, $lte: now },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$model', '$aiModel'] },
            totalCost: { $sum: '$cost' },
          },
        },
        { $sort: { totalCost: -1 } },
      ])
      .exec()
      .catch(() => [] as { _id: string; totalCost: number }[]);

    const totalRecentCost = recentAgg.reduce((sum, r) => sum + r.totalCost, 0);
    const dailyBurnUsd = totalRecentCost / windowDays;
    const daysLeftInMonth = Math.max(
      0,
      (endOfMonth.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    const projectedMonthlyCostUsd =
      overall.cost + dailyBurnUsd * daysLeftInMonth;

    // Convert token budget to approximate USD budget using the blended
    // observed rate; if no data yet fall back to overall.cost threshold.
    const tokensPerDollar = overall.used > 0 ? overall.used / overall.cost : 0;
    const budgetUsd =
      tokensPerDollar > 0 ? overall.budget / tokensPerDollar : overall.cost * 2;
    const remainingUsd = Math.max(0, budgetUsd - overall.cost);
    const daysOfRunway = dailyBurnUsd > 0 ? remainingUsd / dailyBurnUsd : Infinity;

    const willBlowBudget =
      projectedMonthlyCostUsd > budgetUsd && budgetUsd > 0;

    let projectedHitDate: string | undefined;
    let daysUntilHit: number | undefined;
    if (willBlowBudget && dailyBurnUsd > 0) {
      const daysOut = Math.ceil(daysOfRunway);
      const hit = new Date(now.getTime() + daysOut * 24 * 60 * 60 * 1000);
      projectedHitDate = hit.toISOString().slice(0, 10);
      daysUntilHit = daysOut;
    }

    return {
      isOverPacing: willBlowBudget,
      dailyBurnUsd,
      projectedMonthlyCostUsd,
      projectedHitDate,
      daysUntilHit,
      daysOfRunway: Number.isFinite(daysOfRunway) ? daysOfRunway : 9999,
      topOffenderModel: recentAgg[0]?._id,
      topOffenderCostUsd: recentAgg[0]?.totalCost,
    };
  }

  /**
   * Public accessor so the decision layer can compute pacing without
   * re-running the full budget status aggregation.
   */
  async getBudgetPacing(userId: string): Promise<BudgetPacing> {
    const { startOfMonth, endOfMonth } = this.getMonthDateRange();
    const overall = await this.getOverallUsage(userId, startOfMonth, endOfMonth);
    const userBudget = DEFAULT_USER_BUDGET_TOKENS;
    const overallStatus: BudgetStatusOverall = {
      budget: userBudget,
      used: overall.totalTokens,
      remaining: Math.max(0, userBudget - overall.totalTokens),
      cost: overall.totalCost,
      usagePercentage: (overall.totalTokens / userBudget) * 100,
    };
    return this.computePacing(userId, startOfMonth, endOfMonth, overallStatus);
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
