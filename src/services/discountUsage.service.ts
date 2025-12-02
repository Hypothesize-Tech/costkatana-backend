import { Discount, IDiscount } from '../models/Discount';
import { Subscription } from '../models/Subscription';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

export interface DiscountUsageStats {
    totalUses: number;
    uniqueUsers: number;
    totalDiscountAmount: number;
    averageDiscountAmount: number;
    usageByPlan: Record<string, number>;
    usageOverTime: Array<{
        date: string;
        count: number;
    }>;
    recentUsers: Array<{
        userId: string;
        userEmail: string;
        appliedAt: Date;
        discountAmount: number;
        plan: string;
    }>;
}

export class DiscountUsageService {
    /**
     * Safely convert userId to string
     */
    private static userIdToString(userId: unknown): string {
        if (!userId) return 'unknown';
        if (typeof userId === 'string') return userId;
        if (userId instanceof mongoose.Types.ObjectId) return userId.toString();
        if (typeof userId === 'object' && userId !== null) {
            // Check if it's a Mongoose document with _id
            if ('_id' in userId) {
                const id = (userId as { _id?: unknown })._id;
                if (id instanceof mongoose.Types.ObjectId) {
                    return id.toString();
                }
                return this.userIdToString(id);
            }
            // Check if it has an id property
            if ('id' in userId) {
                const id = (userId as { id?: unknown }).id;
                if (id instanceof mongoose.Types.ObjectId) {
                    return id.toString();
                }
                return this.userIdToString(id);
            }
            // Try toString if available (but check result to avoid [object Object])
            const userIdObj = userId as { toString?: () => string };
            if (userIdObj.toString && typeof userIdObj.toString === 'function') {
                try {
                    const result = userIdObj.toString();
                    // Only use if it's not the default object string representation
                    if (result && typeof result === 'string' && result !== '[object Object]' && result !== 'unknown') {
                        return result;
                    }
                } catch {
                    // Ignore errors
                }
            }
        }
        return 'unknown';
    }

    /**
     * Get usage statistics for a discount code
     */
    static async getDiscountUsageStats(discountId: string): Promise<DiscountUsageStats> {
        try {
            const discount = await Discount.findById(discountId);
            if (!discount) {
                throw new Error('Discount not found');
            }

            // Find all subscriptions that used this discount
            const subscriptions = await Subscription.find({
                'discount.code': discount.code,
            }).populate('userId', 'email name');

            const totalUses = subscriptions.length;

            // Calculate total discount amount
            let totalDiscountAmount = 0;
            const usageByPlan: Record<string, number> = {};
            const usageByDate: Record<string, number> = {};

            subscriptions.forEach((sub) => {
                if (sub.discount?.amount) {
                    totalDiscountAmount += sub.discount.amount;
                }

                // Count by plan
                const plan = sub.plan ?? 'unknown';
                usageByPlan[plan] = (usageByPlan[plan] ?? 0) + 1;

                // Count by date (when subscription was created/updated)
                const dateKey = sub.updatedAt.toISOString().split('T')[0];
                usageByDate[dateKey] = (usageByDate[dateKey] || 0) + 1;
            });
            
            // Get unique user IDs properly
            const uniqueUserIdsSet = new Set<string>();
            subscriptions.forEach((sub) => {
                const userIdStr = this.userIdToString(sub.userId);
                if (userIdStr && userIdStr !== 'unknown') {
                    uniqueUserIdsSet.add(userIdStr);
                }
            });
            const uniqueUsers = uniqueUserIdsSet.size;

            const averageDiscountAmount =
                totalUses > 0 ? totalDiscountAmount / totalUses : 0;

            // Convert usage by date to array format
            const usageOverTime = Object.entries(usageByDate)
                .map(([date, count]) => ({ date, count }))
                .sort((a, b) => a.date.localeCompare(b.date));

            // Get recent users (last 10)
            const recentUsers = subscriptions
                .slice(-10)
                .reverse()
                .map((sub) => {
                    const userId = sub.userId;
                    let userEmail = 'unknown@example.com';
                    
                    // Handle populated user object to get email
                    if (userId && typeof userId === 'object' && userId !== null && 'email' in userId) {
                        userEmail = (userId as { email?: string }).email ?? 'unknown@example.com';
                    }
                    
                    const userIdStr = this.userIdToString(userId);
                    
                    return {
                        userId: userIdStr,
                        userEmail,
                        appliedAt: sub.updatedAt,
                        discountAmount: sub.discount?.amount ?? 0,
                        plan: sub.plan ?? 'unknown',
                    };
                });

            return {
                totalUses,
                uniqueUsers,
                totalDiscountAmount,
                averageDiscountAmount,
                usageByPlan,
                usageOverTime,
                recentUsers,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error getting discount usage stats', {
                discountId,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Get all discounts with their usage stats
     */
    static async getDiscountsWithUsage(
        filters?: {
            isActive?: boolean;
            type?: 'percentage' | 'fixed';
            search?: string;
        }
    ): Promise<Array<IDiscount & { usageStats: Partial<DiscountUsageStats> }>> {
        try {
            const query: Record<string, unknown> = {};

            if (filters?.isActive !== undefined) {
                query.isActive = filters.isActive;
            }

            if (filters?.type) {
                query.type = filters.type;
            }

            if (filters?.search) {
                query.code = { $regex: filters.search, $options: 'i' };
            }

            const discounts = await Discount.find(query).sort({ createdAt: -1 });

            // Get basic usage stats for each discount
            const discountsWithUsage = await Promise.all(
                discounts.map(async (discount) => {
                    const subscriptions = await Subscription.countDocuments({
                        'discount.code': discount.code,
                    });

                    const uniqueUsers = await Subscription.distinct('userId', {
                        'discount.code': discount.code,
                    });

                    const discountObj = discount.toObject() as IDiscount;
                    return {
                        ...discountObj,
                        usageStats: {
                            totalUses: subscriptions,
                            uniqueUsers: uniqueUsers.length,
                        },
                    } as unknown as IDiscount & { usageStats: Partial<DiscountUsageStats> };
                })
            );

            return discountsWithUsage;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error getting discounts with usage', {
                error: errorMessage,
            });
            throw error;
        }
    }
}

