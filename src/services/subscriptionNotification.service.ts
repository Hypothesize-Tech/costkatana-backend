import { EmailService } from './email.service';
import { IUser } from '../models/User';
import { ISubscription } from '../models/Subscription';
import { IInvoice } from '../models/Invoice';
import { webhookEventEmitter } from './webhookEventEmitter.service';
import { loggingService } from './logging.service';

export class SubscriptionNotificationService {
    /**
     * Send trial started email
     */
    static async sendTrialStartedEmail(user: IUser, subscription: ISubscription): Promise<void> {
        try {
            const trialDays = subscription.trialEnd && subscription.trialStart
                ? Math.ceil((subscription.trialEnd.getTime() - subscription.trialStart.getTime()) / (1000 * 60 * 60 * 24))
                : 14;

            await EmailService.sendEmail({
                to: user.email,
                subject: `Welcome to ${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)} Trial - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #06ec9e;">🎉 Your ${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)} Trial Has Started!</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your ${trialDays}-day trial for the <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> plan has started. You now have access to:</p>
                        <ul>
                            <li><strong>${subscription.limits.tokensPerMonth.toLocaleString()}</strong> tokens per month</li>
                            <li><strong>${subscription.limits.requestsPerMonth.toLocaleString()}</strong> requests per month</li>
                            ${subscription.limits.cortexDailyUsage.limit > 0 ? `<li><strong>${subscription.limits.cortexDailyUsage.limit}</strong> Cortex Meta-Language uses per day</li>` : ''}
                        </ul>
                        <p>Your trial ends on <strong>${subscription.trialEnd?.toLocaleDateString()}</strong>.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Subscription</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.trial_started',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                            trialEnd: subscription.trialEnd,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                        trialEnd: subscription.trialEnd,
                    },
                }
            );
        } catch (error: any) {
            loggingService.error('Error sending trial started email', { userId: (user as any)._id?.toString() || (user as any).id?.toString() || '', error: error.message });
        }
    }

    /**
     * Send trial ending soon email
     */
    static async sendTrialEndingSoonEmail(user: IUser, subscription: ISubscription, daysRemaining: number): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Your Trial Ends in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''} - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #f59e0b;">⏰ Trial Ending Soon</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> trial ends in <strong>${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>.</p>
                        <p>To continue enjoying all the features, please add a payment method to keep your subscription active.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Add Payment Method</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.trial_ending',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                            daysRemaining,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                        daysRemaining,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending trial ending soon email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send trial expired email
     */
    static async sendTrialExpiredEmail(user: IUser, subscription: ISubscription): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: 'Your Trial Has Ended - Cost Katana',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #ef4444;">Trial Period Ended</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your trial period for the <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> plan has ended.</p>
                        <p>Your account has been downgraded to the Free plan. To continue with premium features, please upgrade your subscription.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Upgrade Now</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.trial_expired',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending trial expired email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send subscription upgraded email
     */
    static async sendSubscriptionUpgradedEmail(user: IUser, oldPlan: string, newPlan: string): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Subscription Upgraded to ${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)} - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #06ec9e;">✨ Subscription Upgraded!</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your subscription has been successfully upgraded from <strong>${oldPlan.charAt(0).toUpperCase() + oldPlan.slice(1)}</strong> to <strong>${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)}</strong>.</p>
                        <p>You now have access to all the premium features of your new plan.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Subscription</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            webhookEventEmitter.emitWebhookEvent(
                'subscription.upgraded',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: '',
                        name: `${newPlan} subscription`,
                        metadata: {
                            oldPlan,
                            newPlan,
                        },
                    },
                },
                {
                    metadata: {
                        oldPlan,
                        newPlan,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending subscription upgraded email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send subscription downgraded email
     */
    static async sendSubscriptionDowngradedEmail(user: IUser, oldPlan: string, newPlan: string, effectiveDate: Date): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Subscription Changed to ${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)} - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #f59e0b;">Subscription Changed</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your subscription has been changed from <strong>${oldPlan.charAt(0).toUpperCase() + oldPlan.slice(1)}</strong> to <strong>${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)}</strong>.</p>
                        <p>This change will take effect on <strong>${effectiveDate.toLocaleDateString()}</strong>.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Subscription</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            webhookEventEmitter.emitWebhookEvent(
                'subscription.downgraded',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: '',
                        name: `${newPlan} subscription`,
                        metadata: {
                            oldPlan,
                            newPlan,
                            effectiveDate,
                        },
                    },
                },
                {
                    metadata: {
                        oldPlan,
                        newPlan,
                        effectiveDate,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending subscription downgraded email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send subscription canceled email
     */
    static async sendSubscriptionCanceledEmail(user: IUser, subscription: ISubscription, cancelDate: Date): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: 'Subscription Canceled - Cost Katana',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #ef4444;">Subscription Canceled</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> subscription has been canceled.</p>
                        ${subscription.billing.cancelAtPeriodEnd ? `<p>Your subscription will remain active until <strong>${subscription.billing.nextBillingDate?.toLocaleDateString()}</strong>.</p>` : '<p>Your subscription has been canceled immediately.</p>'}
                        <p>We're sorry to see you go. If you change your mind, you can reactivate your subscription anytime.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Reactivate Subscription</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.canceled',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                            cancelDate,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                        cancelDate,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending subscription canceled email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send subscription reactivated email
     */
    static async sendSubscriptionReactivatedEmail(user: IUser, subscription: ISubscription): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: 'Subscription Reactivated - Cost Katana',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #06ec9e;">Welcome Back!</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> subscription has been reactivated.</p>
                        <p>You now have full access to all premium features again.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Subscription</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.reactivated',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending subscription reactivated email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send payment failed email
     */
    static async sendPaymentFailedEmail(user: IUser, subscription: ISubscription, retryDate: Date): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: 'Payment Failed - Action Required - Cost Katana',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #ef4444;">⚠️ Payment Failed</h2>
                        <p>Hi ${user.name},</p>
                        <p>We were unable to process your payment for your <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> subscription.</p>
                        <p>We'll automatically retry the payment on <strong>${retryDate.toLocaleDateString()}</strong>.</p>
                        <p>Please update your payment method to avoid service interruption.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Update Payment Method</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.payment_failed',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                            retryDate,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                        retryDate,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending payment failed email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send payment succeeded email
     */
    static async sendPaymentSucceededEmail(user: IUser, invoice: IInvoice): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Payment Received - Invoice ${invoice.invoiceNumber} - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #06ec9e;">✅ Payment Received</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your payment of <strong>$${invoice.total.toFixed(2)}</strong> has been successfully processed.</p>
                        <p>Invoice Number: <strong>${invoice.invoiceNumber}</strong></p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/billing/invoices/${invoice._id}" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Invoice</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const invoiceIdStr = (invoice._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.payment_succeeded',
                userIdStr,
                {
                    resource: {
                        type: 'invoice',
                        id: invoiceIdStr,
                        name: `Invoice ${invoice.invoiceNumber}`,
                        metadata: {
                            invoiceId: invoiceIdStr,
                            invoiceNumber: invoice.invoiceNumber,
                            amount: invoice.total,
                        },
                    },
                },
                {
                    metadata: {
                        invoiceId: invoiceIdStr,
                        invoiceNumber: invoice.invoiceNumber,
                        amount: invoice.total,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending payment succeeded email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send invoice email
     */
    static async sendInvoiceEmail(user: IUser, invoice: IInvoice): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Invoice ${invoice.invoiceNumber} - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #06ec9e;">Invoice Ready</h2>
                        <p>Hi ${user.name},</p>
                        <p>Your invoice <strong>${invoice.invoiceNumber}</strong> is ready.</p>
                        <p>Amount: <strong>$${invoice.total.toFixed(2)}</strong></p>
                        <p>Due Date: <strong>${invoice.dueDate.toLocaleDateString()}</strong></p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/billing/invoices/${invoice._id}" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Invoice</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const invoiceIdStr = (invoice._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.invoice_created',
                userIdStr,
                {
                    resource: {
                        type: 'invoice',
                        id: invoiceIdStr,
                        name: `Invoice ${invoice.invoiceNumber}`,
                        metadata: {
                            invoiceId: invoiceIdStr,
                            invoiceNumber: invoice.invoiceNumber,
                            amount: invoice.total,
                        },
                    },
                },
                {
                    metadata: {
                        invoiceId: invoiceIdStr,
                        invoiceNumber: invoice.invoiceNumber,
                        amount: invoice.total,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending invoice email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send usage alert email
     */
    static async sendUsageAlertEmail(
        user: IUser,
        subscription: ISubscription,
        usage: { metric: string; used: number; limit: number; percentage: number },
        threshold: number
    ): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Usage Alert: ${usage.metric.charAt(0).toUpperCase() + usage.metric.slice(1)} at ${threshold}% - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: ${threshold >= 90 ? '#ef4444' : '#f59e0b'};">
                            ${threshold >= 90 ? '⚠️' : '📊'} Usage Alert
                        </h2>
                        <p>Hi ${user.name},</p>
                        <p>Your <strong>${usage.metric}</strong> usage is at <strong>${threshold}%</strong> of your plan limit.</p>
                        <p>Used: <strong>${usage.used.toLocaleString()}</strong> / <strong>${usage.limit === -1 ? 'Unlimited' : usage.limit.toLocaleString()}</strong></p>
                        ${threshold >= 90 ? '<p><strong>You\'re approaching your limit. Consider upgrading to avoid service interruption.</strong></p>' : ''}
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Usage</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.usage_alert',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            metric: usage.metric,
                            used: usage.used,
                            limit: usage.limit,
                            percentage: usage.percentage,
                            threshold,
                        },
                    },
                    metrics: {
                        current: usage.used,
                        threshold: usage.limit,
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        metric: usage.metric,
                        used: usage.used,
                        limit: usage.limit,
                        percentage: usage.percentage,
                        threshold,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending usage alert email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Send limit exceeded email
     */
    static async sendLimitExceededEmail(user: IUser, subscription: ISubscription, limitType: string): Promise<void> {
        try {
            await EmailService.sendEmail({
                to: user.email,
                subject: `Limit Exceeded: ${limitType} - Cost Katana`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #ef4444;">🚫 Limit Exceeded</h2>
                        <p>Hi ${user.name},</p>
                        <p>You've reached your <strong>${limitType}</strong> limit on your <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> plan.</p>
                        <p>To continue using this feature, please upgrade your subscription.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Upgrade Now</a></p>
                    </div>
                `,
            });

            // Emit webhook event
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            const subscriptionIdStr = (subscription._id as any).toString();
            webhookEventEmitter.emitWebhookEvent(
                'subscription.limit_exceeded',
                userIdStr,
                {
                    resource: {
                        type: 'subscription',
                        id: subscriptionIdStr,
                        name: `${subscription.plan} subscription`,
                        metadata: {
                            subscriptionId: subscriptionIdStr,
                            plan: subscription.plan,
                            limitType,
                        },
                    },
                },
                {
                    metadata: {
                        subscriptionId: subscriptionIdStr,
                        plan: subscription.plan,
                        limitType,
                    },
                }
            );
        } catch (error: any) {
            const userIdStr = (user as any)._id?.toString() || (user as any).id?.toString() || '';
            loggingService.error('Error sending limit exceeded email', { userId: userIdStr, error: error.message });
        }
    }

    /**
     * Emit subscription webhook event
     */
    static emitSubscriptionEvent(
        eventType: string,
        userId: string,
        data: Record<string, any>
    ): void {
        webhookEventEmitter.emitWebhookEvent(
            eventType as any,
            userId,
            data
        );
    }
}

