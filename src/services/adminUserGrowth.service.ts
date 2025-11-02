import { User } from '../models/User';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface UserGrowthTrend {
    date: string;
    newUsers: number;
    totalUsers: number;
    activeUsers: number;
}

export interface EngagementMetrics {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    newUsersThisMonth: number;
    retentionRate: number;
    averageEngagementScore: number;
    peakUsageHour: number;
    averageSessionsPerUser: number;
}

export interface UserSegment {
    segment: string;
    count: number;
    percentage: number;
    averageCost: number;
    totalCost: number;
}

export class AdminUserGrowthService {
    /**
     * Get user growth trends by date (daily/weekly/monthly)
     */
    static async getUserGrowthTrends(
        period: 'daily' | 'weekly' | 'monthly' = 'daily',
        startDate?: Date,
        endDate?: Date
    ): Promise<UserGrowthTrend[]> {
        try {
            const matchStage: any = {};
            
            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            let dateFormat: any;
            let dateGroup: any;

            switch (period) {
                case 'daily':
                    dateFormat = {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    };
                    dateGroup = { $dayOfMonth: '$createdAt', $month: '$createdAt', $year: '$createdAt' };
                    break;
                case 'weekly':
                    dateFormat = {
                        $dateToString: { format: '%Y-W%V', date: '$createdAt' }
                    };
                    dateGroup = { $week: '$createdAt', $year: '$createdAt' };
                    break;
                case 'monthly':
                    dateFormat = {
                        $dateToString: { format: '%Y-%m', date: '$createdAt' }
                    };
                    dateGroup = { $month: '$createdAt', $year: '$createdAt' };
                    break;
            }

            // Aggregate users by signup date
            const userGrowth = await User.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: dateFormat,
                        date: { $first: dateFormat },
                        newUsers: { $sum: 1 },
                        totalUsers: { $sum: 1 }
                    }
                },
                { $sort: { date: 1 } }
            ]);

            // Calculate cumulative totals
            let cumulativeTotal = 0;
            const growthTrends: UserGrowthTrend[] = [];

            // Get date range for active users calculation
            const now = new Date();
            const activeUserCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

            for (const item of userGrowth) {
                cumulativeTotal += item.newUsers;
                
                // Calculate active users for this period
                const periodStart = new Date(item.date);
                const periodEnd = new Date(periodStart);
                
                if (period === 'daily') {
                    periodEnd.setDate(periodEnd.getDate() + 1);
                } else if (period === 'weekly') {
                    periodEnd.setDate(periodEnd.getDate() + 7);
                } else {
                    periodEnd.setMonth(periodEnd.getMonth() + 1);
                }

                const activeUsers = await Usage.countDocuments({
                    createdAt: { $gte: periodStart, $lt: periodEnd },
                    userId: { $exists: true }
                });

                growthTrends.push({
                    date: item.date,
                    newUsers: item.newUsers,
                    totalUsers: cumulativeTotal,
                    activeUsers
                });
            }

            return growthTrends;
        } catch (error) {
            loggingService.error('Error getting user growth trends:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserGrowthService',
                operation: 'getUserGrowthTrends'
            });
            throw error;
        }
    }

    /**
     * Get active users count (users with activity in last N days)
     */
    static async getActiveUsers(days: number = 30): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            const activeUserIds = await Usage.distinct('userId', {
                createdAt: { $gte: cutoffDate }
            });

            return activeUserIds.length;
        } catch (error) {
            loggingService.error('Error getting active users:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserGrowthService',
                operation: 'getActiveUsers'
            });
            throw error;
        }
    }

    /**
     * Get user engagement metrics
     */
    static async getUserEngagementMetrics(
        startDate?: Date,
        endDate?: Date
    ): Promise<EngagementMetrics> {
        try {
            const now = endDate ?? new Date();
            const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

            // Build date filter for usage queries
            const usageDateFilter: any = {};
            if (startDate || endDate) {
                usageDateFilter.createdAt = {};
                if (startDate) usageDateFilter.createdAt.$gte = startDate;
                if (endDate) usageDateFilter.createdAt.$lte = endDate;
            }

            // Total users (all users, regardless of date range)
            const totalUsers = await User.countDocuments();

            // Active users (with usage in the specified date range)
            const activeUserIds = await Usage.distinct('userId', {
                ...usageDateFilter,
                userId: { $exists: true }
            });
            const activeUsers = activeUserIds.length;
            const inactiveUsers = totalUsers - activeUsers;

            // New users this month (always use current month, not filtered by date range)
            const newUsersThisMonth = await User.countDocuments({
                createdAt: { $gte: thisMonthStart }
            });

            // Retention rate calculation
            // Calculate based on users created before the start of the date range
            const periodStart = startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const existingUsersCount = await User.countDocuments({
                createdAt: { $lt: periodStart }
            });
            const retentionRate = existingUsersCount > 0 
                ? (activeUsers / existingUsersCount) * 100 
                : 0;

            // Average engagement score (based on requests per user within date range)
            const usageStatsMatch: any = {};
            if (startDate || endDate) {
                usageStatsMatch.createdAt = {};
                if (startDate) usageStatsMatch.createdAt.$gte = startDate;
                if (endDate) usageStatsMatch.createdAt.$lte = endDate;
            }

            const usageStats = await Usage.aggregate([
                { $match: usageStatsMatch },
                {
                    $group: {
                        _id: '$userId',
                        requestCount: { $sum: 1 },
                        lastActivity: { $max: '$createdAt' }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgRequests: { $avg: '$requestCount' },
                        avgDaysSinceActivity: {
                            $avg: {
                                $divide: [
                                    { $subtract: [now, '$lastActivity'] },
                                    24 * 60 * 60 * 1000
                                ]
                            }
                        }
                    }
                }
            ]);

            const avgRequests = usageStats[0]?.avgRequests ?? 0;
            const averageEngagementScore = Math.min(100, (avgRequests / 100) * 100); // Normalize to 0-100

            // Peak usage hour (within date range)
            const hourlyUsageMatch: any = {};
            if (startDate || endDate) {
                hourlyUsageMatch.createdAt = {};
                if (startDate) hourlyUsageMatch.createdAt.$gte = startDate;
                if (endDate) hourlyUsageMatch.createdAt.$lte = endDate;
            }

            const hourlyUsage = await Usage.aggregate([
                { $match: hourlyUsageMatch },
                {
                    $group: {
                        _id: { $hour: '$createdAt' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]);
            const peakUsageHour = hourlyUsage[0]?._id ?? 0;

            // Average sessions per user (simplified: requests per user)
            const averageSessionsPerUser = avgRequests;

            return {
                totalUsers,
                activeUsers,
                inactiveUsers,
                newUsersThisMonth,
                retentionRate: Math.round(retentionRate * 100) / 100,
                averageEngagementScore: Math.round(averageEngagementScore * 100) / 100,
                peakUsageHour,
                averageSessionsPerUser: Math.round(averageSessionsPerUser * 100) / 100
            };
        } catch (error) {
            loggingService.error('Error getting user engagement metrics:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserGrowthService',
                operation: 'getUserEngagementMetrics'
            });
            throw error;
        }
    }

    /**
     * Segment users by spending and activity
     */
    static async getUserSegments(
        startDate?: Date,
        endDate?: Date
    ): Promise<UserSegment[]> {
        try {
            const matchStage: any = {};
            
            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            // Get spending data per user
            const userSpending = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$userId',
                        totalCost: { $sum: '$cost' },
                        requestCount: { $sum: 1 },
                        lastActivity: { $max: '$createdAt' }
                    }
                }
            ]);

            const totalUsers = userSpending.length;

            // Calculate percentiles for segmentation
            const sortedByCost = [...userSpending].sort((a, b) => 
                (b.totalCost || 0) - (a.totalCost || 0)
            );
            
            const highSpenderThreshold = sortedByCost[Math.floor(sortedByCost.length * 0.1)]?.totalCost ?? 0;
            const mediumSpenderThreshold = sortedByCost[Math.floor(sortedByCost.length * 0.5)]?.totalCost ?? 0;

            // Segment users
            const segments: Map<string, { count: number; totalCost: number; costs: number[] }> = new Map();
            
            const now = new Date();
            const activeCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            for (const user of userSpending) {
                const cost = user.totalCost || 0;
                const lastActivity = user.lastActivity ? new Date(user.lastActivity) : null;
                const isActive = lastActivity && lastActivity >= activeCutoff;

                let segment = 'Low Spender';
                if (cost >= highSpenderThreshold) {
                    segment = isActive ? 'High Spender - Active' : 'High Spender - Inactive';
                } else if (cost >= mediumSpenderThreshold) {
                    segment = isActive ? 'Medium Spender - Active' : 'Medium Spender - Inactive';
                } else {
                    segment = isActive ? 'Low Spender - Active' : 'Low Spender - Inactive';
                }

                const existing = segments.get(segment) || { count: 0, totalCost: 0, costs: [] };
                existing.count += 1;
                existing.totalCost += cost;
                existing.costs.push(cost);
                segments.set(segment, existing);
            }

            // Convert to array format
            const segmentArray: UserSegment[] = Array.from(segments.entries()).map(([segment, data]) => ({
                segment,
                count: data.count,
                percentage: totalUsers > 0 ? (data.count / totalUsers) * 100 : 0,
                averageCost: data.count > 0 ? data.totalCost / data.count : 0,
                totalCost: data.totalCost
            }));

            return segmentArray.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting user segments:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminUserGrowthService',
                operation: 'getUserSegments'
            });
            throw error;
        }
    }
}


