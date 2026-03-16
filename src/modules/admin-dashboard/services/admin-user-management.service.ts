import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  Project,
  ProjectDocument,
} from '../../../schemas/team-project/project.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../../../schemas/core/subscription.schema';
import {
  UserManagementFilters,
  AdminUserSummary,
  UserDetail,
} from '../interfaces';

@Injectable()
export class AdminUserManagementService {
  private readonly logger = new Logger(AdminUserManagementService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  /**
   * Get all users with summary statistics
   */
  async getAllUsers(
    filters: UserManagementFilters = {},
  ): Promise<AdminUserSummary[]> {
    try {
      const query: any = {};

      // Build search query
      if (filters.search) {
        query.$or = [
          { email: { $regex: filters.search, $options: 'i' } },
          { name: { $regex: filters.search, $options: 'i' } },
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
        const plan = filters.subscriptionPlan as string;
        if (plan === 'free') {
          const freeSubIds = await this.subscriptionModel.distinct('_id', {
            plan: 'free',
          });
          query.$and = query.$and || [];
          query.$and.push({
            $or: [
              { subscriptionId: { $exists: false } },
              { subscriptionId: null },
              { subscriptionId: { $in: freeSubIds } },
            ],
          });
        } else {
          const subscriptionIds = await this.subscriptionModel
            .find({ plan })
            .select('_id')
            .lean();
          query.subscriptionId = {
            $in: subscriptionIds.map((s: any) => s._id),
          };
        }
      }

      // Get users
      const users = await this.userModel
        .find(query)
        .select(
          '_id email name avatar role isActive emailVerified subscriptionId createdAt lastLogin',
        )
        .lean()
        .limit(filters.limit || 100)
        .skip(filters.offset || 0)
        .sort(this.buildSortQuery(filters));

      // Get usage stats for each user
      const userIds = users.map((u) => u._id);
      const usageStats = await this.usageModel.aggregate([
        {
          $match: {
            userId: { $in: userIds },
          },
        },
        {
          $group: {
            _id: '$userId',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
          },
        },
      ]);

      const projectCounts = await this.projectModel.aggregate([
        {
          $match: {
            ownerId: { $in: userIds },
          },
        },
        {
          $group: {
            _id: '$ownerId',
            count: { $sum: 1 },
          },
        },
      ]);

      const usageMap = new Map(
        usageStats.map((s: any) => [s._id.toString(), s]),
      );
      const projectMap = new Map(
        projectCounts.map((p: any) => [p._id.toString(), p.count]),
      );

      // Get workspace counts
      const workspaceCounts = await this.userModel.aggregate([
        {
          $match: { _id: { $in: userIds } },
        },
        {
          $project: {
            userId: '$_id',
            workspaceCount: { $size: '$workspaceMemberships' },
          },
        },
      ]);

      const workspaceMap = new Map(
        workspaceCounts.map((w: any) => [
          w.userId.toString(),
          w.workspaceCount,
        ]),
      );

      // Get subscription plans for all users
      const subscriptionIds = users
        .map((u: any) => u.subscriptionId)
        .filter(Boolean);
      const subscriptions =
        subscriptionIds.length > 0
          ? await this.subscriptionModel
              .find({ _id: { $in: subscriptionIds } })
              .select('_id plan')
              .lean()
          : [];
      const subscriptionMap = new Map(
        subscriptions.map((s: any) => [s._id.toString(), s.plan]),
      );

      return users.map((user: any) => {
        const usage = usageMap.get(user._id.toString()) || {
          totalCost: 0,
          totalTokens: 0,
          totalRequests: 0,
        };

        const subscriptionIdStr = user.subscriptionId?.toString();
        const subscriptionPlan = subscriptionIdStr
          ? (subscriptionMap.get(subscriptionIdStr) as
              | 'free'
              | 'pro'
              | 'enterprise'
              | 'plus') || 'free'
          : 'free';

        return {
          userId: user._id.toString(),
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          role: user.role,
          isActive: user.isActive !== false,
          emailVerified: user.emailVerified || false,
          subscriptionPlan,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          totalCost: usage.totalCost || 0,
          totalTokens: usage.totalTokens || 0,
          totalRequests: usage.totalRequests || 0,
          projectCount: projectMap.get(user._id.toString()) || 0,
          workspaceCount: workspaceMap.get(user._id.toString()) || 0,
        };
      });
    } catch (error) {
      this.logger.error('Error getting all users:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get user detail by ID
   */
  async getUserDetail(userId: string): Promise<UserDetail | null> {
    try {
      const user = await this.userModel
        .findById(userId)
        .populate('subscriptionId')
        .lean();
      if (!user) return null;

      // Get usage stats
      const usageStats = await this.usageModel.aggregate([
        {
          $match: { userId: new mongoose.Types.ObjectId(userId) },
        },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
          },
        },
      ]);

      const stats = usageStats[0] || {
        totalCost: 0,
        totalTokens: 0,
        totalRequests: 0,
      };

      // Get projects
      const projects = await this.projectModel
        .find({ ownerId: new mongoose.Types.ObjectId(userId) })
        .select('_id name')
        .lean();

      // Get workspace memberships with workspace names
      const workspaceIds =
        (user as any).workspaceMemberships?.map((wm: any) => wm.workspaceId) ||
        [];
      let workspaces: any[] = [];
      if (workspaceIds.length > 0) {
        const WorkspaceModel =
          this.userModel.db.model('Workspace') ||
          this.userModel.db.models.Workspace;
        if (WorkspaceModel) {
          workspaces = await WorkspaceModel.find({ _id: { $in: workspaceIds } })
            .select('_id name')
            .lean();
        }
      }

      const workspaceMap = new Map(
        workspaces.map((w: any) => [w._id.toString(), w.name]),
      );

      const workspaceMemberships = (
        (user as any).workspaceMemberships || []
      ).map((wm: any) => ({
        workspaceId: wm.workspaceId.toString(),
        workspaceName: workspaceMap.get(wm.workspaceId.toString()),
        role: wm.role,
        joinedAt: wm.joinedAt,
      }));

      // Get subscription plan
      let subscriptionPlan: 'free' | 'pro' | 'enterprise' | 'plus' = 'free';
      if ((user as any).subscriptionId) {
        const subscription = await this.subscriptionModel
          .findById((user as any).subscriptionId)
          .select('plan')
          .lean();
        if (subscription) {
          subscriptionPlan = (subscription as any).plan || 'free';
        }
      }

      return {
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        isActive: user.isActive !== false,
        emailVerified: user.emailVerified || false,
        subscriptionPlan,
        workspaceId: (user as any).workspaceId?.toString(),
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
          projectName: p.name,
        })),
        apiKeyCount: (user as any).apiKeys?.length || 0,
        dashboardApiKeyCount: (user as any).dashboardApiKeys?.length || 0,
        preferences: {
          emailAlerts: (user as any).preferences?.emailAlerts || false,
          alertThreshold: (user as any).preferences?.alertThreshold || 0,
          optimizationSuggestions:
            (user as any).preferences?.optimizationSuggestions || false,
        },
      };
    } catch (error) {
      this.logger.error('Error getting user detail:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Update user status (activate/suspend)
   */
  async updateUserStatus(userId: string, isActive: boolean): Promise<boolean> {
    try {
      const result = await this.userModel.findByIdAndUpdate(
        userId,
        { isActive },
        { new: true },
      );

      if (result) {
        this.logger.log(`User status updated: ${userId}, active: ${isActive}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Error updating user status:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Update user role
   */
  async updateUserRole(
    userId: string,
    role: 'user' | 'admin',
  ): Promise<boolean> {
    try {
      const result = await this.userModel.findByIdAndUpdate(
        userId,
        { role },
        { new: true },
      );

      if (result) {
        this.logger.log(`User role updated: ${userId}, role: ${role}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Error updating user role:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Delete user (soft delete by setting isActive to false)
   */
  async deleteUser(userId: string): Promise<boolean> {
    try {
      // Soft delete - set isActive to false instead of actually deleting
      const result = await this.userModel.findByIdAndUpdate(
        userId,
        { isActive: false },
        { new: true },
      );

      if (result) {
        this.logger.log(`User deleted (soft delete): ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Error deleting user:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Build sort query from filters
   */
  private buildSortQuery(filters: UserManagementFilters): any {
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
  async getUserStats(): Promise<{
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
        plusPlan,
      ] = await Promise.all([
        this.userModel.countDocuments(),
        this.userModel.countDocuments({ isActive: true }),
        this.userModel.countDocuments({ isActive: false }),
        this.userModel.countDocuments({ role: 'admin' }),
        this.userModel.countDocuments({ emailVerified: true }),
        this.userModel.countDocuments({ emailVerified: false }),
        this.subscriptionModel.countDocuments({ plan: 'free' }),
        this.subscriptionModel.countDocuments({ plan: 'pro' }),
        this.subscriptionModel.countDocuments({ plan: 'enterprise' }),
        this.subscriptionModel.countDocuments({ plan: 'plus' }),
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
          plus: plusPlan,
        },
      };
    } catch (error) {
      this.logger.error('Error getting user stats:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
