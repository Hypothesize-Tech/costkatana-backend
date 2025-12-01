import { IPaymentGateway, PaymentGateway, CreateCustomerParams, CreateCustomerResult, CreatePaymentMethodParams, CreatePaymentMethodResult, CreateSubscriptionParams, CreateSubscriptionResult, UpdateSubscriptionParams, UpdateSubscriptionResult, CancelSubscriptionParams, CancelSubscriptionResult, ChargeParams, ChargeResult, RefundParams, RefundResult, WebhookEvent } from './paymentGateway.interface';
import { StripeGatewayService } from './stripeGateway.service';
import { RazorpayGatewayService } from './razorpayGateway.service';
import { PayPalGatewayService } from './paypalGateway.service';
import { loggingService } from '../logging.service';
import { PaymentMethod } from '../../models/PaymentMethod';

/**
 * Payment Gateway Manager Service
 * 
 * Manages multiple payment gateways (Stripe, Razorpay, PayPal) and provides
 * a unified interface for payment operations with auto-debit/recurring payments.
 */
export class PaymentGatewayManagerService {
    private gateways: Map<PaymentGateway, IPaymentGateway> = new Map();

    constructor() {
        // Initialize all payment gateways
        try {
            this.gateways.set('stripe', new StripeGatewayService());
        } catch (error) {
            loggingService.warn('Stripe gateway initialization failed', { error });
        }

        try {
            this.gateways.set('razorpay', new RazorpayGatewayService());
        } catch (error) {
            loggingService.warn('Razorpay gateway initialization failed', { error });
        }

        try {
            this.gateways.set('paypal', new PayPalGatewayService());
        } catch (error) {
            loggingService.warn('PayPal gateway initialization failed', { error });
        }
    }

    /**
     * Get a specific payment gateway instance
     */
    getGateway(gateway: PaymentGateway): IPaymentGateway {
        const gatewayInstance = this.gateways.get(gateway);
        if (!gatewayInstance) {
            throw new Error(`Payment gateway ${gateway} is not available or not configured`);
        }
        return gatewayInstance;
    }

    /**
     * Check if a payment gateway is available
     */
    isGatewayAvailable(gateway: PaymentGateway): boolean {
        return this.gateways.has(gateway);
    }

    /**
     * Get all available payment gateways
     */
    getAvailableGateways(): PaymentGateway[] {
        return Array.from(this.gateways.keys());
    }

    /**
     * Create customer in specified gateway
     */
    async createCustomer(gateway: PaymentGateway, params: CreateCustomerParams): Promise<CreateCustomerResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.createCustomer(params);
    }

    /**
     * Create payment method in specified gateway
     */
    async createPaymentMethod(gateway: PaymentGateway, params: CreatePaymentMethodParams): Promise<CreatePaymentMethodResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.createPaymentMethod(params);
    }

    /**
     * Create subscription with auto-debit in specified gateway
     */
    async createSubscription(gateway: PaymentGateway, params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.createSubscription(params);
    }

    /**
     * Update subscription in specified gateway
     */
    async updateSubscription(gateway: PaymentGateway, params: UpdateSubscriptionParams): Promise<UpdateSubscriptionResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.updateSubscription(params);
    }

    /**
     * Cancel subscription in specified gateway
     */
    async cancelSubscription(gateway: PaymentGateway, params: CancelSubscriptionParams): Promise<CancelSubscriptionResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.cancelSubscription(params);
    }

    /**
     * Reactivate subscription in specified gateway
     */
    async reactivateSubscription(gateway: PaymentGateway, subscriptionId: string): Promise<CreateSubscriptionResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.reactivateSubscription(subscriptionId);
    }

    /**
     * Charge customer (one-time payment)
     */
    async charge(gateway: PaymentGateway, params: ChargeParams): Promise<ChargeResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.charge(params);
    }

    /**
     * Process refund
     */
    async refund(gateway: PaymentGateway, params: RefundParams): Promise<RefundResult> {
        const gatewayInstance = this.getGateway(gateway);
        return await gatewayInstance.refund(params);
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(gateway: PaymentGateway, payload: string, signature: string, secret: string): boolean {
        const gatewayInstance = this.getGateway(gateway);
        return gatewayInstance.verifyWebhookSignature(payload, signature, secret);
    }

    /**
     * Parse webhook event
     */
    parseWebhookEvent(gateway: PaymentGateway, payload: unknown, headers: Record<string, string>): WebhookEvent {
        const gatewayInstance = this.getGateway(gateway);
        return gatewayInstance.parseWebhookEvent(payload, headers);
    }

    /**
     * Handle payment method expiration
     * This should be called periodically to check for expired payment methods
     * 
     * @param gateway - Payment gateway (stripe, razorpay, paypal)
     * @param paymentMethodId - Gateway payment method ID (not database ID)
     * @returns true if payment method is expired, false otherwise
     */
    async handlePaymentMethodExpiration(gateway: PaymentGateway, paymentMethodId: string): Promise<boolean> {
        try {
            const now = new Date();
            const currentMonth = now.getMonth() + 1; // getMonth() returns 0-11
            const currentYear = now.getFullYear();

            // Find payment method in database first
            const dbPaymentMethod = await PaymentMethod.findOne({
                gateway,
                gatewayPaymentMethodId: paymentMethodId,
            });

            if (!dbPaymentMethod) {
                loggingService.warn('Payment method not found in database', { gateway, paymentMethodId });
                return false;
            }

            // PayPal accounts don't expire
            if (gateway === 'paypal' || dbPaymentMethod.type === 'paypal_account') {
                return false;
            }

            // UPI and bank accounts don't expire
            if (dbPaymentMethod.type === 'upi' || dbPaymentMethod.type === 'bank_account' || dbPaymentMethod.type === 'wallet') {
                return false;
            }

            // Only cards expire
            if (dbPaymentMethod.type !== 'card') {
                return false;
            }

            let isExpired = false;
            let expiryMonth: number | undefined;
            let expiryYear: number | undefined;

            // Gateway-specific expiration checking
            if (gateway === 'stripe') {
                try {
                    const gatewayInstance = this.getGateway(gateway);
                    const gatewayPaymentMethod = await gatewayInstance.getPaymentMethod(paymentMethodId) as {
                        card?: {
                            exp_month?: number;
                            exp_year?: number;
                            last4?: string;
                            brand?: string;
                        };
                    };
                    
                    // Stripe payment method structure
                    if (gatewayPaymentMethod?.card?.exp_month && gatewayPaymentMethod?.card?.exp_year) {
                        expiryMonth = gatewayPaymentMethod.card.exp_month;
                        expiryYear = gatewayPaymentMethod.card.exp_year;
                    }
                } catch (error: unknown) {
                    // If gateway retrieval fails, fall back to database values
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.warn('Failed to retrieve payment method from Stripe, using database values', {
                        paymentMethodId,
                        error: errorMessage,
                    });
                }
            }

            // Fall back to database values if gateway retrieval didn't work or for Razorpay
            if (expiryMonth === undefined || expiryYear === undefined) {
                if (dbPaymentMethod.card?.expiryMonth && dbPaymentMethod.card?.expiryYear) {
                    expiryMonth = dbPaymentMethod.card.expiryMonth;
                    expiryYear = dbPaymentMethod.card.expiryYear;
                } else if (dbPaymentMethod.expiryDate) {
                    // Use expiryDate if available
                    const expiry = new Date(dbPaymentMethod.expiryDate);
                    expiryMonth = expiry.getMonth() + 1;
                    expiryYear = expiry.getFullYear();
                } else {
                    // No expiry information available
                    loggingService.warn('No expiry information available for payment method', {
                        gateway,
                        paymentMethodId,
                        dbPaymentMethodId: dbPaymentMethod._id?.toString() ?? 'unknown',
                    });
                    return false;
                }
            }

            // Check if expired
            // Card is expired if current date is past the expiry month/year
            if (expiryYear !== undefined && expiryMonth !== undefined) {
                if (expiryYear < currentYear || (expiryYear === currentYear && expiryMonth < currentMonth)) {
                    isExpired = true;
                }
            }

            // Update database if expired
            if (isExpired) {
                // Update payment method status
                dbPaymentMethod.isActive = false;
                dbPaymentMethod.recurringStatus = 'expired';
                
                // Update expiry date if not set
                if (!dbPaymentMethod.expiryDate && expiryMonth && expiryYear) {
                    dbPaymentMethod.expiryDate = new Date(expiryYear, expiryMonth - 1, 1); // First day of expiry month
                }

                await dbPaymentMethod.save();

                const dbPaymentMethodId = dbPaymentMethod._id ? String(dbPaymentMethod._id) : 'unknown';
                const userId = dbPaymentMethod.userId ? String(dbPaymentMethod.userId) : 'unknown';
                
                loggingService.info('Payment method marked as expired', {
                    gateway,
                    paymentMethodId,
                    dbPaymentMethodId,
                    userId,
                    expiryMonth,
                    expiryYear,
                });

                // Update card details in database if we got fresh data from gateway
                if (gateway === 'stripe' && dbPaymentMethod.card) {
                    try {
                        const gatewayInstance = this.getGateway(gateway);
                        const gatewayPaymentMethod = await gatewayInstance.getPaymentMethod(paymentMethodId) as {
                            card?: {
                                exp_month?: number;
                                exp_year?: number;
                                last4?: string;
                                brand?: string;
                            };
                        };
                        
                        if (gatewayPaymentMethod?.card) {
                            if (gatewayPaymentMethod.card.exp_month) {
                                dbPaymentMethod.card.expiryMonth = gatewayPaymentMethod.card.exp_month;
                            }
                            if (gatewayPaymentMethod.card.exp_year) {
                                dbPaymentMethod.card.expiryYear = gatewayPaymentMethod.card.exp_year;
                            }
                            if (gatewayPaymentMethod.card.last4) {
                                dbPaymentMethod.card.last4 = gatewayPaymentMethod.card.last4;
                            }
                            if (gatewayPaymentMethod.card.brand) {
                                dbPaymentMethod.card.brand = gatewayPaymentMethod.card.brand;
                            }
                            await dbPaymentMethod.save();
                        }
                    } catch (error: unknown) {
                        // Non-critical - we already marked it as expired
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        loggingService.warn('Failed to update card details from gateway', {
                            paymentMethodId,
                            error: errorMessage,
                        });
                    }
                }
            } else {
                // Update expiry date in database if we have fresh data and it's not set
                if (gateway === 'stripe' && expiryMonth && expiryYear && !dbPaymentMethod.expiryDate) {
                    dbPaymentMethod.expiryDate = new Date(expiryYear, expiryMonth - 1, 1);
                    if (dbPaymentMethod.card) {
                        dbPaymentMethod.card.expiryMonth = expiryMonth;
                        dbPaymentMethod.card.expiryYear = expiryYear;
                    }
                    await dbPaymentMethod.save();
                }
            }

            return isExpired;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            loggingService.error('Error checking payment method expiration', {
                gateway,
                paymentMethodId,
                error: errorMessage,
                stack: errorStack,
            });
            return false;
        }
    }

    /**
     * Retry failed payment
     * Handles retry logic for failed subscription payments
     */
    async retryFailedPayment(gateway: PaymentGateway, subscriptionId: string, paymentMethodId: string): Promise<ChargeResult> {
        try {
            const gatewayInstance = this.getGateway(gateway);
            const subscription = await gatewayInstance.getSubscription(subscriptionId) as {
                amount?: number;
                currency?: string;
                customer?: string;
            };
            
            // Get the amount from subscription
            // This is gateway-specific, so we'll need to handle it per gateway
            const amount = subscription.amount ?? 0;
            const currency = subscription.currency ?? 'USD';
            const customerId = subscription.customer ?? '';
            
            if (!customerId) {
                throw new Error('Customer ID not found in subscription');
            }
            
            // Attempt to charge
            return await gatewayInstance.charge({
                customerId: customerId,
                paymentMethodId: paymentMethodId,
                amount: amount,
                currency: currency,
                description: `Retry payment for subscription ${subscriptionId}`,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Error retrying failed payment', { gateway, subscriptionId, error: errorMessage });
            throw error;
        }
    }
}

// Export singleton instance
export const paymentGatewayManager = new PaymentGatewayManagerService();

