import { Subscription, ISubscription } from '../models/Subscription';
import { PaymentMethod} from '../models/PaymentMethod';
import { Invoice, IInvoice } from '../models/Invoice';
import { SubscriptionHistory } from '../models/SubscriptionHistory';
import { Discount } from '../models/Discount';
import { paymentGatewayManager } from './paymentGateway/paymentGatewayManager.service';
import { PaymentGateway } from './paymentGateway/paymentGateway.interface';
import { loggingService } from './logging.service';
import { AppError } from '../middleware/error.middleware';
import { ObjectId } from 'mongoose';

// Subscription plan limits based on new pricing structure
export const SUBSCRIPTION_PLAN_LIMITS = {
    free: {
        tokensPerMonth: 1_000_000, // 1M tokens
        requestsPerMonth: 5_000, // 5K requests
        logsPerMonth: 5_000, // 5K logs
        projects: 1,
        agentTraces: 10,
        seats: 1,
        cortexDailyUsage: {
            limit: 0, // Not available
        },
        allowedModels: ['claude-3-haiku', 'gpt-3.5-turbo', 'gemini-1.5-flash'], // Basic models
        features: ['basic_analytics', 'usage_tracking', 'unified_endpoint'],
    },
    plus: {
        tokensPerMonth: 2_000_000, // 2M tokens included
        requestsPerMonth: 10_000, // 10K requests
        logsPerMonth: -1, // Unlimited
        projects: -1, // Unlimited
        agentTraces: 100,
        seats: 1,
        cortexDailyUsage: {
            limit: 0, // Not available
        },
        allowedModels: ['*'], // All models
        features: ['advanced_analytics', 'predictive_analytics', 'batch_processing', 'failover', 'security_moderation', 'usage_tracking', 'unified_endpoint', 'advanced_metrics'],
        overagePricing: {
            tokensPer1M: 5, // $5 per 1M tokens over included
        },
    },
    pro: {
        tokensPerMonth: 5_000_000, // 5M tokens included per user
        requestsPerMonth: 50_000, // 50K requests
        logsPerMonth: -1, // Unlimited
        projects: -1, // Unlimited
        agentTraces: 100, // Per user
        seats: 1, // Base seat included, additional at $20/user/month
        cortexDailyUsage: {
            limit: 0, // Not available
        },
        allowedModels: ['*'], // All models
        features: ['advanced_analytics', 'predictive_analytics', 'batch_processing', 'failover', 'security_moderation', 'usage_tracking', 'unified_endpoint', 'advanced_metrics', 'priority_support'],
        overagePricing: {
            tokensPer1M: 5, // $5 per 1M tokens over included
            seatPerMonth: 20, // $20 per additional seat per month
        },
    },
    enterprise: {
        tokensPerMonth: -1, // Unlimited
        requestsPerMonth: -1, // Unlimited
        logsPerMonth: -1, // Unlimited
        projects: -1, // Unlimited
        agentTraces: -1, // Unlimited
        seats: -1, // Custom
        cortexDailyUsage: {
            limit: -1, // Unlimited
        },
        allowedModels: ['*', 'custom'], // All models + custom
        features: ['*'], // All features
    },
};

export class SubscriptionService {
    /**
     * Get subscription by user ID
     */
    static async getSubscriptionByUserId(userId: string | ObjectId | undefined): Promise<ISubscription | null> {
        if (!userId) return null;
        const userIdStr = typeof userId === 'string' ? userId : userId.toString();
        try {
            const subscription = await Subscription.findOne({ userId: userIdStr }).populate('paymentMethodId');
            return subscription;
        } catch (error: any) {
            loggingService.error('Error getting subscription by user ID', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Create default free subscription for new user
     */
    static async createDefaultSubscription(userId: string | ObjectId): Promise<ISubscription> {
        try {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            
            // Check if subscription already exists
            const existingSubscription = await Subscription.findOne({ userId: userIdStr });
            if (existingSubscription) {
                loggingService.info('Subscription already exists for user', { userId: userIdStr });
                return existingSubscription;
            }

            const limits = SUBSCRIPTION_PLAN_LIMITS.free;
            const now = new Date();
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);

            const subscription = new Subscription({
                userId,
                plan: 'free',
                status: 'active',
                startDate: now,
                isTrial: false,
                billing: {
                    amount: 0,
                    currency: 'USD',
                    interval: 'monthly',
                    cancelAtPeriodEnd: false,
                },
                paymentGateway: null,
                limits: {
                    tokensPerMonth: limits.tokensPerMonth,
                    requestsPerMonth: limits.requestsPerMonth,
                    logsPerMonth: limits.logsPerMonth,
                    projects: limits.projects,
                    agentTraces: limits.agentTraces,
                    seats: limits.seats,
                    cortexDailyUsage: {
                        limit: limits.cortexDailyUsage.limit,
                        currentCount: 0,
                        lastResetDate: now,
                    },
                },
                allowedModels: limits.allowedModels,
                features: limits.features,
                usage: {
                    tokensUsed: 0,
                    requestsUsed: 0,
                    logsUsed: 0,
                    agentTracesUsed: 0,
                    optimizationsUsed: 0,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                },
            });

            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'status_change',
                newStatus: 'active',
                newPlan: 'free',
                changedBy: 'system',
                reason: 'Default free subscription created',
            });

            loggingService.info('Default free subscription created', { userId: userIdStr, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error creating default subscription', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Start trial period for a plan
     */
    static async startTrial(userId: string | ObjectId, plan: 'plus' | 'pro', trialDays: number = 14): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            if (subscription.isTrial) {
                throw new AppError('User is already on a trial', 400);
            }

            const limits = SUBSCRIPTION_PLAN_LIMITS[plan];
            const now = new Date();
            const trialEnd = new Date(now);
            trialEnd.setDate(trialEnd.getDate() + trialDays);

            subscription.plan = plan;
            subscription.status = 'trialing';
            subscription.isTrial = true;
            subscription.trialStart = now;
            subscription.trialEnd = trialEnd;
            subscription.limits = {
                tokensPerMonth: limits.tokensPerMonth,
                requestsPerMonth: limits.requestsPerMonth,
                logsPerMonth: limits.logsPerMonth,
                projects: limits.projects,
                agentTraces: limits.agentTraces,
                seats: limits.seats,
                cortexDailyUsage: {
                    limit: limits.cortexDailyUsage.limit,
                    currentCount: subscription.limits.cortexDailyUsage.currentCount,
                    lastResetDate: subscription.limits.cortexDailyUsage.lastResetDate,
                },
            };
            subscription.allowedModels = limits.allowedModels;
            subscription.features = limits.features;

            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'trial_started',
                newPlan: plan,
                newStatus: 'trialing',
                changedBy: 'user',
                reason: `Started ${trialDays}-day trial`,
            });

            loggingService.info('Trial started', { userId: userIdStr, plan, trialDays, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error starting trial', { userId: userIdStr, plan, error: error.message });
            throw error;
        }
    }

    /**
     * Upgrade subscription with payment gateway integration
     */
    static async upgradeSubscription(
        userId: string | ObjectId,
        newPlan: 'plus' | 'pro' | 'enterprise',
        paymentGateway: PaymentGateway,
        paymentMethodId: string | ObjectId,
        billingInfo?: {
            interval?: 'monthly' | 'yearly';
            discountCode?: string;
            gatewaySubscriptionId?: string; // For one-time payments, pass the payment ID directly
        }
    ): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            const oldPlan = subscription.plan;
            const limits = SUBSCRIPTION_PLAN_LIMITS[newPlan];
            const now = new Date();

            // Get payment method
            const paymentMethod = await PaymentMethod.findById(paymentMethodId);
            if (!paymentMethod || paymentMethod.userId.toString() !== userId.toString()) {
                throw new AppError('Payment method not found', 404);
            }

            // Calculate pricing
            const pricing = this.getPlanPricing(newPlan, billingInfo?.interval || 'monthly');
            
            // Apply discount if provided
            let finalAmount = pricing.amount;
            if (billingInfo?.discountCode) {
                try {
                    const codeUpper = billingInfo.discountCode.toUpperCase().trim();
                    const discount = await Discount.findOne({
                        code: codeUpper,
                        isActive: true,
                    });

                    if (discount) {
                        // Validate discount
                        const nowDate = new Date();
                        if (nowDate >= discount.validFrom && nowDate <= discount.validUntil) {
                            if (discount.maxUses === -1 || discount.currentUses < discount.maxUses) {
                                const normalizedPlan = newPlan ? (newPlan as string).toLowerCase() : null;
                                if (discount.applicablePlans.length === 0 || (normalizedPlan && discount.applicablePlans.includes(normalizedPlan as any))) {
                                    if (!discount.minAmount || pricing.amount >= discount.minAmount) {
                                        // Calculate discount
                                        let discountAmount = 0;
                                        if (discount.type === 'percentage') {
                                            discountAmount = (pricing.amount * discount.amount) / 100;
                                        } else {
                                            discountAmount = discount.amount;
                                        }
                                        discountAmount = Math.min(discountAmount, pricing.amount);
                                        finalAmount = Math.max(0, pricing.amount - discountAmount);
                                        
                                        // Store discount info in subscription
                                        subscription.discount = {
                                            code: discount.code,
                                            amount: discountAmount,
                                            type: discount.type,
                                            expiresAt: discount.validUntil,
                                        };
                                        
                                        // Increment discount usage
                                        discount.currentUses += 1;
                                        await discount.save();
                                    }
                                }
                            }
                        }
                    }
                } catch (discountError: any) {
                    loggingService.warn('Error applying discount code during upgrade', {
                        userId: typeof userId === 'string' ? userId : userId.toString(),
                        discountCode: billingInfo.discountCode,
                        error: discountError?.message,
                    });
                    // Continue without discount if validation fails
                }
            }
            
            const proratedAmount = await this.calculateProration(oldPlan, newPlan, subscription.billing.nextBillingDate || now);

            // Create or update subscription in payment gateway
            let gatewaySubscriptionId = subscription.gatewaySubscriptionId;
            
            // If gatewaySubscriptionId is provided (e.g., from payment confirmation), use it directly
            if (billingInfo?.gatewaySubscriptionId) {
                gatewaySubscriptionId = billingInfo.gatewaySubscriptionId;
                loggingService.info('Using provided gateway subscription ID', {
                    userId: typeof userId === 'string' ? userId : userId.toString(),
                    gatewaySubscriptionId,
                    paymentGateway,
                });
            } else if (!gatewaySubscriptionId || subscription.paymentGateway !== paymentGateway) {
                // Create new subscription in gateway
                const gatewayResult = await paymentGatewayManager.createSubscription(
                    paymentGateway,
                    {
                        customerId: paymentMethod.gatewayCustomerId,
                        paymentMethodId: paymentMethod.gatewayPaymentMethodId,
                        planId: `${newPlan}_${billingInfo?.interval || 'monthly'}`,
                        amount: pricing.amount,
                        currency: 'USD',
                        interval: billingInfo?.interval || 'monthly',
                        metadata: {
                            userId: userId.toString(),
                            plan: newPlan,
                        },
                    }
                );

                gatewaySubscriptionId = gatewayResult.subscriptionId;
            } else {
                // Update existing subscription
                await paymentGatewayManager.updateSubscription(paymentGateway, {
                    subscriptionId: gatewaySubscriptionId,
                    amount: pricing.amount,
                    interval: billingInfo?.interval || 'monthly',
                });
            }

            // Update subscription in database
            const periodEnd = new Date(now);
            if (billingInfo?.interval === 'yearly') {
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            } else {
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            }

            subscription.plan = newPlan;
            subscription.status = 'active';
            subscription.isTrial = false;
            subscription.trialStart = undefined;
            subscription.trialEnd = undefined;
            subscription.paymentGateway = paymentGateway;
            subscription.gatewayCustomerId = paymentMethod.gatewayCustomerId;
            subscription.gatewaySubscriptionId = gatewaySubscriptionId;
            subscription.paymentMethodId = paymentMethod._id as any;
            subscription.billing = {
                amount: finalAmount,
                currency: 'USD',
                interval: billingInfo?.interval || 'monthly',
                nextBillingDate: periodEnd,
                billingCycleAnchor: now,
                cancelAtPeriodEnd: false,
                proratedAmount: proratedAmount,
            };
            subscription.limits = {
                tokensPerMonth: limits.tokensPerMonth,
                requestsPerMonth: limits.requestsPerMonth,
                logsPerMonth: limits.logsPerMonth,
                projects: limits.projects,
                agentTraces: limits.agentTraces,
                seats: limits.seats,
                cortexDailyUsage: {
                    limit: limits.cortexDailyUsage.limit,
                    currentCount: subscription.limits.cortexDailyUsage.currentCount,
                    lastResetDate: subscription.limits.cortexDailyUsage.lastResetDate,
                },
            };
            subscription.allowedModels = limits.allowedModels;
            subscription.features = limits.features;
            subscription.usage.currentPeriodStart = now;
            subscription.usage.currentPeriodEnd = periodEnd;

            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'upgrade',
                oldPlan,
                newPlan,
                oldStatus: subscription.status,
                newStatus: 'active',
                changedBy: 'user',
                reason: `Upgraded from ${oldPlan} to ${newPlan}`,
            });

            // Generate invoice for prorated amount if applicable
            if (proratedAmount > 0) {
                await this.generateInvoice(userIdStr, subscription, [
                    {
                        description: `Prorated upgrade from ${oldPlan} to ${newPlan}`,
                        quantity: 1,
                        unitPrice: proratedAmount,
                        total: proratedAmount,
                        type: 'proration',
                    },
                ]);
            }

            loggingService.info('Subscription upgraded', { userId: userIdStr, oldPlan, newPlan, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error upgrading subscription', { userId: userIdStr, newPlan, error: error.message });
            throw error;
        }
    }

    /**
     * Get plan pricing
     */
    static getPlanPricing(plan: 'free' | 'plus' | 'pro' | 'enterprise', interval: 'monthly' | 'yearly'): { amount: number; currency: string } {
        const pricing: Record<string, { monthly: number; yearly: number }> = {
            free: { monthly: 0, yearly: 0 },
            plus: { monthly: 49, yearly: 470.4 }, // 20% off yearly
            pro: { monthly: 499, yearly: 4788.8 }, // 20% off yearly
            enterprise: { monthly: 0, yearly: 0 }, // Custom pricing
        };

        const planPricing = pricing[plan];
        if (!planPricing) {
            throw new AppError('Invalid plan', 400);
        }

        return {
            amount: interval === 'yearly' ? planPricing.yearly : planPricing.monthly,
            currency: 'USD',
        };
    }

    /**
     * Calculate prorated amount for plan change
     */
    static async calculateProration(
        oldPlan: 'free' | 'plus' | 'pro' | 'enterprise',
        newPlan: 'free' | 'plus' | 'pro' | 'enterprise',
        nextBillingDate: Date
    ): Promise<number> {
        if (oldPlan === 'free' || newPlan === 'free') {
            return 0;
        }

        const now = new Date();
        const daysRemaining = Math.ceil((nextBillingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const daysInCycle = 30; // Assuming monthly cycle

        const oldPricing = this.getPlanPricing(oldPlan, 'monthly');
        const newPricing = this.getPlanPricing(newPlan, 'monthly');

        const oldDailyRate = oldPricing.amount / daysInCycle;
        const newDailyRate = newPricing.amount / daysInCycle;
        const proratedAmount = (newDailyRate - oldDailyRate) * daysRemaining;

        return Math.max(0, proratedAmount);
    }

    /**
     * Generate invoice
     */
    static async generateInvoice(
        userId: string | ObjectId,
        subscription: ISubscription,
        lineItems: Array<{
            description: string;
            quantity: number;
            unitPrice: number;
            total: number;
            type: 'plan' | 'overage' | 'discount' | 'proration' | 'tax' | 'seat' | 'other';
        }>
    ): Promise<IInvoice> {
        try {
            const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
            const tax = subtotal * 0.1; // 10% tax (adjust as needed)
            const total = subtotal + tax;

            const now = new Date();
            const dueDate = new Date(now);
            dueDate.setDate(dueDate.getDate() + 30);

            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            const invoice = new Invoice({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                status: 'pending',
                subtotal,
                tax,
                discount: 0,
                total,
                currency: subscription.billing.currency,
                lineItems: lineItems.map(item => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    total: item.total,
                    type: item.type,
                })),
                dueDate,
                paymentGateway: subscription.paymentGateway,
                periodStart: subscription.usage.currentPeriodStart,
                periodEnd: subscription.usage.currentPeriodEnd,
            });

            await invoice.save();
            return invoice;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error generating invoice', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Validate and reserve tokens before operation
     */
    static async validateAndReserveTokens(userId: string | ObjectId, estimatedTokens: number): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        if (subscription.status !== 'active' && subscription.status !== 'trialing') {
            throw new AppError(`Subscription is ${subscription.status}. Please activate your subscription.`, 403);
        }

        const limit = subscription.limits.tokensPerMonth;
        if (limit === -1) {
            return; // Unlimited
        }

        const used = subscription.usage.tokensUsed;
        const available = limit - used;

        if (available < estimatedTokens) {
            throw new AppError(
                `Insufficient token quota. Available: ${available.toLocaleString()}, Required: ${estimatedTokens.toLocaleString()}`,
                403
            );
        }
    }

    /**
     * Consume tokens after operation
     */
    static async consumeTokens(userId: string | ObjectId, actualTokens: number): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        subscription.usage.tokensUsed += actualTokens;
        await subscription.save();

        // Check usage alerts
        await this.checkUsageAlerts(userId);
    }

    /**
     * Check request quota
     */
    static async checkRequestQuota(userId: string | ObjectId): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        if (subscription.status !== 'active' && subscription.status !== 'trialing') {
            throw new AppError(`Subscription is ${subscription.status}. Please activate your subscription.`, 403);
        }

        const limit = subscription.limits.requestsPerMonth;
        if (limit === -1) {
            return; // Unlimited
        }

        const used = subscription.usage.requestsUsed;
        if (used >= limit) {
            throw new AppError(
                `Request quota exceeded. Limit: ${limit.toLocaleString()}, Used: ${used.toLocaleString()}`,
                403
            );
        }
    }

    /**
     * Consume request
     */
    static async consumeRequest(userId: string | ObjectId): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        subscription.usage.requestsUsed += 1;
        await subscription.save();

        // Check usage alerts
        await this.checkUsageAlerts(userId);
    }

    /**
     * Check Cortex daily quota
     */
    static async checkCortexQuota(userId: string | ObjectId): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        const limit = subscription.limits.cortexDailyUsage.limit;
        if (limit === -1) {
            return; // Unlimited
        }

        if (limit === 0) {
            throw new AppError('Cortex Meta-Language is not available on your plan. Please upgrade to Plus or Pro.', 403);
        }

        // Reset daily count if it's a new day
        const lastReset = subscription.limits.cortexDailyUsage.lastResetDate;
        const now = new Date();
        if (now.toDateString() !== lastReset.toDateString()) {
            subscription.limits.cortexDailyUsage.currentCount = 0;
            subscription.limits.cortexDailyUsage.lastResetDate = now;
            await subscription.save();
        }

        const used = subscription.limits.cortexDailyUsage.currentCount;
        if (used >= limit) {
            throw new AppError(
                `Daily Cortex quota exceeded. Limit: ${limit}, Used: ${used}. Resets daily.`,
                403
            );
        }
    }

    /**
     * Consume Cortex usage
     */
    static async consumeCortexUsage(userId: string | ObjectId): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        // Reset if new day
        const lastReset = subscription.limits.cortexDailyUsage.lastResetDate;
        const now = new Date();
        if (now.toDateString() !== lastReset.toDateString()) {
            subscription.limits.cortexDailyUsage.currentCount = 0;
            subscription.limits.cortexDailyUsage.lastResetDate = now;
        }

        subscription.limits.cortexDailyUsage.currentCount += 1;
        await subscription.save();
    }

    /**
     * Check usage alerts (50%, 75%, 90%, 95%, 99% thresholds)
     */
    static async checkUsageAlerts(userId: string | ObjectId): Promise<void> {
        const subscription = await this.getSubscriptionByUserId(userId);
        if (!subscription) {
            return;
        }

        const thresholds = [50, 75, 90, 95, 99];
        const metrics = [
            { name: 'tokens', used: subscription.usage.tokensUsed, limit: subscription.limits.tokensPerMonth },
            { name: 'requests', used: subscription.usage.requestsUsed, limit: subscription.limits.requestsPerMonth },
        ];

        for (const metric of metrics) {
            if (metric.limit === -1) continue; // Unlimited

            const percentage = (metric.used / metric.limit) * 100;
            for (const threshold of thresholds) {
                if (percentage >= threshold && percentage < threshold + 1) {
                    // Trigger alert (will be implemented in notification service)
                    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
                    loggingService.warn(`Usage alert: ${metric.name} at ${threshold}%`, {
                        userId: userIdStr,
                        metric: metric.name,
                        used: metric.used,
                        limit: metric.limit,
                        percentage,
                    });
                    break;
                }
            }
        }
    }

    /**
     * Get available upgrades for current plan
     */
    static getAvailableUpgrades(currentPlan: 'free' | 'plus' | 'pro' | 'enterprise'): Array<'plus' | 'pro' | 'enterprise'> {
        const upgradeMap: Record<string, Array<'plus' | 'pro' | 'enterprise'>> = {
            free: ['plus', 'pro', 'enterprise'],
            plus: ['pro', 'enterprise'],
            pro: ['enterprise'],
            enterprise: [],
        };

        return upgradeMap[currentPlan] || [];
    }

    /**
     * Get plan limits
     */
    static getPlanLimits(plan: 'free' | 'plus' | 'pro' | 'enterprise') {
        return SUBSCRIPTION_PLAN_LIMITS[plan];
    }

    /**
     * Downgrade subscription
     */
    static async downgradeSubscription(
        userId: string | ObjectId,
        newPlan: 'free' | 'plus' | 'pro',
        scheduleForPeriodEnd: boolean = true
    ): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            const oldPlan = subscription.plan;
            const limits = SUBSCRIPTION_PLAN_LIMITS[newPlan];

            if (scheduleForPeriodEnd && subscription.paymentGateway && subscription.gatewaySubscriptionId) {
                // Schedule cancellation at period end in payment gateway
                await paymentGatewayManager.cancelSubscription(
                    subscription.paymentGateway,
                    {
                        subscriptionId: subscription.gatewaySubscriptionId,
                        cancelAtPeriodEnd: true,
                    }
                );

                subscription.billing.cancelAtPeriodEnd = true;
            } else {
                // Immediate downgrade
                subscription.plan = newPlan;
                subscription.limits = {
                    tokensPerMonth: limits.tokensPerMonth,
                    requestsPerMonth: limits.requestsPerMonth,
                    logsPerMonth: limits.logsPerMonth,
                    projects: limits.projects,
                    agentTraces: limits.agentTraces,
                    seats: limits.seats,
                    cortexDailyUsage: {
                        limit: limits.cortexDailyUsage.limit,
                        currentCount: subscription.limits.cortexDailyUsage.currentCount,
                        lastResetDate: subscription.limits.cortexDailyUsage.lastResetDate,
                    },
                };
                subscription.allowedModels = limits.allowedModels;
                subscription.features = limits.features;

                if (newPlan === 'free') {
                    subscription.paymentGateway = null;
                    subscription.gatewaySubscriptionId = undefined;
                    subscription.billing.amount = 0;
                }
            }

            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'downgrade',
                oldPlan,
                newPlan,
                changedBy: 'user',
                reason: `Downgraded from ${oldPlan} to ${newPlan}${scheduleForPeriodEnd ? ' (scheduled for period end)' : ''}`,
            });

            loggingService.info('Subscription downgraded', { userId: userIdStr, oldPlan, newPlan, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error downgrading subscription', { userId: userIdStr, newPlan, error: error.message });
            throw error;
        }
    }

    /**
     * Cancel subscription
     */
    static async cancelSubscription(
        userId: string | ObjectId,
        cancelAtPeriodEnd: boolean = true,
        reason?: string
    ): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            if (subscription.paymentGateway && subscription.gatewaySubscriptionId) {
                await paymentGatewayManager.cancelSubscription(
                    subscription.paymentGateway,
                    {
                        subscriptionId: subscription.gatewaySubscriptionId,
                        cancelAtPeriodEnd,
                        reason,
                    }
                );
            }

            if (cancelAtPeriodEnd) {
                subscription.billing.cancelAtPeriodEnd = true;
                subscription.billing.canceledAt = new Date();
            } else {
                subscription.status = 'canceled';
                subscription.billing.canceledAt = new Date();
            }

            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'cancel',
                oldStatus: subscription.status,
                newStatus: cancelAtPeriodEnd ? subscription.status : 'canceled',
                changedBy: 'user',
                reason: reason || 'User requested cancellation',
            });

            loggingService.info('Subscription canceled', { userId: userIdStr, cancelAtPeriodEnd, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error canceling subscription', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Reactivate canceled subscription
     */
    static async reactivateSubscription(userId: string | ObjectId): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            if (subscription.status !== 'canceled' && !subscription.billing.cancelAtPeriodEnd) {
                throw new AppError('Subscription is not canceled', 400);
            }

            if (subscription.paymentGateway && subscription.gatewaySubscriptionId) {
                await paymentGatewayManager.reactivateSubscription(
                    subscription.paymentGateway,
                    subscription.gatewaySubscriptionId
                );
            }

            subscription.status = 'active';
            subscription.billing.cancelAtPeriodEnd = false;
            subscription.billing.canceledAt = undefined;

            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'reactivate',
                oldStatus: 'canceled',
                newStatus: 'active',
                changedBy: 'user',
                reason: 'User reactivated subscription',
            });

            loggingService.info('Subscription reactivated', { userId: userIdStr, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error reactivating subscription', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Pause subscription
     */
    static async pauseSubscription(userId: string | ObjectId, reason?: string): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            subscription.status = 'paused';
            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'pause',
                oldStatus: 'active',
                newStatus: 'paused',
                changedBy: 'user',
                reason: reason || 'User paused subscription',
            });

            loggingService.info('Subscription paused', { userId: userIdStr, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error pausing subscription', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Resume paused subscription
     */
    static async resumeSubscription(userId: string | ObjectId): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            if (subscription.status !== 'paused') {
                throw new AppError('Subscription is not paused', 400);
            }

            subscription.status = 'active';
            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'resume',
                oldStatus: 'paused',
                newStatus: 'active',
                changedBy: 'user',
                reason: 'User resumed subscription',
            });

            loggingService.info('Subscription resumed', { userId: userIdStr, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error resuming subscription', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Update payment method
     */
    static async updatePaymentMethod(
        userId: string | ObjectId,
        paymentMethodId: string | ObjectId
    ): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            const paymentMethod = await PaymentMethod.findById(paymentMethodId);
            if (!paymentMethod || paymentMethod.userId.toString() !== userId.toString()) {
                throw new AppError('Payment method not found', 404);
            }

            // Update subscription in payment gateway if applicable
            if (subscription.paymentGateway && subscription.gatewaySubscriptionId) {
                await paymentGatewayManager.updateSubscription(subscription.paymentGateway, {
                    subscriptionId: subscription.gatewaySubscriptionId,
                    paymentMethodId: paymentMethod.gatewayPaymentMethodId,
                });
            }

            subscription.paymentMethodId = paymentMethod._id as any;
            subscription.gatewayCustomerId = paymentMethod.gatewayCustomerId;
            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'payment_method_update',
                changedBy: 'user',
                reason: 'Payment method updated',
            });

            loggingService.info('Payment method updated', { userId: userIdStr, paymentMethodId, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error updating payment method', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Update billing cycle (monthly/yearly)
     */
    static async updateBillingCycle(
        userId: string | ObjectId,
        interval: 'monthly' | 'yearly'
    ): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            if (subscription.plan === 'free') {
                throw new AppError('Cannot update billing cycle for free plan', 400);
            }

            const pricing = this.getPlanPricing(subscription.plan, interval);

            // Update subscription in payment gateway if applicable
            if (subscription.paymentGateway && subscription.gatewaySubscriptionId) {
                await paymentGatewayManager.updateSubscription(subscription.paymentGateway, {
                    subscriptionId: subscription.gatewaySubscriptionId,
                    amount: pricing.amount,
                    interval,
                });
            }

            subscription.billing.interval = interval;
            subscription.billing.amount = pricing.amount;
            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'billing_cycle_update',
                changedBy: 'user',
                reason: `Billing cycle changed to ${interval}`,
            });

            loggingService.info('Billing cycle updated', { userId: userIdStr, interval, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error updating billing cycle', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Apply discount code
     */
    static async applyDiscountCode(
        userId: string | ObjectId,
        discountCode: string
    ): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            // Validate discount code against database
            const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
            const codeUpper = discountCode.toUpperCase().trim();
            
            const discount = await Discount.findOne({
                code: codeUpper,
                isActive: true,
            });

            if (!discount) {
                throw new AppError('Invalid or inactive discount code', 400);
            }

            // Check if discount is user-specific and matches
            if (discount.userId) {
                const discountUserIdStr: string = typeof discount.userId === 'string' 
                    ? discount.userId 
                    : String(discount.userId);
                if (discountUserIdStr !== userIdStr) {
                    throw new AppError('This discount code is not available for your account', 403);
                }
            }

            // Check if discount is still valid (date range)
            const now = new Date();
            if (now < discount.validFrom) {
                throw new AppError('Discount code is not yet valid', 400);
            }

            if (now > discount.validUntil) {
                throw new AppError('Discount code has expired', 400);
            }

            // Check if discount has exceeded max uses
            if (discount.maxUses !== -1 && discount.currentUses >= discount.maxUses) {
                throw new AppError('Discount code has reached its maximum usage limit', 400);
            }

            // Check if discount applies to the current plan
            const normalizedPlan = subscription.plan ? (subscription.plan as string).toLowerCase() : null;
            if (discount.applicablePlans.length > 0 && (!normalizedPlan || !discount.applicablePlans.includes(normalizedPlan as any))) {
                throw new AppError(`This discount code is not applicable to your current plan (${subscription.plan})`, 400);
            }

            // Check minimum amount requirement if applicable
            if (discount.minAmount && subscription.billing.amount < discount.minAmount) {
                throw new AppError(`This discount code requires a minimum purchase amount of $${discount.minAmount}`, 400);
            }

            // Check if user already has a discount applied
            if (subscription.discount?.code) {
                throw new AppError('You already have a discount code applied. Please remove it first.', 400);
            }

            // Calculate discount amount based on subscription billing amount
            let discountAmount = 0;
            if (discount.type === 'percentage') {
                discountAmount = (subscription.billing.amount * discount.amount) / 100;
            } else {
                discountAmount = discount.amount;
            }

            // Ensure discount doesn't exceed the subscription amount
            discountAmount = Math.min(discountAmount, subscription.billing.amount);

            // Apply discount to subscription
            subscription.discount = {
                code: discount.code,
                amount: discountAmount,
                type: discount.type,
                expiresAt: discount.validUntil,
            };

            await subscription.save();

            // Increment discount usage count
            discount.currentUses += 1;
            await discount.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'discount_applied',
                changedBy: 'user',
                reason: `Discount code ${discountCode} applied (${discount.type === 'percentage' ? `${discount.amount}%` : `$${discount.amount}`})`,
            });

            loggingService.info('Discount code applied successfully', {
                userId: userIdStr,
                discountCode: codeUpper,
                discountType: discount.type,
                discountAmount: discount.amount,
                calculatedAmount: discountAmount,
                subscriptionId: subscriptionIdStr,
            });

            return subscription;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error applying discount code', {
                userId: userIdStr,
                discountCode,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Remove discount code
     */
    static async removeDiscountCode(userId: string | ObjectId): Promise<ISubscription> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            subscription.discount = undefined;
            await subscription.save();

            // Create subscription history entry
            const subscriptionIdStr = (subscription._id as any).toString();
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            await SubscriptionHistory.create({
                subscriptionId: subscriptionIdStr,
                userId: userIdStr,
                changeType: 'discount_removed',
                changedBy: 'user',
                reason: 'Discount code removed',
            });

            loggingService.info('Discount code removed', { userId: userIdStr, subscriptionId: subscriptionIdStr });
            return subscription;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error removing discount code', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Get billing history
     */
    static async getBillingHistory(
        userId: string | ObjectId,
        limit: number = 10,
        offset: number = 0
    ): Promise<{ invoices: IInvoice[]; total: number }> {
        try {
            const invoices = await Invoice.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(offset)
                .populate('paymentMethodId');

            const total = await Invoice.countDocuments({ userId });

            return { invoices, total };
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error getting billing history', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Get usage analytics
     */
    static async getUsageAnalytics(
        userId: string | ObjectId,
        period: 'daily' | 'weekly' | 'monthly' = 'monthly'
    ): Promise<any> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            // Calculate period dates
            const now = new Date();
            let periodStart: Date;
            let periodEnd: Date = now;

            switch (period) {
                case 'daily':
                    periodStart = new Date(now);
                    periodStart.setHours(0, 0, 0, 0);
                    break;
                case 'weekly':
                    periodStart = new Date(now);
                    periodStart.setDate(now.getDate() - 7);
                    break;
                case 'monthly':
                default:
                    periodStart = subscription.usage.currentPeriodStart;
                    periodEnd = subscription.usage.currentPeriodEnd;
                    break;
            }

            return {
                tokens: {
                    used: subscription.usage.tokensUsed || 0,
                    limit: subscription.limits.tokensPerMonth,
                    percentage: subscription.limits.tokensPerMonth === -1 
                        ? 0 
                        : (subscription.usage.tokensUsed || 0) / subscription.limits.tokensPerMonth * 100,
                },
                requests: {
                    used: subscription.usage.requestsUsed || 0,
                    limit: subscription.limits.requestsPerMonth,
                    percentage: subscription.limits.requestsPerMonth === -1 
                        ? 0 
                        : (subscription.usage.requestsUsed || 0) / subscription.limits.requestsPerMonth * 100,
                },
                logs: {
                    used: subscription.usage.logsUsed || 0,
                    limit: subscription.limits.logsPerMonth,
                    percentage: subscription.limits.logsPerMonth === -1 
                        ? 0 
                        : (subscription.usage.logsUsed || 0) / subscription.limits.logsPerMonth * 100,
                },
                workflows: {
                    used: subscription.usage.agentTracesUsed || 0,
                    limit: subscription.limits.agentTraces,
                    percentage: subscription.limits.agentTraces === -1 
                        ? 0 
                        : (subscription.usage.agentTracesUsed || 0) / subscription.limits.agentTraces * 100,
                },
                cortex: {
                    used: subscription.limits.cortexDailyUsage.currentCount || 0,
                    limit: subscription.limits.cortexDailyUsage.limit,
                    percentage: subscription.limits.cortexDailyUsage.limit === -1 
                        ? 0 
                        : subscription.limits.cortexDailyUsage.limit === 0
                        ? 0
                        : (subscription.limits.cortexDailyUsage.currentCount || 0) / subscription.limits.cortexDailyUsage.limit * 100,
                },
                period: {
                    type: period,
                    start: periodStart,
                    end: periodEnd,
                },
            };
        } catch (error: any) {
            loggingService.error('Error getting usage analytics', { userId: userId.toString(), error: error.message });
            throw error;
        }
    }

    /**
     * Process overage billing
     */
    static async processOverageBilling(userId: string | ObjectId, overageTokens: number): Promise<IInvoice> {
        try {
            const subscription = await this.getSubscriptionByUserId(userId);
            if (!subscription) {
                throw new AppError('Subscription not found', 404);
            }

            if (subscription.plan === 'free' || subscription.plan === 'enterprise') {
                throw new AppError('Overage billing not applicable for this plan', 400);
            }

            const overagePricing = SUBSCRIPTION_PLAN_LIMITS[subscription.plan].overagePricing;
            if (!overagePricing) {
                throw new AppError('Overage pricing not configured for this plan', 400);
            }

            const overageAmount = (overageTokens / 1_000_000) * overagePricing.tokensPer1M;

            const invoice = await this.generateInvoice(userId.toString(), subscription, [
                {
                    description: `Overage: ${(overageTokens / 1_000_000).toFixed(2)}M tokens`,
                    quantity: 1,
                    unitPrice: overageAmount,
                    total: overageAmount,
                    type: 'overage',
                },
            ]);

            // Charge the customer
            if (subscription.paymentGateway && subscription.paymentMethodId) {
                const paymentMethod = await PaymentMethod.findById(subscription.paymentMethodId);
                if (paymentMethod) {
                    await paymentGatewayManager.charge(subscription.paymentGateway, {
                        customerId: paymentMethod.gatewayCustomerId,
                        paymentMethodId: paymentMethod.gatewayPaymentMethodId,
                        amount: overageAmount,
                        currency: 'USD',
                        description: `Overage billing for ${(overageTokens / 1_000_000).toFixed(2)}M tokens`,
                    });

                    invoice.status = 'paid';
                    invoice.paymentDate = new Date();
                    await invoice.save();
                }
            }

            return invoice;
        } catch (error: any) {
            const userIdStr = typeof userId === 'string' ? userId : userId.toString();
            loggingService.error('Error processing overage billing', { userId: userIdStr, error: error.message });
            throw error;
        }
    }

    /**
     * Process failed payments (dunning management)
     */
    static async processFailedPayments(): Promise<void> {
        try {
            // Find subscriptions with past_due status
            const pastDueSubscriptions = await Subscription.find({
                status: 'past_due',
                paymentGateway: { $ne: null },
            }).populate('paymentMethodId');

            for (const subscription of pastDueSubscriptions) {
                if (!subscription.paymentMethodId) continue;

                const paymentMethod = await PaymentMethod.findById(subscription.paymentMethodId);
                if (!paymentMethod) continue;

                try {
                    // Retry payment
                    await paymentGatewayManager.retryFailedPayment(
                        subscription.paymentGateway!,
                        subscription.gatewaySubscriptionId!,
                        paymentMethod.gatewayPaymentMethodId
                    );

                    subscription.status = 'active';
                    await subscription.save();

                    loggingService.info('Failed payment retried successfully', {
                        userId: (subscription.userId as any).toString(),
                        subscriptionId: (subscription._id as any).toString(),
                    });
                } catch (error: any) {
                    loggingService.error('Failed to retry payment', {
                        userId: (subscription.userId as any).toString(),
                        subscriptionId: (subscription._id as any).toString(),
                        error: error.message,
                    });

                    // If multiple failures, mark as unpaid
                    subscription.status = 'unpaid';
                    await subscription.save();
                }
            }
        } catch (error: any) {
            loggingService.error('Error processing failed payments', { error: error.message });
        }
    }

    /**
     * Process scheduled cancellations
     */
    static async processCancellations(): Promise<void> {
        try {
            const now = new Date();
            const subscriptions = await Subscription.find({
                'billing.cancelAtPeriodEnd': true,
                'billing.nextBillingDate': { $lte: now },
            });

            for (const subscription of subscriptions) {
                subscription.status = 'canceled';
                subscription.billing.cancelAtPeriodEnd = false;
                await subscription.save();

                // Create subscription history entry
                await SubscriptionHistory.create({
                    subscriptionId: (subscription._id as any).toString(),
                    userId: (subscription.userId as any).toString(),
                    changeType: 'cancel',
                    oldStatus: 'active',
                    newStatus: 'canceled',
                    changedBy: 'system',
                    reason: 'Scheduled cancellation processed',
                });

                loggingService.info('Scheduled cancellation processed', {
                    userId: (subscription.userId as any).toString(),
                    subscriptionId: (subscription._id as any).toString(),
                });
            }
        } catch (error: any) {
            loggingService.error('Error processing cancellations', { error: error.message });
        }
    }

    /**
     * Process trial expirations
     */
    static async processTrialExpirations(): Promise<void> {
        try {
            const now = new Date();
            const expiredTrials = await Subscription.find({
                isTrial: true,
                trialEnd: { $lte: now },
                status: 'trialing',
            });

            for (const subscription of expiredTrials) {
                // If no payment method, downgrade to free
                if (!subscription.paymentMethodId) {
                    subscription.plan = 'free';
                    subscription.status = 'active';
                    subscription.isTrial = false;
                    subscription.trialEnd = undefined;
                    subscription.paymentGateway = null;
                    subscription.gatewaySubscriptionId = undefined;
                    subscription.billing.amount = 0;

                    const freeLimits = SUBSCRIPTION_PLAN_LIMITS.free;
                    subscription.limits = {
                        tokensPerMonth: freeLimits.tokensPerMonth,
                        requestsPerMonth: freeLimits.requestsPerMonth,
                        logsPerMonth: freeLimits.logsPerMonth,
                        projects: freeLimits.projects,
                        agentTraces: freeLimits.agentTraces,
                        seats: freeLimits.seats,
                        cortexDailyUsage: {
                            limit: freeLimits.cortexDailyUsage.limit,
                            currentCount: 0,
                            lastResetDate: now,
                        },
                    };
                    subscription.allowedModels = freeLimits.allowedModels;
                    subscription.features = freeLimits.features;
                } else {
                    // Attempt to charge for the plan
                    subscription.status = 'past_due';
                }

                await subscription.save();

                // Create subscription history entry
                await SubscriptionHistory.create({
                    subscriptionId: (subscription._id as any).toString(),
                    userId: (subscription.userId as any).toString(),
                    changeType: 'trial_ended',
                    oldStatus: 'trialing',
                    newStatus: subscription.status,
                    changedBy: 'system',
                    reason: 'Trial period expired',
                });

                loggingService.info('Trial expiration processed', {
                    userId: (subscription.userId as any).toString(),
                    subscriptionId: (subscription._id as any).toString(),
                });
            }
        } catch (error: any) {
            loggingService.error('Error processing trial expirations', { error: error.message });
        }
    }

    /**
     * Reset daily Cortex usage (called by cron job)
     */
    static async resetDailyCortexUsage(): Promise<void> {
        try {
            const now = new Date();
            await Subscription.updateMany(
                {},
                {
                    $set: {
                        'limits.cortexDailyUsage.currentCount': 0,
                        'limits.cortexDailyUsage.lastResetDate': now,
                    },
                }
            );
            loggingService.info('Daily Cortex usage reset completed');
        } catch (error: any) {
            loggingService.error('Error resetting daily Cortex usage', { error: error.message });
        }
    }
}
