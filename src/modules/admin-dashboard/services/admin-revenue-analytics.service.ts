import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../../../schemas/core/subscription.schema';
import {
  RevenueMetrics,
  SubscriptionMetrics,
  ConversionMetrics,
  UpcomingRenewals,
} from '../interfaces';

@Injectable()
export class AdminRevenueAnalyticsService {
  private readonly logger = new Logger(AdminRevenueAnalyticsService.name);

  private static readonly PLAN_PRICING = {
    free: 0,
    plus: 25,
    pro: 399,
    enterprise: 0,
  };

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  /**
   * Get revenue metrics
   */
  async getRevenueMetrics(
    startDate?: Date,
    endDate?: Date,
  ): Promise<RevenueMetrics> {
    try {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      // Get all users with subscriptions
      const users = await this.userModel
        .find({ isActive: true })
        .populate('subscriptionId')
        .lean();

      // Calculate MRR (Monthly Recurring Revenue)
      let totalMRR = 0;
      const revenueByPlanMap = new Map<
        string,
        { count: number; revenue: number }
      >();

      for (const user of users) {
        const subscription = (user as any).subscriptionId;
        const plan = subscription?.plan || 'free';
        const billing = subscription?.billing;
        const interval = billing?.interval || 'monthly';
        const amount = billing?.amount || 0;
        const seats = subscription?.limits?.seats ?? 1;

        if (plan !== 'free') {
          let monthlyRevenue = amount;

          // If yearly, divide by 12 for MRR
          if (interval === 'yearly') {
            monthlyRevenue = amount / 12;
          } else if (plan === 'plus') {
            // Plus plan: seats * 25
            monthlyRevenue =
              seats * AdminRevenueAnalyticsService.PLAN_PRICING.plus;
          } else if (plan === 'pro') {
            monthlyRevenue = AdminRevenueAnalyticsService.PLAN_PRICING.pro;
          }

          totalMRR += monthlyRevenue;

          if (!revenueByPlanMap.has(plan)) {
            revenueByPlanMap.set(plan, { count: 0, revenue: 0 });
          }
          const planData = revenueByPlanMap.get(plan)!;
          planData.count++;
          planData.revenue += monthlyRevenue;
        } else {
          if (!revenueByPlanMap.has(plan)) {
            revenueByPlanMap.set(plan, { count: 0, revenue: 0 });
          }
          revenueByPlanMap.get(plan)!.count++;
        }
      }

      const totalRevenue = Array.from(revenueByPlanMap.values()).reduce(
        (sum, d) => sum + d.revenue,
        0,
      );
      const revenueByPlan = Array.from(revenueByPlanMap.entries()).map(
        ([plan, data]) => ({
          plan,
          count: data.count,
          revenue: data.revenue,
          percentage:
            totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
        }),
      );

      // Calculate revenue for current month and last month
      const revenueThisMonth = await this.calculateMonthRevenue(
        currentMonthStart,
        now,
      );
      const revenueLastMonth = await this.calculateMonthRevenue(
        lastMonthStart,
        lastMonthEnd,
      );
      const revenueGrowth =
        revenueLastMonth > 0
          ? ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100
          : 0;

      // Get revenue trend (last 12 months)
      const revenueTrend = await this.getRevenueTrend(startDate, endDate);

      return {
        totalMRR,
        totalARR: totalMRR * 12,
        revenueThisMonth,
        revenueLastMonth,
        revenueGrowth,
        revenueByPlan,
        revenueTrend,
      };
    } catch (error) {
      this.logger.error('Error getting revenue metrics:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminRevenueAnalyticsService',
        operation: 'getRevenueMetrics',
      });
      throw error;
    }
  }

  /**
   * Calculate revenue for a specific month using Subscription collection.
   */
  private async calculateMonthRevenue(
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      const subscriptions = await this.subscriptionModel
        .find({
          plan: { $ne: 'free' },
          startDate: { $lte: endDate },
          $or: [
            { endDate: { $exists: false } },
            { endDate: null },
            { endDate: { $gte: startDate } },
          ],
        })
        .lean();

      let revenue = 0;
      for (const sub of subscriptions) {
        const s = sub as any;
        const plan = s.plan || 'free';
        const billing = s.billing;
        const interval = billing?.interval || 'monthly';
        const amount = billing?.amount || 0;
        const seats = s.limits?.seats ?? 1;

        if (plan === 'plus') {
          revenue += seats * AdminRevenueAnalyticsService.PLAN_PRICING.plus;
        } else if (plan === 'pro') {
          revenue += AdminRevenueAnalyticsService.PLAN_PRICING.pro;
        } else if (plan === 'enterprise' && amount > 0) {
          revenue += interval === 'yearly' ? amount / 12 : amount;
        }
      }

      return revenue;
    } catch (error) {
      this.logger.error('Error calculating month revenue:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminRevenueAnalyticsService',
        operation: 'calculateMonthRevenue',
      });
      return 0;
    }
  }

  /**
   * Get revenue trend over time
   */
  private async getRevenueTrend(
    startDate?: Date,
    endDate?: Date,
  ): Promise<Array<{ date: string; revenue: number; subscriptions: number }>> {
    try {
      const now = new Date();
      const end = endDate || now;
      const start =
        startDate || new Date(now.getFullYear(), now.getMonth() - 11, 1);

      const trend: Array<{
        date: string;
        revenue: number;
        subscriptions: number;
      }> = [];
      const current = new Date(start);

      while (current <= end) {
        const monthStart = new Date(
          current.getFullYear(),
          current.getMonth(),
          1,
        );
        const monthEnd = new Date(
          current.getFullYear(),
          current.getMonth() + 1,
          0,
        );

        const revenue = await this.calculateMonthRevenue(monthStart, monthEnd);

        const subscriptions = await this.subscriptionModel.countDocuments({
          plan: { $ne: 'free' },
          startDate: { $lte: monthEnd },
          $or: [
            { endDate: { $exists: false } },
            { endDate: null },
            { endDate: { $gte: monthStart } },
          ],
        });

        trend.push({
          date: monthStart.toISOString().split('T')[0],
          revenue,
          subscriptions,
        });

        current.setMonth(current.getMonth() + 1);
      }

      return trend;
    } catch (error) {
      this.logger.error('Error getting revenue trend:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminRevenueAnalyticsService',
        operation: 'getRevenueTrend',
      });
      return [];
    }
  }

  /**
   * Get subscription metrics
   */
  async getSubscriptionMetrics(
    startDate?: Date,
    endDate?: Date,
  ): Promise<SubscriptionMetrics> {
    try {
      const now = endDate || new Date();
      const currentMonthStart =
        startDate || new Date(now.getFullYear(), now.getMonth(), 1);

      // Build match query with date filters
      const matchQuery: any = { isActive: true };

      // Get all subscriptions with optional date filtering
      const users = await this.userModel
        .find(matchQuery)
        .populate('subscriptionId')
        .lean();

      const planCounts = {
        free: 0,
        plus: 0,
        pro: 0,
        enterprise: 0,
      };

      let totalRevenue = 0;

      for (const user of users) {
        const subscription = (user as any).subscriptionId;
        const plan = subscription?.plan || 'free';
        (planCounts as any)[plan] = ((planCounts as any)[plan] || 0) + 1;

        if (plan !== 'free') {
          const billing = subscription?.billing;
          const interval = billing?.interval || 'monthly';
          const amount = billing?.amount || 0;
          const seats = subscription?.limits?.seats ?? 1;

          if (plan === 'plus') {
            totalRevenue +=
              seats * AdminRevenueAnalyticsService.PLAN_PRICING.plus;
          } else if (plan === 'pro') {
            totalRevenue += AdminRevenueAnalyticsService.PLAN_PRICING.pro;
          } else if (plan === 'enterprise' && amount > 0) {
            totalRevenue += interval === 'yearly' ? amount / 12 : amount;
          }
        }
      }

      // New subscriptions in the specified period
      const newSubsDateFilter: any =
        startDate || endDate
          ? {
              ...(startDate && { $gte: startDate }),
              ...(endDate && { $lte: endDate }),
            }
          : { $gte: currentMonthStart, $lte: now };

      const newSubscriptionsThisMonth =
        await this.subscriptionModel.countDocuments({
          plan: { $ne: 'free' },
          startDate: newSubsDateFilter,
        });

      // Cancellations in the specified period
      const cancellationsDateFilter: any =
        startDate || endDate
          ? {
              ...(startDate && { $gte: startDate }),
              ...(endDate && { $lte: endDate }),
            }
          : { $gte: currentMonthStart, $lte: now };

      const cancellationsThisMonth =
        await this.subscriptionModel.countDocuments({
          endDate: { $exists: true, $ne: null, ...cancellationsDateFilter },
        });

      // Filter active subscriptions based on date range
      const cutoffDate = endDate || now;
      const activeSubscriptions = users.filter((u) => {
        const subscription = (u as any).subscriptionId;
        const plan = subscription?.plan || 'free';
        const startDateCheck =
          !startDate ||
          (subscription?.startDate && subscription.startDate <= cutoffDate);
        const endDateCheck =
          !subscription?.endDate || subscription.endDate > cutoffDate;
        return plan !== 'free' && startDateCheck && endDateCheck;
      }).length;

      const churnRate =
        activeSubscriptions > 0
          ? (cancellationsThisMonth / activeSubscriptions) * 100
          : 0;

      const retentionRate = 100 - churnRate;

      const averageRevenuePerUser =
        activeSubscriptions > 0 ? totalRevenue / activeSubscriptions : 0;

      // Estimate LTV (average revenue per user * average subscription duration in months)
      // Assume average subscription duration of 24 months
      const lifetimeValue = averageRevenuePerUser * 24;

      return {
        totalSubscriptions: users.length,
        activeSubscriptions,
        freePlan: planCounts.free,
        plusPlan: planCounts.plus,
        proPlan: planCounts.pro,
        enterprisePlan: planCounts.enterprise,
        newSubscriptionsThisMonth,
        cancellationsThisMonth,
        churnRate,
        retentionRate,
        averageRevenuePerUser,
        lifetimeValue,
      };
    } catch (error) {
      this.logger.error('Error getting subscription metrics:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminRevenueAnalyticsService',
        operation: 'getSubscriptionMetrics',
      });
      throw error;
    }
  }

  /**
   * Get conversion metrics using Subscription and User data.
   */
  async getConversionMetrics(
    startDate?: Date,
    endDate?: Date,
  ): Promise<ConversionMetrics> {
    try {
      const now = endDate || new Date();
      const periodStart =
        startDate || new Date(now.getFullYear(), now.getMonth(), 1);

      const dateFilter: any =
        startDate || endDate
          ? {
              ...(startDate && { $gte: startDate }),
              ...(endDate && { $lte: endDate }),
            }
          : { $gte: periodStart };

      const freeSubIds = await this.subscriptionModel.distinct('_id', {
        plan: 'free',
      });
      const freeUsers = await this.userModel.countDocuments({
        $or: [
          { subscriptionId: { $exists: false } },
          { subscriptionId: null },
          { subscriptionId: { $in: freeSubIds } },
        ],
        isActive: true,
        ...(startDate &&
          endDate && {
            createdAt: { $gte: startDate, $lte: endDate },
          }),
      });

      const plusUsers = await this.subscriptionModel.countDocuments({
        plan: 'plus',
        startDate: dateFilter,
      });

      const proUsers = await this.subscriptionModel.countDocuments({
        plan: 'pro',
        startDate: dateFilter,
      });

      const plusToPro = 0; // Would require plan-change tracking (e.g. previousPlan on Subscription or separate events)

      const freeToPlus = plusUsers;
      const freeToPro = proUsers;
      const totalFreeUsers = freeUsers || 1;

      const conversionRates = {
        freeToPlus:
          totalFreeUsers > 0 ? (freeToPlus / totalFreeUsers) * 100 : 0,
        freeToPro: totalFreeUsers > 0 ? (freeToPro / totalFreeUsers) * 100 : 0,
        plusToPro: plusUsers > 0 ? (plusToPro / plusUsers) * 100 : 0,
      };

      return {
        freeToPlus,
        freeToPro,
        plusToPro,
        conversionRates,
        conversionsThisMonth: freeToPlus + freeToPro + plusToPro,
        conversionTrend: [],
      };
    } catch (error) {
      this.logger.error('Error getting conversion metrics:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminRevenueAnalyticsService',
        operation: 'getConversionMetrics',
      });
      throw error;
    }
  }

  /**
   * Get upcoming renewals
   */
  async getUpcomingRenewals(days: number = 30): Promise<UpcomingRenewals[]> {
    try {
      const now = new Date();
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + days);

      const subscriptions = await this.subscriptionModel
        .find({
          plan: { $ne: 'free' },
          'billing.nextBillingDate': {
            $gte: now,
            $lte: futureDate,
          },
        })
        .select('userId plan billing')
        .populate('userId', 'email')
        .lean();

      const renewals: UpcomingRenewals[] = subscriptions.map((sub: any) => {
        const billing = sub.billing;
        const user = sub.userId;
        return {
          userId: sub.userId?._id?.toString() ?? sub.userId?.toString() ?? '',
          userEmail: user?.email ?? '',
          plan: sub.plan ?? '',
          amount: billing?.amount ?? 0,
          nextBillingDate: billing?.nextBillingDate
            ? new Date(billing.nextBillingDate)
            : new Date(),
          interval: billing?.interval ?? 'monthly',
        };
      });

      return renewals.sort(
        (a, b) => a.nextBillingDate.getTime() - b.nextBillingDate.getTime(),
      );
    } catch (error) {
      this.logger.error('Error getting upcoming renewals:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminRevenueAnalyticsService',
        operation: 'getUpcomingRenewals',
      });
      throw error;
    }
  }
}
