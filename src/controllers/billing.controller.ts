import { Response, NextFunction } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { Invoice } from '../models/Invoice';
import { PaymentMethod } from '../models/PaymentMethod';
import { paymentGatewayManager } from '../services/paymentGateway/paymentGatewayManager.service';
import { loggingService } from '../services/logging.service';

export class BillingController {
    /**
     * Get billing history (invoices)
     * GET /api/billing/invoices
     */
    static async getInvoices(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const limit = parseInt(req.query.limit as string) || 10;
            const offset = parseInt(req.query.offset as string) || 0;

            const { invoices, total } = await SubscriptionService.getBillingHistory(userId, limit, offset);

            res.json({
                success: true,
                data: {
                    invoices,
                    pagination: {
                        total,
                        limit,
                        offset,
                        hasMore: offset + limit < total,
                    },
                },
            });
        } catch (error: any) {
            loggingService.error('Get invoices failed', {
                userId: req.user!.id,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get single invoice
     * GET /api/billing/invoices/:invoiceId
     */
    static async getInvoice(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { invoiceId } = req.params;

            const invoice = await Invoice.findOne({
                _id: invoiceId,
                userId,
            }).populate('paymentMethodId');

            if (!invoice) {
                res.status(404).json({
                    success: false,
                    message: 'Invoice not found',
                });
                return;
            }

            res.json({
                success: true,
                data: invoice,
            });
        } catch (error: any) {
            loggingService.error('Get invoice failed', {
                userId: req.user!.id,
                invoiceId: req.params.invoiceId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get payment methods
     * GET /api/billing/payment-methods
     */
    static async getPaymentMethods(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            const paymentMethods = await PaymentMethod.find({
                userId,
                isActive: true,
            }).sort({ isDefault: -1, createdAt: -1 });

            res.json({
                success: true,
                data: paymentMethods,
            });
        } catch (error: any) {
            loggingService.error('Get payment methods failed', {
                userId: req.user!.id,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Add payment method
     * POST /api/billing/payment-methods
     */
    static async addPaymentMethod(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { gateway, type, cardDetails, upiDetails, bankAccountDetails, paypalEmail, setAsDefault } = req.body;

            if (!['stripe', 'razorpay', 'paypal'].includes(gateway)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid payment gateway',
                });
                return;
            }

            // Get user for customer creation
            const { User } = await import('../models/User');
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create customer in payment gateway if needed
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                const customerResult = await paymentGatewayManager.createCustomer(gateway, {
                    email: user.email,
                    name: user.name,
                    userId: userId.toString(),
                });
                gatewayCustomerId = customerResult.customerId;
            }

            // Create payment method in gateway
            const paymentMethodParams: any = {
                customerId: gatewayCustomerId,
                type,
            };

            if (type === 'card' && cardDetails) {
                paymentMethodParams.cardNumber = cardDetails.number;
                paymentMethodParams.cardExpiryMonth = cardDetails.expiryMonth;
                paymentMethodParams.cardExpiryYear = cardDetails.expiryYear;
                paymentMethodParams.cardCvc = cardDetails.cvc;
                paymentMethodParams.cardholderName = cardDetails.name;
            } else if (type === 'upi' && upiDetails) {
                paymentMethodParams.upiId = upiDetails.upiId;
            } else if (type === 'bank_account' && bankAccountDetails) {
                paymentMethodParams.bankAccountNumber = bankAccountDetails.accountNumber;
                paymentMethodParams.ifsc = bankAccountDetails.ifsc;
                paymentMethodParams.bankName = bankAccountDetails.bankName;
            } else if (type === 'paypal' && paypalEmail) {
                paymentMethodParams.paypalEmail = paypalEmail;
            }

            const gatewayPaymentMethod = await paymentGatewayManager.createPaymentMethod(gateway, paymentMethodParams);

            // Attach to customer and set as default if needed
            if (gateway !== 'paypal') {
                await paymentGatewayManager.getGateway(gateway).attachPaymentMethodToCustomer(
                    gatewayPaymentMethod.paymentMethodId,
                    gatewayCustomerId
                );
            }

            if (setAsDefault) {
                await paymentGatewayManager.getGateway(gateway).setDefaultPaymentMethod(
                    gatewayCustomerId,
                    gatewayPaymentMethod.paymentMethodId
                );
            }

            // Save payment method to database
            const paymentMethod = new PaymentMethod({
                userId,
                gateway,
                gatewayCustomerId,
                gatewayPaymentMethodId: gatewayPaymentMethod.paymentMethodId,
                type: gatewayPaymentMethod.type,
                card: gatewayPaymentMethod.card,
                upi: gatewayPaymentMethod.upi,
                bankAccount: gatewayPaymentMethod.bankAccount,
                paypalAccount: gatewayPaymentMethod.paypalAccount,
                isDefault: setAsDefault || false,
                isActive: true,
                setupForRecurring: true,
                recurringStatus: 'active',
            });

            await paymentMethod.save();

            // If set as default, unset other defaults
            if (setAsDefault) {
                await PaymentMethod.updateMany(
                    { userId, _id: { $ne: paymentMethod._id } },
                    { $set: { isDefault: false } }
                );
            }

            res.json({
                success: true,
                message: 'Payment method added successfully',
                data: paymentMethod,
            });
        } catch (error: any) {
            loggingService.error('Add payment method failed', {
                userId: req.user!.id,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Update payment method
     * PUT /api/billing/payment-methods/:paymentMethodId
     */
    static async updatePaymentMethod(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { paymentMethodId } = req.params;
            const { setAsDefault } = req.body;

            const paymentMethod = await PaymentMethod.findOne({
                _id: paymentMethodId,
                userId,
            });

            if (!paymentMethod) {
                res.status(404).json({
                    success: false,
                    message: 'Payment method not found',
                });
                return;
            }

            if (setAsDefault !== undefined) {
                paymentMethod.isDefault = setAsDefault;
                if (setAsDefault) {
                    // Unset other defaults
                    await PaymentMethod.updateMany(
                        { userId, _id: { $ne: paymentMethod._id } },
                        { $set: { isDefault: false } }
                    );

                    // Set as default in gateway
                    await paymentGatewayManager.getGateway(paymentMethod.gateway).setDefaultPaymentMethod(
                        paymentMethod.gatewayCustomerId,
                        paymentMethod.gatewayPaymentMethodId
                    );
                }
            }

            await paymentMethod.save();

            res.json({
                success: true,
                message: 'Payment method updated successfully',
                data: paymentMethod,
            });
        } catch (error: any) {
            loggingService.error('Update payment method failed', {
                userId: req.user!.id,
                paymentMethodId: req.params.paymentMethodId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Remove payment method
     * DELETE /api/billing/payment-methods/:paymentMethodId
     */
    static async removePaymentMethod(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { paymentMethodId } = req.params;

            const paymentMethod = await PaymentMethod.findOne({
                _id: paymentMethodId,
                userId,
            });

            if (!paymentMethod) {
                res.status(404).json({
                    success: false,
                    message: 'Payment method not found',
                });
                return;
            }

            // Check if it's the only payment method for active subscription
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (subscription && subscription.paymentMethodId?.toString() === paymentMethodId) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot remove payment method that is currently in use. Please update your subscription first.',
                });
                return;
            }

            // Delete from payment gateway
            try {
                await paymentGatewayManager.getGateway(paymentMethod.gateway).deletePaymentMethod(
                    paymentMethod.gatewayPaymentMethodId
                );
            } catch (error: any) {
                // Some gateways don't support deletion - that's okay
                loggingService.warn('Payment method deletion in gateway failed (may not be supported)', {
                    gateway: paymentMethod.gateway,
                    error: error.message,
                });
            }

            // Mark as inactive instead of deleting (for audit trail)
            paymentMethod.isActive = false;
            paymentMethod.recurringStatus = 'cancelled';
            await paymentMethod.save();

            res.json({
                success: true,
                message: 'Payment method removed successfully',
            });
        } catch (error: any) {
            loggingService.error('Remove payment method failed', {
                userId: req.user!.id,
                paymentMethodId: req.params.paymentMethodId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get upcoming invoice preview
     * GET /api/billing/invoices/upcoming
     */
    static async getUpcomingInvoice(req: any, res: Response, next: NextFunction): Promise<void> {
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

            if (subscription.plan === 'free') {
                res.json({
                    success: true,
                    data: null,
                    message: 'No upcoming invoice for free plan',
                });
                return;
            }

            // Calculate upcoming invoice
            const pricing = SubscriptionService.getPlanPricing(
                subscription.plan,
                subscription.billing.interval
            );

            const lineItems: Array<{
                description: string;
                quantity: number;
                unitPrice: number;
                total: number;
                type: 'plan' | 'overage' | 'discount' | 'proration' | 'tax' | 'seat' | 'other';
            }> = [
                {
                    description: `${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)} Plan - ${subscription.billing.interval}`,
                    quantity: 1,
                    unitPrice: pricing.amount,
                    total: pricing.amount,
                    type: 'plan',
                },
            ];

            // Add discount if applicable
            if (subscription.discount) {
                const discountAmount = subscription.discount.type === 'percentage'
                    ? (pricing.amount * subscription.discount.amount!) / 100
                    : subscription.discount.amount!;

                lineItems.push({
                    description: `Discount: ${subscription.discount.code}`,
                    quantity: 1,
                    unitPrice: -discountAmount,
                    total: -discountAmount,
                    type: 'discount',
                });
            }

            const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
            const tax = subtotal * 0.1; // 10% tax
            const total = subtotal + tax;

            res.json({
                success: true,
                data: {
                    subscriptionId: subscription._id,
                    periodStart: subscription.billing.nextBillingDate || subscription.usage.currentPeriodEnd,
                    periodEnd: subscription.billing.interval === 'monthly'
                        ? new Date(new Date(subscription.billing.nextBillingDate || subscription.usage.currentPeriodEnd).setMonth(new Date(subscription.billing.nextBillingDate || subscription.usage.currentPeriodEnd).getMonth() + 1))
                        : new Date(new Date(subscription.billing.nextBillingDate || subscription.usage.currentPeriodEnd).setFullYear(new Date(subscription.billing.nextBillingDate || subscription.usage.currentPeriodEnd).getFullYear() + 1)),
                    lineItems,
                    subtotal,
                    tax,
                    total,
                    currency: subscription.billing.currency,
                    dueDate: subscription.billing.nextBillingDate || subscription.usage.currentPeriodEnd,
                },
            });
        } catch (error: any) {
            loggingService.error('Get upcoming invoice failed', {
                userId: req.user!.id,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get payment gateway configuration (public keys only)
     * GET /api/billing/payment-config
     */
    static async getPaymentConfig(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const config: Record<string, any> = {};

            // Return PayPal client ID (public key - safe to expose)
            if (process.env.PAYPAL_CLIENT_ID) {
                config.paypal = {
                    clientId: process.env.PAYPAL_CLIENT_ID,
                    mode: process.env.PAYPAL_MODE || 'sandbox',
                };
            }

            // Return Stripe publishable key (public key - safe to expose)
            // Check for STRIPE_PUBLISHABLE_KEY first, otherwise extract from secret key pattern
            if (process.env.STRIPE_PUBLISHABLE_KEY) {
                config.stripe = {
                    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
                };
            } else if (process.env.STRIPE_SECRET_KEY) {
                // Extract publishable key pattern from secret key
                // Stripe keys: sk_test_... -> pk_test_..., sk_live_... -> pk_live_...
                const secretKey = process.env.STRIPE_SECRET_KEY;
                if (secretKey.startsWith('sk_test_')) {
                    config.stripe = {
                        publishableKey: secretKey.replace('sk_test_', 'pk_test_'),
                        note: 'Publishable key derived from secret key pattern',
                    };
                } else if (secretKey.startsWith('sk_live_')) {
                    config.stripe = {
                        publishableKey: secretKey.replace('sk_live_', 'pk_live_'),
                        note: 'Publishable key derived from secret key pattern',
                    };
                }
            }

            // Return Razorpay key ID (public key - safe to expose)
            if (process.env.RAZORPAY_KEY_ID) {
                config.razorpay = {
                    keyId: process.env.RAZORPAY_KEY_ID,
                };
            }

            res.json({
                success: true,
                data: config,
            });
        } catch (error: any) {
            loggingService.error('Get payment config failed', {
                userId: req.user?.id,
                error: error.message,
            });
            next(error);
        }
        return;
    }
}

