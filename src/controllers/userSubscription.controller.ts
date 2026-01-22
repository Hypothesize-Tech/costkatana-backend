import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionNotificationService } from '../services/subscriptionNotification.service';
import { updateSubscriptionSchema } from '../utils/validators';

/**
 * Controller for managing user subscriptions
 */
export class UserSubscriptionController {
    /**
     * Authentication validation utility
     */
    private static validateAuthentication(req: any, res: Response): { requestId: string; userId: string } | { requestId: null; userId: null } {
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
            return { requestId: null, userId: null };
        }

        return { requestId, userId };
    }

    // Circuit breaker for database operations (shared for this controller)
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;

    private static isDbCircuitBreakerOpen(): boolean {
        if (UserSubscriptionController.dbFailureCount >= UserSubscriptionController.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - UserSubscriptionController.lastDbFailureTime;
            if (timeSinceLastFailure < UserSubscriptionController.DB_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                UserSubscriptionController.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        UserSubscriptionController.dbFailureCount++;
        UserSubscriptionController.lastDbFailureTime = Date.now();
    }
    static async getSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!subscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const usageAnalytics = await SubscriptionService.getUsageAnalytics(userId);

            res.json({
                success: true,
                data: {
                    ...subscription.toObject(),
                    usageAnalytics,
                },
            });
        } catch (error: any) {
            loggingService.error('Get subscription failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
        return;
    }
    static async updateSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (UserSubscriptionController.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const { plan } = updateSubscriptionSchema.parse(req.body);

            if (!['free', 'plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid subscription plan',
                });
                return;
            }

            // Get current subscription
            const currentSubscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!currentSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            // Determine if this is an upgrade or downgrade
            const planHierarchy = ['free', 'plus', 'pro', 'enterprise'];
            const currentIndex = planHierarchy.indexOf(currentSubscription.plan);
            const newIndex = planHierarchy.indexOf(plan);

            let updatedSubscription;
            if (newIndex > currentIndex) {
                // Upgrade - requires payment gateway
                const { paymentGateway, paymentMethodId } = req.body;
                if (!paymentGateway || !paymentMethodId) {
                    res.status(400).json({
                        success: false,
                        message: 'Payment gateway and payment method required for upgrade',
                    });
                    return;
                }

                updatedSubscription = await SubscriptionService.upgradeSubscription(
                    userId,
                    plan as 'plus' | 'pro' | 'enterprise',
                    paymentGateway,
                    paymentMethodId,
                    { interval: req.body.interval || 'monthly' }
                );

                // Send notification
                const user = await User.findById(userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionUpgradedEmail(
                        user,
                        currentSubscription.plan,
                        plan
                    );
                }
            } else if (newIndex < currentIndex) {
                // Downgrade
                updatedSubscription = await SubscriptionService.downgradeSubscription(
                    userId,
                    plan as 'free' | 'plus' | 'pro',
                    req.body.scheduleForPeriodEnd !== false
                );

                // Send notification
                const user = await User.findById(userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionDowngradedEmail(
                        user,
                        currentSubscription.plan,
                        plan,
                        updatedSubscription.billing.nextBillingDate || new Date()
                    );
                }
            } else {
                // Same plan - no change needed
                updatedSubscription = currentSubscription;
            }

            // Reset failure count on success
            UserSubscriptionController.dbFailureCount = 0;

            res.json({
                success: true,
                message: 'Subscription updated successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            UserSubscriptionController.recordDbFailure();
            loggingService.error('Update subscription failed', {
                requestId,
                userId,
                plan: req.body?.plan,
                error: error.message || 'Unknown error'
            });
            next(error);
        }
        return;
    }
    static async upgradeSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { plan: planRaw, paymentGateway, paymentMethodId, interval, discountCode } = req.body;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!plan || !['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for upgrade',
                });
                return;
            }

            if (!paymentGateway || !paymentMethodId) {
                res.status(400).json({
                    success: false,
                    message: 'Payment gateway and payment method required',
                });
                return;
            }

            const currentSubscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!currentSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan,
                paymentGateway,
                paymentMethodId,
                { interval: interval || 'monthly', discountCode }
            );

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionUpgradedEmail(
                    user,
                    currentSubscription.plan,
                    plan
                );
            }

            res.json({
                success: true,
                message: 'Subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Upgrade subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async downgradeSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { plan, scheduleForPeriodEnd } = req.body;

            if (!['free', 'plus', 'pro'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for downgrade',
                });
                return;
            }

            const currentSubscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!currentSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const updatedSubscription = await SubscriptionService.downgradeSubscription(
                userId,
                plan,
                scheduleForPeriodEnd !== false
            );

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionDowngradedEmail(
                    user,
                    currentSubscription.plan,
                    plan,
                    updatedSubscription.billing.nextBillingDate || new Date()
                );
            }

            res.json({
                success: true,
                message: 'Subscription downgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Downgrade subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async cancelSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { cancelAtPeriodEnd, reason } = req.body;

            const subscription = await SubscriptionService.cancelSubscription(
                userId,
                cancelAtPeriodEnd !== false,
                reason
            );

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionCanceledEmail(
                    user,
                    subscription,
                    new Date()
                );
            }

            res.json({
                success: true,
                message: 'Subscription canceled successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Cancel subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async reactivateSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const subscription = await SubscriptionService.reactivateSubscription(userId);

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionReactivatedEmail(user, subscription);
            }

            res.json({
                success: true,
                message: 'Subscription reactivated successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Reactivate subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async pauseSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { reason } = req.body;
            const subscription = await SubscriptionService.pauseSubscription(userId, reason);

            res.json({
                success: true,
                message: 'Subscription paused successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Pause subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Resume subscription
     * POST /api/user/subscription/resume
     */
    static async resumeSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const subscription = await SubscriptionService.resumeSubscription(userId);

            res.json({
                success: true,
                message: 'Subscription resumed successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Resume subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Update payment method
     * PUT /api/user/subscription/payment-method
     */
    static async updatePaymentMethod(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { paymentMethodId } = req.body;

            if (!paymentMethodId) {
                res.status(400).json({
                    success: false,
                    message: 'Payment method ID required',
                });
                return;
            }

            const subscription = await SubscriptionService.updatePaymentMethod(userId, paymentMethodId);

            res.json({
                success: true,
                message: 'Payment method updated successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Update payment method failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Update billing cycle
     * PUT /api/user/subscription/billing-cycle
     */
    static async updateBillingCycle(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { interval } = req.body;

            if (!['monthly', 'yearly'].includes(interval)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid billing interval. Must be monthly or yearly',
                });
                return;
            }

            const subscription = await SubscriptionService.updateBillingCycle(userId, interval);

            res.json({
                success: true,
                message: 'Billing cycle updated successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Update billing cycle failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Validate discount code (for checkout preview)
     * POST /api/user/subscription/validate-discount
     */
    static async validateDiscountCode(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { code, plan, amount } = req.body;

            if (!code) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code required',
                });
                return;
            }

            const { Discount } = await import('../models/Discount');
            const codeUpper = code.toUpperCase().trim();
            
            const discount = await Discount.findOne({
                code: codeUpper,
                isActive: true,
            });

            if (!discount) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive discount code',
                });
                return;
            }

            // Check if discount is user-specific and matches
            if (discount.userId) {
                const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
                const discountUserIdStr: string = typeof discount.userId === 'string' 
                    ? discount.userId 
                    : String(discount.userId);
                if (discountUserIdStr !== userIdStr) {
                    res.status(403).json({
                        success: false,
                        message: 'This discount code is not available for your account',
                    });
                    return;
                }
            }

            // Check if discount is still valid (date range)
            const now = new Date();
            if (now < discount.validFrom) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code is not yet valid',
                });
                return;
            }

            if (now > discount.validUntil) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code has expired',
                });
                return;
            }

            // Check if discount has exceeded max uses
            if (discount.maxUses !== -1 && discount.currentUses >= discount.maxUses) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code has reached its maximum usage limit',
                });
                return;
            }

            // Check if discount applies to the plan
            // Normalize plan name to lowercase for comparison
            const normalizedPlan = plan ? (plan as string).toLowerCase() : null;
            if (normalizedPlan && discount.applicablePlans.length > 0 && !discount.applicablePlans.includes(normalizedPlan as any)) {
                res.status(400).json({
                    success: false,
                    message: `This discount code is not applicable to ${plan} plan`,
                });
                return;
            }

            // Check minimum amount requirement if applicable
            if (discount.minAmount && amount && amount < discount.minAmount) {
                res.status(400).json({
                    success: false,
                    message: `This discount code requires a minimum purchase amount of $${discount.minAmount}`,
                });
                return;
            }

            // Calculate discount amount
            let discountAmount = 0;
            if (amount) {
                if (discount.type === 'percentage') {
                    discountAmount = (amount * discount.amount) / 100;
                } else {
                    discountAmount = discount.amount;
                }
                // Ensure discount doesn't exceed the amount
                discountAmount = Math.min(discountAmount, amount);
            }

            res.json({
                success: true,
                data: {
                    code: discount.code,
                    type: discount.type,
                    amount: discount.amount,
                    discountAmount: discountAmount,
                    finalAmount: amount ? Math.max(0, amount - discountAmount) : 0,
                },
            });
        } catch (error: any) {
            loggingService.error('Validate discount code failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Apply discount code
     * POST /api/user/subscription/discount
     */
    static async applyDiscountCode(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { code } = req.body;

            if (!code) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code required',
                });
                return;
            }

            const subscription = await SubscriptionService.applyDiscountCode(userId, code);

            res.json({
                success: true,
                message: 'Discount code applied successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Apply discount code failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async getAvailablePlans(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!subscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const availableUpgrades = SubscriptionService.getAvailableUpgrades(subscription.plan);
            const allPlans = ['free', 'plus', 'pro', 'enterprise'] as const;

            const plans = allPlans.map(plan => {
                const limits = SubscriptionService.getPlanLimits(plan);
                const pricing = SubscriptionService.getPlanPricing(plan, 'monthly');
                const yearlyPricing = SubscriptionService.getPlanPricing(plan, 'yearly');

                return {
                    plan,
                    limits,
                    pricing: {
                        monthly: pricing.amount,
                        yearly: yearlyPricing.amount,
                        currency: pricing.currency,
                    },
                    canUpgrade: availableUpgrades.includes(plan as any),
                    isCurrent: subscription.plan === plan,
                };
            });

            res.json({
                success: true,
                data: {
                    currentPlan: subscription.plan,
                    availableUpgrades,
                    plans,
                },
            });
        } catch (error: any) {
            loggingService.error('Get available plans failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async getUsageAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { period } = req.query;
            const analytics = await SubscriptionService.getUsageAnalytics(
                userId,
                (period as 'daily' | 'weekly' | 'monthly') || 'monthly'
            );

            res.json({
                success: true,
                data: analytics,
            });
        } catch (error: any) {
            loggingService.error('Get usage analytics failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async getUserSpending(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { AdminUserAnalyticsService } = await import('../services/adminUserAnalytics.service');
            
            const filters: any = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }
            if (req.query.model) {
                filters.model = req.query.model;
            }
            if (req.query.projectId) {
                filters.projectId = req.query.projectId;
            }

            const userSpending = await AdminUserAnalyticsService.getUserDetailedSpending(userId.toString(), filters);

            if (!userSpending) {
                res.status(404).json({
                    success: false,
                    message: 'User spending data not found'
                });
                return;
            }

            loggingService.info('User spending retrieved', {
                component: 'UserController',
                operation: 'getUserSpending',
                userId,
                requestId
            });

            res.json({
                success: true,
                data: userSpending
            });
        } catch (error: any) {
            loggingService.error('Get user spending failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
    static async getSubscriptionHistory(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserSubscriptionController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { SubscriptionHistory } = await import('../models/SubscriptionHistory');
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!subscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const history = await SubscriptionHistory.find({ subscriptionId: subscription._id })
                .sort({ createdAt: -1 })
                .limit(50);

            res.json({
                success: true,
                data: history,
            });
        } catch (error: any) {
            loggingService.error('Get subscription history failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
}