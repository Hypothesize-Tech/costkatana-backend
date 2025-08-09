import { Activity, IActivity } from '../models/Activity';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export interface ActivityOptions {
    type: IActivity['type'];
    title: string;
    description?: string;
    metadata?: IActivity['metadata'];
    ipAddress?: string;
    userAgent?: string;
}

export class ActivityService {
    /**
     * Track a user activity
     */
    static async trackActivity(userId: string, options: ActivityOptions): Promise<IActivity | null> {
        try {
            const activity = await Activity.create({
                userId: new mongoose.Types.ObjectId(userId),
                ...options
            });

            logger.info(`Activity tracked: ${options.type} for user ${userId}`);
            return activity;
        } catch (error) {
            logger.error('Error tracking activity:', error);
            return null;
        }
    }

    /**
     * Get user activities with pagination
     */
    static async getUserActivities(
        userId: string,
        options: {
            page?: number;
            limit?: number;
            type?: IActivity['type'];
            startDate?: Date;
            endDate?: Date;
        } = {}
    ) {
        try {
            const {
                page = 1,
                limit = 20,
                type,
                startDate,
                endDate
            } = options;

            const query: any = { userId: new mongoose.Types.ObjectId(userId) };

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
                Activity.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Activity.countDocuments(query)
            ]);

            return {
                activities,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error('Error getting user activities:', error);
            throw error;
        }
    }

    /**
     * Get activity summary for a user
     */
    static async getActivitySummary(userId: string, days: number = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const summary = await Activity.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        createdAt: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 },
                        lastActivity: { $max: '$createdAt' }
                    }
                },
                {
                    $project: {
                        type: '$_id',
                        count: 1,
                        lastActivity: 1,
                        _id: 0
                    }
                }
            ]);

            return summary;
        } catch (error) {
            logger.error('Error getting activity summary:', error);
            throw error;
        }
    }

    /**
     * Clean up old activities (keep last 1000 per user)
     */
    static async cleanupOldActivities(userId: string) {
        try {
            const activities = await Activity.find({ userId })
                .sort({ createdAt: -1 })
                .skip(1000)
                .select('_id')
                .lean();

            if (activities.length > 0) {
                const idsToDelete = activities.map(a => a._id);
                await Activity.deleteMany({ _id: { $in: idsToDelete } });
                logger.info(`Cleaned up ${idsToDelete.length} old activities for user ${userId}`);
            }
        } catch (error) {
            logger.error('Error cleaning up activities:', error);
        }
    }
} 