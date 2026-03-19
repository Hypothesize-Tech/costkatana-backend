import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { SubscriptionNotificationService } from '../subscription/subscription-notification.service';
import { Invoice } from '../../schemas/billing/invoice.schema';
import { Subscription } from '../../schemas/core/subscription.schema';
import { PaymentMethod } from '../../schemas/billing/payment-method.schema';
import { User } from '../../schemas/user/user.schema';
import { SubscriptionHistory } from '../../schemas/billing/subscription-history.schema';

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<Invoice>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<Subscription>,
    @InjectModel(PaymentMethod.name)
    private paymentMethodModel: Model<PaymentMethod>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(SubscriptionHistory.name)
    private subscriptionHistoryModel: Model<SubscriptionHistory>,
    private paymentGatewayService: PaymentGatewayService,
    private subscriptionService: SubscriptionService,
    private subscriptionNotificationService: SubscriptionNotificationService,
  ) {}

  /**
   * Process Stripe webhook events
   */
  async processStripeEvent(event: any): Promise<void> {
    const eventType = event.type;
    const data = event.data.object;

    this.logger.log('Processing Stripe webhook event', {
      eventType,
      eventId: event.id,
    });

    switch (eventType) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleStripeSubscriptionUpdate(data);
        break;

      case 'customer.subscription.deleted':
        await this.handleStripeSubscriptionDeleted(data);
        break;

      case 'invoice.payment_succeeded':
        await this.handleStripePaymentSucceeded(data);
        break;

      case 'invoice.payment_failed':
        await this.handleStripePaymentFailed(data);
        break;

      case 'payment_method.attached':
        await this.handleStripePaymentMethodAttached(data);
        break;

      case 'charge.refunded':
        await this.handleStripeRefund(data);
        break;

      default:
        this.logger.debug('Unhandled Stripe webhook event', { eventType });
    }
  }

  /**
   * Process Razorpay webhook events
   */
  async processRazorpayEvent(event: any): Promise<void> {
    const eventType = event.type;
    const payload = event.data;

    this.logger.log('Processing Razorpay webhook event', {
      eventType,
      eventId: event.id,
    });

    switch (eventType) {
      case 'subscription.activated':
      case 'subscription.charged':
        await this.handleRazorpaySubscriptionUpdate(payload);
        break;

      case 'subscription.cancelled':
        await this.handleRazorpaySubscriptionCancelled(payload);
        break;

      case 'payment.captured':
        await this.handleRazorpayPaymentSucceeded(payload);
        break;

      case 'payment.failed':
        await this.handleRazorpayPaymentFailed(payload);
        break;

      case 'refund.created':
        await this.handleRazorpayRefund(payload);
        break;

      default:
        this.logger.debug('Unhandled Razorpay webhook event', { eventType });
    }
  }

  /**
   * Process PayPal webhook events
   */
  async processPayPalEvent(event: any): Promise<void> {
    const eventType = event.type;
    const resource = event.data;

    this.logger.log('Processing PayPal webhook event', {
      eventType,
      eventId: event.id,
    });

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.CREATED':
      case 'BILLING.SUBSCRIPTION.UPDATED':
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await this.handlePayPalSubscriptionUpdate(resource);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        await this.handlePayPalSubscriptionCancelled(resource);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        await this.handlePayPalPaymentSucceeded(resource);
        break;

      case 'PAYMENT.SALE.DENIED':
        await this.handlePayPalPaymentFailed(resource);
        break;

      default:
        this.logger.debug('Unhandled PayPal webhook event', { eventType });
    }
  }

  /**
   * Handle Stripe subscription update
   */
  private async handleStripeSubscriptionUpdate(
    subscription: any,
  ): Promise<void> {
    try {
      const dbSubscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: subscription.id,
      });

      if (!dbSubscription) {
        this.logger.warn('Stripe subscription not found in database', {
          subscriptionId: subscription.id,
        });
        return;
      }

      // Update subscription status
      const statusMap: Record<string, string> = {
        active: 'active',
        trialing: 'trialing',
        past_due: 'past_due',
        canceled: 'canceled',
        unpaid: 'unpaid',
        incomplete: 'incomplete',
      };

      dbSubscription.status =
        statusMap[subscription.status] || subscription.status;
      if (!dbSubscription.billing) {
        dbSubscription.billing = {
          amount: 0,
          currency: 'USD',
          interval: 'monthly',
        };
      }
      dbSubscription.billing.nextBillingDate = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : undefined;
      dbSubscription.cancelAtPeriodEnd =
        subscription.cancel_at_period_end || false;

      // Note: Trial properties not in current schema - skipping

      await dbSubscription.save();

      this.logger.log('Stripe subscription updated', {
        subscriptionId: dbSubscription._id,
        status: dbSubscription.status,
      });
    } catch (error: any) {
      this.logger.error('Error handling Stripe subscription update', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Handle Stripe subscription deleted
   */
  private async handleStripeSubscriptionDeleted(
    subscription: any,
  ): Promise<void> {
    try {
      const dbSubscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: subscription.id,
      });

      if (dbSubscription) {
        dbSubscription.status = 'cancelled';
        dbSubscription.cancelledAt = new Date();
        await dbSubscription.save();

        const user = await this.userModel.findById(dbSubscription.userId);
        if (user) {
          await this.subscriptionNotificationService.sendSubscriptionCanceledEmail(
            user,
            dbSubscription,
            new Date(),
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling Stripe subscription deletion', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Stripe payment succeeded
   */
  private async handleStripePaymentSucceeded(invoice: any): Promise<void> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: invoice.subscription,
      });

      if (!subscription) {
        this.logger.warn('Subscription not found for Stripe invoice', {
          invoiceId: invoice.id,
        });
        return;
      }

      // Find or create invoice
      let dbInvoice = await this.invoiceModel.findOne({
        gatewayTransactionId: invoice.payment_intent,
      });

      if (!dbInvoice) {
        const generatedInvoice = await this.subscriptionService.generateInvoice(
          subscription.userId.toString(),
          (subscription as any)._id.toString(),
          [
            {
              description: invoice.description || 'Subscription payment',
              quantity: 1,
              unitPrice: invoice.amount_paid / 100,
              total: invoice.amount_paid / 100,
              type: 'plan',
            },
          ],
        );
        // Find the saved invoice document
        dbInvoice = await this.invoiceModel.findById(
          (generatedInvoice as any)._id,
        );
      }

      if (!dbInvoice) {
        this.logger.error('Failed to create invoice for Stripe payment', {
          userId: subscription.userId.toString(),
          paymentIntent: invoice.payment_intent,
        });
        return;
      }

      dbInvoice.status = 'paid';
      dbInvoice.paymentDate = new Date(
        invoice.status_transitions.paid_at * 1000,
      );
      dbInvoice.gatewayTransactionId = invoice.payment_intent;
      await dbInvoice.save();

      const user = await this.userModel.findById(subscription.userId);
      if (user && dbInvoice) {
        await this.subscriptionNotificationService.sendPaymentSucceededEmail(
          user,
          dbInvoice,
        );
      }

      this.logger.log('Stripe payment succeeded', {
        invoiceId: dbInvoice._id.toString(),
        amount: invoice.amount_paid / 100,
      });
    } catch (error: any) {
      this.logger.error('Error handling Stripe payment succeeded', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Stripe payment failed
   */
  private async handleStripePaymentFailed(invoice: any): Promise<void> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: invoice.subscription,
      });

      if (subscription) {
        subscription.status = 'past_due';
        await subscription.save();

        const user = await this.userModel.findById(subscription.userId);
        if (user) {
          const retryDate = invoice.next_payment_attempt
            ? new Date(invoice.next_payment_attempt * 1000)
            : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days default

          await this.subscriptionNotificationService.sendPaymentFailedEmail(
            user,
            (subscription as any)._id.toString(),
            retryDate,
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling Stripe payment failed', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Stripe payment method attached
   */
  private async handleStripePaymentMethodAttached(
    paymentMethod: any,
  ): Promise<void> {
    try {
      const dbPaymentMethod = await this.paymentMethodModel.findOne({
        gatewayPaymentMethodId: paymentMethod.id,
      });

      if (dbPaymentMethod) {
        dbPaymentMethod.recurringStatus = 'active';
        await dbPaymentMethod.save();
      }
    } catch (error: any) {
      this.logger.error('Error handling Stripe payment method attached', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Stripe refund
   */
  private async handleStripeRefund(refund: any): Promise<void> {
    try {
      const invoice = await this.invoiceModel.findOne({
        gatewayTransactionId: refund.payment_intent,
      });

      if (invoice) {
        invoice.status = 'refunded';
        await (invoice as any).save();
      }
    } catch (error: any) {
      this.logger.error('Error handling Stripe refund', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Razorpay subscription update
   */
  private async handleRazorpaySubscriptionUpdate(
    subscription: any,
  ): Promise<void> {
    try {
      const dbSubscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: subscription.id,
      });

      if (dbSubscription) {
        const statusMap: Record<string, string> = {
          active: 'active',
          created: 'trialing',
          paused: 'paused',
          cancelled: 'canceled',
        };

        dbSubscription.status =
          statusMap[subscription.status] || subscription.status;
        if (!dbSubscription.billing) {
          dbSubscription.billing = {
            amount: 0,
            currency: 'USD',
            interval: 'monthly',
          };
        }
        dbSubscription.billing.nextBillingDate = subscription.current_end
          ? new Date(subscription.current_end * 1000)
          : undefined;

        await dbSubscription.save();
      }
    } catch (error: any) {
      this.logger.error('Error handling Razorpay subscription update', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Razorpay subscription cancelled
   */
  private async handleRazorpaySubscriptionCancelled(
    subscription: any,
  ): Promise<void> {
    try {
      const dbSubscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: subscription.id,
      });

      if (dbSubscription) {
        dbSubscription.status = 'cancelled';
        dbSubscription.cancelledAt = new Date();
        await dbSubscription.save();

        const user = await this.userModel.findById(dbSubscription.userId);
        if (user) {
          await this.subscriptionNotificationService.sendSubscriptionCanceledEmail(
            user,
            dbSubscription,
            new Date(),
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling Razorpay subscription cancellation', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Razorpay payment succeeded
   */
  private async handleRazorpayPaymentSucceeded(payment: any): Promise<void> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: payment.subscription_id,
      });

      if (!subscription) {
        this.logger.warn('Subscription not found for Razorpay payment', {
          paymentId: payment.id,
          subscriptionId: payment.subscription_id,
        });
        return;
      }

      // First, check if an invoice already exists for this payment
      let invoice = await this.invoiceModel
        .findOne({
          $or: [
            { gatewayTransactionId: payment.id },
            {
              userId: subscription.userId,
              subscriptionId: subscription._id,
              status: 'pending',
            },
          ],
        })
        .sort({ createdAt: -1 }); // Get the most recent pending invoice

      // If no invoice exists, create a new one
      if (!invoice) {
        const generatedInvoice = await this.subscriptionService.generateInvoice(
          subscription.userId.toString(),
          (subscription as any)._id.toString(),
          [
            {
              description: 'Subscription payment',
              quantity: 1,
              unitPrice: payment.amount / 100,
              total: payment.amount / 100,
              type: 'plan',
            },
          ],
        );
        // Find the saved invoice document
        invoice = await this.invoiceModel.findById(
          (generatedInvoice as any)._id,
        );
      }

      if (!invoice) {
        this.logger.error(
          'Failed to create or find invoice for Razorpay payment',
          {
            userId: subscription.userId.toString(),
            paymentId: payment.id,
          },
        );
        return;
      }

      // Update invoice status to paid
      invoice.status = 'paid';
      invoice.paymentDate = new Date(payment.created_at * 1000);
      invoice.gatewayTransactionId = payment.id;
      await invoice.save();

      const user = await this.userModel.findById(subscription.userId);
      if (user && invoice) {
        await this.subscriptionNotificationService.sendPaymentSucceededEmail(
          user,
          invoice,
        );
      }

      this.logger.log('Razorpay payment succeeded', {
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        amount: payment.amount / 100,
        paymentId: payment.id,
      });
    } catch (error: any) {
      this.logger.error('Error handling Razorpay payment succeeded', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Handle Razorpay payment failed
   */
  private async handleRazorpayPaymentFailed(payment: any): Promise<void> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: payment.subscription_id,
      });

      if (subscription) {
        subscription.status = 'past_due';
        await subscription.save();

        const user = await this.userModel.findById(subscription.userId);
        if (user) {
          await this.subscriptionNotificationService.sendPaymentFailedEmail(
            user,
            (subscription as any)._id.toString(),
            new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling Razorpay payment failed', {
        error: error.message,
      });
    }
  }

  /**
   * Handle Razorpay refund
   */
  private async handleRazorpayRefund(refund: any): Promise<void> {
    try {
      const invoice = await this.invoiceModel.findOne({
        gatewayTransactionId: refund.payment_id,
      });

      if (invoice) {
        invoice.status = 'refunded';
        await (invoice as any).save();
      }
    } catch (error: any) {
      this.logger.error('Error handling Razorpay refund', {
        error: error.message,
      });
    }
  }

  /**
   * Handle PayPal subscription update
   */
  private async handlePayPalSubscriptionUpdate(
    subscription: any,
  ): Promise<void> {
    try {
      const dbSubscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: subscription.id,
      });

      if (dbSubscription) {
        const statusMap: Record<string, string> = {
          ACTIVE: 'active',
          APPROVAL_PENDING: 'incomplete',
          APPROVED: 'trialing',
          SUSPENDED: 'paused',
        };

        dbSubscription.status =
          statusMap[subscription.status] || subscription.status;
        if (!dbSubscription.billing) {
          dbSubscription.billing = {
            amount: 0,
            currency: 'USD',
            interval: 'monthly',
          };
        }
        dbSubscription.billing.nextBillingDate = subscription.billing_info
          ?.next_billing_time
          ? new Date(subscription.billing_info.next_billing_time)
          : undefined;

        await dbSubscription.save();
      }
    } catch (error: any) {
      this.logger.error('Error handling PayPal subscription update', {
        error: error.message,
      });
    }
  }

  /**
   * Handle PayPal subscription cancelled
   */
  private async handlePayPalSubscriptionCancelled(
    subscription: any,
  ): Promise<void> {
    try {
      const dbSubscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: subscription.id,
      });

      if (dbSubscription) {
        dbSubscription.status = 'cancelled';
        dbSubscription.cancelledAt = new Date();
        await dbSubscription.save();

        const user = await this.userModel.findById(dbSubscription.userId);
        if (user) {
          await this.subscriptionNotificationService.sendSubscriptionCanceledEmail(
            user,
            dbSubscription,
            new Date(),
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling PayPal subscription cancellation', {
        error: error.message,
      });
    }
  }

  /**
   * Handle PayPal payment succeeded
   */
  private async handlePayPalPaymentSucceeded(sale: any): Promise<void> {
    try {
      // Find subscription by billing agreement ID or transaction ID
      const subscription = await this.subscriptionModel.findOne({
        $or: [
          { gatewaySubscriptionId: sale.billing_agreement_id },
          { 'billing.nextBillingDate': { $exists: true } },
        ],
      });

      if (subscription) {
        const invoice = await this.subscriptionService.generateInvoice(
          subscription.userId.toString(),
          (subscription as any)._id.toString(),
          [
            {
              description: 'Subscription payment',
              quantity: 1,
              unitPrice: parseFloat(sale.amount.total),
              total: parseFloat(sale.amount.total),
              type: 'plan',
            },
          ],
        );

        invoice.status = 'paid';
        invoice.paymentDate = new Date(sale.create_time);
        invoice.gatewayTransactionId = sale.id;
        await (invoice as any).save();

        const user = await this.userModel.findById(subscription.userId);
        if (user) {
          await this.subscriptionNotificationService.sendPaymentSucceededEmail(
            user,
            invoice,
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling PayPal payment succeeded', {
        error: error.message,
      });
    }
  }

  /**
   * Handle PayPal payment failed
   */
  private async handlePayPalPaymentFailed(sale: any): Promise<void> {
    try {
      const subscription = await this.subscriptionModel.findOne({
        gatewaySubscriptionId: sale.billing_agreement_id,
      });

      if (subscription) {
        subscription.status = 'past_due';
        await subscription.save();

        const user = await this.userModel.findById(subscription.userId);
        if (user) {
          await this.subscriptionNotificationService.sendPaymentFailedEmail(
            user,
            (subscription as any)._id.toString(),
            new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          );
        }
      }
    } catch (error: any) {
      this.logger.error('Error handling PayPal payment failed', {
        error: error.message,
      });
    }
  }
}
