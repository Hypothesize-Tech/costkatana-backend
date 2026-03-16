import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Project,
  ProjectDocument,
} from '../../../schemas/team-project/project.schema';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../../schemas/user/workspace.schema';
import { ProjectStats, WorkspaceStats, ProjectTrend } from '../interfaces';

@Injectable()
export class AdminProjectAnalyticsService {
  private readonly logger = new Logger(AdminProjectAnalyticsService.name);

  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
  ) {}

  /**
   * Get analytics for all projects
   */
  async getProjectAnalytics(
    filters: {
      startDate?: Date;
      endDate?: Date;
      workspaceId?: string;
      isActive?: boolean;
    } = {},
  ): Promise<ProjectStats[]> {
    try {
      const matchStage: any = {};

      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
      }

      // Get projects with filters
      const projectMatch: any = {};
      if (filters.workspaceId) {
        projectMatch.workspaceId = filters.workspaceId;
      }
      if (filters.isActive !== undefined) {
        projectMatch.isActive = filters.isActive;
      }

      const projects = await this.projectModel.find(projectMatch).lean();
      const projectStats: ProjectStats[] = [];

      for (const project of projects) {
        const projectId = project._id.toString();

        // Get usage stats for this project
        const usageStats = await this.usageModel.aggregate([
          { $match: { ...matchStage, projectId: project._id } },
          {
            $group: {
              _id: null,
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              totalRequests: { $sum: 1 },
              errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
              lastActivity: { $max: '$createdAt' },
              userIds: { $addToSet: '$userId' },
            },
          },
        ]);

        const stats = usageStats[0] || {
          totalCost: 0,
          totalTokens: 0,
          totalRequests: 0,
          errorCount: 0,
          lastActivity: project.createdAt,
          userIds: [],
        };

        // Get workspace info
        const workspace = project.workspaceId
          ? await this.workspaceModel.findById(project.workspaceId).lean()
          : null;
        const owner = project.ownerId
          ? await this.userModel
              .findById(project.ownerId)
              .select('email name')
              .lean()
          : null;

        const budgetAmount = project.budget?.amount || 0;
        const budgetUsagePercentage =
          budgetAmount > 0 ? (stats.totalCost / budgetAmount) * 100 : 0;

        // Handle potentially undefined fields
        if (!project.ownerId) {
          this.logger.warn('Project missing ownerId', {
            projectId,
            projectName: project.name,
          });
        }

        projectStats.push({
          projectId,
          projectName: project.name,
          workspaceId: project.workspaceId
            ? project.workspaceId.toString()
            : undefined,
          workspaceName: workspace?.name,
          ownerId: project.ownerId ? project.ownerId.toString() : projectId, // Fallback to projectId if ownerId is missing
          ownerEmail: owner?.email,
          totalCost: stats.totalCost || 0,
          totalTokens: stats.totalTokens || 0,
          totalRequests: stats.totalRequests || 0,
          averageCostPerRequest:
            stats.totalRequests > 0
              ? (stats.totalCost || 0) / stats.totalRequests
              : 0,
          budgetAmount,
          budgetUsagePercentage: Math.round(budgetUsagePercentage * 100) / 100,
          isOverBudget: budgetUsagePercentage > 100,
          errorCount: stats.errorCount || 0,
          errorRate:
            stats.totalRequests > 0
              ? ((stats.errorCount || 0) / stats.totalRequests) * 100
              : 0,
          activeUsers: stats.userIds?.length || 0,
          createdAt: project.createdAt,
          lastActivity: stats.lastActivity || project.createdAt,
        });
      }

      return projectStats.sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      this.logger.error('Error getting project analytics:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminProjectAnalyticsService',
        operation: 'getProjectAnalytics',
      });
      throw error;
    }
  }

  /**
   * Get analytics for all workspaces
   */
  async getWorkspaceAnalytics(
    filters: {
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<WorkspaceStats[]> {
    try {
      const matchStage: any = {};

      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
      }

      const workspaces = await this.workspaceModel
        .find({ isActive: true })
        .lean();
      const workspaceStats: WorkspaceStats[] = [];

      for (const workspace of workspaces) {
        const workspaceId = workspace._id.toString();

        // Get all projects in this workspace
        const projects = await this.projectModel
          .find({ workspaceId: workspace._id })
          .lean();

        // Get usage stats for all projects in this workspace
        const projectIds = projects.map((p) => p._id);
        const usageStats = await this.usageModel.aggregate([
          {
            $match: {
              ...matchStage,
              projectId: { $in: projectIds },
            },
          },
          {
            $group: {
              _id: null,
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              totalRequests: { $sum: 1 },
              userIds: { $addToSet: '$userId' },
            },
          },
        ]);

        const stats = usageStats[0] || {
          totalCost: 0,
          totalTokens: 0,
          totalRequests: 0,
          userIds: [],
        };

        // Calculate workspace budget (sum of all project budgets)
        const budgetAmount = projects.reduce(
          (sum, p) => sum + (p.budget?.amount || 0),
          0,
        );
        const budgetUsagePercentage =
          budgetAmount > 0 ? (stats.totalCost / budgetAmount) * 100 : 0;

        const owner = await this.userModel
          .findById(workspace.ownerId)
          .select('email')
          .lean();

        workspaceStats.push({
          workspaceId,
          workspaceName: workspace.name,
          ownerId: workspace.ownerId.toString(),
          ownerEmail: owner?.email,
          totalCost: stats.totalCost || 0,
          totalTokens: stats.totalTokens || 0,
          totalRequests: stats.totalRequests || 0,
          projectCount: projects.length,
          activeProjectCount: projects.filter((p) => p.isActive).length,
          activeUsers: stats.userIds?.length || 0,
          budgetAmount,
          budgetUsagePercentage: Math.round(budgetUsagePercentage * 100) / 100,
          isOverBudget: budgetUsagePercentage > 100,
          createdAt: workspace.createdAt,
        });
      }

      return workspaceStats.sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      this.logger.error('Error getting workspace analytics:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminProjectAnalyticsService',
        operation: 'getWorkspaceAnalytics',
      });
      throw error;
    }
  }

  /**
   * Get spending trends for a project
   */
  async getProjectTrends(
    projectId: string,
    period: 'daily' | 'weekly' | 'monthly' = 'daily',
    startDate?: Date,
    endDate?: Date,
  ): Promise<ProjectTrend[]> {
    try {
      const matchStage: any = {
        projectId: projectId,
      };

      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = startDate;
        if (endDate) matchStage.createdAt.$lte = endDate;
      }

      let dateFormat: any;

      switch (period) {
        case 'daily':
          dateFormat = {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          };
          break;
        case 'weekly':
          dateFormat = {
            $dateToString: { format: '%Y-W%V', date: '$createdAt' },
          };
          break;
        case 'monthly':
          dateFormat = {
            $dateToString: { format: '%Y-%m', date: '$createdAt' },
          };
          break;
      }

      const trends = await this.usageModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: dateFormat,
            date: { $first: dateFormat },
            cost: { $sum: '$cost' },
            tokens: { $sum: '$totalTokens' },
            requests: { $sum: 1 },
          },
        },
        { $sort: { date: 1 } },
      ]);

      return trends.map((t: any) => ({
        date: t.date,
        cost: t.cost || 0,
        tokens: t.tokens || 0,
        requests: t.requests || 0,
      }));
    } catch (error) {
      this.logger.error('Error getting project trends:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminProjectAnalyticsService',
        operation: 'getProjectTrends',
        projectId,
      });
      throw error;
    }
  }
}
