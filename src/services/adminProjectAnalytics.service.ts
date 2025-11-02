import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { loggingService } from './logging.service';

export interface ProjectStats {
    projectId: string;
    projectName: string;
    workspaceId?: string;
    workspaceName?: string;
    ownerId: string;
    ownerEmail?: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    averageCostPerRequest: number;
    budgetAmount: number;
    budgetUsagePercentage: number;
    isOverBudget: boolean;
    errorCount: number;
    errorRate: number;
    activeUsers: number;
    createdAt: Date;
    lastActivity: Date;
}

export interface WorkspaceStats {
    workspaceId: string;
    workspaceName: string;
    ownerId: string;
    ownerEmail?: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    projectCount: number;
    activeProjectCount: number;
    activeUsers: number;
    budgetAmount: number;
    budgetUsagePercentage: number;
    isOverBudget: boolean;
    createdAt: Date;
}

export interface ProjectTrend {
    date: string;
    cost: number;
    tokens: number;
    requests: number;
}

export class AdminProjectAnalyticsService {
    /**
     * Get analytics for all projects
     */
    static async getProjectAnalytics(
        filters: {
            startDate?: Date;
            endDate?: Date;
            workspaceId?: string;
            isActive?: boolean;
        } = {}
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
                projectMatch.workspaceId = new mongoose.Types.ObjectId(filters.workspaceId);
            }
            if (filters.isActive !== undefined) {
                projectMatch.isActive = filters.isActive;
            }

            const projects = await Project.find(projectMatch).lean();
            const projectStats: ProjectStats[] = [];

            for (const project of projects) {
                const projectId = project._id.toString();
                
                // Get usage stats for this project
                const usageStats = await Usage.aggregate([
                    { $match: { ...matchStage, projectId: new mongoose.Types.ObjectId(projectId) } },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            totalRequests: { $sum: 1 },
                            errorCount: { $sum: { $cond: ['$errorOccurred', 1, 0] } },
                            lastActivity: { $max: '$createdAt' },
                            userIds: { $addToSet: '$userId' }
                        }
                    }
                ]);

                const stats = usageStats[0] || {
                    totalCost: 0,
                    totalTokens: 0,
                    totalRequests: 0,
                    errorCount: 0,
                    lastActivity: project.createdAt,
                    userIds: []
                };

                // Get workspace info
                const workspace = await Workspace.findById(project.workspaceId).lean();
                const owner = await User.findById(project.ownerId).lean();

                const budgetAmount = project.budget?.amount || 0;
                const budgetUsagePercentage = budgetAmount > 0 
                    ? (stats.totalCost / budgetAmount) * 100 
                    : 0;

                // Handle potentially undefined fields
                if (!project.ownerId) {
                    loggingService.warn('Project missing ownerId', { projectId, projectName: project.name });
                }

                projectStats.push({
                    projectId,
                    projectName: project.name,
                    workspaceId: project.workspaceId ? project.workspaceId.toString() : undefined,
                    workspaceName: workspace?.name,
                    ownerId: project.ownerId ? project.ownerId.toString() : projectId, // Fallback to projectId if ownerId is missing
                    ownerEmail: owner?.email,
                    totalCost: stats.totalCost || 0,
                    totalTokens: stats.totalTokens || 0,
                    totalRequests: stats.totalRequests || 0,
                    averageCostPerRequest: stats.totalRequests > 0 
                        ? (stats.totalCost || 0) / stats.totalRequests 
                        : 0,
                    budgetAmount,
                    budgetUsagePercentage: Math.round(budgetUsagePercentage * 100) / 100,
                    isOverBudget: budgetUsagePercentage > 100,
                    errorCount: stats.errorCount || 0,
                    errorRate: stats.totalRequests > 0 
                        ? ((stats.errorCount || 0) / stats.totalRequests) * 100 
                        : 0,
                    activeUsers: stats.userIds?.length || 0,
                    createdAt: project.createdAt,
                    lastActivity: stats.lastActivity || project.createdAt
                });
            }

            return projectStats.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting project analytics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminProjectAnalyticsService',
                operation: 'getProjectAnalytics'
            });
            throw error;
        }
    }

    /**
     * Get analytics for all workspaces
     */
    static async getWorkspaceAnalytics(
        filters: {
            startDate?: Date;
            endDate?: Date;
        } = {}
    ): Promise<WorkspaceStats[]> {
        try {
            const matchStage: any = {};

            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) matchStage.createdAt.$gte = filters.startDate;
                if (filters.endDate) matchStage.createdAt.$lte = filters.endDate;
            }

            const workspaces = await Workspace.find({ isActive: true }).lean();
            const workspaceStats: WorkspaceStats[] = [];

            for (const workspace of workspaces) {
                const workspaceId = workspace._id.toString();
                
                // Get all projects in this workspace
                const projects = await Project.find({ workspaceId: workspace._id }).lean();
                
                // Get usage stats for all projects in this workspace
                const projectIds = projects.map(p => p._id);
                const usageStats = await Usage.aggregate([
                    { 
                        $match: { 
                            ...matchStage, 
                            projectId: { $in: projectIds }
                        } 
                    },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            totalRequests: { $sum: 1 },
                            userIds: { $addToSet: '$userId' }
                        }
                    }
                ]);

                const stats = usageStats[0] || {
                    totalCost: 0,
                    totalTokens: 0,
                    totalRequests: 0,
                    userIds: []
                };

                // Calculate workspace budget (sum of all project budgets)
                const budgetAmount = projects.reduce((sum, p) => 
                    sum + (p.budget?.amount || 0), 0
                );
                const budgetUsagePercentage = budgetAmount > 0 
                    ? (stats.totalCost / budgetAmount) * 100 
                    : 0;

                const owner = await User.findById(workspace.ownerId).lean();

                workspaceStats.push({
                    workspaceId,
                    workspaceName: workspace.name,
                    ownerId: workspace.ownerId.toString(),
                    ownerEmail: owner?.email,
                    totalCost: stats.totalCost || 0,
                    totalTokens: stats.totalTokens || 0,
                    totalRequests: stats.totalRequests || 0,
                    projectCount: projects.length,
                    activeProjectCount: projects.filter(p => p.isActive).length,
                    activeUsers: stats.userIds?.length || 0,
                    budgetAmount,
                    budgetUsagePercentage: Math.round(budgetUsagePercentage * 100) / 100,
                    isOverBudget: budgetUsagePercentage > 100,
                    createdAt: workspace.createdAt
                });
            }

            return workspaceStats.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting workspace analytics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminProjectAnalyticsService',
                operation: 'getWorkspaceAnalytics'
            });
            throw error;
        }
    }

    /**
     * Get spending trends for a project
     */
    static async getProjectTrends(
        projectId: string,
        period: 'daily' | 'weekly' | 'monthly' = 'daily',
        startDate?: Date,
        endDate?: Date
    ): Promise<ProjectTrend[]> {
        try {
            const matchStage: any = {
                projectId: new mongoose.Types.ObjectId(projectId)
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
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    };
                    break;
                case 'weekly':
                    dateFormat = {
                        $dateToString: { format: '%Y-W%V', date: '$createdAt' }
                    };
                    break;
                case 'monthly':
                    dateFormat = {
                        $dateToString: { format: '%Y-%m', date: '$createdAt' }
                    };
                    break;
            }

            const trends = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: dateFormat,
                        date: { $first: dateFormat },
                        cost: { $sum: '$cost' },
                        tokens: { $sum: '$totalTokens' },
                        requests: { $sum: 1 }
                    }
                },
                { $sort: { date: 1 } }
            ]);

            return trends.map((t: any) => ({
                date: t.date,
                cost: t.cost || 0,
                tokens: t.tokens || 0,
                requests: t.requests || 0
            }));
        } catch (error) {
            loggingService.error('Error getting project trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminProjectAnalyticsService',
                operation: 'getProjectTrends',
                projectId
            });
            throw error;
        }
    }
}
