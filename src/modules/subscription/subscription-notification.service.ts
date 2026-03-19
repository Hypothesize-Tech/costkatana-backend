import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { User } from '../../schemas/user/user.schema';
import { Subscription } from '../../schemas/core/subscription.schema';
import { Invoice } from '../../schemas/billing/invoice.schema';

@Injectable()
export class SubscriptionNotificationService {
  private readonly logger = new Logger(SubscriptionNotificationService.name);

  constructor(private emailService: EmailService) {}

  /**
   * Send subscription upgraded email
   */
  async sendSubscriptionUpgradedEmail(
    user: User,
    oldPlan: string,
    newPlan: string,
  ): Promise<void> {
    try {
      await this.emailService.sendEmail({
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

      this.logger.log('Subscription upgraded email sent', {
        userId: (user as any)._id?.toString(),
        oldPlan,
        newPlan,
      });
    } catch (error: any) {
      this.logger.error('Error sending subscription upgraded email', {
        userId: (user as any)._id?.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send subscription downgraded email
   */
  async sendSubscriptionDowngradedEmail(
    user: User,
    oldPlan: string,
    newPlan: string,
    effectiveDate: Date,
  ): Promise<void> {
    try {
      await this.emailService.sendEmail({
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

      this.logger.log('Subscription downgraded email sent', {
        userId: (user as any)._id?.toString(),
        oldPlan,
        newPlan,
        effectiveDate,
      });
    } catch (error: any) {
      this.logger.error('Error sending subscription downgraded email', {
        userId: (user as any)._id?.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send subscription canceled email
   */
  async sendSubscriptionCanceledEmail(
    user: User,
    subscription: Subscription,
    cancelDate: Date,
  ): Promise<void> {
    try {
      await this.emailService.sendEmail({
        to: user.email,
        subject: 'Subscription Canceled - Cost Katana',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #ef4444;">Subscription Canceled</h2>
            <p>Hi ${user.name},</p>
            <p>Your <strong>${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}</strong> subscription has been canceled.</p>
            ${subscription.cancelAtPeriodEnd ? `<p>Your subscription will remain active until <strong>${subscription.currentPeriodEnd?.toLocaleDateString()}</strong>.</p>` : '<p>Your subscription has been canceled immediately.</p>'}
            <p>We're sorry to see you go. If you change your mind, you can reactivate your subscription anytime.</p>
            <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/subscription" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">Reactivate Subscription</a></p>
          </div>
        `,
      });

      this.logger.log('Subscription canceled email sent', {
        userId: (user as any)._id?.toString(),
        subscriptionId: (subscription as any)._id?.toString(),
        plan: subscription.plan,
        cancelDate,
      });
    } catch (error: any) {
      this.logger.error('Error sending subscription canceled email', {
        userId: (user as any)._id?.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send subscription reactivated email
   */
  async sendSubscriptionReactivatedEmail(
    user: User,
    subscription: Subscription,
  ): Promise<void> {
    try {
      await this.emailService.sendEmail({
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

      this.logger.log('Subscription reactivated email sent', {
        userId: (user as any)._id?.toString(),
        subscriptionId: (subscription as any)._id?.toString(),
        plan: subscription.plan,
      });
    } catch (error: any) {
      this.logger.error('Error sending subscription reactivated email', {
        userId: (user as any)._id?.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send payment succeeded email
   */
  async sendPaymentSucceededEmail(user: User, invoice: Invoice): Promise<void> {
    try {
      await this.emailService.sendEmail({
        to: user.email,
        subject: `Payment Received - Invoice ${invoice.invoiceNumber} - Cost Katana`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #06ec9e;">✅ Payment Received</h2>
            <p>Hi ${user.name},</p>
            <p>Your payment of <strong>$${invoice.total.toFixed(2)}</strong> has been successfully processed.</p>
            <p>Invoice Number: <strong>${invoice.invoiceNumber}</strong></p>
            <p><a href="${process.env.FRONTEND_URL || 'https://app.costkatana.com'}/billing/invoices/${(invoice as any)._id}" style="background: #06ec9e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">View Invoice</a></p>
          </div>
        `,
      });

      this.logger.log('Payment succeeded email sent', {
        userId: (user as any)._id?.toString(),
        invoiceId: (invoice as any)._id?.toString(),
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.total,
      });
    } catch (error: any) {
      this.logger.error('Error sending payment succeeded email', {
        userId: (user as any)._id?.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send payment failed email
   */
  async sendPaymentFailedEmail(
    user: User,
    subscription: Subscription,
    retryDate: Date,
  ): Promise<void> {
    try {
      await this.emailService.sendEmail({
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

      this.logger.log('Payment failed email sent', {
        userId: (user as any)._id?.toString(),
        subscriptionId: (subscription as any)._id?.toString(),
        plan: subscription.plan,
        retryDate,
      });
    } catch (error: any) {
      this.logger.error('Error sending payment failed email', {
        userId: (user as any)._id?.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send usage threshold alert email
   */
  async sendUsageThresholdAlert(
    user: User,
    threshold: number,
    tokenUsagePercent: number,
    requestUsagePercent: number,
  ): Promise<void> {
    try {
      const alertType = threshold === 100 ? 'Limit Reached' : 'Warning';

      const recipientEmail = (user as { email?: string }).email;
      if (!recipientEmail) {
        this.logger.warn(
          'Cannot send usage threshold alert: user has no email',
          {
            userId: (user as any)._id?.toString(),
          },
        );
        return;
      }

      await this.emailService.sendAlert(
        {
          title: `Usage ${alertType}: ${Math.max(tokenUsagePercent, requestUsagePercent).toFixed(1)}%`,
          message: `Your Cost Katana usage has reached ${Math.max(tokenUsagePercent, requestUsagePercent).toFixed(1)}% of your plan limits.`,
          type: threshold === 100 ? 'error' : 'warning',
          severity: threshold === 100 ? 'high' : 'medium',
          _id: (user as any)._id?.toString(),
          metadata: {
            threshold,
            tokenUsagePercent,
            requestUsagePercent,
            userId: (user as any)._id?.toString(),
          },
        },
        recipientEmail,
      );

      this.logger.log('Usage threshold alert sent', {
        userId: (user as any)._id?.toString(),
        threshold,
        tokenUsagePercent,
        requestUsagePercent,
      });
    } catch (error: any) {
      this.logger.error('Error sending usage threshold alert', {
        userId: (user as any)._id?.toString(),
        threshold,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
