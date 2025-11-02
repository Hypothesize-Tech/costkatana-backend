import mongoose from 'mongoose';
import { User } from '../models/User';
import { Usage } from '../models/Usage';
import { Project } from '../models/Project';
import { loggingService } from './logging.service';

export interface UserManagementFilters {
    search?: string;
    role?: 'user' | 'admin';
    isActive?: boolean;
    emailVerified?: boolean;
    subscriptionPlan?: 'free' | 'pro' | 'enterprise' | 'plus';
    sortBy?: 'name' | 'email' | 'createdAt' | 'lastLogin' | 'totalCost';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
}

export interface AdminUserSummary {
    userId: string;
    email: string;
    name: string;
    avatar?: string;
    role: 'user' | 'admin';
    isActive: boolean;
    emailVerified: boolean;
    subscriptionPlan: 'free' | 'pro' | 'enterprise' | 'plus';
    createdAt: Date;
    lastLogin?: Date;
    totalCost: number;
    totalTokens: number;
    totalRequests: number;
    projectCount: number;
    workspaceCount: number;
}

export interface UserDetail extends AdminUserSummary {
    workspaceId?: string;
    workspaceMemberships: Array<{
        workspaceId: string;
        workspaceName?: string;
        role: 'owner' | 'admin' | 'developer' | 'viewer';
        joinedAt: Date;
    }>;
    projects: Array<{
        projectId: string;
        projectName: string;
        role?: string;
    }>;
    apiKeyCount: number;
    dashboardApiKeyCount: number;
    preferences: {
        emailAlerts: boolean;
        alertThreshold: number;
        optimizationSuggestions: boolean;
    };
}

export class AdminUserManagementService {
    /**
     * Get all users with summary statistics
     */
    static async getAllUsers(filters: UserManagementFilters = {}): Promise<AdminUserSummary[]> {
        try {
            const query: any = {};

            // Build search query
            if (filters.search) {
                query.$or = [
                    { email: { $regex: filters.search, $options: 'i' } },
                    { name: { $regex: filters.search, $options: 'i' } }
                ];
            }

            if (filters.role) {
                query.role = filters.role;
            }

            if (filters.isActive !== undefined) {
                query.isActive = filters.isActive;
            }

            if (filters.emailVerified !== undefined) {
                query.emailVerified = filters.emailVerified;
            }

            if (filters.subscriptionPlan) {
                query['subscription.plan'] = filters.subscriptionPlan;
            }

            // Get users
            const users = await User.find(query)
                .select('_id email name avatar role isActive emailVerified subscription createdAt lastLogin')
                .lean()
                .limit(filters.limit || 100)
                .skip(filters.offset || 0)
                .sort(this.buildSortQuery(filters));

            // Get usage stats for each user
            const userIds = users.map(u => u._id);
            const usageStats = await Usage.aggregate([
                {
                    $match: {
                        userId: { $in: userIds }
                    }
                },
                {
                    $group: {
                        _id: '$userId',
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 }
                    }
                }
            ]);

            const projectCounts = await Project.aggregate([
                {
                    $match: {
                        ownerId: { $in: userIds }
                    }
                },
                {
                    $group: {
                        _id: '$ownerId',
                        count: { $sum: 1 }
                    }
                }
            ]);

            const usageMap = new Map(
                usageStats.map((s: any) => [s._id.toString(), s])
            );
            const projectMap = new Map(
                projectCounts.map((p: any) => [p._id.toString(), p.count])
            );

            // Get workspace counts
            const workspaceCounts = await User.aggregate([
                {
                    $match: { _id: { $in: userIds } }
                },
                {
                    $project: {
                        userId: '$_id',
                        workspaceCount: { $size: '$workspaceMemberships' }
                    }
                }
            ]);

            const workspaceMap = new Map(
                workspaceCounts.map((w: any) => [w.userId.toString(), w.workspaceCount])
            );

            return users.map((user: any) => {
                const usage = usageMap.get(user._id.toString()) || {
                    totalCost: 0,
                    totalTokens: 0,
                    totalRequests: 0
                };

                return {
                    userId: user._id.toString(),
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                    role: user.role,
                    isActive: user.isActive !== false,
                    emailVerified: user.emailVerified || false,
                    subscriptionPlan: (user.subscription?.plan as 'free' | 'pro' | 'enterprise' | 'plus') || 'free',
                    createdAt: user.createdAt,
                    lastLogin: user.lastLogin,
                    totalCost: usage.totalCost || 0,
                    totalTokens: usage.totalTokens || 0,
                    totalRequests: usage.totalRequests || 0,
                    projectCount: projectMap.get(user._id.toString()) || 0,
                    workspaceCount: workspaceMap.get(user._id.toString()) || 0
                };
            });
        } catch (error) {
            loggingService.error('Error getting all users:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get user detail by ID
     */
    static async getUserDetail(userId: string): Promise<UserDetail | null> {
        try {
            const user = await User.findById(userId).lean();
            if (!user) return null;

            // Get usage stats
            const usageStats = await Usage.aggregate([
                {
                    $match: { userId: new mongoose.Types.ObjectId(userId) }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalRequests: { $sum: 1 }
                    }
                }
            ]);

            const stats = usageStats[0] || {
                totalCost: 0,
                totalTokens: 0,
                totalRequests: 0
            };

            // Get projects
            const projects = await Project.find({ ownerId: new mongoose.Types.ObjectId(userId) })
                .select('_id name')
                .lean();

            // Get workspace memberships with workspace names
            const workspaceIds = user.workspaceMemberships?.map((wm: any) => wm.workspaceId) || [];
            let workspaces: any[] = [];
            if (workspaceIds.length > 0) {
                const Workspace = mongoose.models.Workspace || mongoose.model('Workspace', new mongoose.Schema({}, { strict: false }));
                workspaces = await Workspace.find({ _id: { $in: workspaceIds } })
                    .select('_id name')
                    .lean();
            }

            const workspaceMap = new Map(
                workspaces.map((w: any) => [w._id.toString(), w.name])
            );

            const workspaceMemberships = (user.workspaceMemberships || []).map((wm: any) => ({
                workspaceId: wm.workspaceId.toString(),
                workspaceName: workspaceMap.get(wm.workspaceId.toString()),
                role: wm.role,
                joinedAt: wm.joinedAt
            }));

            return {
                userId: user._id.toString(),
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                role: user.role,
                isActive: user.isActive !== false,
                emailVerified: user.emailVerified || false,
                subscriptionPlan: (user.subscription?.plan as 'free' | 'pro' | 'enterprise' | 'plus') || 'free',
                workspaceId: user.workspaceId?.toString(),
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
                totalCost: stats.totalCost || 0,
                totalTokens: stats.totalTokens || 0,
                totalRequests: stats.totalRequests || 0,
                projectCount: projects.length,
                workspaceCount: workspaceMemberships.length,
                workspaceMemberships,
                projects: projects.map((p: any) => ({
                    projectId: p._id.toString(),
                    projectName: p.name
                })),
                apiKeyCount: user.apiKeys?.length || 0,
                dashboardApiKeyCount: user.dashboardApiKeys?.length || 0,
                preferences: {
                    emailAlerts: user.preferences?.emailAlerts || false,
                    alertThreshold: user.preferences?.alertThreshold || 0,
                    optimizationSuggestions: user.preferences?.optimizationSuggestions || false
                }
            };
        } catch (error) {
            loggingService.error('Error getting user detail:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Update user status (activate/suspend)
     */
    static async updateUserStatus(userId: string, isActive: boolean): Promise<boolean> {
        try {
            const result = await User.findByIdAndUpdate(
                userId,
                { isActive },
                { new: true }
            );

            if (result) {
                loggingService.info('User status updated', {
                    userId,
                    isActive
                });
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error updating user status:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Update user role
     */
    static async updateUserRole(userId: string, role: 'user' | 'admin'): Promise<boolean> {
        try {
            const result = await User.findByIdAndUpdate(
                userId,
                { role },
                { new: true }
            );

            if (result) {
                loggingService.info('User role updated', {
                    userId,
                    role
                });
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error updating user role:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Delete user (soft delete by setting isActive to false)
     */
    static async deleteUser(userId: string): Promise<boolean> {
        try {
            // Soft delete - set isActive to false instead of actually deleting
            const result = await User.findByIdAndUpdate(
                userId,
                { isActive: false },
                { new: true }
            );

            if (result) {
                loggingService.info('User deleted (soft delete)', {
                    userId
                });
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error deleting user:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }

    /**
     * Build sort query from filters
     */
    private static buildSortQuery(filters: UserManagementFilters): any {
        const sortBy = filters.sortBy || 'createdAt';
        const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;

        if (sortBy === 'totalCost') {
            // For totalCost, we'll need to sort in memory after aggregation
            return { createdAt: -1 };
        }

        return { [sortBy]: sortOrder };
    }

    /**
     * Get user count statistics
     */
    static async getUserStats(): Promise<{
        totalUsers: number;
        activeUsers: number;
        inactiveUsers: number;
        adminUsers: number;
        verifiedUsers: number;
        unverifiedUsers: number;
        byPlan: {
            free: number;
            pro: number;
            enterprise: number;
            plus: number;
        };
    }> {
        try {
            const [
                totalUsers,
                activeUsers,
                inactiveUsers,
                adminUsers,
                verifiedUsers,
                unverifiedUsers,
                freePlan,
                proPlan,
                enterprisePlan,
                plusPlan
            ] = await Promise.all([
                User.countDocuments(),
                User.countDocuments({ isActive: true }),
                User.countDocuments({ isActive: false }),
                User.countDocuments({ role: 'admin' }),
                User.countDocuments({ emailVerified: true }),
                User.countDocuments({ emailVerified: false }),
                User.countDocuments({ 'subscription.plan': 'free' }),
                User.countDocuments({ 'subscription.plan': 'pro' }),
                User.countDocuments({ 'subscription.plan': 'enterprise' }),
                User.countDocuments({ 'subscription.plan': 'plus' })
            ]);

            return {
                totalUsers,
                activeUsers,
                inactiveUsers,
                adminUsers,
                verifiedUsers,
                unverifiedUsers,
                byPlan: {
                free: freePlan,
                pro: proPlan,
                enterprise: enterprisePlan,
                plus: plusPlan
                }
            };
        } catch (error) {
            loggingService.error('Error getting user stats:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

