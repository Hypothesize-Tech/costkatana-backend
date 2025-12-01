import { Request, Response, NextFunction } from 'express';
import { paymentGatewayManager } from '../services/paymentGateway/paymentGatewayManager.service';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionNotificationService } from '../services/subscriptionNotification.service';
import { Invoice } from '../models/Invoice';
import { Subscription } from '../models/Subscription';
import { PaymentMethod } from '../models/PaymentMethod';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';

/**
 * Payment Webhook Controller
 * Handles webhooks from payment gateways (Stripe, Razorpay, PayPal)
 * Follows best practices: signature verification, idempotency, async processing
 */
export class PaymentWebhookController {
    /**
     * Stripe Webhook Handler
     * POST /api/webhooks/payment/stripe
     */
    static async handleStripeWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        const signature = req.headers['stripe-signature'] as string;
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);

        try {
            // Verify webhook signature
            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
            if (!webhookSecret) {
                loggingService.error('Stripe webhook secret not configured');
                res.status(500).json({ error: 'Webhook secret not configured' });
                return;
            }

            const gateway = paymentGatewayManager.getGateway('stripe');
            if (!gateway.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
                loggingService.warn('Invalid Stripe webhook signature', {
                    hasSignature: !!signature,
                });
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }

            const event = gateway.parseWebhookEvent(req.body, req.headers as Record<string, string>);

            // Process webhook asynchronously (respond quickly to Stripe)
            setImmediate(async () => {
                try {
                    await PaymentWebhookController.processStripeEvent(event);
                } catch (error: any) {
                    loggingService.error('Error processing Stripe webhook event', {
                        eventId: event.id,
                        eventType: event.type,
                        error: error.message,
                    });
                }
            });

            // Respond immediately to Stripe
            res.status(200).json({ received: true });
        } catch (error: any) {
            loggingService.error('Stripe webhook handler error', {
                error: error.message,
                stack: error.stack,
            });
            res.status(400).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Process Stripe webhook events
     */
    private static async processStripeEvent(event: any): Promise<void> {
        const eventType = event.type;
        const data = event.data.object;

        loggingService.info('Processing Stripe webhook event', {
            eventType,
            eventId: event.id,
        });

        switch (eventType) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await PaymentWebhookController.handleStripeSubscriptionUpdate(data);
                break;

            case 'customer.subscription.deleted':
                await PaymentWebhookController.handleStripeSubscriptionDeleted(data);
                break;

            case 'invoice.payment_succeeded':
                await PaymentWebhookController.handleStripePaymentSucceeded(data);
                break;

            case 'invoice.payment_failed':
                await PaymentWebhookController.handleStripePaymentFailed(data);
                break;

            case 'payment_method.attached':
                await PaymentWebhookController.handleStripePaymentMethodAttached(data);
                break;

            case 'charge.refunded':
                await PaymentWebhookController.handleStripeRefund(data);
                break;

            default:
                loggingService.debug('Unhandled Stripe webhook event', { eventType });
        }
    }

    /**
     * Handle Stripe subscription update
     */
    private static async handleStripeSubscriptionUpdate(subscription: any): Promise<void> {
        try {
            const dbSubscription = await Subscription.findOne({
                gatewaySubscriptionId: subscription.id,
            });

            if (!dbSubscription) {
                loggingService.warn('Stripe subscription not found in database', {
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

            dbSubscription.status = statusMap[subscription.status] || subscription.status;
            dbSubscription.billing.nextBillingDate = subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000)
                : undefined;
            dbSubscription.billing.cancelAtPeriodEnd = subscription.cancel_at_period_end || false;

            if (subscription.trial_end) {
                dbSubscription.trialEnd = new Date(subscription.trial_end * 1000);
                dbSubscription.isTrial = true;
            }

            await dbSubscription.save();

            loggingService.info('Stripe subscription updated', {
                subscriptionId: dbSubscription._id,
                status: dbSubscription.status,
            });
        } catch (error: any) {
            loggingService.error('Error handling Stripe subscription update', {
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Handle Stripe subscription deleted
     */
    private static async handleStripeSubscriptionDeleted(subscription: any): Promise<void> {
        try {
            const dbSubscription = await Subscription.findOne({
                gatewaySubscriptionId: subscription.id,
            });

            if (dbSubscription) {
                dbSubscription.status = 'canceled';
                dbSubscription.billing.canceledAt = new Date();
                await dbSubscription.save();

                const user = await User.findById(dbSubscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionCanceledEmail(
                        user,
                        dbSubscription,
                        new Date()
                    );
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling Stripe subscription deletion', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Stripe payment succeeded
     */
    private static async handleStripePaymentSucceeded(invoice: any): Promise<void> {
        try {
            const subscription = await Subscription.findOne({
                gatewaySubscriptionId: invoice.subscription,
            });

            if (!subscription) {
                loggingService.warn('Subscription not found for Stripe invoice', {
                    invoiceId: invoice.id,
                });
                return;
            }

            // Find or create invoice
            let dbInvoice = await Invoice.findOne({
                gatewayTransactionId: invoice.payment_intent,
            });

            if (!dbInvoice) {
                const generatedInvoice = await SubscriptionService.generateInvoice(
                    subscription.userId,
                    subscription,
                    [
                        {
                            description: invoice.description || 'Subscription payment',
                            quantity: 1,
                            unitPrice: invoice.amount_paid / 100,
                            total: invoice.amount_paid / 100,
                            type: 'plan',
                        },
                    ]
                );
                // Find the saved invoice document
                dbInvoice = await Invoice.findById(generatedInvoice._id);
            }

            if (!dbInvoice) {
                loggingService.error('Failed to create invoice for Stripe payment', {
                    userId: (subscription.userId as any).toString(),
                    paymentIntent: invoice.payment_intent
                });
                return;
            }

            dbInvoice.status = 'paid';
            dbInvoice.paymentDate = new Date(invoice.status_transitions.paid_at * 1000);
            dbInvoice.gatewayTransactionId = invoice.payment_intent;
            await dbInvoice.save();

            const user = await User.findById(subscription.userId);
            if (user && dbInvoice) {
                await SubscriptionNotificationService.sendPaymentSucceededEmail(user, dbInvoice as any);
            }

            loggingService.info('Stripe payment succeeded', {
                invoiceId: (dbInvoice._id as any).toString(),
                amount: invoice.amount_paid / 100,
            });
        } catch (error: any) {
            loggingService.error('Error handling Stripe payment succeeded', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Stripe payment failed
     */
    private static async handleStripePaymentFailed(invoice: any): Promise<void> {
        try {
            const subscription = await Subscription.findOne({
                gatewaySubscriptionId: invoice.subscription,
            });

            if (subscription) {
                subscription.status = 'past_due';
                await subscription.save();

                const user = await User.findById(subscription.userId);
                if (user) {
                    const retryDate = invoice.next_payment_attempt
                        ? new Date(invoice.next_payment_attempt * 1000)
                        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days default

                    await SubscriptionNotificationService.sendPaymentFailedEmail(
                        user,
                        subscription,
                        retryDate
                    );
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling Stripe payment failed', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Stripe payment method attached
     */
    private static async handleStripePaymentMethodAttached(paymentMethod: any): Promise<void> {
        try {
            const dbPaymentMethod = await PaymentMethod.findOne({
                gatewayPaymentMethodId: paymentMethod.id,
            });

            if (dbPaymentMethod) {
                dbPaymentMethod.recurringStatus = 'active';
                await dbPaymentMethod.save();
            }
        } catch (error: any) {
            loggingService.error('Error handling Stripe payment method attached', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Stripe refund
     */
    private static async handleStripeRefund(refund: any): Promise<void> {
        try {
            const invoice = await Invoice.findOne({
                gatewayTransactionId: refund.payment_intent,
            });

            if (invoice) {
                invoice.status = 'refunded';
                await invoice.save();
            }
        } catch (error: any) {
            loggingService.error('Error handling Stripe refund', {
                error: error.message,
            });
        }
    }

    /**
     * Razorpay Webhook Handler
     * POST /api/webhooks/payment/razorpay
     */
    static async handleRazorpayWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        const signature = req.headers['x-razorpay-signature'] as string;
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);

        try {
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            if (!webhookSecret) {
                loggingService.error('Razorpay webhook secret not configured');
                res.status(500).json({ error: 'Webhook secret not configured' });
                return;
            }

            const gateway = paymentGatewayManager.getGateway('razorpay');
            if (!gateway.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
                loggingService.warn('Invalid Razorpay webhook signature');
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }

            const event = gateway.parseWebhookEvent(req.body, req.headers as Record<string, string>);

            setImmediate(async () => {
                try {
                    await PaymentWebhookController.processRazorpayEvent(event);
                } catch (error: any) {
                    loggingService.error('Error processing Razorpay webhook event', {
                        eventId: event.id,
                        eventType: event.type,
                        error: error.message,
                    });
                }
            });

            res.status(200).json({ received: true });
        } catch (error: any) {
            loggingService.error('Razorpay webhook handler error', {
                error: error.message,
            });
            res.status(400).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Process Razorpay webhook events
     */
    private static async processRazorpayEvent(event: any): Promise<void> {
        const eventType = event.type;
        const payload = event.data;

        loggingService.info('Processing Razorpay webhook event', {
            eventType,
            eventId: event.id,
        });

        switch (eventType) {
            case 'subscription.activated':
            case 'subscription.charged':
                await PaymentWebhookController.handleRazorpaySubscriptionUpdate(payload);
                break;

            case 'subscription.cancelled':
                await PaymentWebhookController.handleRazorpaySubscriptionCancelled(payload);
                break;

            case 'payment.captured':
                await PaymentWebhookController.handleRazorpayPaymentSucceeded(payload);
                break;

            case 'payment.failed':
                await PaymentWebhookController.handleRazorpayPaymentFailed(payload);
                break;

            case 'refund.created':
                await PaymentWebhookController.handleRazorpayRefund(payload);
                break;

            default:
                loggingService.debug('Unhandled Razorpay webhook event', { eventType });
        }
    }

    /**
     * Handle Razorpay subscription update
     */
    private static async handleRazorpaySubscriptionUpdate(subscription: any): Promise<void> {
        try {
            const dbSubscription = await Subscription.findOne({
                gatewaySubscriptionId: subscription.id,
            });

            if (dbSubscription) {
                const statusMap: Record<string, string> = {
                    active: 'active',
                    created: 'trialing',
                    paused: 'paused',
                    cancelled: 'canceled',
                };

                dbSubscription.status = statusMap[subscription.status] || subscription.status;
                dbSubscription.billing.nextBillingDate = subscription.current_end
                    ? new Date(subscription.current_end * 1000)
                    : undefined;

                await dbSubscription.save();
            }
        } catch (error: any) {
            loggingService.error('Error handling Razorpay subscription update', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Razorpay subscription cancelled
     */
    private static async handleRazorpaySubscriptionCancelled(subscription: any): Promise<void> {
        try {
            const dbSubscription = await Subscription.findOne({
                gatewaySubscriptionId: subscription.id,
            });

            if (dbSubscription) {
                dbSubscription.status = 'canceled';
                dbSubscription.billing.canceledAt = new Date();
                await dbSubscription.save();

                const user = await User.findById(dbSubscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionCanceledEmail(
                        user,
                        dbSubscription,
                        new Date()
                    );
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling Razorpay subscription cancellation', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Razorpay payment succeeded
     */
    private static async handleRazorpayPaymentSucceeded(payment: any): Promise<void> {
        try {
            const subscription = await Subscription.findOne({
                gatewaySubscriptionId: payment.subscription_id,
            });

            if (subscription) {
                const invoice = await SubscriptionService.generateInvoice(
                    subscription.userId,
                    subscription,
                    [
                        {
                            description: 'Subscription payment',
                            quantity: 1,
                            unitPrice: payment.amount / 100,
                            total: payment.amount / 100,
                            type: 'plan',
                        },
                    ]
                );

                invoice.status = 'paid';
                invoice.paymentDate = new Date(payment.created_at * 1000);
                invoice.gatewayTransactionId = payment.id;
                await invoice.save();

                const user = await User.findById(subscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendPaymentSucceededEmail(user, invoice);
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling Razorpay payment succeeded', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Razorpay payment failed
     */
    private static async handleRazorpayPaymentFailed(payment: any): Promise<void> {
        try {
            const subscription = await Subscription.findOne({
                gatewaySubscriptionId: payment.subscription_id,
            });

            if (subscription) {
                subscription.status = 'past_due';
                await subscription.save();

                const user = await User.findById(subscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendPaymentFailedEmail(
                        user,
                        subscription,
                        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                    );
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling Razorpay payment failed', {
                error: error.message,
            });
        }
    }

    /**
     * Handle Razorpay refund
     */
    private static async handleRazorpayRefund(refund: any): Promise<void> {
        try {
            const invoice = await Invoice.findOne({
                gatewayTransactionId: refund.payment_id,
            });

            if (invoice) {
                invoice.status = 'refunded';
                await invoice.save();
            }
        } catch (error: any) {
            loggingService.error('Error handling Razorpay refund', {
                error: error.message,
            });
        }
    }

    /**
     * PayPal Webhook Handler
     * POST /api/webhooks/payment/paypal
     */
    static async handlePayPalWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        const signature = req.headers['paypal-transmission-sig'] as string;
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);

        try {
            const webhookSecret = process.env.PAYPAL_WEBHOOK_SECRET || process.env.PAYPAL_WEBHOOK_ID;
            if (!webhookSecret) {
                loggingService.error('PayPal webhook secret not configured');
                res.status(500).json({ error: 'Webhook secret not configured' });
                return;
            }

            const gateway = paymentGatewayManager.getGateway('paypal');
            if (!gateway.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
                loggingService.warn('Invalid PayPal webhook signature');
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }

            const event = gateway.parseWebhookEvent(req.body, req.headers as Record<string, string>);

            setImmediate(async () => {
                try {
                    await PaymentWebhookController.processPayPalEvent(event);
                } catch (error: any) {
                    loggingService.error('Error processing PayPal webhook event', {
                        eventId: event.id,
                        eventType: event.type,
                        error: error.message,
                    });
                }
            });

            res.status(200).json({ received: true });
        } catch (error: any) {
            loggingService.error('PayPal webhook handler error', {
                error: error.message,
            });
            res.status(400).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Process PayPal webhook events
     */
    private static async processPayPalEvent(event: any): Promise<void> {
        const eventType = event.type;
        const resource = event.data;

        loggingService.info('Processing PayPal webhook event', {
            eventType,
            eventId: event.id,
        });

        switch (eventType) {
            case 'BILLING.SUBSCRIPTION.CREATED':
            case 'BILLING.SUBSCRIPTION.UPDATED':
            case 'BILLING.SUBSCRIPTION.ACTIVATED':
                await PaymentWebhookController.handlePayPalSubscriptionUpdate(resource);
                break;

            case 'BILLING.SUBSCRIPTION.CANCELLED':
            case 'BILLING.SUBSCRIPTION.EXPIRED':
                await PaymentWebhookController.handlePayPalSubscriptionCancelled(resource);
                break;

            case 'PAYMENT.SALE.COMPLETED':
                await PaymentWebhookController.handlePayPalPaymentSucceeded(resource);
                break;

            case 'PAYMENT.SALE.DENIED':
                await PaymentWebhookController.handlePayPalPaymentFailed(resource);
                break;

            default:
                loggingService.debug('Unhandled PayPal webhook event', { eventType });
        }
    }

    /**
     * Handle PayPal subscription update
     */
    private static async handlePayPalSubscriptionUpdate(subscription: any): Promise<void> {
        try {
            const dbSubscription = await Subscription.findOne({
                gatewaySubscriptionId: subscription.id,
            });

            if (dbSubscription) {
                const statusMap: Record<string, string> = {
                    ACTIVE: 'active',
                    APPROVAL_PENDING: 'incomplete',
                    APPROVED: 'trialing',
                    SUSPENDED: 'paused',
                };

                dbSubscription.status = statusMap[subscription.status] || subscription.status;
                dbSubscription.billing.nextBillingDate = subscription.billing_info?.next_billing_time
                    ? new Date(subscription.billing_info.next_billing_time)
                    : undefined;

                await dbSubscription.save();
            }
        } catch (error: any) {
            loggingService.error('Error handling PayPal subscription update', {
                error: error.message,
            });
        }
    }

    /**
     * Handle PayPal subscription cancelled
     */
    private static async handlePayPalSubscriptionCancelled(subscription: any): Promise<void> {
        try {
            const dbSubscription = await Subscription.findOne({
                gatewaySubscriptionId: subscription.id,
            });

            if (dbSubscription) {
                dbSubscription.status = 'canceled';
                dbSubscription.billing.canceledAt = new Date();
                await dbSubscription.save();

                const user = await User.findById(dbSubscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionCanceledEmail(
                        user,
                        dbSubscription,
                        new Date()
                    );
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling PayPal subscription cancellation', {
                error: error.message,
            });
        }
    }

    /**
     * Handle PayPal payment succeeded
     */
    private static async handlePayPalPaymentSucceeded(sale: any): Promise<void> {
        try {
            // Find subscription by billing agreement ID or transaction ID
            const subscription = await Subscription.findOne({
                $or: [
                    { gatewaySubscriptionId: sale.billing_agreement_id },
                    { 'billing.nextBillingDate': { $exists: true } },
                ],
            });

            if (subscription) {
                const invoice = await SubscriptionService.generateInvoice(
                    subscription.userId,
                    subscription,
                    [
                        {
                            description: 'Subscription payment',
                            quantity: 1,
                            unitPrice: parseFloat(sale.amount.total),
                            total: parseFloat(sale.amount.total),
                            type: 'plan',
                        },
                    ]
                );

                invoice.status = 'paid';
                invoice.paymentDate = new Date(sale.create_time);
                invoice.gatewayTransactionId = sale.id;
                await invoice.save();

                const user = await User.findById(subscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendPaymentSucceededEmail(user, invoice);
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling PayPal payment succeeded', {
                error: error.message,
            });
        }
    }

    /**
     * Handle PayPal payment failed
     */
    private static async handlePayPalPaymentFailed(sale: any): Promise<void> {
        try {
            const subscription = await Subscription.findOne({
                gatewaySubscriptionId: sale.billing_agreement_id,
            });

            if (subscription) {
                subscription.status = 'past_due';
                await subscription.save();

                const user = await User.findById(subscription.userId);
                if (user) {
                    await SubscriptionNotificationService.sendPaymentFailedEmail(
                        user,
                        subscription,
                        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
                    );
                }
            }
        } catch (error: any) {
            loggingService.error('Error handling PayPal payment failed', {
                error: error.message,
            });
        }
    }
}

