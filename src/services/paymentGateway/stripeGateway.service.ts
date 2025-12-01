import { IPaymentGateway, PaymentGateway, CreateCustomerParams, CreateCustomerResult, CreatePaymentMethodParams, CreatePaymentMethodResult, CreateSubscriptionParams, CreateSubscriptionResult, UpdateSubscriptionParams, UpdateSubscriptionResult, CancelSubscriptionParams, CancelSubscriptionResult, ChargeParams, ChargeResult, RefundParams, RefundResult, WebhookEvent } from './paymentGateway.interface';
import { loggingService } from '../logging.service';

/**
 * Stripe Payment Gateway Service
 * 
 * Note: Requires 'stripe' package to be installed:
 * npm install stripe
 * 
 * Environment variables required:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET
 */
export class StripeGatewayService implements IPaymentGateway {
    gateway: PaymentGateway = 'stripe';
    private stripe: any;
    private webhookSecret: string = '';

    constructor() {
        try {
            const Stripe = require('stripe');
            if (process.env.STRIPE_SECRET_KEY) {
                this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
                    apiVersion: '2024-12-18.acacia',
                });
                loggingService.info('Stripe SDK initialized successfully');
            } else {
                loggingService.warn('Stripe secret key not configured. Stripe gateway will not function.');
            }
            this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
        } catch (error) {
            loggingService.error('Failed to initialize Stripe SDK', { error });
            // Don't throw - allow graceful degradation if Stripe is not configured
        }
    }

    async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized. Install stripe package.');
            }

            const customer = await this.stripe.customers.create({
                email: params.email,
                name: params.name,
                metadata: {
                    userId: params.userId,
                    ...params.metadata,
                },
            });

            return {
                customerId: customer.id,
                gateway: 'stripe',
            };
        } catch (error: any) {
            loggingService.error('Stripe createCustomer error', { error: error.message, params });
            throw error;
        }
    }

    async getCustomer(customerId: string): Promise<any> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        return await this.stripe.customers.retrieve(customerId);
    }

    async updateCustomer(customerId: string, updates: Record<string, any>): Promise<any> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        return await this.stripe.customers.update(customerId, updates);
    }

    async deleteCustomer(customerId: string): Promise<void> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        await this.stripe.customers.del(customerId);
    }

    async createPaymentMethod(params: CreatePaymentMethodParams): Promise<CreatePaymentMethodResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized');
            }

            if (params.type === 'card' && params.cardNumber) {
                const paymentMethod = await this.stripe.paymentMethods.create({
                    type: 'card',
                    card: {
                        number: params.cardNumber,
                        exp_month: params.cardExpiryMonth,
                        exp_year: params.cardExpiryYear,
                        cvc: params.cardCvc,
                    },
                    billing_details: {
                        name: params.cardholderName,
                    },
                });

                return {
                    paymentMethodId: paymentMethod.id,
                    type: 'card',
                    card: {
                        last4: paymentMethod.card.last4,
                        brand: paymentMethod.card.brand,
                        expiryMonth: paymentMethod.card.exp_month,
                        expiryYear: paymentMethod.card.exp_year,
                    },
                };
            }

            throw new Error(`Unsupported payment method type: ${params.type}`);
        } catch (error: any) {
            loggingService.error('Stripe createPaymentMethod error', { error: error.message });
            throw error;
        }
    }

    async getPaymentMethod(paymentMethodId: string): Promise<any> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        return await this.stripe.paymentMethods.retrieve(paymentMethodId);
    }

    async updatePaymentMethod(paymentMethodId: string, updates: Record<string, any>): Promise<any> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        return await this.stripe.paymentMethods.update(paymentMethodId, updates);
    }

    async deletePaymentMethod(paymentMethodId: string): Promise<void> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        await this.stripe.paymentMethods.detach(paymentMethodId);
    }

    async attachPaymentMethodToCustomer(paymentMethodId: string, customerId: string): Promise<void> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        
        // Check if payment method is already attached to a customer
        const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
        if (paymentMethod.customer) {
            // Already attached to a customer
            if (paymentMethod.customer === customerId) {
                // Already attached to the correct customer, no action needed
                loggingService.info('Payment method already attached to customer', {
                    paymentMethodId,
                    customerId,
                });
                return;
            } else {
                // Attached to a different customer - this is unusual but we'll log it
                loggingService.warn('Payment method attached to different customer', {
                    paymentMethodId,
                    existingCustomer: paymentMethod.customer,
                    targetCustomer: customerId,
                });
                // We'll still try to attach it, which will fail, but the error will be more informative
            }
        }
        
        try {
            await this.stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId,
            });
        } catch (error: any) {
            // If it's already attached (race condition), that's okay
            if (error.message && error.message.includes('already been attached')) {
                loggingService.info('Payment method already attached (race condition)', {
                    paymentMethodId,
                    customerId,
                });
                return;
            }
            // Re-throw if it's a different error
            throw error;
        }
    }

    async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        await this.stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });
    }

    async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized');
            }

            const subscriptionParams: any = {
                customer: params.customerId,
                items: [{
                    price_data: {
                        currency: params.currency.toLowerCase(),
                        unit_amount: Math.round(params.amount * 100), // Convert to cents
                        recurring: {
                            interval: params.interval === 'monthly' ? 'month' : 'year',
                        },
                    },
                }],
                default_payment_method: params.paymentMethodId,
                metadata: params.metadata || {},
            };

            if (params.trialDays) {
                subscriptionParams.trial_period_days = params.trialDays;
            }

            const subscription = await this.stripe.subscriptions.create(subscriptionParams);

            return {
                subscriptionId: subscription.id,
                status: subscription.status as any,
                currentPeriodStart: new Date(subscription.current_period_start * 1000),
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : undefined,
            };
        } catch (error: any) {
            loggingService.error('Stripe createSubscription error', { error: error.message });
            throw error;
        }
    }

    async getSubscription(subscriptionId: string): Promise<any> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        return await this.stripe.subscriptions.retrieve(subscriptionId);
    }

    async updateSubscription(params: UpdateSubscriptionParams): Promise<UpdateSubscriptionResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized');
            }

            const updateParams: any = {
                metadata: params.metadata || {},
            };

            if (params.amount !== undefined) {
                // Update subscription items
                const subscription = await this.stripe.subscriptions.retrieve(params.subscriptionId);
                if (subscription.items.data.length > 0) {
                    await this.stripe.subscriptionItems.update(subscription.items.data[0].id, {
                        price_data: {
                            currency: subscription.currency,
                            unit_amount: Math.round(params.amount * 100),
                            recurring: {
                                interval: params.interval === 'monthly' ? 'month' : 'year',
                            },
                        },
                    });
                }
            }

            if (params.paymentMethodId) {
                updateParams.default_payment_method = params.paymentMethodId;
            }

            if (params.cancelAtPeriodEnd !== undefined) {
                updateParams.cancel_at_period_end = params.cancelAtPeriodEnd;
            }

            const subscription = await this.stripe.subscriptions.update(params.subscriptionId, updateParams);

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                currentPeriodStart: new Date(subscription.current_period_start * 1000),
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            };
        } catch (error: any) {
            loggingService.error('Stripe updateSubscription error', { error: error.message });
            throw error;
        }
    }

    async cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized');
            }

            let subscription;
            if (params.cancelAtPeriodEnd) {
                subscription = await this.stripe.subscriptions.update(params.subscriptionId, {
                    cancel_at_period_end: true,
                });
            } else {
                subscription = await this.stripe.subscriptions.cancel(params.subscriptionId);
            }

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : undefined,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            };
        } catch (error: any) {
            loggingService.error('Stripe cancelSubscription error', { error: error.message });
            throw error;
        }
    }

    async reactivateSubscription(subscriptionId: string): Promise<CreateSubscriptionResult> {
        if (!this.stripe) {
            throw new Error('Stripe SDK not initialized');
        }
        const subscription = await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: false,
        });

        return {
            subscriptionId: subscription.id,
            status: subscription.status as any,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        };
    }

    async charge(params: ChargeParams): Promise<ChargeResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized');
            }

            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: Math.round(params.amount * 100),
                currency: params.currency.toLowerCase(),
                customer: params.customerId,
                payment_method: params.paymentMethodId,
                confirm: true,
                description: params.description,
                metadata: params.metadata,
            });

            return {
                transactionId: paymentIntent.id,
                status: paymentIntent.status === 'succeeded' ? 'succeeded' : paymentIntent.status === 'processing' ? 'pending' : 'failed',
                amount: params.amount,
                currency: params.currency,
            };
        } catch (error: any) {
            loggingService.error('Stripe charge error', { error: error.message });
            throw error;
        }
    }

    async refund(params: RefundParams): Promise<RefundResult> {
        try {
            if (!this.stripe) {
                throw new Error('Stripe SDK not initialized');
            }

            const refundParams: any = {
                payment_intent: params.transactionId,
            };

            if (params.amount) {
                refundParams.amount = Math.round(params.amount * 100);
            }

            const refund = await this.stripe.refunds.create(refundParams);

            return {
                refundId: refund.id,
                status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'pending' ? 'pending' : 'failed',
                amount: refund.amount / 100,
            };
        } catch (error: any) {
            loggingService.error('Stripe refund error', { error: error.message });
            throw error;
        }
    }

    verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
        try {
            if (!this.stripe) {
                loggingService.warn('Stripe SDK not initialized, cannot verify webhook signature');
                return false;
            }
            
            const webhookSecret = secret || this.webhookSecret;
            if (!webhookSecret) {
                loggingService.error('Stripe webhook secret not configured');
                return false;
            }

            try {
                const event = this.stripe.webhooks.constructEvent(
                    payload,
                    signature,
                    webhookSecret
                );
                return event !== null && event !== undefined;
            } catch (err: any) {
                loggingService.error('Stripe webhook signature verification failed', {
                    error: err.message,
                    type: err.type,
                });
                return false;
            }
        } catch (error) {
            loggingService.error('Stripe webhook signature verification error', { error });
            return false;
        }
    }

    parseWebhookEvent(payload: unknown, _headers: Record<string, string>): WebhookEvent {
        // Stripe webhook payload is typically already parsed JSON
        // But handle both string and object cases
        let event: {
            id?: string;
            type?: string;
            data?: {
                object?: unknown;
            };
            created?: number;
            [key: string]: unknown;
        };

        if (typeof payload === 'string') {
            try {
                event = JSON.parse(payload) as typeof event;
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.error('Failed to parse Stripe webhook payload', { error: errorMessage });
                // Return a default event structure if parsing fails
                event = {
                    id: '',
                    type: 'unknown',
                    data: {},
                    created: Math.floor(Date.now() / 1000),
                };
            }
        } else {
            event = payload as typeof event;
        }

        // Extract event data - Stripe wraps the actual object in data.object
        const eventData = event.data?.object ?? event.data ?? event;

        // Handle timestamp - Stripe uses Unix timestamp in seconds
        const timestamp = event.created
            ? new Date(event.created * 1000)
            : new Date();

        return {
            id: event.id ?? '',
            type: event.type ?? 'unknown',
            data: eventData,
            timestamp: timestamp,
        };
    }
}

