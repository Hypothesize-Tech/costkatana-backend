import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Activity } from '../../schemas/logging/activity.schema';

export interface ActivityOptions {
  type: Activity['type'];
  title: string;
  description?: string;
  metadata?: Activity['metadata'];
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectModel(Activity.name) private activityModel: Model<Activity>,
  ) {}

  /**
   * Track a user activity
   */
  async trackActivity(
    userId: string,
    options: ActivityOptions,
  ): Promise<Activity | null> {
    try {
      const activity = new this.activityModel({
        userId,
        ...options,
        createdAt: new Date(),
      });

      await activity.save();

      this.logger.log(`Activity tracked: ${options.type} for user ${userId}`, {
        activityId: activity._id?.toString(),
        type: options.type,
        title: options.title,
      });

      return activity;
    } catch (error) {
      this.logger.error('Error tracking activity', {
        userId,
        type: options.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get user activities with pagination
   */
  async getUserActivities(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      type?: Activity['type'];
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<{
    activities: Activity[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    try {
      const { page = 1, limit = 20, type, startDate, endDate } = options;

      const query: any = { userId };

      if (type) {
        query.type = type;
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      const skip = (page - 1) * limit;

      const [activities, total] = await Promise.all([
        this.activityModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.activityModel.countDocuments(query).exec(),
      ]);

      return {
        activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error getting user activities', {
        userId,
        options,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get activity summary for a user
   */
  async getActivitySummary(
    userId: string,
    days: number = 30,
  ): Promise<{
    totalActivities: number;
    activitiesByType: Record<string, number>;
    recentActivities: Activity[];
    dateRange: { start: Date; end: Date };
  }> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        userId,
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      };

      // Get all activities in date range
      const activities = await this.activityModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(50)
        .exec();

      // Group by type
      const activitiesByType: Record<string, number> = {};
      activities.forEach((activity) => {
        activitiesByType[activity.type] =
          (activitiesByType[activity.type] || 0) + 1;
      });

      return {
        totalActivities: activities.length,
        activitiesByType,
        recentActivities: activities.slice(0, 10), // Return 10 most recent
        dateRange: { start: startDate, end: endDate },
      };
    } catch (error) {
      this.logger.error('Error getting activity summary', {
        userId,
        days,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Clean up old activities (keep latest 1000 per user)
   */
  async cleanupOldActivities(userId: string): Promise<number> {
    try {
      // Find activities beyond the latest 1000 for this user
      const activitiesToDelete = await this.activityModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(1000)
        .select('_id')
        .lean();

      if (activitiesToDelete.length > 0) {
        const idsToDelete = activitiesToDelete.map((activity) => activity._id);
        const result = await this.activityModel.deleteMany({
          _id: { $in: idsToDelete },
        });

        this.logger.log(`Cleaned up old activities for user`, {
          userId,
          deletedCount: result.deletedCount,
        });

        return result.deletedCount || 0;
      }

      return 0;
    } catch (error) {
      this.logger.error('Error cleaning up old activities', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
