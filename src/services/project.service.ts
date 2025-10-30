import { Project, IProject } from '../models/Project';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { ApprovalRequest, IApprovalRequest } from '../models/ApprovalRequest';
import { loggingService } from './logging.service';
import { EmailService } from './email.service';
import { ActivityService } from './activity.service';
import mongoose from 'mongoose';

interface CreateProjectDto {
    name: string;
    description?: string;
    budget: {
        amount: number;
        period: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
        startDate?: Date;
        currency?: string;
        alerts?: Array<{
            threshold: number;
            type: 'email' | 'in-app' | 'both';
            recipients?: string[];
        }>;
    };
    settings?: {
        requireApprovalAbove?: number;
        allowedModels?: string[];
        maxTokensPerRequest?: number;
        enablePromptLibrary?: boolean;
        enableCostAllocation?: boolean;
    };
    tags?: string[];
}

interface ProjectSpendingUpdate {
    amount: number;
    userId: string;
    usageId: string;
    model?: string;
    service?: string;
}

export class ProjectService {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // ObjectId memoization cache
    private static objectIdCache = new Map<string, mongoose.Types.ObjectId>();
    
    // Date range cache for performance
    private static dateRangeCache = new Map<string, Date>();

    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }

    /**
     * Create a new project
     */
    static async createProject(ownerId: string, data: CreateProjectDto): Promise<IProject> {
        const startTime = Date.now();
        loggingService.info('=== ProjectService.createProject STARTED ===');
        loggingService.info('Service input data:', { value:  { 
            ownerId,
            projectName: data.name,
            budgetAmount: data.budget?.amount,
            budgetPeriod: data.budget?.period,
            alertsCount: data.budget?.alerts?.length,
            settingsProvided: !!data.settings
         } });

        try {
            // Get user's workspace
            const user = await User.findById(ownerId).select('workspaceId');
            if (!user || !user.workspaceId) {
                throw new Error('User must belong to a workspace to create projects');
            }

            loggingService.info('Step 1: Creating project object');
            const projectObj = {
                ...data,
                ownerId,
                workspaceId: user.workspaceId,
                budget: {
                    ...data.budget,
                    startDate: data.budget.startDate || new Date(),
                    currency: data.budget.currency || 'USD',
                    alerts: data.budget.alerts || [
                        { threshold: 50, type: 'in-app' },
                        { threshold: 80, type: 'both' },
                        { threshold: 90, type: 'both' }
                    ]
                },
                settings: {
                    enablePromptLibrary: true,
                    enableCostAllocation: true,
                    notifications: {
                        budgetAlerts: true,
                        monthlyReports: true,
                        usageReports: true
                    },
                    ...data.settings
                }
            };

            loggingService.info('Step 2: Initializing Mongoose Project model');
            const project = new Project(projectObj);
            loggingService.info('Project model created, validating...');

            loggingService.info('Step 3: Saving project to database');
            const savedProject = await project.save();
            loggingService.info('Project saved successfully:', {
                projectId: savedProject._id,
                timeTaken: Date.now() - startTime + 'ms'
            });

            loggingService.info('Step 4: Queuing activity tracking');
            // Queue activity tracking for background processing
            this.queueBackgroundOperation(async () => {
                try {
                    await ActivityService.trackActivity(ownerId, {
                        type: 'settings_updated',
                        title: 'Created Project',
                        description: `Created project "${savedProject.name}" with budget ${savedProject.budget.amount} ${savedProject.budget.currency}`,
                        metadata: {
                            projectId: savedProject._id,
                            budget: savedProject.budget.amount
                        }
                    });
                } catch (activityError) {
                    loggingService.warn('Background activity tracking failed:', { 
                        error: activityError instanceof Error ? activityError.message : String(activityError) 
                    });
                }
            });

            loggingService.info('=== ProjectService.createProject COMPLETED ===');
            loggingService.info(`Project created: ${savedProject.name} by user ${ownerId}`);
            return savedProject;
        } catch (error: any) {
            const timeTaken = Date.now() - startTime;
            loggingService.error('=== ProjectService.createProject FAILED ===');
            loggingService.error('Service error details:', {
                message: error.message,
                name: error.name,
                code: error.code,
                stack: error.stack,
                timeTaken: timeTaken + 'ms'
            });

            if (error.name === 'ValidationError') {
                loggingService.error('Mongoose validation errors:', error.errors);
            }

            throw error;
        }
    }

    /**
     * Recalculate spending for all user projects
     */
    static async recalculateUserProjectSpending(userId: string): Promise<void> {
        try {
            const projects = await Project.find({
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ],
                isActive: true
            });

            let totalRecalculated = 0;
            for (const project of projects) {
                await this.recalculateProjectSpending(project._id.toString());
                totalRecalculated++;
            }

            loggingService.info(`Recalculated spending for ${totalRecalculated} user projects`);
        } catch (error) {
            loggingService.error('Error recalculating user project spending:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Recalculate spending for all projects
     */
    static async recalculateAllProjectSpending(): Promise<void> {
        try {
            const projects = await Project.find({ isActive: true });
            let totalRecalculated = 0;

            for (const project of projects) {
                await this.recalculateProjectSpending(project._id.toString());
                totalRecalculated++;
            }

            loggingService.info(`Recalculated spending for ${totalRecalculated} projects`);
        } catch (error) {
            loggingService.error('Error recalculating all project spending:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Recalculate project spending from Usage data
     */
    static async recalculateProjectSpending(projectId: string): Promise<void> {
        try {
            const project = await Project.findById(projectId);
            if (!project) {
                throw new Error('Project not found');
            }

            // Calculate total spending from Usage data
            const usageStats = await Usage.aggregate([
                {
                    $match: {
                        projectId: new mongoose.Types.ObjectId(projectId)
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' }
                    }
                }
            ]);

            const totalSpending = usageStats[0]?.totalCost || 0;

            // Update project spending
            project.spending.current = totalSpending;
            project.spending.lastUpdated = new Date();

            await project.save();
            loggingService.info(`Recalculated spending for project ${projectId}: $${totalSpending}`);
        } catch (error) {
            loggingService.error('Error recalculating project spending:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update project spending when API call is made
     */
    static async updateProjectSpending(projectId: string, update: ProjectSpendingUpdate): Promise<void> {
        try {
            const project = await Project.findById(projectId);
            if (!project) {
                loggingService.warn(`Project not found: ${projectId}`);
                return;
            }

            // Update current spending
            project.spending.current += update.amount;
            project.spending.lastUpdated = new Date();

            // Add to spending history
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let todayHistory = project.spending.history.find(
                h => h.date.toDateString() === today.toDateString()
            );

            if (todayHistory) {
                todayHistory.amount += update.amount;
                if (update.model && todayHistory.breakdown) {
                    todayHistory.breakdown[update.model] =
                        (todayHistory.breakdown[update.model] || 0) + update.amount;
                }
            } else {
                project.spending.history.push({
                    date: today,
                    amount: update.amount,
                    breakdown: update.model ? { [update.model]: update.amount } : {}
                });
            }

            // Check budget alerts
            await this.checkBudgetAlerts(project);

            await project.save();
        } catch (error) {
            loggingService.error('Error updating project spending:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Check if budget alerts need to be triggered
     */
    private static async checkBudgetAlerts(project: any): Promise<void> {
        const usagePercentage = project.budget.amount > 0 ?
            (project.spending.current / project.budget.amount) * 100 : 0;

        for (const alert of project.budget.alerts) {
            if (usagePercentage >= alert.threshold) {
                // Check if alert was already sent
                const alertKey = `budget_alert_${project._id}_${alert.threshold}_${new Date().getMonth()}`;
                const existingAlert = await Alert.findOne({
                    userId: project.ownerId,
                    'metadata.alertKey': alertKey,
                    createdAt: { $gte: new Date(new Date().setDate(1)) } // This month
                });

                if (!existingAlert) {
                    // Create alert
                    const newAlert = await Alert.create({
                        userId: project.ownerId,
                        title: `Budget Alert: ${project.name}`,
                        message: `Project "${project.name}" has reached ${usagePercentage.toFixed(1)}% of its ${project.budget.period} budget`,
                        type: 'cost_threshold',
                        severity: usagePercentage >= 90 ? 'critical' : usagePercentage >= 80 ? 'high' : 'medium',
                        actionRequired: usagePercentage >= 90,
                        data: {
                            currentValue: project.spending.current,
                            threshold: project.budget.amount,
                            percentage: usagePercentage,
                            period: project.budget.period
                        },
                        metadata: {
                            projectId: project._id,
                            usagePercentage,
                            currentSpending: project.spending.current,
                            budget: project.budget.amount,
                            alertKey
                        }
                    });

                    // Send to integrations (Slack, Discord, etc.)
                    try {
                        const { NotificationService } = await import('./notification.service');
                        await NotificationService.sendAlert(newAlert);
                    } catch (error: any) {
                        loggingService.error('Failed to send budget alert to integrations', {
                            error: error.message,
                            alertId: newAlert._id
                        });
                    }

                    // Legacy email support
                    if (alert.type === 'email' || alert.type === 'both') {
                        const owner = await User.findById(project.ownerId);
                        if (owner) {
                            await EmailService.sendCostAlert(
                                owner,
                                project.spending.current,
                                project.budget.amount
                            );
                        }
                    }
                }
            }
        }
    }

    /**
     * Optimized approval check with projection
     */
    static async checkApprovalRequired(
        projectId: string,
        estimatedCost: number
    ): Promise<boolean> {
        try {
            const project = await Project.findById(projectId)
                .select('settings.requireApprovalAbove')
                .lean();
            
            if (!project || !project.settings?.requireApprovalAbove) {
                return false;
            }

            return estimatedCost > project.settings.requireApprovalAbove;
        } catch (error) {
            loggingService.error('Error checking approval requirement:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Create an approval request
     */
    static async createApprovalRequest(
        requesterId: string,
        projectId: string,
        details: any
    ): Promise<IApprovalRequest> {
        try {
            const project = await Project.findById(projectId);
            if (!project) {
                throw new Error('Project not found');
            }

            // Get requester history
            const requesterHistory = await this.getRequesterHistory(requesterId, projectId);

            const approvalRequest = await ApprovalRequest.create({
                requesterId,
                projectId,
                type: 'api_call',
                details,
                metadata: {
                    currentProjectSpending: project.spending.current,
                    budgetRemaining: project.budget.amount - project.spending.current,
                    requesterHistory
                }
            });

            // Notify project owner
            await Alert.create({
                userId: project.ownerId,
                title: 'Approval Request',
                message: `New approval request from user for ${details.operation}`,
                type: 'approval_required',
                severity: details.urgency || 'medium',
                actionRequired: true,
                metadata: {
                    approvalRequestId: approvalRequest._id,
                    projectId,
                    estimatedCost: details.estimatedCost
                }
            });

            return approvalRequest;
        } catch (error) {
            loggingService.error('Error creating approval request:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get requester history for approval context
     */
    private static async getRequesterHistory(userId: string, projectId: string): Promise<any> {
        const [usageStats] = await Usage.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    projectId: new mongoose.Types.ObjectId(projectId)
                }
            },
            {
                $group: {
                    _id: null,
                    totalRequests: { $sum: 1 },
                    totalSpending: { $sum: '$cost' }
                }
            }
        ]);

        const approvedRequests = await ApprovalRequest.countDocuments({
            requesterId: userId,
            projectId,
            status: 'approved'
        });

        return {
            totalRequests: usageStats?.totalRequests || 0,
            approvedRequests,
            totalSpending: usageStats?.totalSpending || 0
        };
    }

    /**
     * Get project analytics with unified $facet aggregation
     */
    static async getProjectAnalytics(projectId: string, period?: string): Promise<any> {
        try {
            const project = await Project.findById(projectId).lean();
            if (!project) {
                throw new Error('Project not found');
            }

            const startDate = this.getStartDateForPeriod(period || project.budget.period);
            const projectObjectId = this.getMemoizedObjectId(projectId);

            // Unified analytics query using $facet for all data in one call
            const [analyticsResult] = await Usage.aggregate([
                {
                    $match: {
                        projectId: projectObjectId,
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $facet: {
                        // Summary statistics
                        summary: [
                            {
                                $group: {
                                    _id: null,
                                    totalCost: { $sum: '$cost' },
                                    totalCalls: { $sum: 1 },
                                    totalTokens: { $sum: '$totalTokens' },
                                    avgCost: { $avg: '$cost' }
                                }
                            }
                        ],
                        // Daily spending trend
                        dailyTrend: [
                            {
                                $group: {
                                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                                    amount: { $sum: '$cost' },
                                    calls: { $sum: 1 }
                                }
                            },
                            { $sort: { _id: 1 } }
                        ],
                        // Service breakdown
                        serviceBreakdown: [
                            {
                                $group: {
                                    _id: '$service',
                                    cost: { $sum: '$cost' },
                                    calls: { $sum: 1 }
                                }
                            },
                            { $sort: { cost: -1 } },
                            { $limit: 10 }
                        ],
                        // Model breakdown
                        modelBreakdown: [
                            {
                                $group: {
                                    _id: '$model',
                                    cost: { $sum: '$cost' },
                                    calls: { $sum: 1 }
                                }
                            },
                            { $sort: { cost: -1 } },
                            { $limit: 10 }
                        ],
                        // User breakdown
                        userBreakdown: [
                            {
                                $group: {
                                    _id: '$userId',
                                    cost: { $sum: '$cost' },
                                    calls: { $sum: 1 }
                                }
                            },
                            { $sort: { cost: -1 } },
                            { $limit: 10 }
                        ]
                    }
                }
            ]);

            // Process results
            const summary = analyticsResult.summary[0] || {
                totalCost: 0,
                totalCalls: 0,
                totalTokens: 0,
                avgCost: 0
            };

            const spendingByService = analyticsResult.serviceBreakdown.map((item: any) => ({
                name: item._id,
                cost: item.cost,
                calls: item.calls
            }));

            const spendingByModel = analyticsResult.modelBreakdown.map((item: any) => ({
                name: item._id,
                cost: item.cost,
                calls: item.calls
            }));

            const spendingByUser = analyticsResult.userBreakdown.map((item: any) => ({
                name: item._id,
                cost: item.cost,
                calls: item.calls
            }));

            return {
                project: {
                    id: project._id,
                    name: project.name,
                    budget: project.budget,
                    spending: project.spending,
                    usagePercentage: project.budget.amount > 0 ?
                        (project.spending.current / project.budget.amount) * 100 : 0
                },
                period: {
                    start: startDate,
                    end: new Date()
                },
                summary: {
                    totalCost: summary.totalCost,
                    totalCalls: summary.totalCalls,
                    totalTokens: summary.totalTokens,
                    avgCostPerCall: summary.avgCost,
                    remainingBudget: Math.max(0, project.budget.amount - project.spending.current),
                    daysRemaining: this.getDaysRemaining(project.budget)
                },
                breakdown: {
                    byService: spendingByService,
                    byModel: spendingByModel,
                    byUser: spendingByUser
                },
                trends: {
                    daily: analyticsResult.dailyTrend,
                    projectedMonthlySpend: this.projectMonthlySpend(analyticsResult.dailyTrend)
                }
            };
        } catch (error) {
            loggingService.error('Error getting project analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Helper method to get start date for period
     */
    private static getStartDateForPeriod(period: string): Date {
        const now = new Date();
        switch (period) {
            case 'monthly':
                return new Date(now.getFullYear(), now.getMonth(), 1);
            case 'quarterly':
                const quarter = Math.floor(now.getMonth() / 3);
                return new Date(now.getFullYear(), quarter * 3, 1);
            case 'yearly':
                return new Date(now.getFullYear(), 0, 1);
            default:
                return new Date(now.getFullYear(), now.getMonth(), 1);
        }
    }

    /**
     * Helper method to aggregate spending data
     */
    private static aggregateSpending(data: any[], key: string): any[] {
        const aggregated = data.reduce((acc, item) => {
            const keyValue = item[key];
            if (!acc[keyValue]) {
                acc[keyValue] = 0;
            }
            acc[keyValue] += item.cost;
            return acc;
        }, {});

        return Object.entries(aggregated)
            .map(([name, cost]) => ({ name, cost }))
            .sort((a, b) => (b.cost as number) - (a.cost as number))
            .slice(0, 10); // Top 10
    }

    /**
     * Helper method to calculate days remaining in budget period
     */
    private static getDaysRemaining(budget: IProject['budget']): number {
        const now = new Date();
        let endDate: Date;

        switch (budget.period) {
            case 'monthly':
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'quarterly':
                const quarter = Math.floor(now.getMonth() / 3);
                endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
                break;
            case 'yearly':
                endDate = new Date(now.getFullYear(), 11, 31);
                break;
            default:
                endDate = budget.endDate || now;
        }

        return Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }

    /**
     * Helper method to project monthly spend
     */
    private static projectMonthlySpend(dailySpending: any[]): number {
        if (dailySpending.length === 0) return 0;

        const totalSpend = dailySpending.reduce((sum, day) => sum + day.amount, 0);
        const avgDailySpend = totalSpend / dailySpending.length;
        return avgDailySpend * 30;
    }

    /**
     * Get user projects with usage statistics
     * Access is now determined by workspace membership
     */
    static async getUserProjects(userId: string): Promise<IProject[]> {
        // Get user's workspace
        const user = await User.findById(userId).select('workspaceId');
        if (!user || !user.workspaceId) {
            return []; // User not in a workspace yet
        }

        // Get all projects in the user's workspace
        const projects = await Project.find({
            workspaceId: user.workspaceId,
            isActive: true
        })
        .populate('ownerId', 'name email')
        .sort({ createdAt: -1 });

        // Optimized: Single aggregation query for all projects' usage statistics
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const projectIds = projects.map(p => p._id);
        const allUsageStats = await Usage.aggregate([
            {
                $match: {
                    projectId: { $in: projectIds },
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: '$projectId',
                    totalCost: { $sum: '$cost' },
                    totalRequests: { $sum: 1 },
                    totalTokens: { $sum: '$totalTokens' }
                }
            }
        ]);

        // Create usage stats lookup map
        const usageStatsMap = new Map(
            allUsageStats.map(stat => [
                stat._id.toString(),
                {
                    totalCost: stat.totalCost,
                    totalRequests: stat.totalRequests,
                    totalTokens: stat.totalTokens
                }
            ])
        );

        // Enhance projects with usage statistics
        const enhancedProjects = projects.map(project => {
            const projectObj = project.toObject() as any;
            const projectIdStr = project._id.toString();
            
            projectObj.usage = usageStatsMap.get(projectIdStr) || {
                totalCost: 0,
                totalRequests: 0,
                totalTokens: 0
            };

            return projectObj;
        });

        return enhancedProjects;
    }

    /**
     * Update project
     */
    static async updateProject(
        projectId: string,
        updates: Partial<IProject>,
        userId: string
    ): Promise<IProject> {
        const project = await Project.findById(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        // Check permissions using PermissionService
        const { PermissionService } = await import('./permission.service');
        const canManage = await PermissionService.hasPermission(userId, project.workspaceId.toString(), 'canManageProjects');
        
        const ownerIdString = typeof project.ownerId === 'object' && project.ownerId._id
            ? project.ownerId._id.toString()
            : project.ownerId.toString();
        
        if (ownerIdString !== userId && !canManage) {
            throw new Error('Unauthorized to update project');
        }

        // Update fields
        Object.assign(project, updates);
        await project.save();

        // Track activity
        await ActivityService.trackActivity(userId, {
            type: 'settings_updated',
            title: 'Updated Project',
            description: `Updated project "${project.name}"`,
            metadata: {
                projectId: project._id,
                updates: Object.keys(updates)
            }
        });

        return project;
    }

    /**
     * Get cost allocation breakdown
     */
    static async getCostAllocation(
        projectId: string,
        options: {
            groupBy?: string;
            startDate?: Date;
            endDate?: Date;
        }
    ): Promise<any> {
        const match: any = {
            projectId: new mongoose.Types.ObjectId(projectId)
        };

        if (options.startDate || options.endDate) {
            match.createdAt = {};
            if (options.startDate) match.createdAt.$gte = options.startDate;
            if (options.endDate) match.createdAt.$lte = options.endDate;
        }

        const groupBy = options.groupBy || 'department';
        const groupField = `costAllocation.${groupBy}`;

        const allocation = await Usage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: `$${groupField}`,
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    count: { $sum: 1 },
                    services: {
                        $push: {
                            service: '$service',
                            cost: '$cost'
                        }
                    }
                }
            },
            {
                $project: {
                    name: '$_id',
                    totalCost: 1,
                    totalTokens: 1,
                    count: 1,
                    topServices: {
                        $slice: [
                            {
                                $sortArray: {
                                    input: '$services',
                                    sortBy: { cost: -1 }
                                }
                            },
                            5
                        ]
                    }
                }
            },
            { $sort: { totalCost: -1 } }
        ]);

        return {
            groupBy,
            period: {
                start: options.startDate,
                end: options.endDate
            },
            allocation,
            total: allocation.reduce((sum, item) => sum + item.totalCost, 0)
        };
    }

    /**
     * Export project data
     */
    static async exportProjectData(
        projectId: string,
        options: {
            format?: 'csv' | 'json' | 'excel';
            startDate?: Date;
            endDate?: Date;
        }
    ): Promise<any> {
        const project = await Project.findById(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        const match: any = {
            projectId: new mongoose.Types.ObjectId(projectId)
        };

        if (options.startDate || options.endDate) {
            match.createdAt = {};
            if (options.startDate) match.createdAt.$gte = options.startDate;
            if (options.endDate) match.createdAt.$lte = options.endDate;
        }

        const usageData = await Usage.find(match)
            .populate('userId', 'name email')
            .sort({ createdAt: -1 });

        if (options.format === 'json') {
            return {
                project: {
                    id: project._id,
                    name: project.name,
                    budget: project.budget,
                    spending: project.spending
                },
                usage: usageData
            };
        }

        // For CSV format
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
                'Tags'
            ];

            const rows = usageData.map(u => [
                u.createdAt.toISOString(),
                (u.userId as any).name || (u.userId as any).email,
                u.service,
                u.model,
                u.totalTokens,
                u.cost.toFixed(4),
                u.costAllocation?.department || '',
                u.costAllocation?.team || '',
                u.costAllocation?.client || '',
                u.tags.join(', ')
            ]);

            return [headers, ...rows]
                .map(row => row.join(','))
                .join('\n');
        }

        // Excel format would require additional libraries
        throw new Error('Excel export not yet implemented');
    }

    /**
     * Get project by ID with access control
     * Access is now determined by workspace membership
     */
    static async getProjectById(projectId: string, userId: string): Promise<IProject> {
        const project = await Project.findById(projectId)
            .populate('ownerId', 'name email');

        if (!project || !project.isActive) {
            throw new Error('Project not found');
        }

        // Check if user has access through workspace membership
        const { PermissionService } = await import('./permission.service');
        const canAccess = await PermissionService.canAccessProject(userId, projectId);

        if (!canAccess) {
            throw new Error('Access denied');
        }

        // Recalculate spending from Usage data to ensure accuracy
        await this.recalculateProjectSpending(projectId);

        // Return the updated project
        const updatedProject = await Project.findById(projectId)
            .populate('ownerId', 'name email');

        if (!updatedProject) {
            throw new Error('Project not found after recalculation');
        }

        return updatedProject;
    }

    /**
     * Delete a project
     */
    static async deleteProject(projectId: string, userId: string): Promise<void> {
        const project = await Project.findById(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        // Only owner can delete project
        const ownerIdString = typeof project.ownerId === 'object' && project.ownerId._id
            ? project.ownerId._id.toString()
            : project.ownerId.toString();
        if (ownerIdString !== userId) {
            throw new Error('Access denied');
        }

        // Soft delete
        project.isActive = false;
        await project.save();

        // Track activity
        await ActivityService.trackActivity(userId, {
            type: 'settings_updated',
            title: 'Deleted Project',
            description: `Deleted project "${project.name}"`,
            metadata: {
                projectId: project._id
            }
        });
    }

    /**
     * Queue background operation
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    /**
     * Start background processor
     */
    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', { 
                            error: error instanceof Error ? error.message : String(error) 
                        });
                    }
                }
            }
        }, 2000); // Process queue every 2 seconds
    }

    /**
     * Get memoized ObjectId
     */
    private static getMemoizedObjectId(id: string): mongoose.Types.ObjectId {
        if (!this.objectIdCache.has(id)) {
            this.objectIdCache.set(id, new mongoose.Types.ObjectId(id));
        }
        return this.objectIdCache.get(id)!;
    }

    /**
     * Get cached date for period
     */
    private static getCachedDateForPeriod(period: string): Date {
        const cacheKey = `${period}_${new Date().toDateString()}`;
        if (!this.dateRangeCache.has(cacheKey)) {
            this.dateRangeCache.set(cacheKey, this.getStartDateForPeriod(period));
        }
        return this.dateRangeCache.get(cacheKey)!;
    }

    /**
     * Stream large project data processing
     */
    private static async streamProjectData(
        projectIds: mongoose.Types.ObjectId[],
        batchSize: number = 50
    ): Promise<Map<string, any>> {
        const resultMap = new Map<string, any>();
        
        for (let i = 0; i < projectIds.length; i += batchSize) {
            const batch = projectIds.slice(i, i + batchSize);
            
            const batchResults = await Usage.aggregate([
                {
                    $match: {
                        projectId: { $in: batch },
                        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: '$projectId',
                        totalCost: { $sum: '$cost' },
                        totalRequests: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' }
                    }
                }
            ]);

            batchResults.forEach(result => {
                resultMap.set(result._id.toString(), {
                    totalCost: result.totalCost,
                    totalRequests: result.totalRequests,
                    totalTokens: result.totalTokens
                });
            });
        }

        return resultMap;
    }

    /**
     * Smart fallback for failed operations
     */
    private static async executeWithFallback<T>(
        primaryOperation: () => Promise<T>,
        fallbackOperation: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        try {
            return await primaryOperation();
        } catch (primaryError) {
            loggingService.warn(`Primary ${operationName} failed, using fallback:`, {
                error: primaryError instanceof Error ? primaryError.message : String(primaryError)
            });
            
            try {
                return await fallbackOperation();
            } catch (fallbackError) {
                loggingService.error(`Both primary and fallback ${operationName} failed:`, {
                    primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
                    fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                });
                throw primaryError; // Throw original error
            }
        }
    }
} 