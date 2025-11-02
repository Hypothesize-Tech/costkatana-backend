import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { loggingService } from './logging.service';

export interface UserSpendingSummary {
    userId: string;
    userEmail: string;
    userName: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    averageCostPerRequest: number;
    firstActivity: Date;
    lastActivity: Date;
    services: Array<{
        service: string;
        cost: number;
        tokens: number;
        requests: number;
    }>;
    models: Array<{
        model: string;
        cost: number;
        tokens: number;
        requests: number;
    }>;
    projects: Array<{
        projectId: string;
        projectName?: string;
        cost: number;
        tokens: number;
        requests: number;
    }>;
    workflows: Array<{
        workflowId: string;
        workflowName?: string;
        cost: number;
        tokens: number;
        requests: number;
    }>;
    features: Array<{
        feature: string;
        cost: number;
        tokens: number;
        requests: number;
    }>;
}

export interface SpendingTrends {
    date: string;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    userCount: number;
}

export interface AdminUserAnalyticsFilters {
    startDate?: Date;
    endDate?: Date;
    service?: string;
    model?: string;
    projectId?: string;
    workflowId?: string;
    userId?: string;
    minCost?: number;
    maxCost?: number;
}

export class AdminUserAnalyticsService {
    /**
     * Get spending summary for all users
     */
    static async getAllUsersSpending(filters: AdminUserAnalyticsFilters = {}): Promise<UserSpendingSummary[]> {
        try {
            const matchStage: any = {};

            // Apply date filters
            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) {
                    matchStage.createdAt.$gte = filters.startDate;
                }
                if (filters.endDate) {
                    matchStage.createdAt.$lte = filters.endDate;
                }
            }

            // Apply service filter
            if (filters.service) {
                matchStage.service = filters.service;
            }

            // Apply model filter
            if (filters.model) {
                matchStage.model = filters.model;
            }

            // Apply project filter
            if (filters.projectId) {
                matchStage.projectId = new mongoose.Types.ObjectId(filters.projectId);
            }

            // Apply workflow filter
            if (filters.workflowId) {
                matchStage.workflowId = filters.workflowId;
            }

            // Apply user filter
            if (filters.userId) {
                matchStage.userId = new mongoose.Types.ObjectId(filters.userId);
            }

            // Aggregate usage data grouped by user
            const userUsageData = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$userId',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        averageCostPerRequest: { $avg: '$cost' },
                        firstActivity: { $min: '$createdAt' },
                        lastActivity: { $max: '$createdAt' },
                        services: {
                            $push: {
                                service: '$service',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                request: 1
                            }
                        },
                        models: {
                            $push: {
                                model: '$model',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                request: 1
                            }
                        },
                        projects: {
                            $push: {
                                projectId: '$projectId',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                request: 1
                            }
                        },
                        workflows: {
                            $push: {
                                workflowId: '$workflowId',
                                workflowName: '$workflowName',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                request: 1
                            }
                        },
                        features: {
                            $push: {
                                endpoint: '$metadata.endpoint',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                request: 1
                            }
                        }
                    }
                },
                {
                    $sort: { totalCost: -1 }
                }
            ]);

            // Process service breakdown
            const processedData = userUsageData.map((userData: any) => {
                // Aggregate services
                const servicesMap = new Map<string, { cost: number; tokens: number; requests: number }>();
                userData.services.forEach((s: any) => {
                    const existing = servicesMap.get(s.service) || { cost: 0, tokens: 0, requests: 0 };
                    servicesMap.set(s.service, {
                        cost: existing.cost + (s.cost || 0),
                        tokens: existing.tokens + (s.tokens || 0),
                        requests: existing.requests + 1
                    });
                });

                // Aggregate models
                const modelsMap = new Map<string, { cost: number; tokens: number; requests: number }>();
                userData.models.forEach((m: any) => {
                    if (m.model) {
                        const existing = modelsMap.get(m.model) || { cost: 0, tokens: 0, requests: 0 };
                        modelsMap.set(m.model, {
                            cost: existing.cost + (m.cost || 0),
                            tokens: existing.tokens + (m.tokens || 0),
                            requests: existing.requests + 1
                        });
                    }
                });

                // Aggregate projects
                const projectsMap = new Map<string, { cost: number; tokens: number; requests: number }>();
                userData.projects.forEach((p: any) => {
                    if (p.projectId) {
                        const projectId = p.projectId.toString();
                        const existing = projectsMap.get(projectId) || { cost: 0, tokens: 0, requests: 0 };
                        projectsMap.set(projectId, {
                            cost: existing.cost + (p.cost || 0),
                            tokens: existing.tokens + (p.tokens || 0),
                            requests: existing.requests + 1
                        });
                    }
                });

                // Aggregate workflows
                const workflowsMap = new Map<string, { workflowName?: string; cost: number; tokens: number; requests: number }>();
                userData.workflows.forEach((w: any) => {
                    if (w.workflowId) {
                        const existing = workflowsMap.get(w.workflowId) || { cost: 0, tokens: 0, requests: 0, workflowName: w.workflowName };
                        workflowsMap.set(w.workflowId, {
                            workflowName: w.workflowName || existing.workflowName,
                            cost: existing.cost + (w.cost || 0),
                            tokens: existing.tokens + (w.tokens || 0),
                            requests: existing.requests + 1
                        });
                    }
                });

                // Aggregate features by endpoint
                const featuresMap = new Map<string, { cost: number; tokens: number; requests: number }>();
                userData.features?.forEach((f: any) => {
                    if (f.endpoint) {
                        // Extract feature name from endpoint
                        const featureName = this.getFeatureFromEndpoint(f.endpoint);
                        const existing = featuresMap.get(featureName) || { cost: 0, tokens: 0, requests: 0 };
                        featuresMap.set(featureName, {
                            cost: existing.cost + (f.cost || 0),
                            tokens: existing.tokens + (f.tokens || 0),
                            requests: existing.requests + 1
                        });
                    }
                });

                return {
                    userId: userData._id.toString(),
                    userEmail: '', // Will be populated below
                    userName: '', // Will be populated below
                    totalCost: userData.totalCost || 0,
                    totalTokens: userData.totalTokens || 0,
                    totalRequests: userData.totalRequests || 0,
                    averageCostPerRequest: userData.averageCostPerRequest || 0,
                    firstActivity: userData.firstActivity || new Date(),
                    lastActivity: userData.lastActivity || new Date(),
                    services: Array.from(servicesMap.entries()).map(([service, data]) => ({
                        service,
                        ...data
                    })),
                    models: Array.from(modelsMap.entries()).map(([model, data]) => ({
                        model,
                        ...data
                    })),
                    projects: Array.from(projectsMap.entries()).map(([projectId, data]) => ({
                        projectId,
                        projectName: undefined, // Can be enriched later if needed
                        ...data
                    })),
                    workflows: Array.from(workflowsMap.entries()).map(([workflowId, data]) => ({
                        workflowId,
                        workflowName: data.workflowName,
                        cost: data.cost,
                        tokens: data.tokens,
                        requests: data.requests
                    })),
                    features: Array.from(featuresMap.entries()).map(([feature, data]) => ({
                        feature,
                        ...data
                    }))
                };
            });

            // Get project names
            const projectIds = new Set<string>();
            processedData.forEach((data) => {
                data.projects.forEach((p: any) => {
                    if (p.projectId) {
                        projectIds.add(p.projectId);
                    }
                });
            });

            const projectIdArray = Array.from(projectIds).map(id => new mongoose.Types.ObjectId(id));
            const projects = await Project.find({ _id: { $in: projectIdArray } }, { name: 1 }).lean();
            const projectMap = new Map(projects.map((p: any) => [p._id.toString(), p.name]));

            // Populate project names
            processedData.forEach((data) => {
                data.projects = data.projects.map((p: any) => ({
                    ...p,
                    projectName: projectMap.get(p.projectId) || 'Unknown Project'
                }));
            });

            // Get user details
            const userIds = processedData.map(d => new mongoose.Types.ObjectId(d.userId));
            const users = await User.find({ _id: { $in: userIds } }, { email: 1, name: 1 }).lean();

            const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

            // Populate user email and name
            return processedData.map(data => {
                const user = userMap.get(data.userId);
                return {
                    ...data,
                    userEmail: user?.email || '',
                    userName: user?.name || 'Unknown User'
                };
            });
        } catch (error) {
            loggingService.error('Error getting all users spending:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsService',
                operation: 'getAllUsersSpending'
            });
            throw error;
        }
    }

    /**
     * Get detailed spending breakdown for a specific user
     */
    static async getUserDetailedSpending(
        userId: string,
        filters: AdminUserAnalyticsFilters = {}
    ): Promise<UserSpendingSummary | null> {
        try {
            const results = await this.getAllUsersSpending({
                ...filters,
                userId
            });

            return results[0] || null;
        } catch (error) {
            loggingService.error('Error getting user detailed spending:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsService',
                operation: 'getUserDetailedSpending',
                userId
            });
            throw error;
        }
    }

    /**
     * Get users filtered by service
     */
    static async getUsersByService(service: string, filters: AdminUserAnalyticsFilters = {}): Promise<UserSpendingSummary[]> {
        return this.getAllUsersSpending({
            ...filters,
            service
        });
    }

    /**
     * Get spending trends over time
     */
    static async getSpendingTrends(
        timeRange: 'daily' | 'weekly' | 'monthly',
        filters: AdminUserAnalyticsFilters = {}
    ): Promise<SpendingTrends[]> {
        try {
            const matchStage: any = {};

            // Apply date filters
            if (filters.startDate || filters.endDate) {
                matchStage.createdAt = {};
                if (filters.startDate) {
                    matchStage.createdAt.$gte = filters.startDate;
                }
                if (filters.endDate) {
                    matchStage.createdAt.$lte = filters.endDate;
                }
            }

            // Apply other filters
            if (filters.service) {
                matchStage.service = filters.service;
            }
            if (filters.model) {
                matchStage.model = filters.model;
            }
            if (filters.projectId) {
                matchStage.projectId = new mongoose.Types.ObjectId(filters.projectId);
            }
            if (filters.userId) {
                matchStage.userId = new mongoose.Types.ObjectId(filters.userId);
            }

            // Determine date grouping format
            let dateFormat: string;
            switch (timeRange) {
                case 'daily':
                    dateFormat = '%Y-%m-%d';
                    break;
                case 'weekly':
                    dateFormat = '%Y-%W'; // Year-Week
                    break;
                case 'monthly':
                    dateFormat = '%Y-%m';
                    break;
                default:
                    dateFormat = '%Y-%m-%d';
            }

            const trends = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: dateFormat,
                                date: '$createdAt'
                            }
                        },
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 },
                        uniqueUsers: { $addToSet: '$userId' }
                    }
                },
                {
                    $project: {
                        date: '$_id',
                        totalCost: 1,
                        totalTokens: 1,
                        totalRequests: 1,
                        userCount: { $size: '$uniqueUsers' },
                        _id: 0
                    }
                },
                {
                    $sort: { date: 1 }
                }
            ]);

            return trends.map((t: any) => ({
                date: t.date,
                totalCost: t.totalCost || 0,
                totalTokens: t.totalTokens || 0,
                totalRequests: t.totalRequests || 0,
                userCount: t.userCount || 0
            }));
        } catch (error) {
            loggingService.error('Error getting spending trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsService',
                operation: 'getSpendingTrends',
                timeRange
            });
            throw error;
        }
    }

    /**
     * Get platform-wide summary statistics
     */
    static async getPlatformSummary(filters: AdminUserAnalyticsFilters = {}): Promise<{
        totalUsers: number;
        totalCost: number;
        totalTokens: number;
        totalRequests: number;
        averageCostPerUser: number;
        topSpendingUsers: Array<{ userId: string; userEmail: string; cost: number }>;
    }> {
        try {
            const usersSpending = await this.getAllUsersSpending(filters);

            const totalCost = usersSpending.reduce((sum, user) => sum + user.totalCost, 0);
            const totalTokens = usersSpending.reduce((sum, user) => sum + user.totalTokens, 0);
            const totalRequests = usersSpending.reduce((sum, user) => sum + user.totalRequests, 0);

            return {
                totalUsers: usersSpending.length,
                totalCost,
                totalTokens,
                totalRequests,
                averageCostPerUser: usersSpending.length > 0 ? totalCost / usersSpending.length : 0,
                topSpendingUsers: usersSpending
                    .slice(0, 10)
                    .map(user => ({
                        userId: user.userId,
                        userEmail: user.userEmail,
                        cost: user.totalCost
                    }))
            };
        } catch (error) {
            loggingService.error('Error getting platform summary:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserAnalyticsService',
                operation: 'getPlatformSummary'
            });
            throw error;
        }
    }

    /**
     * Extract feature name from endpoint path
     */
    private static getFeatureFromEndpoint(endpoint: string): string {
        if (!endpoint) return 'Unknown';
        
        // Normalize endpoint
        const normalized = endpoint.toLowerCase();
        
        // Map endpoints to features
        if (normalized.includes('/chat') || normalized.includes('/agent')) {
            return 'Chat';
        }
        if (normalized.includes('/experimentation') || normalized.includes('/what-if')) {
            return 'Experimentation';
        }
        if (normalized.includes('/gateway')) {
            return 'Gateway';
        }
        if (normalized.includes('/integration')) {
            return 'Integration';
        }
        if (normalized.includes('/workflow')) {
            return 'Workflow';
        }
        if (normalized.includes('/optimization')) {
            return 'Optimization';
        }
        if (normalized.includes('/analytics')) {
            return 'Analytics';
        }
        if (normalized.includes('/notebook')) {
            return 'Notebook';
        }
        if (normalized.includes('/template')) {
            return 'Template';
        }
        if (normalized.includes('/intelligence') || normalized.includes('/predictive')) {
            return 'Intelligence';
        }
        
        return 'Other';
    }
}

