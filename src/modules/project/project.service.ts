import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  Project,
  ProjectDocument,
  ProjectBudget,
} from '../../schemas/team-project/project.schema';
import { Usage } from '../../schemas/core/usage.schema';
import { User, UserDocument } from '../../schemas/user/user.schema';
import { Alert } from '../../schemas/core/alert.schema';
import {
  ApprovalRequest,
  ApprovalRequestDocument,
} from '../../schemas/misc/approval-request.schema';
import {
  TeamMember,
  TeamMemberDocument,
} from '../../schemas/team-project/team-member.schema';
import { ActivityService } from '../activity/activity.service';
import { EmailService } from '../email/email.service';
import { PermissionService } from '../team/services/permission.service';
import { WorkspaceService } from '../team/services/workspace.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

export interface ProjectSpendingUpdate {
  amount: number;
  userId: string;
  usageId: string;
  model?: string;
  service?: string;
}

@Injectable()
export class ProjectService implements OnModuleDestroy {
  private readonly logger = new Logger(ProjectService.name);
  private readonly objectIdCache = new Map<string, Types.ObjectId>();
  private backgroundQueue: Array<() => Promise<void>> = [];
  private backgroundProcessor: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Alert.name) private alertModel: Model<Alert>,
    @InjectModel(ApprovalRequest.name)
    private approvalRequestModel: Model<ApprovalRequestDocument>,
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
    private activityService: ActivityService,
    private emailService: EmailService,
    private permissionService: PermissionService,
    private workspaceService: WorkspaceService,
    private subscriptionService: SubscriptionService,
  ) {
    this.startBackgroundProcessor();
  }

  onModuleDestroy(): void {
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = null;
    }
  }

  private startBackgroundProcessor(): void {
    if (this.backgroundProcessor) return;
    this.backgroundProcessor = setInterval(async () => {
      if (this.backgroundQueue.length > 0) {
        const operation = this.backgroundQueue.shift();
        if (operation) {
          try {
            await operation();
          } catch (err) {
            this.logger.warn('Background operation failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }, 2000);
  }

  private queueBackground(fn: () => Promise<void>): void {
    this.backgroundQueue.push(fn);
  }

  private getMemoizedObjectId(id: string): Types.ObjectId {
    if (!this.objectIdCache.has(id)) {
      this.objectIdCache.set(id, new Types.ObjectId(id));
    }
    return this.objectIdCache.get(id)!;
  }

  async createProject(
    ownerId: string,
    data: CreateProjectDto,
  ): Promise<ProjectDocument> {
    const user = await this.userModel
      .findById(ownerId)
      .select('workspaceId subscriptionId name email');
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.workspaceId) {
      this.logger.log('User missing workspace, creating default workspace', {
        userId: ownerId,
      });
      if (!user.subscriptionId) {
        const subscription =
          await this.subscriptionService.createDefaultSubscription(ownerId);
        (user as any).subscriptionId = (subscription as any)._id;
        await user.save();
        this.logger.log('Created default subscription for user', {
          userId: ownerId,
          subscriptionId: (subscription as any)._id,
        });
      }
      const workspace = await this.workspaceService.createDefaultWorkspace(
        ownerId,
        (user as any).name || 'User',
      );
      (user as any).workspaceId = workspace._id;
      (user as any).workspaceMemberships = [
        { workspaceId: workspace._id, role: 'owner', joinedAt: new Date() },
      ];
      await user.save();
      await this.teamMemberModel.create({
        userId: new Types.ObjectId(ownerId),
        workspaceId: workspace._id,
        email: (user as any).email,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      });
      this.logger.log('Created default workspace for user', {
        userId: ownerId,
        workspaceId: workspace._id,
      });
    }

    const workspaceId = (user as any).workspaceId;
    if (!workspaceId) {
      throw new Error('User workspace is required but not found');
    }

    const projectObj = {
      ...data,
      ownerId: new Types.ObjectId(ownerId),
      workspaceId: Types.ObjectId.isValid(String(workspaceId))
        ? new Types.ObjectId(String(workspaceId))
        : workspaceId,
      budget: {
        ...data.budget,
        startDate: new Date(),
        currency: data.budget.currency || 'USD',
        alerts: data.budget.alerts?.length
          ? data.budget.alerts
          : [
              { threshold: 50, type: 'in-app' as const, recipients: [] },
              { threshold: 80, type: 'both' as const, recipients: [] },
              { threshold: 90, type: 'both' as const, recipients: [] },
            ],
      },
      settings: {
        enablePromptLibrary: true,
        enableCostAllocation: true,
        ...data.settings,
      },
    };

    const project = new this.projectModel(projectObj);
    const savedProject = await project.save();

    this.queueBackground(async () => {
      try {
        await this.activityService.trackActivity(ownerId, {
          type: 'settings_updated',
          title: 'Created Project',
          description: `Created project "${savedProject.name}" with budget ${savedProject.budget.amount} ${savedProject.budget.currency}`,
          metadata: {
            projectId: savedProject._id,
            budget: savedProject.budget.amount,
          },
        });
      } catch (e) {
        this.logger.warn('Background activity tracking failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });

    this.logger.log(`Project created: ${savedProject.name} by user ${ownerId}`);
    return savedProject;
  }

  async getUserProjects(userId: string): Promise<any[]> {
    const user = await this.userModel.findById(userId).select('workspaceId');
    if (!user || !(user as any).workspaceId) {
      return [];
    }
    const workspaceId = (user as any).workspaceId;

    const projects = await this.projectModel
      .find({
        workspaceId: Types.ObjectId.isValid(String(workspaceId))
          ? new Types.ObjectId(String(workspaceId))
          : workspaceId,
        isActive: true,
      })
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const projectIds = projects.map((p) => p._id);
    const allUsageStats = await this.usageModel.aggregate([
      {
        $match: {
          projectId: { $in: projectIds },
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: '$projectId',
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
        },
      },
    ]);

    const usageStatsMap = new Map(
      allUsageStats.map((stat: any) => [
        stat._id.toString(),
        {
          totalCost: stat.totalCost,
          totalRequests: stat.totalRequests,
          totalTokens: stat.totalTokens,
        },
      ]),
    );

    return projects.map((project) => {
      const po = project.toObject ? project.toObject() : (project as any);
      const pid = project._id.toString();
      po.usage = usageStatsMap.get(pid) || {
        totalCost: 0,
        totalRequests: 0,
        totalTokens: 0,
      };
      return po;
    });
  }

  async getProjectById(
    projectId: string,
    userId: string,
  ): Promise<ProjectDocument> {
    const project = await this.projectModel
      .findById(projectId)
      .populate('ownerId', 'name email');

    if (!project || !project.isActive) {
      throw new Error('Project not found');
    }

    const canAccess = await this.permissionService.canAccessProject(
      userId,
      projectId,
    );
    if (!canAccess) {
      throw new Error('Access denied');
    }

    await this.recalculateProjectSpending(projectId);
    const updated = await this.projectModel
      .findById(projectId)
      .populate('ownerId', 'name email');
    if (!updated) {
      throw new Error('Project not found after recalculation');
    }
    return updated;
  }

  async updateProject(
    projectId: string,
    updates: UpdateProjectDto,
    userId: string,
  ): Promise<ProjectDocument> {
    const project = await this.projectModel.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const workspaceId =
      project.workspaceId?.toString?.() ||
      (project.workspaceId as any)?._id?.toString?.();
    if (!workspaceId) {
      throw new Error('Project has no workspace');
    }
    const canManage = await this.permissionService.hasPermission(
      userId,
      workspaceId,
      'canManageProjects',
    );
    const ownerIdStr =
      typeof project.ownerId === 'object' && (project.ownerId as any)._id
        ? (project.ownerId as any)._id.toString()
        : project.ownerId.toString();
    if (ownerIdStr !== userId && !canManage) {
      throw new Error('Unauthorized to update project');
    }

    Object.assign(project, updates);
    await project.save();

    await this.activityService.trackActivity(userId, {
      type: 'settings_updated',
      title: 'Updated Project',
      description: `Updated project "${project.name}"`,
      metadata: { projectId: project._id, updates: Object.keys(updates) },
    });

    return project;
  }

  async deleteProject(projectId: string, userId: string): Promise<void> {
    const project = await this.projectModel.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const ownerIdStr =
      typeof project.ownerId === 'object' && (project.ownerId as any)._id
        ? (project.ownerId as any)._id.toString()
        : project.ownerId.toString();
    if (ownerIdStr !== userId) {
      throw new Error('Access denied');
    }
    project.isActive = false;
    await project.save();
    await this.activityService.trackActivity(userId, {
      type: 'settings_updated',
      title: 'Deleted Project',
      description: `Deleted project "${project.name}"`,
      metadata: { projectId: project._id },
    });
  }

  async getProjectAnalytics(projectId: string, period?: string): Promise<any> {
    const project = await this.projectModel.findById(projectId).lean();
    if (!project) {
      throw new Error('Project not found');
    }

    const startDate = this.getStartDateForPeriod(
      period || (project as any).budget.period,
    );
    const projectObjectId = this.getMemoizedObjectId(projectId);

    const [analyticsResult] = await this.usageModel.aggregate([
      {
        $match: {
          projectId: projectObjectId,
          createdAt: { $gte: startDate },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
                totalCalls: { $sum: 1 },
                totalTokens: { $sum: '$totalTokens' },
                avgCost: { $avg: '$cost' },
              },
            },
          ],
          dailyTrend: [
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
                amount: { $sum: '$cost' },
                calls: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          serviceBreakdown: [
            {
              $group: {
                _id: '$service',
                cost: { $sum: '$cost' },
                calls: { $sum: 1 },
              },
            },
            { $sort: { cost: -1 } },
            { $limit: 10 },
          ],
          modelBreakdown: [
            {
              $group: {
                _id: '$model',
                cost: { $sum: '$cost' },
                calls: { $sum: 1 },
              },
            },
            { $sort: { cost: -1 } },
            { $limit: 10 },
          ],
          userBreakdown: [
            {
              $group: {
                _id: '$userId',
                cost: { $sum: '$cost' },
                calls: { $sum: 1 },
              },
            },
            { $sort: { cost: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]);

    const summary = analyticsResult.summary[0] || {
      totalCost: 0,
      totalCalls: 0,
      totalTokens: 0,
      avgCost: 0,
    };
    const budget = (project as any).budget;
    const spending = (project as any).spending || { current: 0 };

    return {
      project: {
        id: (project as any)._id,
        name: (project as any).name,
        budget,
        spending: (project as any).spending,
        usagePercentage:
          budget.amount > 0 ? (spending.current / budget.amount) * 100 : 0,
      },
      period: { start: startDate, end: new Date() },
      summary: {
        totalCost: summary.totalCost,
        totalCalls: summary.totalCalls,
        totalTokens: summary.totalTokens,
        avgCostPerCall: summary.avgCost,
        remainingBudget: Math.max(0, budget.amount - spending.current),
        daysRemaining: this.getDaysRemaining(budget),
      },
      breakdown: {
        byService: (analyticsResult.serviceBreakdown || []).map(
          (item: any) => ({
            name: item._id,
            cost: item.cost,
            calls: item.calls,
          }),
        ),
        byModel: (analyticsResult.modelBreakdown || []).map((item: any) => ({
          name: item._id,
          cost: item.cost,
          calls: item.calls,
        })),
        byUser: (analyticsResult.userBreakdown || []).map((item: any) => ({
          name: item._id,
          cost: item.cost,
          calls: item.calls,
        })),
      },
      trends: {
        daily: analyticsResult.dailyTrend || [],
        projectedMonthlySpend: this.projectMonthlySpend(
          analyticsResult.dailyTrend || [],
        ),
      },
    };
  }

  private getStartDateForPeriod(period: string): Date {
    const now = new Date();
    switch (period) {
      case 'monthly':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case 'quarterly': {
        const q = Math.floor(now.getMonth() / 3);
        return new Date(now.getFullYear(), q * 3, 1);
      }
      case 'yearly':
        return new Date(now.getFullYear(), 0, 1);
      default:
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  private getDaysRemaining(budget: ProjectBudget): number {
    const now = new Date();
    let endDate: Date;
    switch (budget.period) {
      case 'monthly':
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'quarterly': {
        const q = Math.floor(now.getMonth() / 3);
        endDate = new Date(now.getFullYear(), (q + 1) * 3, 0);
        break;
      }
      case 'yearly':
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      default:
        endDate = budget.endDate || now;
    }
    return Math.max(
      0,
      Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  private projectMonthlySpend(dailySpending: any[]): number {
    if (dailySpending.length === 0) return 0;
    const total = dailySpending.reduce((sum, day) => sum + day.amount, 0);
    return (total / dailySpending.length) * 30;
  }

  async getCostAllocation(
    projectId: string,
    options: { groupBy?: string; startDate?: Date; endDate?: Date },
  ): Promise<any> {
    const match: any = { projectId: new Types.ObjectId(projectId) };
    if (options.startDate || options.endDate) {
      match.createdAt = {};
      if (options.startDate) match.createdAt.$gte = options.startDate;
      if (options.endDate) match.createdAt.$lte = options.endDate;
    }
    const groupBy = options.groupBy || 'department';
    const groupField = `costAllocation.${groupBy}`;

    const allocation = await this.usageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: `$${groupField}`,
          totalCost: { $sum: '$cost' },
          totalTokens: { $sum: '$totalTokens' },
          count: { $sum: 1 },
          services: { $push: { service: '$service', cost: '$cost' } },
        },
      },
      {
        $project: {
          name: '$_id',
          totalCost: 1,
          totalTokens: 1,
          count: 1,
          topServices: {
            $slice: [
              { $sortArray: { input: '$services', sortBy: { cost: -1 } } },
              5,
            ],
          },
        },
      },
      { $sort: { totalCost: -1 } },
    ]);

    return {
      groupBy,
      period: { start: options.startDate, end: options.endDate },
      allocation,
      total: allocation.reduce(
        (sum: number, item: any) => sum + item.totalCost,
        0,
      ),
    };
  }

  async exportProjectData(
    projectId: string,
    options: {
      format?: 'csv' | 'json' | 'excel';
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<any> {
    const project = await this.projectModel.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const match: any = { projectId: new Types.ObjectId(projectId) };
    if (options.startDate || options.endDate) {
      match.createdAt = {};
      if (options.startDate) match.createdAt.$gte = options.startDate;
      if (options.endDate) match.createdAt.$lte = options.endDate;
    }

    const usageData = await this.usageModel
      .find(match)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    if (options.format === 'json') {
      return {
        project: {
          id: project._id,
          name: project.name,
          budget: project.budget,
          spending: project.spending,
        },
        usage: usageData,
      };
    }

    if (options.format === 'csv') {
      const headers = [
        'Date',
        'User',
        'Service',
        'Model',
        'Tokens',
        'Cost',
        'Department',
        'Team',
        'Client',
        'Tags',
      ];
      const rows = usageData.map((u: any) => [
        u.createdAt.toISOString(),
        u.userId?.name || u.userId?.email || '',
        u.service,
        u.model,
        u.totalTokens ?? '',
        u.cost.toFixed(4),
        u.costAllocation?.department ?? '',
        u.costAllocation?.team ?? '',
        u.costAllocation?.client ?? '',
        (u.tags && Array.isArray(u.tags) ? u.tags : []).join(', '),
      ]);
      return [headers, ...rows].map((row) => row.join(',')).join('\n');
    }

    // Excel export implementation
    const workbook = XLSX.utils.book_new();

    // Project Summary Sheet
    const projectSummary = [
      ['Project Information'],
      ['Name', project.name],
      ['Budget', project.budget?.amount || 0],
      ['Current Spending', project.spending?.current ?? 0],
      [
        'Remaining Budget',
        (project.budget?.amount || 0) - (project.spending?.current ?? 0),
      ],
      ['Created', project.createdAt.toISOString()],
      [''],
      ['Usage Statistics'],
      ['Total Records', usageData.length],
      [
        'Date Range',
        options.startDate ? options.startDate.toISOString() : 'All time',
        options.endDate ? options.endDate.toISOString() : 'Present',
      ],
    ];

    const projectSheet = XLSX.utils.aoa_to_sheet(projectSummary);
    XLSX.utils.book_append_sheet(workbook, projectSheet, 'Project Summary');

    // Usage Data Sheet
    const usageHeaders = [
      'Date',
      'User Name',
      'User Email',
      'Service',
      'Model',
      'Prompt Tokens',
      'Completion Tokens',
      'Total Tokens',
      'Cost (USD)',
      'Latency (ms)',
      'Department',
      'Team',
      'Client',
      'Tags',
      'Request ID',
    ];

    const usageRows = usageData.map((u: any) => [
      u.createdAt.toISOString(),
      u.userId?.name || '',
      u.userId?.email || '',
      u.service || '',
      u.model || '',
      u.promptTokens || 0,
      u.completionTokens || 0,
      u.totalTokens || 0,
      u.cost || 0,
      u.latency || 0,
      u.costAllocation?.department || '',
      u.costAllocation?.team || '',
      u.costAllocation?.client || '',
      u.tags && Array.isArray(u.tags) ? u.tags.join(', ') : '',
      u.requestId || '',
    ]);

    const usageSheet = XLSX.utils.aoa_to_sheet([usageHeaders, ...usageRows]);
    XLSX.utils.book_append_sheet(workbook, usageSheet, 'Usage Data');

    // Cost Analysis Sheet
    const costAnalysis = this.generateCostAnalysisSheet(usageData);
    const costSheet = XLSX.utils.aoa_to_sheet(costAnalysis);
    XLSX.utils.book_append_sheet(workbook, costSheet, 'Cost Analysis');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return {
      buffer,
      filename: `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_export_${new Date().toISOString().split('T')[0]}.xlsx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async recalculateProjectSpending(projectId: string): Promise<void> {
    const project = await this.projectModel.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    let workspaceId = project.workspaceId;
    if (!workspaceId) {
      const owner = await this.userModel
        .findById(project.ownerId)
        .select('workspaceId');
      if (owner?.workspaceId) {
        workspaceId = Types.ObjectId.isValid(String(owner.workspaceId))
          ? new Types.ObjectId(String(owner.workspaceId))
          : (owner.workspaceId as any);
        (project as any).workspaceId = workspaceId;
        await project.save();
        this.logger.log(`Migrated workspaceId for project ${projectId}`);
      } else {
        this.logger.warn(
          `Skipping project ${projectId} - no workspaceId and owner has no workspace`,
        );
        return;
      }
    }

    const [usageStats] = await this.usageModel.aggregate([
      { $match: { projectId: new Types.ObjectId(projectId) } },
      { $group: { _id: null, totalCost: { $sum: '$cost' } } },
    ]);
    const totalSpending = usageStats?.totalCost ?? 0;
    (project as any).spending = (project as any).spending || {};
    (project as any).spending.current = totalSpending;
    (project as any).spending.lastUpdated = new Date();
    await project.save();
    this.logger.log(
      `Recalculated spending for project ${projectId}: $${totalSpending}`,
    );
  }

  async recalculateUserProjectSpending(userId: string): Promise<void> {
    const projects = await this.projectModel.find({
      $or: [{ ownerId: userId }, { 'members.userId': userId }],
      isActive: true,
    });
    let totalRecalculated = 0;
    for (const project of projects) {
      try {
        await this.recalculateProjectSpending(project._id.toString());
        totalRecalculated++;
      } catch (e) {
        this.logger.warn(
          `Failed to recalculate spending for project ${project._id.toString()}`,
          {
            error: e instanceof Error ? e.message : String(e),
          },
        );
      }
    }
    this.logger.log(
      `Recalculated spending for ${totalRecalculated} user projects`,
      { userId },
    );
  }

  /**
   * Recalculate spending for all active projects (Express parity).
   */
  async recalculateAllProjectSpending(): Promise<void> {
    const projects = await this.projectModel.find({ isActive: true });
    let totalRecalculated = 0;
    for (const project of projects) {
      try {
        await this.recalculateProjectSpending(project._id.toString());
        totalRecalculated++;
      } catch (e) {
        this.logger.warn(
          `Failed to recalculate spending for project ${project._id.toString()}`,
          { error: e instanceof Error ? e.message : String(e) },
        );
      }
    }
    this.logger.log(`Recalculated spending for ${totalRecalculated} projects`);
  }

  async updateProjectSpending(
    projectId: string,
    update: ProjectSpendingUpdate,
  ): Promise<void> {
    const project = await this.projectModel.findById(projectId);
    if (!project) {
      this.logger.warn(`Project not found: ${projectId}`);
      return;
    }
    const spending = (project as any).spending || {
      current: 0,
      lastUpdated: new Date(),
      history: [],
    };
    spending.current += update.amount;
    spending.lastUpdated = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayHistory = spending.history?.find(
      (h: any) => new Date(h.date).toDateString() === today.toDateString(),
    );
    if (todayHistory) {
      todayHistory.amount += update.amount;
      if (update.model && todayHistory.breakdown) {
        todayHistory.breakdown[update.model] =
          (todayHistory.breakdown[update.model] || 0) + update.amount;
      }
    } else {
      if (!spending.history) spending.history = [];
      spending.history.push({
        date: today,
        amount: update.amount,
        breakdown: update.model ? { [update.model]: update.amount } : {},
      });
    }
    (project as any).spending = spending;
    await this.checkBudgetAlerts(project);
    await project.save();
  }

  private async checkBudgetAlerts(project: ProjectDocument): Promise<void> {
    const budget = project.budget;
    const spending = (project as any).spending || { current: 0 };
    const usagePercentage =
      budget.amount > 0 ? (spending.current / budget.amount) * 100 : 0;
    const ownerId =
      typeof project.ownerId === 'object' && (project.ownerId as any)._id
        ? (project.ownerId as any)._id.toString()
        : project.ownerId.toString();

    for (const alert of budget.alerts || []) {
      if (usagePercentage >= alert.threshold) {
        const alertKey = `budget_alert_${project._id}_${alert.threshold}_${new Date().getMonth()}`;
        const firstOfMonth = new Date();
        firstOfMonth.setDate(1);
        firstOfMonth.setHours(0, 0, 0, 0);
        const existingAlert = await this.alertModel.findOne({
          userId: ownerId,
          'metadata.alertKey': alertKey,
          createdAt: { $gte: firstOfMonth },
        });
        if (!existingAlert) {
          await this.alertModel.create({
            userId: ownerId,
            title: `Budget Alert: ${project.name}`,
            message: `Project "${project.name}" has reached ${usagePercentage.toFixed(1)}% of its ${budget.period} budget`,
            type: 'cost_threshold',
            severity:
              usagePercentage >= 90
                ? 'critical'
                : usagePercentage >= 80
                  ? 'high'
                  : 'medium',
            actionRequired: usagePercentage >= 90,
            data: {
              currentValue: spending.current,
              threshold: budget.amount,
              percentage: usagePercentage,
              period: budget.period,
            },
            metadata: {
              projectId: project._id.toString(),
              usagePercentage,
              currentSpending: spending.current,
              budget: budget.amount,
              alertKey,
            },
          });
          if (alert.type === 'email' || alert.type === 'both') {
            const owner = await this.userModel.findById(ownerId);
            if (owner) {
              await this.emailService.sendCostAlert(
                owner as any,
                spending.current,
                budget.amount,
              );
            }
          }
        }
      }
    }
  }

  async checkApprovalRequired(
    projectId: string,
    estimatedCost: number,
  ): Promise<boolean> {
    const project = await this.projectModel
      .findById(projectId)
      .select('settings.requireApprovalAbove')
      .lean();
    if (!project || !(project as any).settings?.requireApprovalAbove)
      return false;
    return estimatedCost > (project as any).settings.requireApprovalAbove;
  }

  async createApprovalRequest(
    requesterId: string,
    projectId: string,
    details: any,
  ): Promise<ApprovalRequestDocument> {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new Error('Project not found');
    const requesterHistory = await this.getRequesterHistory(
      requesterId,
      projectId,
    );
    const spending = (project as any).spending || { current: 0 };
    const approvalRequest = await this.approvalRequestModel.create({
      requesterId: new Types.ObjectId(requesterId),
      projectId: new Types.ObjectId(projectId),
      type: 'api_call',
      details,
      metadata: {
        currentProjectSpending: spending.current,
        budgetRemaining: project.budget.amount - spending.current,
        requesterHistory,
      },
    });
    await this.alertModel.create({
      userId: project.ownerId,
      title: 'Approval Request',
      message: `New approval request from user for ${details.operation}`,
      type: 'system',
      severity: details.urgency || 'medium',
      actionRequired: true,
      metadata: {
        approvalRequestId: approvalRequest._id,
        projectId,
        estimatedCost: details.estimatedCost,
      },
    });
    return approvalRequest;
  }

  private async getRequesterHistory(
    userId: string,
    projectId: string,
  ): Promise<any> {
    const [usageStats] = await this.usageModel.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          projectId: new Types.ObjectId(projectId),
        },
      },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalSpending: { $sum: '$cost' },
        },
      },
    ]);
    const approvedCount = await this.approvalRequestModel.countDocuments({
      requesterId: userId,
      projectId,
      status: 'approved',
    });
    return {
      totalRequests: usageStats?.totalRequests ?? 0,
      approvedRequests: approvedCount,
      totalSpending: usageStats?.totalSpending ?? 0,
    };
  }

  async getApprovalRequests(
    projectId: string,
    status?: string,
  ): Promise<any[]> {
    const filter: any = { projectId };
    if (status) filter.status = status;
    return this.approvalRequestModel
      .find(filter)
      .populate('requesterId', 'name email')
      .sort({ createdAt: -1 })
      .lean();
  }

  async handleApprovalRequest(
    requestId: string,
    userId: string,
    action: 'approve' | 'reject',
    comments?: string,
    conditions?: string[],
  ): Promise<ApprovalRequestDocument> {
    const request = await this.approvalRequestModel.findById(requestId);
    if (!request) {
      throw new Error('Approval request not found');
    }
    if (request.status !== 'pending') {
      throw new Error('Request has already been processed');
    }
    if (action === 'approve') {
      await request.approve(userId, comments, conditions);
    } else {
      await request.reject(userId, comments ?? '');
    }
    return request;
  }

  /**
   * Generate cost analysis sheet data
   */
  private generateCostAnalysisSheet(usageData: any[]): any[][] {
    const analysis = [
      ['Cost Analysis'],
      [''],
      ['Summary Statistics'],
      ['Total Usage Records', usageData.length],
      [
        'Total Cost (USD)',
        usageData.reduce((sum, u) => sum + (u.cost || 0), 0),
      ],
      [
        'Average Cost per Request',
        usageData.length > 0
          ? usageData.reduce((sum, u) => sum + (u.cost || 0), 0) /
            usageData.length
          : 0,
      ],
      [
        'Total Tokens Used',
        usageData.reduce((sum, u) => sum + (u.totalTokens || 0), 0),
      ],
      [''],
      ['Cost by Service'],
    ];

    // Group by service
    const serviceCosts = new Map<string, number>();
    const serviceRequests = new Map<string, number>();

    usageData.forEach((u) => {
      const service = u.service || 'Unknown';
      serviceCosts.set(
        service,
        (serviceCosts.get(service) || 0) + (u.cost || 0),
      );
      serviceRequests.set(service, (serviceRequests.get(service) || 0) + 1);
    });

    analysis.push([
      'Service',
      'Total Cost',
      'Request Count',
      'Avg Cost per Request',
    ]);
    Array.from(serviceCosts.entries()).forEach(([service, cost]) => {
      const requests = serviceRequests.get(service) || 0;
      analysis.push([
        service,
        cost.toFixed(4),
        requests,
        (cost / requests).toFixed(4),
      ]);
    });

    analysis.push(['']);
    analysis.push(['Cost by Model']);

    // Group by model
    const modelCosts = new Map<string, number>();
    const modelRequests = new Map<string, number>();

    usageData.forEach((u) => {
      const model = u.model || 'Unknown';
      modelCosts.set(model, (modelCosts.get(model) || 0) + (u.cost || 0));
      modelRequests.set(model, (modelRequests.get(model) || 0) + 1);
    });

    analysis.push([
      'Model',
      'Total Cost',
      'Request Count',
      'Avg Cost per Request',
    ]);
    Array.from(modelCosts.entries()).forEach(([model, cost]) => {
      const requests = modelRequests.get(model) || 0;
      analysis.push([
        model,
        cost.toFixed(4),
        requests,
        (cost / requests).toFixed(4),
      ]);
    });

    analysis.push(['']);
    analysis.push(['Cost by User']);

    // Group by user
    const userCosts = new Map<string, number>();
    const userRequests = new Map<string, number>();

    usageData.forEach((u) => {
      const userName = u.userId?.name || u.userId?.email || 'Unknown User';
      userCosts.set(userName, (userCosts.get(userName) || 0) + (u.cost || 0));
      userRequests.set(userName, (userRequests.get(userName) || 0) + 1);
    });

    analysis.push([
      'User',
      'Total Cost',
      'Request Count',
      'Avg Cost per Request',
    ]);
    Array.from(userCosts.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by cost descending
      .forEach(([user, cost]) => {
        const requests = userRequests.get(user) || 0;
        analysis.push([
          user,
          cost.toFixed(4),
          requests,
          (cost / requests).toFixed(4),
        ]);
      });

    analysis.push(['']);
    analysis.push(['Daily Cost Breakdown']);

    // Group by date
    const dailyCosts = new Map<string, number>();
    const dailyRequests = new Map<string, number>();

    usageData.forEach((u) => {
      const date = u.createdAt.toISOString().split('T')[0];
      dailyCosts.set(date, (dailyCosts.get(date) || 0) + (u.cost || 0));
      dailyRequests.set(date, (dailyRequests.get(date) || 0) + 1);
    });

    analysis.push([
      'Date',
      'Total Cost',
      'Request Count',
      'Avg Cost per Request',
    ]);
    Array.from(dailyCosts.entries())
      .sort((a, b) => a[0].localeCompare(b[0])) // Sort by date ascending
      .forEach(([date, cost]) => {
        const requests = dailyRequests.get(date) || 0;
        analysis.push([
          date,
          cost.toFixed(4),
          requests,
          (cost / requests).toFixed(4),
        ]);
      });

    return analysis;
  }
}
