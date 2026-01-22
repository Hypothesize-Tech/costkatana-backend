import { Response, NextFunction } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { Invoice } from '../models/Invoice';
import { PaymentMethod } from '../models/PaymentMethod';
import { paymentGatewayManager } from '../services/paymentGateway/paymentGatewayManager.service';
import { loggingService } from '../services/logging.service';
import { convertToSmallestUnit } from '../utils/currencyConverter';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class BillingController {
    /**
     * Get billing history (invoices)
     * GET /api/billing/invoices
     */
    static async getInvoices(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getInvoices', req);
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const offset = parseInt(req.query.offset as string) || 0;

            const { invoices, total } = await SubscriptionService.getBillingHistory(userId, limit, offset);

            ControllerHelper.logRequestSuccess('getInvoices', req, startTime, {
                total,
                limit,
                offset
            });

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
            ControllerHelper.handleError('getInvoices', error, req, res, startTime);
        }
    }

    /**
     * Get single invoice
     * GET /api/billing/invoices/:invoiceId
     */
    static async getInvoice(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getInvoice', req);
        try {
            const { invoiceId } = req.params;
            ServiceHelper.validateObjectId(invoiceId, 'invoiceId');

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

            ControllerHelper.logRequestSuccess('getInvoice', req, startTime, {
                invoiceId
            });

            res.json({
                success: true,
                data: invoice,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getInvoice', error, req, res, startTime, {
                invoiceId: req.params.invoiceId
            });
        }
    }

    /**
     * Get payment methods
     * GET /api/billing/payment-methods
     */
    static async getPaymentMethods(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getPaymentMethods', req);
        try {
            const paymentMethods = await PaymentMethod.find({
                userId,
                isActive: true,
            }).sort({ isDefault: -1, createdAt: -1 });

            ControllerHelper.logRequestSuccess('getPaymentMethods', req, startTime, {
                count: paymentMethods.length
            });

            res.json({
                success: true,
                data: paymentMethods,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPaymentMethods', error, req, res, startTime);
        }
    }

    /**
     * Add payment method
     * POST /api/billing/payment-methods
     */
    static async addPaymentMethod(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('addPaymentMethod', req);
        try {
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

            ControllerHelper.logRequestSuccess('addPaymentMethod', req, startTime, {
                paymentMethodId: paymentMethod._id,
                gateway,
                type
            });

            res.json({
                success: true,
                message: 'Payment method added successfully',
                data: paymentMethod,
            });
        } catch (error: any) {
            ControllerHelper.handleError('addPaymentMethod', error, req, res, startTime, {
                gateway: req.body.gateway,
                type: req.body.type
            });
        }
    }

    /**
     * Update payment method
     * PUT /api/billing/payment-methods/:paymentMethodId
     */
    static async updatePaymentMethod(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('updatePaymentMethod', req);
        try {
            const { paymentMethodId } = req.params;
            ServiceHelper.validateObjectId(paymentMethodId, 'paymentMethodId');
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

            ControllerHelper.logRequestSuccess('updatePaymentMethod', req, startTime, {
                paymentMethodId
            });

            res.json({
                success: true,
                message: 'Payment method updated successfully',
                data: paymentMethod,
            });
        } catch (error: any) {
            ControllerHelper.handleError('updatePaymentMethod', error, req, res, startTime, {
                paymentMethodId: req.params.paymentMethodId
            });
        }
    }

    /**
     * Remove payment method
     * DELETE /api/billing/payment-methods/:paymentMethodId
     */
    static async removePaymentMethod(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('removePaymentMethod', req);
        try {
            const { paymentMethodId } = req.params;
            ServiceHelper.validateObjectId(paymentMethodId, 'paymentMethodId');

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

            ControllerHelper.logRequestSuccess('removePaymentMethod', req, startTime, {
                paymentMethodId
            });

            res.json({
                success: true,
                message: 'Payment method removed successfully',
            });
        } catch (error: any) {
            ControllerHelper.handleError('removePaymentMethod', error, req, res, startTime, {
                paymentMethodId: req.params.paymentMethodId
            });
        }
    }

    /**
     * Get upcoming invoice preview
     * GET /api/billing/invoices/upcoming
     */
    static async getUpcomingInvoice(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUpcomingInvoice', req);
        try {

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
            ControllerHelper.handleError('getUpcomingInvoice', error, req, res, startTime);
        }
    }

    /**
     * Create Razorpay order for payment method collection
     * POST /api/billing/payment-methods/razorpay/create-order
     */
    static async createRazorpayPaymentMethodOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('createRazorpayPaymentMethodOrder', req);
        try {
            const { amount, currency } = req.body;

            // Default to minimal amount if not provided
            // Razorpay requires minimum 1.00 in base currency (1 USD or 1 INR)
            const MINIMUM_ORDER_AMOUNT = 1.0;
            const orderAmount = amount || MINIMUM_ORDER_AMOUNT;
            const orderCurrency = (currency || 'USD').toUpperCase();

            // Validate minimum amount
            if (orderAmount < MINIMUM_ORDER_AMOUNT) {
                res.status(400).json({
                    success: false,
                    message: `Order amount (${orderCurrency} ${orderAmount.toFixed(2)}) is below the minimum required amount of ${orderCurrency} ${MINIMUM_ORDER_AMOUNT.toFixed(2)}.`,
                });
                return;
            }

            // Get user
            const { User } = await import('../models/User');
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Validate user email (required for Razorpay customer creation)
            if (!user.email) {
                res.status(400).json({
                    success: false,
                    message: 'User email is required. Please update your profile with an email address.',
                });
                return;
            }

            // Check if Razorpay gateway is available
            if (!paymentGatewayManager.isGatewayAvailable('razorpay')) {
                res.status(500).json({
                    success: false,
                    message: 'Razorpay payment gateway is not available',
                });
                return;
            }

            const razorpayGateway = paymentGatewayManager.getGateway('razorpay') as any;
            if (!razorpayGateway || !razorpayGateway.razorpay) {
                res.status(500).json({
                    success: false,
                    message: 'Razorpay SDK is not initialized',
                });
                return;
            }

            // Get or create Razorpay customer (for future use, not required for order creation)
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'razorpay' });
            if (!existingPaymentMethod) {
                // Create customer if it doesn't exist (for future payment method attachment)
                try {
                    await paymentGatewayManager.createCustomer('razorpay', {
                        email: user.email,
                        name: user.name || user.email,
                        userId: userId.toString(),
                    });
                } catch (customerError: any) {
                    // Log but don't fail - customer creation is not required for order creation
                    loggingService.warn('Failed to create Razorpay customer during order creation', {
                        userId,
                        error: customerError?.message || String(customerError),
                    });
                }
            }

            // Convert amount to smallest currency unit (cents for USD, paise for INR)
            const amountInSmallestUnit = convertToSmallestUnit(orderAmount, orderCurrency);

            // Create Razorpay order
            // Receipt must be max 40 characters (Razorpay requirement)
            // Format: pm_<shortUserId>_<shortTimestamp>
            const shortUserId = userId.toString().substring(0, 12); // First 12 chars of userId
            const shortTimestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
            const receipt = `pm_${shortUserId}_${shortTimestamp}`; // Max length: 3 + 12 + 1 + 8 = 24 chars
            
            let order;
            try {
                order = await razorpayGateway.razorpay.orders.create({
                    amount: amountInSmallestUnit,
                    currency: orderCurrency,
                    receipt: receipt,
                    notes: {
                        userId: userId.toString(),
                        purpose: 'payment_method_collection',
                    },
                });
            } catch (razorpayError: any) {
                loggingService.error('Razorpay order creation failed', {
                    userId,
                    amount: amountInSmallestUnit,
                    currency: orderCurrency,
                    error: razorpayError?.message || String(razorpayError),
                    errorDetails: razorpayError?.error || razorpayError,
                });
                res.status(400).json({
                    success: false,
                    message: razorpayError?.error?.description || razorpayError?.message || 'Failed to create Razorpay order',
                });
                return;
            }

            loggingService.info('Razorpay order created for payment method collection', {
                userId,
                orderId: order.id,
                amount: orderAmount,
                currency: orderCurrency,
            });

            res.json({
                success: true,
                data: {
                    orderId: order.id,
                    keyId: process.env.RAZORPAY_KEY_ID,
                    amount: amountInSmallestUnit,
                    currency: orderCurrency,
                    convertedAmount: orderAmount,
                },
            });
        } catch (error: any) {
            loggingService.error('Create Razorpay payment method order failed', {
                userId: req.user!.id,
                error: error.message,
                errorStack: error.stack,
                errorDetails: error,
                requestBody: req.body,
            });
            next(error);
        }
        return;
    }

    /**
     * Save Razorpay payment method after successful checkout
     * POST /api/billing/payment-methods/razorpay/save
     */
    static async saveRazorpayPaymentMethod(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('saveRazorpayPaymentMethod', req);
        try {
            const { paymentId, orderId, signature, setAsDefault } = req.body;

            if (!paymentId || !orderId || !signature) {
                res.status(400).json({
                    success: false,
                    message: 'Payment ID, Order ID, and signature are required',
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

            // Verify payment signature
            const razorpayGateway = paymentGatewayManager.getGateway('razorpay') as any;
            if (!razorpayGateway || !razorpayGateway.razorpay) {
                res.status(500).json({
                    success: false,
                    message: 'Razorpay gateway is not available',
                });
                return;
            }

            // Verify signature
            const crypto = require('crypto');
            const text = `${orderId}|${paymentId}`;
            const generatedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
                .update(text)
                .digest('hex');

            if (generatedSignature !== signature) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid payment signature',
                });
                return;
            }

            // Fetch payment details from Razorpay
            const payment = await razorpayGateway.razorpay.payments.fetch(paymentId);

            // Create or get Razorpay customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'razorpay' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                const customerResult = await paymentGatewayManager.createCustomer('razorpay', {
                    email: user.email,
                    name: user.name || user.email,
                    userId: userId.toString(),
                });
                gatewayCustomerId = customerResult.customerId;
            }

            // Extract payment method details from payment
            const paymentMethodType = payment.method || 'card';
            let paymentMethodData: any = {
                gateway: 'razorpay',
                gatewayCustomerId,
                gatewayPaymentMethodId: paymentId, // Use payment ID as payment method ID
                type: paymentMethodType,
                isDefault: setAsDefault || false,
                isActive: true,
                setupForRecurring: true,
                recurringStatus: 'active',
            };

            // Extract card details if available
            if (payment.card) {
                paymentMethodData.card = {
                    last4: payment.card.last4 || '',
                    brand: payment.card.network?.toLowerCase() || 'unknown',
                    expiryMonth: payment.card.expiry_month || null,
                    expiryYear: payment.card.expiry_year || null,
                    maskedNumber: `**** **** **** ${payment.card.last4 || ''}`,
                };
            }

            // Extract UPI details if available
            if (payment.vpa) {
                paymentMethodData.type = 'upi';
                paymentMethodData.upi = {
                    upiId: payment.vpa,
                    vpa: payment.vpa,
                };
            }

            // Check if payment method already exists
            let paymentMethod = await PaymentMethod.findOne({
                userId,
                gateway: 'razorpay',
                gatewayPaymentMethodId: paymentId,
            });

            if (paymentMethod) {
                // Update existing payment method
                Object.assign(paymentMethod, paymentMethodData);
                await paymentMethod.save();
            } else {
                // Create new payment method
                paymentMethod = new PaymentMethod(paymentMethodData);
                paymentMethod.userId = userId as any;
                await paymentMethod.save();
            }

            // If set as default, unset other defaults
            if (setAsDefault) {
                await PaymentMethod.updateMany(
                    { userId, _id: { $ne: paymentMethod._id } },
                    { $set: { isDefault: false } }
                );

                // Set as default in gateway if supported
                try {
                    await razorpayGateway.setDefaultPaymentMethod(
                        gatewayCustomerId,
                        paymentId
                    );
                } catch (error: any) {
                    // Razorpay may not support setting default payment method directly
                    loggingService.warn('Failed to set default payment method in Razorpay', {
                        error: error.message,
                    });
                }
            }

            res.json({
                success: true,
                message: 'Payment method saved successfully',
                data: paymentMethod,
            });
        } catch (error: any) {
            loggingService.error('Save Razorpay payment method failed', {
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
    static async getPaymentConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        // This endpoint may not require auth, but we'll check if userId exists
        const userId = req.userId;
        ControllerHelper.logRequestStart('getPaymentConfig', req);
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

            ControllerHelper.logRequestSuccess('getPaymentConfig', req, startTime, {
                gatewaysConfigured: Object.keys(config).length
            });

            res.json({
                success: true,
                data: config,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPaymentConfig', error, req, res, startTime);
        }
    }
}

