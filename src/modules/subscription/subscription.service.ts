import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { User } from '../../schemas/user/user.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../../schemas/core/subscription.schema';
import { Invoice } from '../../schemas/billing/invoice.schema';
import { Usage } from '../../schemas/core/usage.schema';
import { PaymentMethod } from '../../schemas/billing/payment-method.schema';
import { Discount } from '../../schemas/billing/discount.schema';
import { SubscriptionHistory } from '../../schemas/billing/subscription-history.schema';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service';
import type { PaymentGatewayType } from '../payment-gateway/payment-gateway.interface';
import { SubscriptionNotificationService } from './subscription-notification.service';
import { getPlanPriceOrNull } from '../../config/plan-pricing.config';
import { generateSecureId } from '../../common/utils/secure-id.util';

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
    features: [
      'advanced_analytics',
      'predictive_analytics',
      'batch_processing',
      'failover',
      'security_moderation',
      'usage_tracking',
      'unified_endpoint',
      'advanced_metrics',
    ],
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
    features: [
      'advanced_analytics',
      'predictive_analytics',
      'batch_processing',
      'failover',
      'security_moderation',
      'usage_tracking',
      'unified_endpoint',
      'advanced_metrics',
      'priority_support',
    ],
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

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<Subscription>,
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PaymentMethod.name)
    private paymentMethodModel: Model<PaymentMethod>,
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
    @InjectModel(SubscriptionHistory.name)
    private subscriptionHistoryModel: Model<SubscriptionHistory>,
    private paymentGatewayService: PaymentGatewayService,
    private subscriptionNotificationService: SubscriptionNotificationService,
  ) {}

  /**
   * Get subscription by user ID
   */
  async getSubscriptionByUserId(userId: string): Promise<Subscription | null> {
    try {
      const subscription = await this.subscriptionModel
        .findOne({ userId })
        .populate('paymentMethodId')
        .exec();

      return subscription;
    } catch (error) {
      this.logger.error('Error getting subscription by user ID', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get subscription formatted for API response (matches frontend Subscription type).
   * Creates default subscription if user has none.
   */
  async getSubscriptionForApi(
    userId: string,
  ): Promise<Record<string, unknown>> {
    let subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      this.logger.debug('No subscription found, creating default', { userId });
      subscription = await this.createDefaultSubscription(userId);
    }

    const subDoc = subscription as SubscriptionDocument & {
      metadata?: {
        cortexDailyUsage?: { currentCount?: number; lastResetDate?: Date };
      };
    };
    const planLimits =
      SUBSCRIPTION_PLAN_LIMITS[
        subscription.plan as keyof typeof SUBSCRIPTION_PLAN_LIMITS
      ] || SUBSCRIPTION_PLAN_LIMITS.free;
    const cortexLimit =
      typeof (planLimits as { cortexDailyUsage?: { limit: number } })
        ?.cortexDailyUsage === 'object'
        ? ((planLimits as { cortexDailyUsage: { limit: number } })
            .cortexDailyUsage?.limit ?? 0)
        : 0;
    const cortex = subDoc.metadata?.cortexDailyUsage ?? {};
    const cortexUsed = cortex.currentCount ?? 0;

    return {
      id: (subDoc as any)._id?.toString(),
      userId: subscription.userId,
      plan: subscription.plan,
      status: subscription.status,
      startDate:
        subscription.currentPeriodStart?.toISOString?.() ??
        new Date().toISOString(),
      endDate: subscription.currentPeriodEnd?.toISOString?.() ?? undefined,
      trialStart:
        (subDoc.metadata as any)?.trialStart?.toISOString?.() ?? undefined,
      trialEnd:
        (subDoc.metadata as any)?.trialEnd?.toISOString?.() ?? undefined,
      isTrial: !!(subDoc.metadata as any)?.isTrial,
      limits: {
        tokensPerMonth:
          subscription.usageLimits?.tokensPerMonth ??
          planLimits.tokensPerMonth ??
          0,
        requestsPerMonth:
          subscription.usageLimits?.requestsPerMonth ??
          planLimits.requestsPerMonth ??
          0,
        logsPerMonth:
          subscription.usageLimits?.logsPerMonth ??
          planLimits.logsPerMonth ??
          0,
        projects: (planLimits as { projects?: number }).projects ?? 1,
        agentTraces: (planLimits as { agentTraces?: number }).agentTraces ?? 10,
        seats: (planLimits as { seats?: number }).seats ?? 1,
        cortexDailyUsage: cortexLimit,
      },
      usage: {
        tokensUsed: subscription.usage?.current?.tokens ?? 0,
        requestsUsed: subscription.usage?.current?.requests ?? 0,
        logsUsed: subscription.usage?.current?.logs ?? 0,
        projectsUsed: 0,
        agentTracesUsed: 0,
        cortexDailyUsage: cortexUsed,
        lastResetDate: cortex.lastResetDate
          ? new Date(cortex.lastResetDate).toISOString()
          : new Date(0).toISOString(),
      },
      billing: subscription.billing
        ? {
            amount: subscription.billing.amount ?? 0,
            currency: subscription.billing.currency ?? 'USD',
            interval: subscription.billing.interval ?? 'monthly',
            nextBillingDate:
              subscription.billing.nextBillingDate?.toISOString?.() ??
              undefined,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
            canceledAt: subscription.cancelledAt?.toISOString?.() ?? undefined,
          }
        : {
            amount: 0,
            currency: 'USD',
            interval: 'monthly',
            cancelAtPeriodEnd: false,
          },
      paymentMethod: subDoc.paymentMethodId
        ? typeof subDoc.paymentMethodId === 'object' &&
          subDoc.paymentMethodId !== null
          ? {
              paymentGateway:
                (subDoc.paymentMethodId as any)?.paymentGateway ?? 'none',
              lastFour: (subDoc.paymentMethodId as any)?.lastFour,
              brand: (subDoc.paymentMethodId as any)?.brand,
            }
          : undefined
        : undefined,
      allowedModels:
        (planLimits as { allowedModels?: string[] }).allowedModels ?? [],
      features:
        subscription.features ??
        (planLimits as { features?: string[] }).features ??
        [],
      createdAt:
        subscription.createdAt?.toISOString?.() ?? new Date().toISOString(),
      updatedAt:
        subscription.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  /**
   * Create default free subscription for new user
   */
  async createDefaultSubscription(
    userId: string,
  ): Promise<SubscriptionDocument> {
    try {
      // Check if subscription already exists
      const existingSubscription = await this.subscriptionModel.findOne({
        userId,
      });
      if (existingSubscription) {
        return existingSubscription;
      }

      const now = new Date();
      const subscription = new this.subscriptionModel({
        userId,
        plan: 'free',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
        cancelAtPeriodEnd: false,
        usageLimits: SUBSCRIPTION_PLAN_LIMITS.free,
        features: SUBSCRIPTION_PLAN_LIMITS.free.features,
        metadata: {
          autoCreated: true,
          createdAt: now,
        },
      });

      await subscription.save();

      this.logger.log('Created default free subscription', {
        userId,
        subscriptionId: (subscription as any)._id?.toString(),
        plan: 'free',
      });

      return subscription;
    } catch (error) {
      this.logger.error('Error creating default subscription', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Create subscription
   */
  async createSubscription(
    userId: string,
    plan: string,
    paymentMethodId?: string,
  ): Promise<Subscription> {
    try {
      // Validate plan exists
      if (
        !SUBSCRIPTION_PLAN_LIMITS[plan as keyof typeof SUBSCRIPTION_PLAN_LIMITS]
      ) {
        throw new BadRequestException(`Invalid plan: ${plan}`);
      }

      // Check if user already has an active subscription
      const existingSubscription = await this.subscriptionModel.findOne({
        userId,
        status: { $in: ['active', 'trialing'] },
      });

      if (existingSubscription) {
        throw new BadRequestException(
          'User already has an active subscription',
        );
      }

      const now = new Date();
      const planLimits =
        SUBSCRIPTION_PLAN_LIMITS[plan as keyof typeof SUBSCRIPTION_PLAN_LIMITS];

      const subscription = new this.subscriptionModel({
        userId,
        plan,
        status: plan === 'free' ? 'active' : 'trialing',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
        cancelAtPeriodEnd: false,
        usageLimits: planLimits,
        features: planLimits.features,
        paymentMethodId,
        metadata: {
          createdAt: now,
          source: 'api',
        },
      });

      await subscription.save();

      this.logger.log('Created subscription', {
        userId,
        subscriptionId: (subscription as any)._id?.toString(),
        plan,
        status: subscription.status,
      });

      return subscription;
    } catch (error) {
      this.logger.error('Error creating subscription', {
        userId,
        plan,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Upgrade subscription
   */
  async upgradeSubscription(
    userId: string,
    newPlan: string,
    paymentGateway?: 'stripe' | 'razorpay' | 'paypal',
    paymentMethodId?: string,
    options?: {
      interval?: 'monthly' | 'yearly';
      discountCode?: string;
      prorationMode?: 'immediate' | 'next_cycle';
    },
  ): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      // Validate new plan
      if (
        !SUBSCRIPTION_PLAN_LIMITS[
          newPlan as keyof typeof SUBSCRIPTION_PLAN_LIMITS
        ]
      ) {
        throw new BadRequestException(`Invalid plan: ${newPlan}`);
      }

      const oldPlan = subscription.plan;
      const newPlanLimits =
        SUBSCRIPTION_PLAN_LIMITS[
          newPlan as keyof typeof SUBSCRIPTION_PLAN_LIMITS
        ];

      // Update subscription
      const updateData: any = {
        plan: newPlan,
        usageLimits: newPlanLimits,
        features: newPlanLimits.features,
        metadata: {
          ...subscription.metadata,
          upgradedFrom: oldPlan,
          upgradedAt: new Date(),
          upgradeMode: options?.prorationMode || 'next_cycle',
        },
      };

      // Update payment method if provided
      if (paymentMethodId) {
        updateData.paymentMethodId = paymentMethodId;
      }

      // Update billing interval if provided
      if (options?.interval) {
        updateData.billing = {
          ...subscription.billing,
          interval: options.interval,
          updatedAt: new Date(),
        };
      }

      // Apply discount if provided
      if (options?.discountCode) {
        const discountValidation = await this.validateDiscountCode(
          options.discountCode,
          newPlan,
        );
        updateData.discount = {
          code: discountValidation.code,
          type: discountValidation.type,
          amount: discountValidation.amount,
          appliedAt: new Date(),
        };
        // Increment discount usage
        await this.discountModel.findOneAndUpdate(
          { code: options.discountCode.toUpperCase().trim() },
          { $inc: { currentUses: 1 } },
        );
      }

      // If immediate upgrade, reset period
      if (options?.prorationMode === 'immediate') {
        const now = new Date();
        updateData.currentPeriodStart = now;
        updateData.currentPeriodEnd = new Date(
          now.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(subscription._id, updateData, { new: true })
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to update subscription');
      }

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'upgrade',
        oldPlan,
        newPlan,
        oldStatus: subscription.status,
        newStatus: updatedSubscription.status,
        changedBy: 'user',
        metadata: {
          paymentGateway,
          paymentMethodId,
          interval: options?.interval,
          discountCode: options?.discountCode,
          prorationMode: options?.prorationMode,
        },
      });

      this.logger.log('Upgraded subscription', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        oldPlan,
        newPlan,
        paymentGateway,
        paymentMethodId,
        options,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error upgrading subscription', {
        userId,
        newPlan,
        paymentGateway,
        paymentMethodId,
        options,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    userId: string,
    cancelAtPeriodEnd: boolean = true,
    reason?: string,
  ): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      const updateData: any = {
        cancelAtPeriodEnd,
        metadata: {
          ...subscription.metadata,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      };

      // If immediate cancellation, set status to cancelled
      if (!cancelAtPeriodEnd) {
        updateData.status = 'cancelled';
        updateData.cancelledAt = new Date();
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(subscription._id, updateData, { new: true })
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to cancel subscription');
      }

      this.logger.log('Cancelled subscription', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        cancelAtPeriodEnd,
        immediate: !cancelAtPeriodEnd,
        reason,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error cancelling subscription', {
        userId,
        cancelAtPeriodEnd,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Record usage
   */
  async recordUsage(
    userId: string,
    usage: {
      tokens: number;
      requests: number;
      cost: number;
      metadata?: any;
    },
  ): Promise<void> {
    try {
      const subscription = await this.getSubscriptionByUserId(userId);
      if (!subscription) {
        this.logger.warn('No subscription found for usage recording', {
          userId,
        });
        return;
      }

      // Update subscription usage counters
      await this.subscriptionModel.findByIdAndUpdate(
        (subscription as any)._id,
        {
          $inc: {
            'usage.current.tokens': usage.tokens,
            'usage.current.requests': usage.requests,
            'usage.current.cost': usage.cost,
          },
          $set: {
            'usage.lastActivity': new Date(),
          },
        },
      );

      // Create usage record
      const usageRecord = new this.usageModel({
        userId,
        subscriptionId: (subscription as any)._id,
        tokens: usage.tokens,
        requests: usage.requests,
        cost: usage.cost,
        metadata: usage.metadata,
        recordedAt: new Date(),
      });

      await usageRecord.save();

      this.logger.debug('Recorded usage', {
        userId,
        subscriptionId: (subscription as any)._id?.toString(),
        tokens: usage.tokens,
        requests: usage.requests,
        cost: usage.cost,
      });
    } catch (error) {
      this.logger.error('Error recording usage', {
        userId,
        usage,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - usage recording failures shouldn't break the main flow
    }
  }

  /**
   * Check usage limits
   */
  async checkUsageLimits(
    userId: string,
    type: 'tokens' | 'requests' | 'logs',
  ): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
  }> {
    try {
      const subscription = await this.getSubscriptionByUserId(userId);
      if (!subscription) {
        return {
          allowed: false,
          current: 0,
          limit: 0,
          remaining: 0,
        };
      }

      const current = subscription.usage?.current?.[type] || 0;
      const limit = subscription.usageLimits?.[`${type}PerMonth`] || 0;

      // Unlimited plans have -1 as limit
      const isUnlimited = limit === -1;
      const allowed = isUnlimited || current < limit;
      const remaining = isUnlimited ? -1 : Math.max(0, limit - current);

      return {
        allowed,
        current,
        limit,
        remaining,
      };
    } catch (error) {
      this.logger.error('Error checking usage limits', {
        userId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Default to allowing usage if check fails
      return {
        allowed: true,
        current: 0,
        limit: -1,
        remaining: -1,
      };
    }
  }

  /**
   * Reset monthly usage
   */
  async resetMonthlyUsage(): Promise<void> {
    try {
      const result = await this.subscriptionModel.updateMany(
        {
          status: 'active',
          currentPeriodEnd: { $lt: new Date() },
        },
        {
          $set: {
            'usage.current': {
              tokens: 0,
              requests: 0,
              logs: 0,
              cost: 0,
            },
            'usage.previous': '$usage.current',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
          $unset: {
            cancelAtPeriodEnd: 1,
          },
        },
      );

      // Handle cancelled subscriptions
      await this.subscriptionModel.updateMany(
        {
          status: 'active',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { $lt: new Date() },
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
          },
        },
      );

      this.logger.log('Reset monthly usage for subscriptions', {
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      this.logger.error('Error resetting monthly usage', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(userId: string): Promise<{
    current: {
      tokens: number;
      requests: number;
      logs: number;
      cost: number;
    };
    limits: {
      tokensPerMonth: number;
      requestsPerMonth: number;
      logsPerMonth: number;
    };
    remaining: {
      tokens: number;
      requests: number;
      logs: number;
    };
    period: {
      start: Date;
      end: Date;
    };
  }> {
    try {
      const subscription = await this.getSubscriptionByUserId(userId);
      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      const usage = subscription.usage?.current || {
        tokens: 0,
        requests: 0,
        logs: 0,
        cost: 0,
      };
      const limits = {
        tokensPerMonth: subscription.usageLimits?.tokensPerMonth || 0,
        requestsPerMonth: subscription.usageLimits?.requestsPerMonth || 0,
        logsPerMonth: subscription.usageLimits?.logsPerMonth || 0,
      };

      const remaining = {
        tokens:
          limits.tokensPerMonth === -1
            ? -1
            : Math.max(0, limits.tokensPerMonth - usage.tokens),
        requests:
          limits.requestsPerMonth === -1
            ? -1
            : Math.max(0, limits.requestsPerMonth - usage.requests),
        logs:
          limits.logsPerMonth === -1
            ? -1
            : Math.max(0, limits.logsPerMonth - usage.logs),
      };

      return {
        current: usage,
        limits,
        remaining,
        period: {
          start: subscription.currentPeriodStart || new Date(),
          end: subscription.currentPeriodEnd || new Date(),
        },
      };
    } catch (error) {
      this.logger.error('Error getting usage stats', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check if feature is available for user's plan
   */
  async isFeatureAvailable(userId: string, feature: string): Promise<boolean> {
    const subscription = await this.getSubscriptionByUserId(userId);
    const plan = subscription?.plan ?? 'free';
    const planLimits = SUBSCRIPTION_PLAN_LIMITS[plan];
    const planFeatures =
      planLimits?.features ?? SUBSCRIPTION_PLAN_LIMITS.free.features;

    // Subscription document may override with stored features
    const features = subscription?.features?.length
      ? subscription.features
      : planFeatures;

    if (features.includes('*')) return true;
    const hasFeature = features.includes(feature);
    this.logger.debug('Feature availability check', {
      userId,
      feature,
      hasFeature,
    });
    return hasFeature;
  }

  /**
   * Get available models for user's plan
   */
  async getAvailableModels(userId: string): Promise<string[]> {
    try {
      const subscription = await this.getSubscriptionByUserId(userId);
      if (!subscription) {
        return SUBSCRIPTION_PLAN_LIMITS.free.allowedModels;
      }

      const planLimits = SUBSCRIPTION_PLAN_LIMITS[subscription.plan];
      return planLimits?.allowedModels || [];
    } catch (error) {
      this.logger.error('Error getting available models', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Calculate prorated amount for plan change
   */
  calculateProration(
    oldPlan: keyof typeof SUBSCRIPTION_PLAN_LIMITS,
    newPlan: keyof typeof SUBSCRIPTION_PLAN_LIMITS,
    nextBillingDate: Date,
  ): number {
    if (oldPlan === 'free' || newPlan === 'free') {
      return 0;
    }

    const now = new Date();
    const daysRemaining = Math.ceil(
      (nextBillingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    const daysInCycle = 30; // Assuming monthly cycle

    const oldPricing = this.getPlanPricing(oldPlan, 'monthly');
    const newPricing = this.getPlanPricing(newPlan, 'monthly');

    const oldDailyRate = oldPricing.amount / daysInCycle;
    const newDailyRate = newPricing.amount / daysInCycle;
    const proratedAmount = (newDailyRate - oldDailyRate) * daysRemaining;

    return Math.max(0, proratedAmount);
  }

  /**
   * Process payment for subscription via payment gateway (Stripe, etc.).
   * paymentMethodId is the internal PaymentMethod document _id.
   */
  async processPayment(
    userId: string,
    amount: number,
    paymentMethodId: string,
    description: string,
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    try {
      if (amount <= 0) {
        return { success: true, transactionId: undefined };
      }

      this.logger.log('Processing payment via gateway', {
        userId,
        amount,
        paymentMethodId,
        description,
      });

      const paymentMethod = await this.paymentMethodModel
        .findOne({ _id: paymentMethodId, userId })
        .exec();

      if (!paymentMethod) {
        this.logger.warn('Payment method not found or access denied', {
          userId,
          paymentMethodId,
        });
        return {
          success: false,
          error: 'Payment method not found',
        };
      }

      const gateway = paymentMethod.gateway as PaymentGatewayType;
      if (!this.paymentGatewayService.isGatewayAvailable(gateway)) {
        this.logger.warn('Payment gateway not available', {
          userId,
          gateway,
        });
        return {
          success: false,
          error: `Payment gateway ${gateway} is not available`,
        };
      }

      const chargeResult = await this.paymentGatewayService.charge(gateway, {
        customerId: paymentMethod.gatewayCustomerId,
        paymentMethodId: paymentMethod.gatewayPaymentMethodId,
        amount,
        currency: 'USD',
        description,
        metadata: {
          userId,
          internalPaymentMethodId: paymentMethodId,
        },
      });

      if (
        chargeResult.status !== 'succeeded' &&
        chargeResult.status !== 'pending'
      ) {
        this.logger.warn('Gateway charge failed', {
          userId,
          amount,
          gateway,
          status: chargeResult.status,
        });
        return {
          success: false,
          error: 'Payment was not successful',
        };
      }

      if (description.includes('Overage') || description.includes('overage')) {
        await this.recordUsage(userId, {
          tokens: 0,
          requests: 0,
          cost: amount,
          metadata: {
            paymentId: chargeResult.transactionId,
            description,
          },
        });
      }

      this.logger.log('Payment processed successfully', {
        userId,
        amount,
        paymentMethodId,
        transactionId: chargeResult.transactionId,
        gateway,
        status: chargeResult.status,
      });

      return {
        success: true,
        transactionId: chargeResult.transactionId,
      };
    } catch (error) {
      this.logger.error('Payment processing failed', {
        userId,
        amount,
        paymentMethodId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment failed',
      };
    }
  }

  /**
   * Generate invoice
   */
  async generateInvoice(
    userId: string,
    subscriptionId: string,
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
      type: string;
    }>,
    paymentMethodId?: string,
  ): Promise<Invoice> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
      const taxAmount = totalAmount * 0.1; // 10% tax
      const finalAmount = totalAmount + taxAmount;

      const invoiceNumber = generateSecureId('INV').replace('_', '-');

      const invoice = new this.invoiceModel({
        invoiceNumber,
        userId,
        subscriptionId,
        items,
        subtotal: totalAmount,
        tax: taxAmount,
        total: finalAmount,
        currency: 'USD',
        status: 'pending',
        paymentMethodId,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        metadata: {
          generatedAt: new Date(),
          source: 'subscription_service',
        },
      });

      await invoice.save();

      // Auto-pay invoice if payment method is provided
      if (paymentMethodId && finalAmount > 0) {
        try {
          const paymentResult = await this.processPayment(
            userId,
            finalAmount,
            paymentMethodId,
            `Invoice ${invoiceNumber} payment`,
          );

          if (paymentResult.success) {
            invoice.status = 'paid';
            invoice.paymentDate = new Date();
            await invoice.save();

            this.logger.log('Invoice auto-paid successfully', {
              userId,
              invoiceId: invoice._id?.toString(),
              invoiceNumber,
              amount: finalAmount,
              transactionId: paymentResult.transactionId,
            });
          } else {
            this.logger.warn('Invoice auto-payment failed', {
              userId,
              invoiceId: invoice._id?.toString(),
              invoiceNumber,
              amount: finalAmount,
              error: paymentResult.error,
            });
          }
        } catch (paymentError) {
          this.logger.error('Error during invoice auto-payment', {
            userId,
            invoiceId: invoice._id?.toString(),
            invoiceNumber,
            error:
              paymentError instanceof Error
                ? paymentError.message
                : 'Unknown error',
          });
          // Invoice remains pending if payment fails
        }
      }

      this.logger.log('Invoice generated', {
        userId,
        invoiceId: invoice._id?.toString(),
        invoiceNumber,
        total: finalAmount,
        status: invoice.status,
      });

      return invoice;
    } catch (error) {
      this.logger.error('Error generating invoice', {
        userId,
        subscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Cancel subscription with refund calculation
   */
  async cancelSubscriptionWithRefund(
    userId: string,
    cancelAtPeriodEnd: boolean = true,
    refundType: 'prorated' | 'full' | 'none' = 'prorated',
  ): Promise<{
    subscription: Subscription;
    refundAmount?: number;
    refundProcessed?: boolean;
  }> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      let refundAmount: number | undefined;
      let refundProcessed = false;

      // Calculate refund if not cancelling at period end
      if (!cancelAtPeriodEnd && refundType !== 'none') {
        const now = new Date();
        const periodEnd = subscription.currentPeriodEnd || new Date();
        const daysRemaining = Math.max(
          0,
          Math.ceil(
            (periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          ),
        );
        const dailyRate =
          subscription.plan === 'free'
            ? 0
            : this.getPlanPricing(
                subscription.plan as keyof typeof SUBSCRIPTION_PLAN_LIMITS,
                'monthly',
              ).amount / 30;

        if (refundType === 'full') {
          refundAmount = dailyRate * 30; // Full month refund
        } else {
          refundAmount = dailyRate * daysRemaining; // Prorated refund
        }

        // Process refund via payment gateway when amount > 0
        if (refundAmount > 0) {
          try {
            const subscriptionId = (subscription as any)._id;

            const recentPaidInvoice = await this.invoiceModel
              .findOne({
                userId,
                subscriptionId,
                status: 'paid',
                gatewayTransactionId: { $exists: true, $nin: [null, ''] },
                paymentGateway: { $in: ['stripe', 'razorpay', 'paypal'] },
              })
              .sort({ createdAt: -1 })
              .limit(1)
              .exec();

            if (
              recentPaidInvoice &&
              recentPaidInvoice.gatewayTransactionId &&
              recentPaidInvoice.paymentGateway &&
              this.paymentGatewayService.isGatewayAvailable(
                recentPaidInvoice.paymentGateway as PaymentGatewayType,
              )
            ) {
              const refundResult = await this.paymentGatewayService.refund(
                recentPaidInvoice.paymentGateway as PaymentGatewayType,
                {
                  transactionId: recentPaidInvoice.gatewayTransactionId,
                  amount: Math.min(refundAmount, recentPaidInvoice.total),
                  reason: `Subscription cancellation refund (${refundType})`,
                  metadata: {
                    userId,
                    subscriptionId: subscriptionId?.toString(),
                    refundType,
                    originalInvoiceId: (
                      recentPaidInvoice as any
                    )._id?.toString(),
                  },
                },
              );

              if (
                refundResult.status === 'succeeded' ||
                refundResult.status === 'pending'
              ) {
                refundProcessed = true;

                recentPaidInvoice.status = 'refunded';
                await recentPaidInvoice.save();

                const creditInvoice = new this.invoiceModel({
                  invoiceNumber: generateSecureId('CR').replace('_', '-'),
                  userId,
                  subscriptionId,
                  lineItems: [
                    {
                      description: `Credit: Refund for subscription cancellation (${refundType})`,
                      quantity: 1,
                      unitPrice: -refundResult.amount,
                      total: -refundResult.amount,
                      type: 'other',
                    },
                  ],
                  subtotal: -refundResult.amount,
                  tax: 0,
                  discount: 0,
                  total: -refundResult.amount,
                  currency: 'USD',
                  status:
                    refundResult.status === 'succeeded'
                      ? 'refunded'
                      : 'pending',
                  paymentGateway: recentPaidInvoice.paymentGateway,
                  gatewayTransactionId: refundResult.refundId,
                  dueDate: new Date(),
                  periodStart: subscription.currentPeriodStart,
                  periodEnd: subscription.currentPeriodEnd,
                  metadata: {
                    type: 'refund_credit',
                    refundType,
                    originalInvoiceId: (
                      recentPaidInvoice as any
                    )._id?.toString(),
                    gatewayRefundId: refundResult.refundId,
                  },
                });
                await creditInvoice.save();

                this.logger.log('Refund processed via payment gateway', {
                  userId,
                  subscriptionId: subscriptionId?.toString(),
                  refundAmount: refundResult.amount,
                  refundType,
                  gateway: recentPaidInvoice.paymentGateway,
                  refundId: refundResult.refundId,
                  status: refundResult.status,
                });
              } else {
                this.logger.warn('Payment gateway refund failed', {
                  userId,
                  subscriptionId: subscriptionId?.toString(),
                  refundAmount,
                  refundType,
                  gateway: recentPaidInvoice.paymentGateway,
                  status: refundResult.status,
                });
              }
            } else {
              if (!recentPaidInvoice) {
                this.logger.debug(
                  'No paid invoice with gateway transaction for refund',
                  {
                    userId,
                    subscriptionId: (subscription as any)._id?.toString(),
                  },
                );
              } else if (
                !this.paymentGatewayService.isGatewayAvailable(
                  (recentPaidInvoice.paymentGateway as PaymentGatewayType) ??
                    'stripe',
                )
              ) {
                this.logger.warn('Payment gateway not available for refund', {
                  userId,
                  subscriptionId: (subscription as any)._id?.toString(),
                  gateway: recentPaidInvoice.paymentGateway,
                });
              }
            }
          } catch (refundError) {
            this.logger.error('Error processing refund via payment gateway', {
              userId,
              subscriptionId: (subscription as any)._id?.toString(),
              refundAmount,
              refundType,
              error:
                refundError instanceof Error
                  ? refundError.message
                  : 'Unknown error',
            });
          }
        }
      }

      // Update subscription
      const updateData: any = {
        cancelAtPeriodEnd,
        metadata: {
          ...subscription.metadata,
          cancelledAt: new Date(),
          cancellationReason: 'user_requested',
          refundAmount,
          refundProcessed,
        },
      };

      if (!cancelAtPeriodEnd) {
        updateData.status = 'cancelled';
        updateData.cancelledAt = new Date();
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(subscription._id, updateData, { new: true })
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to cancel subscription');
      }

      this.logger.log('Subscription cancelled with refund calculation', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        cancelAtPeriodEnd,
        refundAmount,
        refundProcessed,
      });

      return {
        subscription: updatedSubscription,
        refundAmount,
        refundProcessed,
      };
    } catch (error) {
      this.logger.error('Error cancelling subscription with refund', {
        userId,
        cancelAtPeriodEnd,
        refundType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get billing history
   */
  async getBillingHistory(
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<{
    invoices: Invoice[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> {
    try {
      const page = options?.page || 1;
      const limit = options?.limit || 20;
      const skip = (page - 1) * limit;

      const query: any = { userId };
      if (options?.startDate || options?.endDate) {
        query.createdAt = {};
        if (options.startDate) query.createdAt.$gte = options.startDate;
        if (options.endDate) query.createdAt.$lte = options.endDate;
      }

      const [invoices, total] = await Promise.all([
        this.invoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.invoiceModel.countDocuments(query).exec(),
      ]);

      return {
        invoices,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error('Error getting billing history', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Reactivate cancelled subscription
   */
  async reactivateSubscription(userId: string): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'cancelled',
        cancelAtPeriodEnd: true,
      });

      if (!subscription) {
        throw new NotFoundException('Cancelled subscription not found');
      }

      // Check if still within the grace period
      const now = new Date();
      const periodEnd = subscription.currentPeriodEnd;
      if (!periodEnd || periodEnd < now) {
        throw new BadRequestException(
          'Subscription reactivation period has expired',
        );
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(
          subscription._id,
          {
            $unset: {
              cancelAtPeriodEnd: 1,
              cancelledAt: 1,
            },
            metadata: {
              ...subscription.metadata,
              reactivatedAt: new Date(),
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to reactivate subscription');
      }

      this.logger.log('Subscription reactivated', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error reactivating subscription', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Downgrade subscription
   */
  async downgradeSubscription(
    userId: string,
    newPlan: 'free' | 'plus' | 'pro',
    scheduleForPeriodEnd: boolean = true,
  ): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      // Validate new plan
      if (!SUBSCRIPTION_PLAN_LIMITS[newPlan]) {
        throw new BadRequestException(`Invalid plan: ${newPlan}`);
      }

      const oldPlan = subscription.plan;
      const newPlanLimits = SUBSCRIPTION_PLAN_LIMITS[newPlan];

      const updateData: any = {
        metadata: {
          ...subscription.metadata,
          downgradedFrom: oldPlan,
          downgradedAt: new Date(),
          scheduledDowngrade: scheduleForPeriodEnd,
        },
      };

      if (scheduleForPeriodEnd) {
        // Schedule downgrade for period end
        updateData.scheduledPlanChange = {
          newPlan,
          effectiveDate: subscription.currentPeriodEnd,
        };
      } else {
        // Immediate downgrade
        updateData.plan = newPlan;
        updateData.usageLimits = newPlanLimits;
        updateData.features = newPlanLimits.features;
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(subscription._id, updateData, { new: true })
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to downgrade subscription');
      }

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'downgrade',
        oldPlan,
        newPlan,
        oldStatus: subscription.status,
        newStatus: updatedSubscription.status,
        changedBy: 'user',
        metadata: {
          scheduledForPeriodEnd: scheduleForPeriodEnd,
          effectiveDate: scheduleForPeriodEnd
            ? subscription.currentPeriodEnd
            : new Date(),
        },
      });

      this.logger.log('Downgraded subscription', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        oldPlan,
        newPlan,
        scheduled: scheduleForPeriodEnd,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error downgrading subscription', {
        userId,
        newPlan,
        scheduleForPeriodEnd,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Pause subscription
   */
  async pauseSubscription(
    userId: string,
    reason?: string,
  ): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(
          subscription._id,
          {
            status: 'paused',
            metadata: {
              ...subscription.metadata,
              pausedAt: new Date(),
              pauseReason: reason,
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to pause subscription');
      }

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'pause',
        oldStatus: subscription.status,
        newStatus: 'paused',
        changedBy: 'user',
        reason,
      });

      this.logger.log('Paused subscription', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        reason,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error pausing subscription', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Resume subscription
   */
  async resumeSubscription(userId: string): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'paused',
      });

      if (!subscription) {
        throw new NotFoundException('Paused subscription not found');
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(
          subscription._id,
          {
            status: 'active',
            metadata: {
              ...subscription.metadata,
              resumedAt: new Date(),
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to resume subscription');
      }

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'resume',
        oldStatus: subscription.status,
        newStatus: 'active',
        changedBy: 'user',
      });

      this.logger.log('Resumed subscription', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error resuming subscription', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      // Verify payment method exists and belongs to user
      const paymentMethod = await this.paymentMethodModel.findOne({
        _id: paymentMethodId,
        userId,
      });

      if (!paymentMethod) {
        throw new NotFoundException('Payment method not found');
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(
          subscription._id,
          {
            paymentMethodId,
            metadata: {
              ...subscription.metadata,
              paymentMethodUpdatedAt: new Date(),
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to update payment method');
      }

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'payment_method_update',
        changedBy: 'user',
        metadata: {
          oldPaymentMethodId: subscription.paymentMethodId,
          newPaymentMethodId: paymentMethodId,
        },
      });

      this.logger.log('Updated payment method', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        paymentMethodId,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error updating payment method', {
        userId,
        paymentMethodId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Update billing cycle
   */
  async updateBillingCycle(
    userId: string,
    interval: 'monthly' | 'yearly',
  ): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(
          subscription._id,
          {
            billing: {
              ...subscription.billing,
              interval,
              updatedAt: new Date(),
            },
            metadata: {
              ...subscription.metadata,
              billingCycleUpdatedAt: new Date(),
              oldInterval: subscription.billing?.interval,
              newInterval: interval,
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to update billing cycle');
      }

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'billing_cycle_update',
        changedBy: 'user',
        metadata: {
          oldInterval: subscription.billing?.interval,
          newInterval: interval,
        },
      });

      this.logger.log('Updated billing cycle', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        interval,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error updating billing cycle', {
        userId,
        interval,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Validate discount code
   */
  async validateDiscountCode(
    code: string,
    plan?: string,
    amount?: number,
  ): Promise<{
    code: string;
    type: 'percentage' | 'fixed';
    amount: number;
    discountAmount: number;
    finalAmount: number;
  }> {
    try {
      const codeUpper = code.toUpperCase().trim();

      const discount = await this.discountModel.findOne({
        code: codeUpper,
        isActive: true,
      });

      if (!discount) {
        throw new BadRequestException('Invalid or inactive discount code');
      }

      // Check if discount is still valid (date range)
      const now = new Date();
      if (now < discount.validFrom) {
        throw new BadRequestException('Discount code is not yet valid');
      }

      if (now > discount.validUntil) {
        throw new BadRequestException('Discount code has expired');
      }

      // Check if discount has exceeded max uses
      if (discount.maxUses !== -1 && discount.currentUses >= discount.maxUses) {
        throw new BadRequestException(
          'Discount code has reached its maximum usage limit',
        );
      }

      // Check if discount applies to the plan
      if (
        plan &&
        discount.applicablePlans.length > 0 &&
        !discount.applicablePlans.includes(plan as any)
      ) {
        throw new BadRequestException(
          `This discount code is not applicable to ${plan} plan`,
        );
      }

      // Check minimum amount requirement if applicable
      if (discount.minAmount && amount && amount < discount.minAmount) {
        throw new BadRequestException(
          `This discount code requires a minimum purchase amount of $${discount.minAmount}`,
        );
      }

      // Calculate discount amount
      let discountAmount = 0;
      if (amount) {
        if (discount.type === 'percentage') {
          discountAmount = (amount * discount.amount) / 100;
        } else {
          discountAmount = discount.amount;
        }
        discountAmount = Math.min(discountAmount, amount);
      }

      return {
        code: discount.code,
        type: discount.type,
        amount: discount.amount,
        discountAmount,
        finalAmount: amount ? Math.max(0, amount - discountAmount) : 0,
      };
    } catch (error) {
      this.logger.error('Error validating discount code', {
        code,
        plan,
        amount,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Apply discount code to subscription
   */
  async applyDiscountCode(userId: string, code: string): Promise<Subscription> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        userId,
        status: 'active',
      });

      if (!subscription) {
        throw new NotFoundException('Active subscription not found');
      }

      // Validate discount code first
      await this.validateDiscountCode(code, subscription.plan);

      const codeUpper = code.toUpperCase().trim();
      const discount = await this.discountModel.findOne({
        code: codeUpper,
        isActive: true,
      });

      if (!discount) {
        throw new BadRequestException('Invalid or inactive discount code');
      }

      // Update subscription with discount
      const updatedSubscription = await this.subscriptionModel
        .findByIdAndUpdate(
          subscription._id,
          {
            discount: {
              code: discount.code,
              type: discount.type,
              amount: discount.amount,
              appliedAt: new Date(),
            },
            metadata: {
              ...subscription.metadata,
              discountAppliedAt: new Date(),
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedSubscription) {
        throw new NotFoundException('Failed to apply discount code');
      }

      // Increment discount usage count
      await this.discountModel.findByIdAndUpdate(discount._id, {
        $inc: { currentUses: 1 },
      });

      // Log subscription history
      await this.subscriptionHistoryModel.create({
        subscriptionId: subscription._id,
        userId: subscription.userId,
        changeType: 'discount_applied',
        changedBy: 'user',
        metadata: {
          discountCode: codeUpper,
          discountType: discount.type,
          discountAmount: discount.amount,
        },
      });

      this.logger.log('Applied discount code', {
        userId,
        subscriptionId: updatedSubscription._id?.toString(),
        discountCode: codeUpper,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error applying discount code', {
        userId,
        code,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get available upgrades for a plan
   */
  getAvailableUpgrades(plan: string): string[] {
    const planHierarchy = ['free', 'plus', 'pro', 'enterprise'];
    const currentIndex = planHierarchy.indexOf(plan);

    if (currentIndex === -1) {
      return [];
    }

    return planHierarchy.slice(currentIndex + 1);
  }

  /**
   * Get plan pricing
   */
  getPlanPricing(plan: string, interval: 'monthly' | 'yearly' = 'monthly') {
    // Production pricing structure - matches subscription plan limits
    const pricing: Record<
      string,
      { monthly: number; yearly: number; currency: string }
    > = {
      free: { monthly: 0, yearly: 0, currency: 'USD' },
      plus: { monthly: 49, yearly: 470.4, currency: 'USD' }, // 20% off yearly (49 * 12 * 0.8 = 470.4)
      pro: { monthly: 499, yearly: 4788.8, currency: 'USD' }, // 20% off yearly (499 * 12 * 0.8 = 4788.8)
      enterprise: { monthly: 0, yearly: 0, currency: 'USD' }, // Custom pricing - contact sales
    };

    const planPricing = pricing[plan];
    if (!planPricing) {
      throw new BadRequestException(`Invalid plan: ${plan}`);
    }

    return {
      amount: interval === 'yearly' ? planPricing.yearly : planPricing.monthly,
      currency: planPricing.currency,
    };
  }

  /**
   * Update subscription (general method that handles upgrades, downgrades, and same-plan changes)
   */
  async updateSubscription(
    userId: string,
    newPlan: string,
    paymentGateway?: 'stripe' | 'razorpay' | 'paypal',
    paymentMethodId?: string,
    options?: {
      interval?: 'monthly' | 'yearly';
      discountCode?: string;
    },
  ): Promise<Subscription> {
    try {
      // Validate new plan
      if (
        !SUBSCRIPTION_PLAN_LIMITS[
          newPlan as keyof typeof SUBSCRIPTION_PLAN_LIMITS
        ]
      ) {
        throw new BadRequestException(`Invalid plan: ${newPlan}`);
      }

      // Get current subscription
      const currentSubscription = await this.getSubscriptionByUserId(userId);
      if (!currentSubscription) {
        throw new NotFoundException('Subscription not found');
      }

      // Determine plan hierarchy
      const planHierarchy = ['free', 'plus', 'pro', 'enterprise'];
      const currentIndex = planHierarchy.indexOf(currentSubscription.plan);
      const newIndex = planHierarchy.indexOf(newPlan);

      let updatedSubscription: Subscription;

      if (newIndex > currentIndex) {
        // Upgrade - requires payment gateway and method
        if (!paymentGateway || !paymentMethodId) {
          throw new BadRequestException(
            'Payment gateway and payment method required for upgrade',
          );
        }

        updatedSubscription = await this.upgradeSubscription(
          userId,
          newPlan,
          paymentGateway,
          paymentMethodId,
          options,
        );
      } else if (newIndex < currentIndex) {
        // Downgrade
        updatedSubscription = await this.downgradeSubscription(
          userId,
          newPlan as 'free' | 'plus' | 'pro',
          true, // Default to scheduling for period end
        );
      } else {
        // Same plan - update billing cycle or discount if provided
        if (
          options?.interval &&
          options.interval !== currentSubscription.billing?.interval
        ) {
          updatedSubscription = await this.updateBillingCycle(
            userId,
            options.interval,
          );
        } else if (options?.discountCode) {
          updatedSubscription = await this.applyDiscountCode(
            userId,
            options.discountCode,
          );
        } else {
          // No changes needed
          updatedSubscription = currentSubscription;
        }
      }

      this.logger.log('Updated subscription', {
        userId,
        oldPlan: currentSubscription.plan,
        newPlan,
        paymentGateway,
        paymentMethodId,
        options,
      });

      return updatedSubscription;
    } catch (error) {
      this.logger.error('Error updating subscription', {
        userId,
        newPlan,
        paymentGateway,
        paymentMethodId,
        options,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get plan limits
   */
  getPlanLimits(plan: string) {
    return (
      SUBSCRIPTION_PLAN_LIMITS[plan as keyof typeof SUBSCRIPTION_PLAN_LIMITS] ||
      SUBSCRIPTION_PLAN_LIMITS.free
    );
  }

  /**
   * Admin: Update subscription plan and seats without payment (e.g. for guardrails/backend use).
   */
  async updatePlanAndSeats(
    userId: string,
    plan: 'free' | 'plus' | 'pro' | 'enterprise',
    seats?: number,
  ): Promise<Subscription> {
    const subscription = await this.subscriptionModel
      .findOne({ userId })
      .exec();
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const planLimits = SUBSCRIPTION_PLAN_LIMITS[plan];
    const updated = await this.subscriptionModel
      .findByIdAndUpdate(
        subscription._id,
        {
          plan,
          usageLimits: planLimits,
          features: planLimits.features,
          ...(seats != null && {
            metadata: { ...subscription.metadata, seats },
          }),
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Failed to update subscription');
    }
    return updated;
  }

  /**
   * Get usage analytics
   */
  async getUsageAnalytics(
    userId: string,
    period: 'daily' | 'weekly' | 'monthly' = 'monthly',
  ): Promise<any> {
    try {
      const subscription = await this.subscriptionModel.findOne({ userId });
      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      // Calculate date range based on period
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'daily':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }

      // Aggregate usage data
      const usageStats = await this.usageModel.aggregate([
        {
          $match: {
            userId: subscription.userId,
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format:
                  period === 'daily'
                    ? '%Y-%m-%d'
                    : period === 'weekly'
                      ? '%Y-%U'
                      : '%Y-%m',
                date: '$createdAt',
              },
            },
            totalTokens: { $sum: '$totalTokens' },
            totalCost: { $sum: '$cost' },
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      return {
        period,
        startDate,
        endDate: now,
        subscription: {
          plan: subscription.plan,
          limits: subscription.usageLimits,
        },
        usage: usageStats,
        summary: {
          totalTokens: usageStats.reduce(
            (sum, stat) => sum + stat.totalTokens,
            0,
          ),
          totalCost: usageStats.reduce((sum, stat) => sum + stat.totalCost, 0),
          totalRequests: usageStats.reduce(
            (sum, stat) => sum + stat.totalRequests,
            0,
          ),
          avgResponseTime:
            usageStats.length > 0
              ? usageStats.reduce(
                  (sum, stat) => sum + stat.avgResponseTime,
                  0,
                ) / usageStats.length
              : 0,
        },
      };
    } catch (error) {
      this.logger.error('Error getting usage analytics', {
        userId,
        period,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get subscription history
   */
  async getSubscriptionHistory(userId: string): Promise<SubscriptionHistory[]> {
    try {
      const subscription = await this.subscriptionModel.findOne({ userId });
      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      const history = await this.subscriptionHistoryModel
        .find({ subscriptionId: subscription._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .exec();

      return history;
    } catch (error) {
      this.logger.error('Error getting subscription history', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get user spending (for dashboard)
   */
  async getUserSpending(
    userId: string,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      service?: string;
      model?: string;
      projectId?: string;
    },
  ): Promise<any> {
    try {
      const matchConditions: any = { userId };

      if (filters?.startDate || filters?.endDate) {
        matchConditions.createdAt = {};
        if (filters.startDate)
          matchConditions.createdAt.$gte = filters.startDate;
        if (filters.endDate) matchConditions.createdAt.$lte = filters.endDate;
      }

      if (filters?.service) {
        matchConditions.service = filters.service;
      }

      if (filters?.model) {
        matchConditions.model = filters.model;
      }

      if (filters?.projectId) {
        matchConditions.projectId = filters.projectId;
      }

      const spendingData = await this.usageModel.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: {
              service: '$service',
              model: '$model',
              date: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
              },
            },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
          },
        },
        {
          $group: {
            _id: '$_id.service',
            models: {
              $push: {
                model: '$_id.model',
                date: '$_id.date',
                totalCost: '$totalCost',
                totalTokens: '$totalTokens',
                totalRequests: '$totalRequests',
                avgResponseTime: '$avgResponseTime',
              },
            },
            totalServiceCost: { $sum: '$totalCost' },
            totalServiceTokens: { $sum: '$totalTokens' },
            totalServiceRequests: { $sum: '$totalRequests' },
          },
        },
        {
          $project: {
            service: '$_id',
            totalCost: '$totalServiceCost',
            totalTokens: '$totalServiceTokens',
            totalRequests: '$totalServiceRequests',
            models: 1,
          },
        },
        { $sort: { totalCost: -1 } },
      ]);

      const summary = {
        totalCost: spendingData.reduce(
          (sum, service) => sum + service.totalCost,
          0,
        ),
        totalTokens: spendingData.reduce(
          (sum, service) => sum + service.totalTokens,
          0,
        ),
        totalRequests: spendingData.reduce(
          (sum, service) => sum + service.totalRequests,
          0,
        ),
        services: spendingData.length,
        period: {
          startDate: filters?.startDate,
          endDate: filters?.endDate,
        },
      };

      return {
        summary,
        services: spendingData,
      };
    } catch (error) {
      this.logger.error('Error getting user spending', {
        userId,
        filters,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Reset daily Cortex usage
   */
  async resetDailyCortexUsage(): Promise<void> {
    try {
      const result = await this.subscriptionModel.updateMany(
        {
          status: { $in: ['active', 'trialing'] },
          'cortexUsage.dailyReset': { $lt: new Date() },
        },
        {
          $set: {
            'cortexUsage.used': 0,
            'cortexUsage.dailyReset': new Date(
              Date.now() + 24 * 60 * 60 * 1000,
            ),
          },
        },
      );

      this.logger.log('Reset daily Cortex usage', {
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      this.logger.error('Error resetting daily Cortex usage', error);
      throw error;
    }
  }

  /**
   * Process trial expirations
   */
  async processTrialExpirations(): Promise<void> {
    try {
      const expiredTrials = await this.subscriptionModel.find({
        status: 'trialing',
        trialEnd: { $lt: new Date() },
      });

      let convertedCount = 0;
      let cancelledCount = 0;

      for (const subscription of expiredTrials) {
        try {
          // Check if user has payment method
          const user = await this.userModel.findById(subscription.userId);
          if (!user) continue;

          // If no payment method, cancel (query PaymentMethod collection; User has no paymentMethods field)
          const paymentMethodCount =
            await this.paymentMethodModel.countDocuments({ userId: user._id });
          if (paymentMethodCount === 0) {
            await this.subscriptionModel.updateOne(
              { _id: subscription._id },
              {
                $set: {
                  status: 'cancelled',
                  cancelledAt: new Date(),
                  cancelReason: 'trial_expired_no_payment',
                },
              },
            );
            cancelledCount++;
          } else {
            // Convert to paid plan
            await this.subscriptionModel.updateOne(
              { _id: subscription._id },
              {
                $set: {
                  status: 'active',
                  trialEnd: null,
                },
              },
            );
            convertedCount++;
          }
        } catch (error) {
          this.logger.error('Error processing trial expiration', {
            subscriptionId: subscription._id,
            error: (error as Error).message,
          });
        }
      }

      this.logger.log('Processed trial expirations', {
        total: expiredTrials.length,
        converted: convertedCount,
        cancelled: cancelledCount,
      });
    } catch (error) {
      this.logger.error('Error processing trial expirations', error);
      throw error;
    }
  }

  /**
   * Process scheduled cancellations
   */
  async processCancellations(): Promise<void> {
    try {
      const now = new Date();
      const result = await this.subscriptionModel.updateMany(
        {
          status: 'active',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { $lte: now },
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: now,
          },
        },
      );

      this.logger.log('Processed scheduled cancellations', {
        cancelledCount: result.modifiedCount,
      });
    } catch (error) {
      this.logger.error('Error processing scheduled cancellations', error);
      throw error;
    }
  }

  /**
   * Process failed payment retries (dunning)
   */
  async processFailedPayments(): Promise<void> {
    try {
      const failedPayments = await this.subscriptionModel.find({
        status: 'past_due',
        'billing.paymentFailedAt': { $exists: true },
        'billing.nextRetryAt': { $lte: new Date() },
        'billing.retryCount': { $lt: 3 },
      });

      let retriedCount = 0;
      let cancelledCount = 0;

      for (const subscription of failedPayments) {
        try {
          const retryCount = (subscription as any).billing?.retryCount ?? 0;

          // Try to charge payment method
          const paymentSuccess = await this.retryPayment(subscription);

          if (paymentSuccess) {
            await this.subscriptionModel.updateOne(
              { _id: subscription._id },
              {
                $set: {
                  status: 'active',
                  'billing.paymentFailedAt': null,
                  'billing.nextRetryAt': null,
                  'billing.retryCount': 0,
                },
              },
            );
            retriedCount++;
          } else {
            // Increment retry count or cancel
            const newRetryCount = retryCount + 1;
            if (newRetryCount >= 3) {
              await this.subscriptionModel.updateOne(
                { _id: subscription._id },
                {
                  $set: {
                    status: 'cancelled',
                    cancelledAt: new Date(),
                    cancelReason: 'payment_failed_max_retries',
                  },
                },
              );
              cancelledCount++;
            } else {
              await this.subscriptionModel.updateOne(
                { _id: subscription._id },
                {
                  $set: {
                    'billing.retryCount': newRetryCount,
                    'billing.nextRetryAt': new Date(
                      Date.now() + 24 * 60 * 60 * 1000,
                    ), // Retry tomorrow
                  },
                },
              );
            }
          }
        } catch (error) {
          this.logger.error('Error processing failed payment', {
            subscriptionId: subscription._id,
            error: (error as Error).message,
          });
        }
      }

      this.logger.log('Processed failed payments', {
        retried: retriedCount,
        cancelled: cancelledCount,
      });
    } catch (error) {
      this.logger.error('Error processing failed payments', error);
      throw error;
    }
  }

  /**
   * Check usage alerts for a user
   */
  async checkUsageAlerts(userId: string): Promise<void> {
    try {
      const user = await this.userModel
        .findById(userId)
        .populate('subscription');
      if (!user) return;

      const subscription = (user as any).subscription;
      if (
        !subscription ||
        !['active', 'trialing'].includes(subscription.status)
      ) {
        return;
      }

      const usage = user.usage?.currentMonth;
      const limits = subscription.limits;

      if (!usage || !limits) return;

      const tokenUsagePercent =
        (usage.totalTokens / limits.tokensPerMonth) * 100;
      const requestUsagePercent = (usage.apiCalls / limits.apiCalls) * 100;

      // Check for 80% and 100% thresholds
      const thresholds = [80, 100];
      for (const threshold of thresholds) {
        if (
          tokenUsagePercent >= threshold ||
          requestUsagePercent >= threshold
        ) {
          // Send alert notification
          await this.subscriptionNotificationService.sendUsageThresholdAlert(
            user,
            threshold,
            tokenUsagePercent,
            requestUsagePercent,
          );
          this.logger.warn('Usage threshold exceeded', {
            userId,
            threshold,
            tokenUsagePercent: tokenUsagePercent.toFixed(2),
            requestUsagePercent: requestUsagePercent.toFixed(2),
          });
          break; // Only send one alert per check
        }
      }
    } catch (error) {
      this.logger.error('Error checking usage alerts', {
        userId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Start trial period for a plan (Express parity).
   */
  async startTrial(
    userId: string,
    plan: 'plus' | 'pro',
    trialDays: number = 14,
  ): Promise<Subscription> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const subDoc = subscription as any;
    if (subDoc.metadata?.isTrial) {
      throw new BadRequestException('User is already on a trial');
    }
    const limits = SUBSCRIPTION_PLAN_LIMITS[plan];
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + trialDays);
    const updated = await this.subscriptionModel
      .findByIdAndUpdate(
        subDoc._id,
        {
          plan,
          status: 'trialing',
          usageLimits: {
            tokensPerMonth: limits.tokensPerMonth,
            requestsPerMonth: limits.requestsPerMonth,
            logsPerMonth: limits.logsPerMonth,
          },
          features: limits.features,
          metadata: {
            ...subDoc.metadata,
            isTrial: true,
            trialStart: now,
            trialEnd,
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Subscription not found');
    await this.subscriptionHistoryModel.create({
      subscriptionId: subDoc._id,
      userId: new mongoose.Types.ObjectId(userId),
      changeType: 'trial_started',
      newPlan: plan,
      newStatus: 'trialing',
      changedBy: 'user',
      reason: `Started ${trialDays}-day trial`,
    });
    this.logger.log('Trial started', { userId, plan, trialDays });
    return updated;
  }

  /**
   * Validate and reserve tokens before operation (Express parity).
   */
  async validateAndReserveTokens(
    userId: string,
    estimatedTokens: number,
  ): Promise<void> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    if (
      subscription.status !== 'active' &&
      subscription.status !== 'trialing'
    ) {
      throw new BadRequestException(
        `Subscription is ${subscription.status}. Please activate your subscription.`,
      );
    }
    const limit = subscription.usageLimits?.tokensPerMonth ?? 0;
    if (limit === -1) return;
    const used = subscription.usage?.current?.tokens ?? 0;
    const available = limit - used;
    if (available < estimatedTokens) {
      throw new BadRequestException(
        `Insufficient token quota. Available: ${available.toLocaleString()}, Required: ${estimatedTokens.toLocaleString()}`,
      );
    }
  }

  /**
   * Consume tokens after operation (Express parity).
   */
  async consumeTokens(userId: string, actualTokens: number): Promise<void> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    await this.subscriptionModel.findByIdAndUpdate((subscription as any)._id, {
      $inc: { 'usage.current.tokens': actualTokens },
      $set: { 'usage.current.lastActivity': new Date() },
    });
    await this.checkUsageAlerts(userId);
  }

  /**
   * Check request quota (Express parity).
   */
  async checkRequestQuota(userId: string): Promise<void> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    if (
      subscription.status !== 'active' &&
      subscription.status !== 'trialing'
    ) {
      throw new BadRequestException(
        `Subscription is ${subscription.status}. Please activate your subscription.`,
      );
    }
    const limit = subscription.usageLimits?.requestsPerMonth ?? 0;
    if (limit === -1) return;
    const used = subscription.usage?.current?.requests ?? 0;
    if (used >= limit) {
      throw new BadRequestException(
        `Request quota exceeded. Limit: ${limit.toLocaleString()}, Used: ${used.toLocaleString()}`,
      );
    }
  }

  /**
   * Consume one request (Express parity).
   */
  async consumeRequest(userId: string): Promise<void> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    await this.subscriptionModel.findByIdAndUpdate(
      (subscription as unknown as { _id?: unknown })._id,
      {
        $inc: { 'usage.current.requests': 1 },
        $set: { 'usage.current.lastActivity': new Date() },
      },
    );
    await this.checkUsageAlerts(userId);
  }

  /**
   * Check agent trace / workflow quota before execution (Express parity).
   */
  async checkAgentTraceQuota(userId: string): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ userId })
      .select('plan usage')
      .lean()
      .exec();
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const planLimits =
      SUBSCRIPTION_PLAN_LIMITS[
        (subscription.plan as keyof typeof SUBSCRIPTION_PLAN_LIMITS) ?? 'free'
      ];
    const limit = (planLimits as { agentTraces?: number }).agentTraces ?? 10;
    if (limit === -1) return;
    const usage = subscription.usage as
      | { agentTracesUsed?: number }
      | undefined;
    const used = usage?.agentTracesUsed ?? 0;
    if (used >= limit) {
      throw new BadRequestException(
        `Workflow quota exceeded. Limit: ${limit}, Used: ${used}. Please upgrade your plan.`,
      );
    }
  }

  /**
   * Increment agent trace usage after workflow completion (Express parity).
   */
  async incrementAgentTracesUsed(userId: string): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ userId })
      .select('_id')
      .exec();
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    await this.subscriptionModel.findByIdAndUpdate(subscription._id, {
      $inc: { 'usage.agentTracesUsed': 1 },
    });
    await this.checkUsageAlerts(userId);
  }

  /**
   * Check Cortex daily quota (Express parity).
   * Uses metadata.cortexDailyUsage for currentCount/lastResetDate; limit from plan.
   */
  async checkCortexQuota(userId: string): Promise<void> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const planLimits = SUBSCRIPTION_PLAN_LIMITS[subscription.plan];
    const cortexDaily = (planLimits as { cortexDailyUsage?: { limit: number } })
      .cortexDailyUsage;
    const cortexLimit = cortexDaily?.limit ?? 0;
    if (cortexLimit === -1) return;
    if (cortexLimit === 0) {
      throw new BadRequestException(
        'Cortex Meta-Language is not available on your plan. Please upgrade to Plus or Pro.',
      );
    }
    const meta = (subscription as any).metadata ?? {};
    const cortex = meta.cortexDailyUsage ?? {
      currentCount: 0,
      lastResetDate: new Date(0),
    };
    const lastReset = cortex.lastResetDate
      ? new Date(cortex.lastResetDate)
      : new Date(0);
    const now = new Date();
    if (now.toDateString() !== lastReset.toDateString()) {
      await this.subscriptionModel.findByIdAndUpdate(
        (subscription as any)._id,
        {
          $set: {
            'metadata.cortexDailyUsage': {
              currentCount: 0,
              lastResetDate: now,
            },
          },
        },
      );
      return;
    }
    const used = cortex.currentCount ?? 0;
    if (used >= cortexLimit) {
      throw new BadRequestException(
        `Daily Cortex quota exceeded. Limit: ${cortexLimit}, Used: ${used}. Resets daily.`,
      );
    }
  }

  /**
   * Consume Cortex usage (Express parity).
   */
  async consumeCortexUsage(userId: string): Promise<void> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const meta = (subscription as any).metadata ?? {};
    const cortex = meta.cortexDailyUsage ?? {
      currentCount: 0,
      lastResetDate: new Date(0),
    };
    const lastReset = cortex.lastResetDate
      ? new Date(cortex.lastResetDate)
      : new Date(0);
    const now = new Date();
    const isNewDay = now.toDateString() !== lastReset.toDateString();
    await this.subscriptionModel.findByIdAndUpdate((subscription as any)._id, {
      $set: {
        'metadata.cortexDailyUsage': {
          currentCount: isNewDay ? 1 : (cortex.currentCount ?? 0) + 1,
          lastResetDate: isNewDay ? now : lastReset,
        },
      },
    });
  }

  /**
   * Remove discount code from subscription (Express parity).
   */
  async removeDiscountCode(userId: string): Promise<Subscription> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const subDoc = subscription as any;
    const updated = await this.subscriptionModel
      .findByIdAndUpdate(
        subDoc._id,
        { $unset: { 'metadata.discount': 1 } },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Subscription not found');
    await this.subscriptionHistoryModel.create({
      subscriptionId: subDoc._id,
      userId: new mongoose.Types.ObjectId(userId),
      changeType: 'discount_removed',
      changedBy: 'user',
      reason: 'Discount code removed',
    });
    this.logger.log('Discount code removed', { userId });
    return updated;
  }

  /**
   * Process overage billing and create invoice (Express parity).
   */
  async processOverageBilling(
    userId: string,
    overageTokens: number,
  ): Promise<Invoice> {
    const subscription = await this.getSubscriptionByUserId(userId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const plan = subscription.plan;
    if (plan === 'free' || plan === 'enterprise') {
      throw new BadRequestException(
        'Overage billing not applicable for this plan',
      );
    }
    const planLimits = SUBSCRIPTION_PLAN_LIMITS[plan] as any;
    const overagePricing = planLimits?.overagePricing;
    if (!overagePricing?.tokensPer1M) {
      throw new BadRequestException(
        'Overage pricing not configured for this plan',
      );
    }
    const overageAmount =
      (overageTokens / 1_000_000) * overagePricing.tokensPer1M;
    const items = [
      {
        description: `Overage: ${(overageTokens / 1_000_000).toFixed(2)}M tokens`,
        quantity: 1,
        unitPrice: overageAmount,
        total: overageAmount,
        type: 'overage' as const,
      },
    ];
    const invoice = await this.generateInvoice(
      userId,
      (subscription as any)._id?.toString(),
      items,
      subscription.paymentMethodId,
    );
    if (subscription.paymentMethodId && overageAmount > 0) {
      try {
        const paymentMethod = await this.paymentMethodModel.findById(
          subscription.paymentMethodId,
        );
        if (paymentMethod) {
          const result = await this.paymentGatewayService.charge(
            (paymentMethod as any).gateway as PaymentGatewayType,
            {
              customerId: (paymentMethod as any).gatewayCustomerId,
              paymentMethodId: (paymentMethod as any).gatewayPaymentMethodId,
              amount: overageAmount,
              currency: 'USD',
              description: `Overage billing for ${(overageTokens / 1_000_000).toFixed(2)}M tokens`,
            },
          );
          if (result?.status === 'succeeded') {
            invoice.status = 'paid';
            (invoice as any).paymentDate = new Date();
            await (
              invoice as unknown as { save: () => Promise<unknown> }
            ).save();
          }
        }
      } catch (err) {
        this.logger.warn('Overage charge failed', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return invoice;
  }

  /**
   * Retry payment for a failed subscription
   */
  private async retryPayment(subscription: any): Promise<boolean> {
    try {
      // Get the payment method for this subscription
      const paymentMethod = await this.paymentMethodModel.findOne({
        userId: subscription.userId,
        isDefault: true,
      });

      if (!paymentMethod) {
        this.logger.warn(
          'No default payment method found for subscription retry',
          {
            subscriptionId: subscription._id.toString(),
            userId: subscription.userId,
          },
        );
        return false;
      }

      // Get the amount to charge (subscription price)
      const amount = await this.calculateSubscriptionAmount(subscription);

      // Attempt to charge the payment method
      const chargeResult = await this.paymentGatewayService.charge(
        paymentMethod.gateway as PaymentGatewayType,
        {
          customerId: paymentMethod.gatewayCustomerId,
          paymentMethodId: paymentMethod.gatewayPaymentMethodId,
          amount: amount,
          currency: subscription.currency || 'usd',
          description: `Subscription retry - ${subscription.plan} plan`,
          metadata: {
            subscriptionId: subscription._id.toString(),
            userId: subscription.userId,
            retryAttempt: subscription.billing?.retryCount ?? 0,
          },
        },
      );

      return chargeResult.status === 'succeeded';
    } catch (error) {
      this.logger.error('Payment retry failed', {
        subscriptionId: subscription._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get plan price from config (with env override). Throws NotFoundException if plan unknown.
   */
  private getPlanPriceFallback(plan: string): number {
    const price = getPlanPriceOrNull(plan);
    if (price === null) {
      throw new NotFoundException(
        `Unknown subscription plan: ${plan}. Valid plans: free, starter, professional, enterprise.`,
      );
    }
    return price;
  }

  /**
   * Calculate subscription amount for retry
   */
  private async calculateSubscriptionAmount(
    subscription: any,
  ): Promise<number> {
    try {
      // Try to get the actual amount from the payment gateway
      if (subscription.gatewaySubscriptionId && subscription.gateway) {
        const gatewaySubscription =
          await this.paymentGatewayService.getSubscription(
            subscription.gateway as PaymentGatewayType,
            subscription.gatewaySubscriptionId,
          );

        // Return the amount from the gateway (usually in cents, convert to dollars)
        const amount =
          gatewaySubscription.amount || gatewaySubscription.plan?.amount;
        if (amount) {
          // Convert from cents to dollars if needed
          return typeof amount === 'number' && amount > 1000
            ? amount / 100
            : amount;
        }
      }

      const price = this.getPlanPriceFallback(subscription.plan);
      this.logger.warn('Using fallback pricing calculation', {
        subscriptionId: subscription._id?.toString(),
        gateway: subscription.gateway,
        hasGatewaySubscriptionId: !!subscription.gatewaySubscriptionId,
        metric: 'subscription.plan_price_fallback',
      });
      return price;
    } catch (error) {
      this.logger.error(
        'Failed to calculate subscription amount from gateway',
        {
          subscriptionId: subscription._id?.toString(),
          error: error instanceof Error ? error.message : String(error),
          metric: 'subscription.plan_price_fallback',
        },
      );
      return this.getPlanPriceFallback(subscription.plan);
    }
  }
}
