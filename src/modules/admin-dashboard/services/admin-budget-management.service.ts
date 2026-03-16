import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import {
  Project,
  ProjectDocument,
} from '../../../schemas/team-project/project.schema';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../../schemas/user/workspace.schema';
import { EmailService } from '../../email/email.service';
import {
  BudgetOverview,
  BudgetAlert,
  ProjectBudgetStatus,
  BudgetTrend,
} from '../interfaces';

@Injectable()
export class AdminBudgetManagementService {
  private readonly logger = new Logger(AdminBudgetManagementService.name);

  // Alert thresholds (percentage of budget)
  private static readonly ALERT_THRESHOLDS = [50, 75, 90, 95, 100];

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Get budget overview
   */
  async getBudgetOverview(
    startDate?: Date,
    endDate?: Date,
  ): Promise<BudgetOverview> {
    try {
      const now = new Date();
      const currentMonthStart =
        startDate || new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd =
        endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Get all projects with budgets
      const projects = await this.projectModel
        .find({
          isActive: true,
          $or: [
            { budget: { $exists: true, $ne: null } },
            { monthlyBudget: { $exists: true, $ne: null } },
            { dailyBudget: { $exists: true, $ne: null } },
          ],
        })
        .populate('workspaceId')
        .lean();

      // Get all workspaces with budgets
      const workspaces = await this.workspaceModel
        .find({
          isActive: true,
          $or: [
            { budget: { $exists: true, $ne: null } },
            { monthlyBudget: { $exists: true, $ne: null } },
            { dailyBudget: { $exists: true, $ne: null } },
          ],
        })
        .lean();

      let totalBudgetAllocated = 0;
      let totalSpent = 0;
      let projectsWithBudgets = 0;
      let workspacesWithBudgets = 0;
      let budgetUtilizationRate = 0;
      let overBudgetCount = 0;
      let nearLimitCount = 0;

      // Calculate project budgets
      for (const project of projects) {
        projectsWithBudgets++;
        const budget = (project as any).budget?.amount || 0;
        totalBudgetAllocated += budget;

        // Get spending for this project in current month
        const spending = await this.getProjectSpending(
          project._id.toString(),
          currentMonthStart,
          currentMonthEnd,
        );
        totalSpent += spending;

        if (budget > 0) {
          const utilizationRate = (spending / budget) * 100;
          if (utilizationRate >= 100) {
            overBudgetCount++;
          } else if (utilizationRate >= 80) {
            nearLimitCount++;
          }
        }
      }

      // Calculate workspace budgets
      for (const workspace of workspaces) {
        workspacesWithBudgets++;
        const budget = (workspace as any).budget?.amount || 0;
        totalBudgetAllocated += budget;

        // Get spending for this workspace in current month
        const spending = await this.getWorkspaceSpending(
          workspace._id.toString(),
          currentMonthStart,
          currentMonthEnd,
        );
        totalSpent += spending;

        if (budget > 0) {
          const utilizationRate = (spending / budget) * 100;
          if (utilizationRate >= 100) {
            overBudgetCount++;
          } else if (utilizationRate >= 80) {
            nearLimitCount++;
          }
        }
      }

      // Calculate utilization rate
      budgetUtilizationRate =
        totalBudgetAllocated > 0
          ? (totalSpent / totalBudgetAllocated) * 100
          : 0;

      // Get budget alerts
      const budgetAlertsList = await this.getBudgetAlerts();

      return {
        totalBudget: totalBudgetAllocated,
        totalSpent,
        remainingBudget: totalBudgetAllocated - totalSpent,
        budgetUtilization: budgetUtilizationRate,
        budgetAlerts: budgetAlertsList.length,
        overBudgetProjects: overBudgetCount,
        nearBudgetProjects: nearLimitCount,
      };
    } catch (error) {
      this.logger.error('Error getting budget overview:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminBudgetManagementService',
        operation: 'getBudgetOverview',
      });
      throw error;
    }
  }

  /**
   * Get project budget status
   */
  async getProjectBudgetStatus(
    projectId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<ProjectBudgetStatus[]> {
    try {
      const matchQuery: any = { isActive: true };

      if (projectId) {
        matchQuery._id = projectId;
      } else {
        // Only projects with budgets
        matchQuery.$or = [
          { budget: { $exists: true, $ne: null } },
          { monthlyBudget: { $exists: true, $ne: null } },
          { dailyBudget: { $exists: true, $ne: null } },
        ];
      }

      const projects = await this.projectModel
        .find(matchQuery)
        .populate('workspaceId')
        .populate('ownerId', 'email')
        .lean();

      const now = new Date();
      const currentMonthStart =
        startDate || new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd =
        endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const budgetStatuses: ProjectBudgetStatus[] = [];

      for (const project of projects) {
        const projectData = project as any;
        const budget = projectData.budget?.amount || 0;
        const monthlyBudget = projectData.monthlyBudget || 0;
        const dailyBudget = projectData.dailyBudget || 0;

        if (budget === 0 && monthlyBudget === 0 && dailyBudget === 0) {
          continue; // Skip projects without budgets
        }

        // Get current spending
        const currentSpending = await this.getProjectSpending(
          project._id.toString(),
          currentMonthStart,
          currentMonthEnd,
        );

        // Get spending for today
        const todayStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const todaySpending = await this.getProjectSpending(
          project._id.toString(),
          todayStart,
          todayEnd,
        );

        // Calculate utilization rates
        const budgetUtilization =
          budget > 0 ? (currentSpending / budget) * 100 : 0;
        const monthlyUtilization =
          monthlyBudget > 0 ? (currentSpending / monthlyBudget) * 100 : 0;
        const dailyUtilization =
          dailyBudget > 0 ? (todaySpending / dailyBudget) * 100 : 0;

        // Determine status (ProjectBudgetStatus uses on_track | near_limit | over_budget | warning | critical)
        let status:
          | 'on_track'
          | 'near_limit'
          | 'over_budget'
          | 'warning'
          | 'critical' = 'on_track';
        if (
          budgetUtilization >= 100 ||
          monthlyUtilization >= 100 ||
          dailyUtilization >= 100
        ) {
          status = 'over_budget';
        } else if (
          budgetUtilization >= 90 ||
          monthlyUtilization >= 90 ||
          dailyUtilization >= 90
        ) {
          status = 'critical';
        } else if (
          budgetUtilization >= 75 ||
          monthlyUtilization >= 75 ||
          dailyUtilization >= 75
        ) {
          status = 'warning';
        } else if (
          budgetUtilization >= 60 ||
          monthlyUtilization >= 60 ||
          dailyUtilization >= 60
        ) {
          status = 'near_limit';
        }

        budgetStatuses.push({
          projectId: project._id.toString(),
          projectName: projectData.name,
          workspaceId: projectData.workspaceId?._id?.toString(),
          workspaceName: projectData.workspaceId?.name,
          userId: projectData.ownerId?._id?.toString(),
          userEmail: projectData.ownerId?.email,
          budget,
          monthlyBudget,
          dailyBudget,
          currentSpending,
          budgetUtilization,
          monthlyUtilization,
          dailyUtilization,
          status,
          lastUpdated: projectData.updatedAt || projectData.createdAt,
        });
      }

      return budgetStatuses.sort(
        (a, b) => (b.currentSpending ?? 0) - (a.currentSpending ?? 0),
      );
    } catch (error) {
      this.logger.error('Error getting project budget status:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminBudgetManagementService',
        operation: 'getProjectBudgetStatus',
      });
      throw error;
    }
  }

  /**
   * Get budget alerts
   */
  async getBudgetAlerts(): Promise<BudgetAlert[]> {
    try {
      const projectBudgets = await this.getProjectBudgetStatus();
      const alerts: BudgetAlert[] = [];

      for (const budget of projectBudgets) {
        if (budget.status === 'over_budget' || budget.status === 'critical') {
          alerts.push({
            id: `project-${budget.projectId}`,
            type: 'project_budget',
            entityId: budget.projectId,
            entityName: budget.projectName,
            currentUsage: budget.currentSpending,
            limit: budget.budget || budget.monthlyBudget || budget.dailyBudget,
            percentage: Math.max(
              budget.budgetUtilization ?? 0,
              budget.monthlyUtilization ?? 0,
              budget.dailyUtilization ?? 0,
            ),
            severity: budget.status === 'over_budget' ? 'critical' : 'warning',
            message: `Project "${budget.projectName}" is ${budget.status === 'over_budget' ? 'over budget' : 'near budget limit'}`,
            createdAt: new Date(),
          });
        }
      }

      // Sort by severity and percentage
      return alerts.sort((a, b) => {
        if (a.severity !== b.severity) {
          return a.severity === 'critical' ? -1 : 1;
        }
        return (b.percentage ?? 0) - (a.percentage ?? 0);
      });
    } catch (error) {
      this.logger.error('Error getting budget alerts:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminBudgetManagementService',
        operation: 'getBudgetAlerts',
      });
      throw error;
    }
  }

  /**
   * Get budget trends
   */
  async getBudgetTrends(
    entityId?: string,
    entityType?: 'project' | 'workspace',
    startDate?: Date,
    endDate?: Date,
  ): Promise<BudgetTrend[]> {
    try {
      const now = new Date();
      const end = endDate || now;
      const start =
        startDate || new Date(now.getFullYear(), now.getMonth() - 11, 1);

      const trends: BudgetTrend[] = [];
      const current = new Date(start);

      while (current <= end) {
        const monthStart = new Date(
          current.getFullYear(),
          current.getMonth(),
          1,
        );
        const monthEnd = new Date(
          current.getFullYear(),
          current.getMonth() + 1,
          0,
        );

        let spending = 0;
        let budget = 0;

        if (entityType === 'project' && entityId) {
          spending = await this.getProjectSpending(
            entityId,
            monthStart,
            monthEnd,
          );
          const project = await this.projectModel.findById(entityId).lean();
          budget = (project as any)?.budget?.amount || 0;
        } else if (entityType === 'workspace' && entityId) {
          spending = await this.getWorkspaceSpending(
            entityId,
            monthStart,
            monthEnd,
          );
          const workspace = await this.workspaceModel.findById(entityId).lean();
          budget = (workspace as any)?.budget?.amount || 0;
        }

        trends.push({
          date: monthStart.toISOString().split('T')[0],
          spending,
          budget,
          utilization: budget > 0 ? (spending / budget) * 100 : 0,
        });

        current.setMonth(current.getMonth() + 1);
      }

      return trends;
    } catch (error) {
      this.logger.error('Error getting budget trends:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminBudgetManagementService',
        operation: 'getBudgetTrends',
      });
      throw error;
    }
  }

  /**
   * Send budget alert notifications
   */
  async sendBudgetAlertNotifications(): Promise<void> {
    try {
      const alerts = await this.getBudgetAlerts();

      for (const alert of alerts) {
        if (alert.severity === 'critical') {
          // Send email notification
          try {
            await this.emailService.sendEmail({
              to: 'admin@costkatana.com', // Should be configured
              subject: `Budget Alert: ${alert.entityName}`,
              html: `
                <h2>Budget Alert</h2>
                <p><strong>${alert.message}</strong></p>
                <p>Current Usage: $${(alert.currentUsage ?? 0).toFixed(2)}</p>
                <p>Budget Limit: $${(alert.limit ?? 0).toFixed(2)}</p>
                <p>Percentage Used: ${(alert.percentage ?? 0).toFixed(1)}%</p>
                <p>Please review and take appropriate action.</p>
              `,
            });
          } catch (emailError) {
            this.logger.error('Failed to send budget alert email:', {
              error: emailError,
              alertId: alert.id,
            });
          }
        }
      }

      this.logger.log(`Sent ${alerts.length} budget alert notifications`);
    } catch (error) {
      this.logger.error('Error sending budget alert notifications:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminBudgetManagementService',
        operation: 'sendBudgetAlertNotifications',
      });
      throw error;
    }
  }

  /**
   * Get project spending for a date range
   */
  private async getProjectSpending(
    projectId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      const result = await this.usageModel.aggregate([
        {
          $match: {
            projectId: projectId,
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
          },
        },
      ]);

      return result[0]?.totalCost || 0;
    } catch (error) {
      this.logger.error('Error getting project spending:', {
        error: error,
        projectId,
        startDate,
        endDate,
      });
      return 0;
    }
  }

  /**
   * Get workspace spending for a date range
   */
  private async getWorkspaceSpending(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      // Get all projects in the workspace
      const projects = await this.projectModel
        .find({
          workspaceId: workspaceId,
          isActive: true,
        })
        .select('_id')
        .lean();

      const projectIds = projects.map((p) => p._id.toString());

      if (projectIds.length === 0) {
        return 0;
      }

      const result = await this.usageModel.aggregate([
        {
          $match: {
            projectId: { $in: projectIds },
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
          },
        },
      ]);

      return result[0]?.totalCost || 0;
    } catch (error) {
      this.logger.error('Error getting workspace spending:', {
        error: error,
        workspaceId,
        startDate,
        endDate,
      });
      return 0;
    }
  }
}
