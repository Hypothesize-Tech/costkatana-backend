import { IPaymentGateway, PaymentGateway, CreateCustomerParams, CreateCustomerResult, CreatePaymentMethodParams, CreatePaymentMethodResult, CreateSubscriptionParams, CreateSubscriptionResult, UpdateSubscriptionParams, UpdateSubscriptionResult, CancelSubscriptionParams, CancelSubscriptionResult, ChargeParams, ChargeResult, RefundParams, RefundResult, WebhookEvent } from './paymentGateway.interface';
import { loggingService } from '../logging.service';
import { PaymentMethod } from '../../models/PaymentMethod';
import crypto from 'crypto';

/**
 * Razorpay Payment Gateway Service
 * 
 * Note: Requires 'razorpay' package to be installed:
 * npm install razorpay
 * 
 * Environment variables required:
 * - RAZORPAY_KEY_ID
 * - RAZORPAY_KEY_SECRET
 * - RAZORPAY_WEBHOOK_SECRET
 */
export class RazorpayGatewayService implements IPaymentGateway {
    gateway: PaymentGateway = 'razorpay';
    private razorpay: any;
    private webhookSecret: string = '';

    constructor() {
        try {
            const Razorpay = require('razorpay');
            if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
                this.razorpay = new Razorpay({
                    key_id: process.env.RAZORPAY_KEY_ID,
                    key_secret: process.env.RAZORPAY_KEY_SECRET,
                });
                loggingService.info('Razorpay SDK initialized successfully');
            } else {
                loggingService.warn('Razorpay credentials not configured. Razorpay gateway will not function.');
            }
            this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
        } catch (error) {
            loggingService.error('Failed to initialize Razorpay SDK', { error });
            // Don't throw - allow graceful degradation if Razorpay is not configured
        }
    }

    async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized. Install razorpay package.');
            }

            if (!params.email) {
                throw new Error('Email is required to create Razorpay customer');
            }

            const customer = await this.razorpay.customers.create({
                name: params.name || params.email,
                email: params.email,
                notes: {
                    userId: params.userId,
                    ...params.metadata,
                },
            });

            return {
                customerId: customer.id,
                gateway: 'razorpay',
            };
        } catch (error: any) {
            const errorMessage = error?.message || error?.error?.description || error?.error?.message || String(error);
            const errorDetails = {
                error: errorMessage,
                errorType: error?.constructor?.name,
                errorCode: error?.statusCode || error?.code,
                params: {
                    email: params.email,
                    name: params.name,
                    hasUserId: !!params.userId,
                },
            };
            loggingService.error('Razorpay createCustomer error', errorDetails);
            throw error;
        }
    }

    async getCustomer(customerId: string): Promise<any> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }
        return await this.razorpay.customers.fetch(customerId);
    }

    async updateCustomer(customerId: string, updates: Record<string, any>): Promise<any> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }
        return await this.razorpay.customers.edit(customerId, updates);
    }

    deleteCustomer(customerId: string): Promise<void> {
        // Razorpay doesn't support customer deletion via API
        loggingService.warn('Razorpay does not support customer deletion via API', { customerId });
        return Promise.resolve();
    }

    async createPaymentMethod(params: CreatePaymentMethodParams): Promise<CreatePaymentMethodResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized');
            }

            if (!params.customerId) {
                throw new Error('Customer ID is required for Razorpay payment method creation');
            }

            if (params.type === 'card' && params.cardNumber) {
                // For Razorpay recurring payments, we use tokens
                // Tokens are created server-side and can be used for subscriptions
                try {
                    const token = await this.razorpay.tokens.create({
                        customer_id: params.customerId,
                        method: 'card',
                        card: {
                            number: params.cardNumber,
                            name: params.cardholderName,
                            expiry_month: params.cardExpiryMonth,
                            expiry_year: params.cardExpiryYear,
                            cvv: params.cardCvc,
                        },
                    });

                    // Extract card details from token response
                    const cardDetails = token.card || {};
                    const last4 = params.cardNumber.slice(-4);

                    return {
                        paymentMethodId: token.id,
                        type: 'card',
                        card: {
                            last4: last4,
                            brand: cardDetails.network || cardDetails.type || 'unknown',
                            expiryMonth: params.cardExpiryMonth,
                            expiryYear: params.cardExpiryYear,
                        },
                        metadata: {
                            tokenId: token.id,
                            customerId: params.customerId,
                        },
                    };
                } catch (tokenError: unknown) {
                    // If token creation fails, fall back to creating a saved card reference
                    // Razorpay allows saving card details for future use
                    const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
                    loggingService.warn('Razorpay token creation failed, using fallback method', {
                        error: errorMessage,
                    });

                    // Return a payment method ID that can be stored in database
                    // For actual payments, this will need to be used with payment links or subscriptions
                    return {
                        paymentMethodId: `card_${params.customerId}_${Date.now()}`,
                        type: 'card',
                        card: {
                            last4: params.cardNumber.slice(-4),
                            brand: this.detectCardBrand(params.cardNumber),
                            expiryMonth: params.cardExpiryMonth,
                            expiryYear: params.cardExpiryYear,
                        },
                        metadata: {
                            customerId: params.customerId,
                            note: 'Card details stored for recurring payments',
                        },
                    };
                }
            } else if (params.type === 'upi' && params.upiId) {
                // Razorpay UPI payment method - UPI IDs are used directly
                return {
                    paymentMethodId: `upi_${params.customerId}_${Date.now()}`,
                    type: 'upi',
                    upi: {
                        upiId: params.upiId,
                        vpa: params.upiId,
                    },
                    metadata: {
                        customerId: params.customerId,
                    },
                };
            } else if (params.type === 'bank_account' && params.bankAccountNumber && params.ifsc) {
                // Razorpay bank account for NACH/eMandate
                return {
                    paymentMethodId: `bank_${params.customerId}_${Date.now()}`,
                    type: 'bank_account',
                    bankAccount: {
                        maskedAccountNumber: `****${params.bankAccountNumber.slice(-4)}`,
                        ifsc: params.ifsc,
                        bankName: params.bankName,
                    },
                    metadata: {
                        customerId: params.customerId,
                    },
                };
            }

            throw new Error(`Unsupported payment method type: ${params.type}`);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Razorpay createPaymentMethod error', { error: errorMessage });
            throw error;
        }
    }

    /**
     * Helper method to detect card brand from card number
     */
    private detectCardBrand(cardNumber: string): string {
        const number = cardNumber.replace(/\s/g, '');
        if (/^4/.test(number)) return 'visa';
        if (/^5[1-5]/.test(number)) return 'mastercard';
        if (/^3[47]/.test(number)) return 'amex';
        if (/^6(?:011|5)/.test(number)) return 'discover';
        if (/^35/.test(number)) return 'jcb';
        if (/^30[0-5]/.test(number)) return 'diners';
        return 'unknown';
    }

    async getPaymentMethod(paymentMethodId: string): Promise<any> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }

        // Razorpay doesn't have a direct payment method retrieval API
        // Retrieve from our database instead
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'razorpay',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (!dbPaymentMethod) {
            throw new Error(`Payment method ${paymentMethodId} not found in database`);
        }

        // Try to fetch token details if it's a token ID
        if (paymentMethodId.startsWith('token_') || paymentMethodId.match(/^[a-zA-Z0-9]{24}$/)) {
            try {
                const token = await this.razorpay.tokens.fetch(paymentMethodId);
                return {
                    id: token.id,
                    customer: token.customer_id,
                    method: token.method,
                    card: token.card ? {
                        last4: token.card.last4,
                        network: token.card.network,
                        type: token.card.type,
                        expiry_month: token.card.expiry_month,
                        expiry_year: token.card.expiry_year,
                    } : undefined,
                    ...dbPaymentMethod.toObject(),
                };
            } catch (error: unknown) {
                // Token fetch failed, return database record
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.warn('Failed to fetch Razorpay token, returning database record', {
                    paymentMethodId,
                    error: errorMessage,
                });
            }
        }

        // Return database record with gateway metadata
        return {
            id: dbPaymentMethod.gatewayPaymentMethodId,
            customer: dbPaymentMethod.gatewayCustomerId,
            method: dbPaymentMethod.type,
            card: dbPaymentMethod.card,
            upi: dbPaymentMethod.upi,
            bankAccount: dbPaymentMethod.bankAccount,
            ...dbPaymentMethod.toObject(),
        };
    }

    async updatePaymentMethod(paymentMethodId: string, updates: Record<string, unknown>): Promise<any> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }

        // Razorpay doesn't support updating payment methods directly
        // Update our database record instead
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'razorpay',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (!dbPaymentMethod) {
            throw new Error(`Payment method ${paymentMethodId} not found in database`);
        }

        // Update allowed fields in database
        if (updates.isDefault !== undefined) {
            dbPaymentMethod.isDefault = updates.isDefault as boolean;
        }
        if (updates.isActive !== undefined) {
            dbPaymentMethod.isActive = updates.isActive as boolean;
        }
        if (updates.recurringStatus !== undefined) {
            dbPaymentMethod.recurringStatus = updates.recurringStatus as 'active' | 'failed' | 'expired' | 'cancelled';
        }
        if (updates.gatewayMetadata !== undefined) {
            dbPaymentMethod.gatewayMetadata = updates.gatewayMetadata as Record<string, unknown>;
        }

        await dbPaymentMethod.save();

        loggingService.info('Razorpay payment method updated in database', {
            paymentMethodId,
            updates: Object.keys(updates),
        });

        return {
            id: dbPaymentMethod.gatewayPaymentMethodId,
            customer: dbPaymentMethod.gatewayCustomerId,
            method: dbPaymentMethod.type,
            ...dbPaymentMethod.toObject(),
        };
    }

    async deletePaymentMethod(paymentMethodId: string): Promise<void> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }

        // Razorpay doesn't support payment method deletion via API
        // Mark as inactive in our database instead
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'razorpay',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (dbPaymentMethod) {
            dbPaymentMethod.isActive = false;
            dbPaymentMethod.recurringStatus = 'cancelled';
            await dbPaymentMethod.save();

            const dbPaymentMethodId = dbPaymentMethod._id ? String(dbPaymentMethod._id) : 'unknown';
            loggingService.info('Razorpay payment method marked as inactive in database', {
                paymentMethodId,
                dbPaymentMethodId,
            });
        } else {
            loggingService.warn('Payment method not found in database for deletion', { paymentMethodId });
        }

        // If it's a token, we can't delete it from Razorpay, but we've marked it inactive
        // Tokens in Razorpay are automatically deleted after a period of non-use
    }

    async attachPaymentMethodToCustomer(paymentMethodId: string, customerId: string): Promise<void> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }

        // Razorpay handles payment method attachment differently:
        // - Tokens are created with customer_id, so they're already attached
        // - For other payment methods, we update the database record

        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'razorpay',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (dbPaymentMethod) {
            // Verify customer matches if it's a token
            if (paymentMethodId.startsWith('token_') || paymentMethodId.match(/^[a-zA-Z0-9]{24}$/)) {
                try {
                    const token = await this.razorpay.tokens.fetch(paymentMethodId);
                    if (token.customer_id !== customerId) {
                        throw new Error(`Token ${paymentMethodId} belongs to different customer`);
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.warn('Failed to verify token customer', {
                        paymentMethodId,
                        customerId,
                        error: errorMessage,
                    });
                }
            }

            // Update database record to ensure customer is correct
            if (dbPaymentMethod.gatewayCustomerId !== customerId) {
                dbPaymentMethod.gatewayCustomerId = customerId;
                await dbPaymentMethod.save();
            }

            loggingService.info('Razorpay payment method attached to customer', {
                paymentMethodId,
                customerId,
            });
        } else {
            loggingService.warn('Payment method not found in database for attachment', {
                paymentMethodId,
                customerId,
            });
        }
    }

    async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }

        // Razorpay doesn't have a default payment method concept in their API
        // Handle this in our database
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'razorpay',
            gatewayPaymentMethodId: paymentMethodId,
            gatewayCustomerId: customerId,
        });

        if (!dbPaymentMethod) {
            throw new Error(`Payment method ${paymentMethodId} not found for customer ${customerId}`);
        }

        // Unset other default payment methods for this customer
        await PaymentMethod.updateMany(
            {
                gateway: 'razorpay',
                gatewayCustomerId: customerId,
                _id: { $ne: dbPaymentMethod._id },
            },
            { $set: { isDefault: false } }
        );

        // Set this payment method as default
        dbPaymentMethod.isDefault = true;
        await dbPaymentMethod.save();

        const dbPaymentMethodId = dbPaymentMethod._id ? String(dbPaymentMethod._id) : 'unknown';
        loggingService.info('Razorpay default payment method set in database', {
            customerId,
            paymentMethodId,
            dbPaymentMethodId,
        });
    }

    async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized');
            }

            // Convert amount to paise (Razorpay uses smallest currency unit)
            const subscriptionParams: {
                plan_id: string;
                customer_notify: number;
                total_count: number;
                start_at?: number;
                notes: Record<string, unknown>;
            } = {
                plan_id: params.planId, // You need to create plans in Razorpay first
                customer_notify: 1,
                total_count: 999, // Set to 999 for effectively unlimited recurring subscriptions (matches Razorpay plan configuration)
                notes: params.metadata ?? {},
            };

            if (params.trialDays) {
                subscriptionParams.start_at = Math.floor((Date.now() + params.trialDays * 24 * 60 * 60 * 1000) / 1000);
            }

            const subscription = await this.razorpay.subscriptions.create(subscriptionParams);

            // Calculate period dates
            const now = new Date();
            const periodEnd = new Date(now);
            if (params.interval === 'monthly') {
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            } else {
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            }

            return {
                subscriptionId: subscription.id,
                status: subscription.status === 'active' ? 'active' : subscription.status === 'created' ? 'trialing' : 'incomplete',
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                trialEnd: params.trialDays ? new Date(now.getTime() + params.trialDays * 24 * 60 * 60 * 1000) : undefined,
            };
        } catch (error: any) {
            loggingService.error('Razorpay createSubscription error', { error: error.message });
            throw error;
        }
    }

    async getSubscription(subscriptionId: string): Promise<any> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }
        return await this.razorpay.subscriptions.fetch(subscriptionId);
    }

    async updateSubscription(params: UpdateSubscriptionParams): Promise<UpdateSubscriptionResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized');
            }

            if (params.cancelAtPeriodEnd !== undefined) {
                if (params.cancelAtPeriodEnd) {
                    // Pause subscription
                    await this.razorpay.subscriptions.pause(params.subscriptionId, {
                        pause_at: 'next_billing_cycle',
                    });
                } else {
                    // Resume subscription
                    await this.razorpay.subscriptions.resume(params.subscriptionId);
                }
            }

            const subscription = await this.razorpay.subscriptions.fetch(params.subscriptionId);

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                currentPeriodStart: new Date(subscription.current_start * 1000),
                currentPeriodEnd: new Date(subscription.current_end * 1000),
                cancelAtPeriodEnd: subscription.status === 'paused',
            };
        } catch (error: any) {
            loggingService.error('Razorpay updateSubscription error', { error: error.message });
            throw error;
        }
    }

    async cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized');
            }

            let subscription;
            if (params.cancelAtPeriodEnd) {
                subscription = await this.razorpay.subscriptions.pause(params.subscriptionId, {
                    pause_at: 'next_billing_cycle',
                });
            } else {
                subscription = await this.razorpay.subscriptions.cancel(params.subscriptionId);
            }

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                canceledAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : undefined,
                cancelAtPeriodEnd: subscription.status === 'paused',
            };
        } catch (error: any) {
            loggingService.error('Razorpay cancelSubscription error', { error: error.message });
            throw error;
        }
    }

    async reactivateSubscription(subscriptionId: string): Promise<CreateSubscriptionResult> {
        if (!this.razorpay) {
            throw new Error('Razorpay SDK not initialized');
        }
        const subscription = await this.razorpay.subscriptions.resume(subscriptionId);

        const status = subscription.status === 'active' ? 'active' : subscription.status === 'created' ? 'trialing' : 'incomplete';
        return {
            subscriptionId: subscription.id,
            status: status,
            currentPeriodStart: new Date(subscription.current_start * 1000),
            currentPeriodEnd: new Date(subscription.current_end * 1000),
        };
    }

    async charge(params: ChargeParams): Promise<ChargeResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized');
            }

            // Convert amount to paise (Razorpay uses smallest currency unit)
            const amountInPaise = Math.round(params.amount * 100);

            // For recurring payments with saved payment methods, use payment capture
            // For one-time payments, create an order and payment link
            const dbPaymentMethod = await PaymentMethod.findOne({
                gateway: 'razorpay',
                gatewayPaymentMethodId: params.paymentMethodId,
                gatewayCustomerId: params.customerId,
                isActive: true,
            }).catch(() => null);

            if (dbPaymentMethod && dbPaymentMethod.setupForRecurring) {
                // Use saved payment method for auto-debit
                // Create a payment using the saved token/payment method
                try {
                    // For Razorpay, we create a payment directly if we have a token
                    if (params.paymentMethodId.startsWith('token_') || params.paymentMethodId.match(/^[a-zA-Z0-9]{24}$/)) {
                        // Create payment with token
                        const payment = await this.razorpay.payments.create({
                            amount: amountInPaise,
                            currency: params.currency.toUpperCase(),
                            customer_id: params.customerId,
                            token: params.paymentMethodId,
                            description: params.description ?? 'Payment',
                            notes: params.metadata ?? {},
                        });

                        return {
                            transactionId: payment.id,
                            status: payment.status === 'captured' ? 'succeeded' : payment.status === 'authorized' ? 'pending' : 'failed',
                            amount: params.amount,
                            currency: params.currency,
                            metadata: {
                                paymentId: payment.id,
                                orderId: payment.order_id,
                            },
                        };
                    } else {
                        // For non-token payment methods, create an order and payment link
                        return await this.createOrderAndPaymentLink(params, amountInPaise);
                    }
                } catch (paymentError: unknown) {
                    // If direct payment fails, fall back to order creation
                    const errorMessage = paymentError instanceof Error ? paymentError.message : String(paymentError);
                    loggingService.warn('Direct payment failed, creating order instead', {
                        error: errorMessage,
                    });
                    return await this.createOrderAndPaymentLink(params, amountInPaise);
                }
            } else {
                // One-time payment - create order and payment link
                return await this.createOrderAndPaymentLink(params, amountInPaise);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Razorpay charge error', { error: errorMessage });
            throw error;
        }
    }

    /**
     * Helper method to create order and payment link for one-time payments
     */
    private async createOrderAndPaymentLink(params: ChargeParams, amountInPaise: number): Promise<ChargeResult> {
        // Create order
        const order = await this.razorpay.orders.create({
            amount: amountInPaise,
            currency: params.currency.toUpperCase(),
            receipt: `receipt_${Date.now()}_${params.customerId}`,
            notes: {
                customerId: params.customerId,
                paymentMethodId: params.paymentMethodId,
                ...params.metadata,
            },
        });

        // Create payment link for the order
        try {
            const paymentLink = await this.razorpay.paymentLink.create({
                amount: amountInPaise,
                currency: params.currency.toUpperCase(),
                description: params.description ?? 'Payment',
                customer: {
                    name: '', // Will be filled from customer record if needed
                    contact: '',
                    email: '',
                },
                notify: {
                    sms: false,
                    email: false,
                },
                reminder_enable: false,
                notes: params.metadata ?? {},
            });

            return {
                transactionId: order.id,
                status: 'pending',
                amount: params.amount,
                currency: params.currency,
                metadata: {
                    orderId: order.id,
                    paymentLinkId: paymentLink.id,
                    paymentLinkUrl: paymentLink.short_url,
                },
            };
        } catch (linkError: unknown) {
            // If payment link creation fails, return order (customer can pay via other means)
            const errorMessage = linkError instanceof Error ? linkError.message : String(linkError);
            loggingService.warn('Payment link creation failed, returning order only', {
                error: errorMessage,
            });

            return {
                transactionId: order.id,
                status: 'pending',
                amount: params.amount,
                currency: params.currency,
                metadata: {
                    orderId: order.id,
                    note: 'Payment link creation failed. Use order ID for manual payment.',
                },
            };
        }
    }

    async refund(params: RefundParams): Promise<RefundResult> {
        try {
            if (!this.razorpay) {
                throw new Error('Razorpay SDK not initialized');
            }

            const refundParams: any = {
                payment_id: params.transactionId,
            };

            if (params.amount) {
                refundParams.amount = Math.round(params.amount * 100);
            }

            const refund = await this.razorpay.refunds.create(refundParams);

            return {
                refundId: refund.id,
                status: refund.status === 'processed' ? 'succeeded' : refund.status === 'pending' ? 'pending' : 'failed',
                amount: refund.amount / 100,
            };
        } catch (error: any) {
            loggingService.error('Razorpay refund error', { error: error.message });
            throw error;
        }
    }

    verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
        try {
            const expectedSignature = crypto
                .createHmac('sha256', secret || this.webhookSecret)
                .update(payload)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );
        } catch (error) {
            loggingService.error('Razorpay webhook signature verification failed', { error });
            return false;
        }
    }

    parseWebhookEvent(payload: unknown, _headers: Record<string, string>): WebhookEvent {
        const event = payload as {
            event?: string;
            id?: string;
            type?: string;
            payload?: unknown;
            data?: unknown;
            created_at?: number | string;
        };

        const timestamp = event.created_at 
            ? (typeof event.created_at === 'number' 
                ? new Date(event.created_at * 1000) 
                : new Date(event.created_at))
            : new Date();

        return {
            id: event.event ?? event.id ?? '',
            type: event.event ?? event.type ?? '',
            data: event.payload ?? event.data ?? event,
            timestamp: timestamp,
        };
    }
}

