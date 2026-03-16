import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Discount } from '../../schemas/billing/discount.schema';
import { Subscription } from '../../schemas/core/subscription.schema';
import { User } from '../../schemas/user/user.schema';
import { LoggingService } from '../../common/services/logging.service';

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

@Injectable()
export class DiscountUsageService {
  private readonly logger = new Logger(DiscountUsageService.name);

  constructor(
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<Subscription>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Safely convert userId to string (ObjectId or populated user)
   */
  private userIdToString(userId: unknown): string {
    if (!userId) return 'unknown';
    if (typeof userId === 'string') return userId;
    if (userId instanceof mongoose.Types.ObjectId) return userId.toString();
    if (typeof userId === 'object' && userId !== null) {
      if ('_id' in userId) {
        const id = (userId as { _id?: unknown })._id;
        if (id instanceof mongoose.Types.ObjectId) return id.toString();
        return this.userIdToString(id);
      }
      if ('id' in userId) {
        const id = (userId as { id?: unknown }).id;
        if (id instanceof mongoose.Types.ObjectId) return id.toString();
        return this.userIdToString(id);
      }
      const userIdObj = userId as { toString?: () => string };
      if (userIdObj.toString && typeof userIdObj.toString === 'function') {
        try {
          const result = userIdObj.toString();
          if (
            result &&
            typeof result === 'string' &&
            result !== '[object Object]' &&
            result !== 'unknown'
          ) {
            return result;
          }
        } catch {
          // ignore
        }
      }
    }
    return 'unknown';
  }

  /**
   * Get usage statistics for a discount code
   */
  async getDiscountUsageStats(discountId: string): Promise<DiscountUsageStats> {
    try {
      const discount = await this.discountModel.findById(discountId);
      if (!discount) {
        throw new Error('Discount not found');
      }

      const subscriptions = await this.subscriptionModel
        .find({
          'discount.code': discount.code,
        })
        .populate('userId', 'email name')
        .lean()
        .exec();

      const totalUses = subscriptions.length;

      let totalDiscountAmount = 0;
      const usageByPlan: Record<string, number> = {};
      const usageByDate: Record<string, number> = {};

      for (const sub of subscriptions) {
        const discountAmount = (sub as any).discount?.amount;
        if (typeof discountAmount === 'number') {
          totalDiscountAmount += discountAmount;
        }

        const plan = (sub as any).plan ?? 'unknown';
        usageByPlan[plan] = (usageByPlan[plan] ?? 0) + 1;

        const updatedAt = (sub as any).updatedAt;
        const dateKey = updatedAt
          ? new Date(updatedAt).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];
        usageByDate[dateKey] = (usageByDate[dateKey] || 0) + 1;
      }

      const uniqueUserIdsSet = new Set<string>();
      for (const sub of subscriptions) {
        const userIdStr = this.userIdToString((sub as any).userId);
        if (userIdStr && userIdStr !== 'unknown') {
          uniqueUserIdsSet.add(userIdStr);
        }
      }
      const uniqueUsers = uniqueUserIdsSet.size;

      const averageDiscountAmount =
        totalUses > 0 ? totalDiscountAmount / totalUses : 0;

      const usageOverTime = Object.entries(usageByDate)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const recentSubs = subscriptions.slice(-10).reverse();
      const recentUsers = recentSubs.map((sub) => {
        const userId = (sub as any).userId;
        let userEmail = 'unknown@example.com';
        if (
          userId &&
          typeof userId === 'object' &&
          userId !== null &&
          'email' in userId
        ) {
          userEmail =
            (userId as { email?: string }).email ?? 'unknown@example.com';
        }
        return {
          userId: this.userIdToString(userId),
          userEmail,
          appliedAt: (sub as any).updatedAt ?? new Date(),
          discountAmount: (sub as any).discount?.amount ?? 0,
          plan: (sub as any).plan ?? 'unknown',
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggingService.error('Error getting discount usage stats', {
        discountId,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get basic usage stats for a discount (totalUses, uniqueUsers) - used in list
   */
  async getUsageStatsForDiscount(
    code: string,
  ): Promise<{ totalUses: number; uniqueUsers: number }> {
    const totalUses = await this.subscriptionModel.countDocuments({
      'discount.code': code,
    });
    const uniqueUserIds = await this.subscriptionModel.distinct('userId', {
      'discount.code': code,
    });
    return {
      totalUses,
      uniqueUsers: uniqueUserIds.length,
    };
  }
}
