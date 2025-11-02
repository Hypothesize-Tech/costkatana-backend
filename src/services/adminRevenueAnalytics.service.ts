import { User } from '../models/User';
import { loggingService } from './logging.service';

export interface RevenueMetrics {
    totalMRR: number;
    totalARR: number;
    revenueThisMonth: number;
    revenueLastMonth: number;
    revenueGrowth: number;
    revenueByPlan: Array<{
        plan: string;
        count: number;
        revenue: number;
        percentage: number;
    }>;
    revenueTrend: Array<{
        date: string;
        revenue: number;
        subscriptions: number;
    }>;
}

export interface SubscriptionMetrics {
    totalSubscriptions: number;
    activeSubscriptions: number;
    freePlan: number;
    plusPlan: number;
    proPlan: number;
    enterprisePlan: number;
    newSubscriptionsThisMonth: number;
    cancellationsThisMonth: number;
    churnRate: number;
    retentionRate: number;
    averageRevenuePerUser: number;
    lifetimeValue: number;
}

export interface ConversionMetrics {
    freeToPlus: number;
    freeToPro: number;
    plusToPro: number;
    conversionRates: {
        freeToPlus: number;
        freeToPro: number;
        plusToPro: number;
    };
    conversionsThisMonth: number;
    conversionTrend: Array<{
        date: string;
        conversions: number;
        fromPlan: string;
        toPlan: string;
    }>;
}

export interface UpcomingRenewals {
    userId: string;
    userEmail: string;
    plan: string;
    amount: number;
    nextBillingDate: Date;
    interval: 'monthly' | 'yearly';
}

export class AdminRevenueAnalyticsService {
    // Plan pricing (from guardrails.service.ts)
    private static readonly PLAN_PRICING = {
        free: 0,
        plus: 25, // per seat
        pro: 399,
        enterprise: 0 // custom pricing
    };

    /**
     * Get revenue metrics
     */
    static async getRevenueMetrics(
        startDate?: Date,
        endDate?: Date
    ): Promise<RevenueMetrics> {
        try {
            const now = new Date();
            const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

            // Get all users with subscriptions
            const users = await User.find({ isActive: true }).select('subscription');

            // Calculate MRR (Monthly Recurring Revenue)
            let totalMRR = 0;
            const revenueByPlanMap = new Map<string, { count: number; revenue: number }>();

            for (const user of users) {
                const plan = user.subscription?.plan || 'free';
                const billing = user.subscription?.billing;
                const interval = billing?.interval || 'monthly';
                const amount = billing?.amount || 0;
                const seats = user.subscription?.seats || 1;

                if (plan !== 'free') {
                    let monthlyRevenue = amount;
                    
                    // If yearly, divide by 12 for MRR
                    if (interval === 'yearly') {
                        monthlyRevenue = amount / 12;
                    } else if (plan === 'plus') {
                        // Plus plan: seats * 25
                        monthlyRevenue = seats * this.PLAN_PRICING.plus;
                    } else if (plan === 'pro') {
                        monthlyRevenue = this.PLAN_PRICING.pro;
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

            const totalRevenue = Array.from(revenueByPlanMap.values()).reduce((sum, d) => sum + d.revenue, 0);
            const revenueByPlan = Array.from(revenueByPlanMap.entries()).map(([plan, data]) => ({
                plan,
                count: data.count,
                revenue: data.revenue,
                percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
            }));

            // Calculate revenue for current month and last month
            const revenueThisMonth = await this.calculateMonthRevenue(currentMonthStart, now);
            const revenueLastMonth = await this.calculateMonthRevenue(lastMonthStart, lastMonthEnd);
            const revenueGrowth = revenueLastMonth > 0 
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
                revenueTrend
            };
        } catch (error) {
            loggingService.error('Error getting revenue metrics:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Calculate revenue for a specific month
     */
    private static async calculateMonthRevenue(startDate: Date, endDate: Date): Promise<number> {
        try {
            const users = await User.find({
                isActive: true,
                'subscription.startDate': { $lte: endDate },
                $or: [
                    { 'subscription.endDate': { $exists: false } },
                    { 'subscription.endDate': { $gte: startDate } }
                ]
            }).select('subscription');

            let revenue = 0;
            for (const user of users) {
                const plan = user.subscription?.plan || 'free';
                const billing = user.subscription?.billing;
                const interval = billing?.interval || 'monthly';
                const amount = billing?.amount || 0;
                const seats = user.subscription?.seats || 1;

                if (plan !== 'free') {
                    if (plan === 'plus') {
                        revenue += seats * this.PLAN_PRICING.plus;
                    } else if (plan === 'pro') {
                        revenue += this.PLAN_PRICING.pro;
                    } else if (plan === 'enterprise' && amount > 0) {
                        revenue += interval === 'yearly' ? amount / 12 : amount;
                    }
                }
            }

            return revenue;
        } catch (error) {
            loggingService.error('Error calculating month revenue:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    /**
     * Get revenue trend over time
     */
    private static async getRevenueTrend(
        startDate?: Date,
        endDate?: Date
    ): Promise<Array<{ date: string; revenue: number; subscriptions: number }>> {
        try {
            const now = new Date();
            const end = endDate || now;
            const start = startDate || new Date(now.getFullYear(), now.getMonth() - 11, 1);

            const trend: Array<{ date: string; revenue: number; subscriptions: number }> = [];
            const current = new Date(start);

            while (current <= end) {
                const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
                const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

                const revenue = await this.calculateMonthRevenue(monthStart, monthEnd);
                
                const subscriptions = await User.countDocuments({
                    isActive: true,
                    'subscription.startDate': { $lte: monthEnd },
                    'subscription.plan': { $ne: 'free' },
                    $or: [
                        { 'subscription.endDate': { $exists: false } },
                        { 'subscription.endDate': { $gte: monthStart } }
                    ]
                });

                trend.push({
                    date: monthStart.toISOString().split('T')[0],
                    revenue,
                    subscriptions
                });

                current.setMonth(current.getMonth() + 1);
            }

            return trend;
        } catch (error) {
            loggingService.error('Error getting revenue trend:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Get subscription metrics
     */
    static async getSubscriptionMetrics(
        startDate?: Date,
        endDate?: Date
    ): Promise<SubscriptionMetrics> {
        try {
            const now = endDate || new Date();
            const currentMonthStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1);

            // Build match query with date filters
            const matchQuery: any = { isActive: true };
            
            if (startDate || endDate) {
                matchQuery['subscription.startDate'] = {};
                if (startDate) matchQuery['subscription.startDate'].$gte = startDate;
                if (endDate) matchQuery['subscription.startDate'].$lte = endDate;
            }

            // Get all subscriptions with optional date filtering
            const subscriptions = await User.find(matchQuery).select('subscription createdAt');

            const planCounts = {
                free: 0,
                plus: 0,
                pro: 0,
                enterprise: 0
            };

            let totalRevenue = 0;

            for (const user of subscriptions) {
                const plan = user.subscription?.plan || 'free';
                planCounts[plan as keyof typeof planCounts]++;

                if (plan !== 'free') {
                    const billing = user.subscription?.billing;
                    const interval = billing?.interval || 'monthly';
                    const amount = billing?.amount || 0;
                    const seats = user.subscription?.seats || 1;

                    if (plan === 'plus') {
                        totalRevenue += seats * this.PLAN_PRICING.plus;
                    } else if (plan === 'pro') {
                        totalRevenue += this.PLAN_PRICING.pro;
                    } else if (plan === 'enterprise' && amount > 0) {
                        totalRevenue += interval === 'yearly' ? amount / 12 : amount;
                    }
                }
            }

            // New subscriptions in the specified period
            const newSubscriptionsQuery: any = {
                isActive: true,
                'subscription.plan': { $ne: 'free' }
            };
            
            if (startDate || endDate) {
                newSubscriptionsQuery['subscription.startDate'] = {};
                if (startDate) newSubscriptionsQuery['subscription.startDate'].$gte = startDate;
                if (endDate) newSubscriptionsQuery['subscription.startDate'].$lte = endDate;
            } else {
                newSubscriptionsQuery['subscription.startDate'] = { $gte: currentMonthStart, $lte: now };
            }
            
            const newSubscriptionsThisMonth = await User.countDocuments(newSubscriptionsQuery);

            // Cancellations in the specified period (users who ended subscription)
            const cancellationsQuery: any = {
                isActive: true
            };
            
            if (startDate || endDate) {
                cancellationsQuery['subscription.endDate'] = {};
                if (startDate) cancellationsQuery['subscription.endDate'].$gte = startDate;
                if (endDate) cancellationsQuery['subscription.endDate'].$lte = endDate;
            } else {
                cancellationsQuery['subscription.endDate'] = { $gte: currentMonthStart, $lte: now };
            }
            
            const cancellationsThisMonth = await User.countDocuments(cancellationsQuery);

            // Filter active subscriptions based on date range
            const cutoffDate = endDate || now;
            const activeSubscriptions = subscriptions.filter(u => {
                const plan = u.subscription?.plan || 'free';
                const startDateCheck = !startDate || (u.subscription?.startDate && u.subscription.startDate <= cutoffDate);
                const endDateCheck = !u.subscription?.endDate || u.subscription.endDate > cutoffDate;
                return plan !== 'free' && startDateCheck && endDateCheck;
            }).length;

            const churnRate = activeSubscriptions > 0 
                ? (cancellationsThisMonth / activeSubscriptions) * 100 
                : 0;
            
            const retentionRate = 100 - churnRate;

            const averageRevenuePerUser = activeSubscriptions > 0 
                ? totalRevenue / activeSubscriptions 
                : 0;

            // Estimate LTV (average revenue per user * average subscription duration in months)
            // Assume average subscription duration of 24 months
            const lifetimeValue = averageRevenuePerUser * 24;

            return {
                totalSubscriptions: subscriptions.length,
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
                lifetimeValue
            };
        } catch (error) {
            loggingService.error('Error getting subscription metrics:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get conversion metrics
     */
    static async getConversionMetrics(
        startDate?: Date,
        endDate?: Date
    ): Promise<ConversionMetrics> {
        try {
            // This would require tracking plan changes in a separate model
            // For now, we'll calculate based on current subscriptions
            const now = endDate || new Date();
            const periodStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1);

            // Build date filter for subscriptions started in period
            const dateFilter: any = {};
            if (startDate || endDate) {
                dateFilter.$gte = startDate || periodStart;
                if (endDate) dateFilter.$lte = endDate;
            } else {
                dateFilter.$gte = periodStart;
            }

            const freeUsersQuery: any = {
                'subscription.plan': 'free',
                isActive: true
            };
            
            if (startDate || endDate) {
                freeUsersQuery.createdAt = {};
                if (startDate) freeUsersQuery.createdAt.$gte = startDate;
                if (endDate) freeUsersQuery.createdAt.$lte = endDate;
            }

            const freeUsers = await User.countDocuments(freeUsersQuery);

            const plusUsersQuery: any = {
                'subscription.plan': 'plus',
                isActive: true,
                'subscription.startDate': dateFilter
            };
            
            const plusUsers = await User.countDocuments(plusUsersQuery);

            const proUsersQuery: any = {
                'subscription.plan': 'pro',
                isActive: true,
                'subscription.startDate': dateFilter
            };
            
            const proUsers = await User.countDocuments(proUsersQuery);

            // Estimate conversions (this is simplified - real implementation would track actual conversions)
            const freeToPlus = plusUsers;
            const freeToPro = proUsers;
            const plusToPro = 0; // Would need tracking

            const totalFreeUsers = freeUsers + plusUsers + proUsers; // Approximate

            const conversionRates = {
                freeToPlus: totalFreeUsers > 0 ? (freeToPlus / totalFreeUsers) * 100 : 0,
                freeToPro: totalFreeUsers > 0 ? (freeToPro / totalFreeUsers) * 100 : 0,
                plusToPro: plusUsers > 0 ? (plusToPro / plusUsers) * 100 : 0
            };

            return {
                freeToPlus,
                freeToPro,
                plusToPro,
                conversionRates,
                conversionsThisMonth: freeToPlus + freeToPro + plusToPro,
                conversionTrend: [] // Would need historical data
            };
        } catch (error) {
            loggingService.error('Error getting conversion metrics:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get upcoming renewals
     */
    static async getUpcomingRenewals(days: number = 30): Promise<UpcomingRenewals[]> {
        try {
            const now = new Date();
            const futureDate = new Date(now);
            futureDate.setDate(futureDate.getDate() + days);

            const users = await User.find({
                isActive: true,
                'subscription.billing.nextBillingDate': {
                    $gte: now,
                    $lte: futureDate
                },
                'subscription.plan': { $ne: 'free' }
            }).select('email subscription').lean();

            const renewals: UpcomingRenewals[] = users.map(user => {
                const billing = user.subscription?.billing;
                return {
                    userId: user._id.toString(),
                    userEmail: user.email,
                    plan: user.subscription?.plan || '',
                    amount: billing?.amount || 0,
                    nextBillingDate: billing?.nextBillingDate || new Date(),
                    interval: billing?.interval || 'monthly'
                };
            });

            return renewals.sort((a, b) => 
                a.nextBillingDate.getTime() - b.nextBillingDate.getTime()
            );
        } catch (error) {
            loggingService.error('Error getting upcoming renewals:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}


