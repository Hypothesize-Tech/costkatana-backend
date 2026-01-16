import { IPaymentGateway, PaymentGateway, CreateCustomerParams, CreateCustomerResult, CreatePaymentMethodParams, CreatePaymentMethodResult, CreateSubscriptionParams, CreateSubscriptionResult, UpdateSubscriptionParams, UpdateSubscriptionResult, CancelSubscriptionParams, CancelSubscriptionResult, ChargeParams, ChargeResult, RefundParams, RefundResult, WebhookEvent } from './paymentGateway.interface';
import { loggingService } from '../logging.service';
import { PaymentMethod } from '../../models/PaymentMethod';
import { Subscription } from '../../models/Subscription';

/**
 * PayPal Payment Gateway Service
 * 
 * Note: Requires '@paypal/checkout-server-sdk' package to be installed:
 * npm install @paypal/checkout-server-sdk
 * 
 * Environment variables required:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - PAYPAL_MODE (sandbox or live)
 * - PAYPAL_WEBHOOK_ID
 */
export class PayPalGatewayService implements IPaymentGateway {
    gateway: PaymentGateway = 'paypal';
    private paypalClient: any;
    private webhookId: string = '';

    constructor() {
        try {
            const paypal = require('@paypal/checkout-server-sdk');
            if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
                const environment = process.env.PAYPAL_MODE === 'live'
                    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
                    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
                this.paypalClient = new paypal.core.PayPalHttpClient(environment);
                loggingService.info('PayPal SDK initialized successfully', {
                    mode: process.env.PAYPAL_MODE ?? 'sandbox',
                });
            } else {
                loggingService.warn('PayPal credentials not configured. PayPal gateway will not function.');
            }
            this.webhookId = process.env.PAYPAL_WEBHOOK_ID ?? '';
        } catch (error) {
            loggingService.error('Failed to initialize PayPal SDK', { error });
            // Don't throw - allow graceful degradation if PayPal is not configured
        }
    }

    async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
        // PayPal doesn't have a direct customer creation API
        // Customers are identified by their PayPal account email
        // We'll use the email as the customer ID
        // Since PayPal doesn't support customer creation, we ensure consistency in our database
        try {
            const customerId = params.email; // PayPal uses email as customer identifier

            // Verify customer doesn't already exist in our database with conflicting info
            // Check if there are existing payment methods or subscriptions with this customer ID
            const existingPaymentMethods = await PaymentMethod.find({
                gateway: 'paypal',
                gatewayCustomerId: customerId,
            }).limit(1);

            const existingSubscriptions = await Subscription.find({
                paymentGateway: 'paypal',
                gatewayCustomerId: customerId,
            }).limit(1);

            // If customer already exists in our database, return existing customer ID
            if (existingPaymentMethods.length > 0 || existingSubscriptions.length > 0) {
                loggingService.info('PayPal customer already exists in database', {
                    customerId,
                    hasPaymentMethods: existingPaymentMethods.length > 0,
                    hasSubscriptions: existingSubscriptions.length > 0,
                });
            } else {
                loggingService.info('PayPal customer created (email-based identifier)', {
                    customerId,
                    name: params.name,
                    note: 'PayPal uses email as customer identifier. Customer will be stored when payment method or subscription is created.',
                });
            }

            return {
                customerId: customerId,
                gateway: 'paypal',
            };
        } catch (error: unknown) {
            // If database check fails, still return customer ID (email)
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.warn('Failed to check PayPal customer in database, returning email as customer ID', {
                email: params.email,
                error: errorMessage,
            });
            return {
                customerId: params.email,
                gateway: 'paypal',
            };
        }
    }

    async getCustomer(customerId: string): Promise<any> {
        // PayPal doesn't have a direct customer retrieval API
        // Retrieve customer info from our database (PaymentMethod and Subscription records)
        try {
            // Get payment methods for this customer
            const paymentMethods = await PaymentMethod.find({
                gateway: 'paypal',
                gatewayCustomerId: customerId,
            }).limit(1);

            // Get subscriptions for this customer
            const subscriptions = await Subscription.find({
                paymentGateway: 'paypal',
                gatewayCustomerId: customerId,
            }).limit(1);

            // Extract customer info from database records
            let email = customerId; // Default to customerId (which is email for PayPal)
            let name: string | undefined;

            if (paymentMethods.length > 0 && paymentMethods[0].paypalAccount?.email) {
                email = paymentMethods[0].paypalAccount.email;
            }

            if (subscriptions.length > 0) {
                // Try to get user info from subscription
                const subscription = subscriptions[0];
                if (subscription.userId) {
                    const { User } = await import('../../models/User');
                    const user = await User.findById(subscription.userId).select('name email').lean();
                    if (user) {
                        name = user.name;
                        email = user.email ?? email;
                    }
                }
            }

            return {
                id: customerId,
                email: email,
                name: name,
                paymentMethodsCount: paymentMethods.length,
                subscriptionsCount: subscriptions.length,
                metadata: {
                    source: 'database',
                    note: 'PayPal uses email as customer identifier. Customer info retrieved from database records.',
                },
            };
        } catch (error: unknown) {
            // If database retrieval fails, return basic info
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.warn('Failed to retrieve PayPal customer from database, returning basic info', {
                customerId,
                error: errorMessage,
            });
            return { id: customerId, email: customerId };
        }
    }

    async updateCustomer(customerId: string, updates: Record<string, unknown>): Promise<any> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal doesn't support customer updates via API directly
        // However, we need to update our database records to maintain consistency
        try {
            // Update payment methods with this customer ID
            if (updates.email || updates.name) {
                const paymentMethods = await PaymentMethod.find({
                    gateway: 'paypal',
                    gatewayCustomerId: customerId,
                });

                for (const paymentMethod of paymentMethods) {
                    if (updates.email && paymentMethod.paypalAccount) {
                        paymentMethod.paypalAccount.email = updates.email as string;
                        paymentMethod.gatewayCustomerId = updates.email as string; // PayPal uses email as customer ID
                        await paymentMethod.save();
                    }
                }

                // Update subscriptions with this customer ID
                const newCustomerId = (updates.email as string) ?? customerId;
                await Subscription.updateMany(
                    {
                        paymentGateway: 'paypal',
                        gatewayCustomerId: customerId,
                    },
                    {
                        $set: {
                            gatewayCustomerId: newCustomerId,
                        },
                    }
                );

                loggingService.info('PayPal customer updated in database', {
                    customerId,
                    newEmail: updates.email,
                    paymentMethodsUpdated: paymentMethods.length,
                });
            }

            const newCustomerId = (updates.email as string) ?? customerId;
            return Promise.resolve({
                id: newCustomerId,
                email: newCustomerId,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('PayPal updateCustomer error', {
                customerId,
                error: errorMessage,
            });
            // Still return the customer info even if update fails
            return Promise.resolve({ id: customerId, email: customerId });
        }
    }

    async deleteCustomer(customerId: string): Promise<void> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal doesn't support customer deletion via API
        // However, we need to clean up our database records and cancel subscriptions
        try {
            // Find all subscriptions for this customer
            const subscriptions = await Subscription.find({
                paymentGateway: 'paypal',
                gatewayCustomerId: customerId,
            });

            // Cancel all active subscriptions
            for (const subscription of subscriptions) {
                if (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due') {
                    try {
                        if (subscription.gatewaySubscriptionId) {
                            const paypal = require('@paypal/checkout-server-sdk');
                            const cancelRequest = new paypal.billingSubscriptions.SubscriptionsCancelRequest(
                                subscription.gatewaySubscriptionId
                            );
                            cancelRequest.requestBody({
                                reason: 'Customer account deleted',
                            });
                            await this.paypalClient.execute(cancelRequest);
                        }

                        // Update subscription status in database
                        subscription.status = 'canceled';
                        subscription.billing.canceledAt = new Date();
                        subscription.billing.cancelAtPeriodEnd = false;
                        await subscription.save();

                        loggingService.info('PayPal subscription cancelled during customer deletion', {
                            customerId,
                            subscriptionId: subscription._id?.toString(),
                            gatewaySubscriptionId: subscription.gatewaySubscriptionId,
                        });
                    } catch (subError: unknown) {
                        // Non-critical - continue with other cleanup
                        const errorMessage = subError instanceof Error ? subError.message : String(subError);
                        loggingService.warn('Failed to cancel subscription during customer deletion', {
                            customerId,
                            subscriptionId: subscription._id?.toString(),
                            error: errorMessage,
                        });
                    }
                }
            }

            // Deactivate all payment methods for this customer
            const paymentMethods = await PaymentMethod.find({
                gateway: 'paypal',
                gatewayCustomerId: customerId,
            });

            for (const paymentMethod of paymentMethods) {
                paymentMethod.isActive = false;
                paymentMethod.recurringStatus = 'cancelled';
                paymentMethod.isDefault = false;

                // Try to cancel billing agreements if they exist
                if (paymentMethod.gatewayPaymentMethodId.startsWith('I-') || 
                    paymentMethod.gatewayPaymentMethodId.match(/^[A-Z0-9]{14}$/)) {
                    try {
                        const paypal = require('@paypal/checkout-server-sdk');
                        const request = new paypal.billingAgreements.AgreementsCancelRequest(
                            paymentMethod.gatewayPaymentMethodId
                        );
                        request.requestBody({
                            note: 'Customer account deleted',
                        });
                        await this.paypalClient.execute(request);
                    } catch (agreementError: unknown) {
                        // Non-critical - we've already marked it inactive
                        const errorMessage = agreementError instanceof Error ? agreementError.message : String(agreementError);
                        loggingService.warn('Failed to cancel billing agreement during customer deletion', {
                            customerId,
                            paymentMethodId: paymentMethod.gatewayPaymentMethodId,
                            error: errorMessage,
                        });
                    }
                }

                await paymentMethod.save();
            }

            loggingService.info('PayPal customer deleted - database cleanup completed', {
                customerId,
                subscriptionsCancelled: subscriptions.length,
                paymentMethodsDeactivated: paymentMethods.length,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('PayPal deleteCustomer error', {
                customerId,
                error: errorMessage,
            });
            // Don't throw - we want to complete as much cleanup as possible
        }
    }

    createPaymentMethod(params: CreatePaymentMethodParams): Promise<CreatePaymentMethodResult> {
        if (!this.paypalClient) {
            return Promise.reject(new Error('PayPal SDK not initialized'));
        }

        if (params.type === 'paypal' && params.paypalEmail) {
            // PayPal payment method is the PayPal account itself
            // For recurring payments, this is typically tied to a billing agreement
            // The payment method ID will be the billing agreement ID once created
            const paymentMethodId = params.paypalEmail.includes('@') 
                ? `paypal_${params.paypalEmail.replace('@', '_at_')}_${Date.now()}`
                : `paypal_${params.paypalEmail}_${Date.now()}`;

            return Promise.resolve({
                paymentMethodId: paymentMethodId,
                type: 'paypal_account',
                paypalAccount: {
                    email: params.paypalEmail,
                },
                metadata: {
                    customerId: params.customerId,
                    note: 'PayPal account payment method. Billing agreement will be created during subscription setup.',
                },
            });
        }

        return Promise.reject(new Error(`Unsupported payment method type: ${params.type}. PayPal only supports PayPal accounts.`));
    }

    async getPaymentMethod(paymentMethodId: string): Promise<any> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal payment methods are tied to billing agreements/subscriptions
        // Retrieve from our database first
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'paypal',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (!dbPaymentMethod) {
            throw new Error(`Payment method ${paymentMethodId} not found in database`);
        }

        // If payment method ID is a billing agreement ID, try to fetch from PayPal
        if (paymentMethodId.startsWith('I-') || paymentMethodId.match(/^[A-Z0-9]{14}$/)) {
            try {
                const paypal = require('@paypal/checkout-server-sdk');
                // Try to get billing agreement details
                const request = new paypal.billingAgreements.AgreementsGetRequest(paymentMethodId);
                const response = await this.paypalClient.execute(request);
                const agreement = response.result;

                return {
                    id: agreement.id,
                    customer: agreement.payer?.payer_info?.email ?? dbPaymentMethod.gatewayCustomerId,
                    method: 'paypal_account',
                    paypalAccount: {
                        email: agreement.payer?.payer_info?.email ?? dbPaymentMethod.paypalAccount?.email,
                    },
                    status: agreement.state,
                    ...dbPaymentMethod.toObject(),
                };
            } catch (error: unknown) {
                // Billing agreement fetch failed, return database record
                const errorMessage = error instanceof Error ? error.message : String(error);
                loggingService.warn('Failed to fetch PayPal billing agreement, returning database record', {
                    paymentMethodId,
                    error: errorMessage,
                });
            }
        }

        // Return database record
        return {
            id: dbPaymentMethod.gatewayPaymentMethodId,
            customer: dbPaymentMethod.gatewayCustomerId,
            method: dbPaymentMethod.type,
            paypalAccount: dbPaymentMethod.paypalAccount,
            ...dbPaymentMethod.toObject(),
        };
    }

    async updatePaymentMethod(paymentMethodId: string, updates: Record<string, unknown>): Promise<any> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal doesn't support updating payment methods directly
        // Update our database record instead
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'paypal',
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

        loggingService.info('PayPal payment method updated in database', {
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
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal payment methods are tied to billing agreements
        // Mark as inactive in our database instead of deleting
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'paypal',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (dbPaymentMethod) {
            dbPaymentMethod.isActive = false;
            dbPaymentMethod.recurringStatus = 'cancelled';
            await dbPaymentMethod.save();

            loggingService.info('PayPal payment method marked as inactive in database', {
                paymentMethodId,
                dbPaymentMethodId: dbPaymentMethod._id ? String(dbPaymentMethod._id) : 'unknown',
            });

            // If it's a billing agreement ID, try to cancel the agreement
            if (paymentMethodId.startsWith('I-') || paymentMethodId.match(/^[A-Z0-9]{14}$/)) {
                try {
                    const paypal = require('@paypal/checkout-server-sdk');
                    const request = new paypal.billingAgreements.AgreementsCancelRequest(paymentMethodId);
                    request.requestBody({
                        note: 'Payment method removed by user',
                    });
                    await this.paypalClient.execute(request);
                    loggingService.info('PayPal billing agreement cancelled', { paymentMethodId });
                } catch (error: unknown) {
                    // Non-critical - we've already marked it inactive
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.warn('Failed to cancel PayPal billing agreement', {
                        paymentMethodId,
                        error: errorMessage,
                    });
                }
            }
        } else {
            loggingService.warn('Payment method not found in database for deletion', { paymentMethodId });
        }
    }

    async attachPaymentMethodToCustomer(paymentMethodId: string, customerId: string): Promise<void> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal handles payment method attachment through billing agreements
        // Update database record to ensure customer is correct
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'paypal',
            gatewayPaymentMethodId: paymentMethodId,
        });

        if (dbPaymentMethod) {
            // Verify customer matches if it's a billing agreement
            if (paymentMethodId.startsWith('I-') || paymentMethodId.match(/^[A-Z0-9]{14}$/)) {
                try {
                    const paypal = require('@paypal/checkout-server-sdk');
                    const request = new paypal.billingAgreements.AgreementsGetRequest(paymentMethodId);
                    const response = await this.paypalClient.execute(request);
                    const agreement = response.result;
                    
                    const agreementEmail = agreement.payer?.payer_info?.email;
                    if (agreementEmail && agreementEmail !== customerId) {
                        loggingService.warn('PayPal billing agreement belongs to different customer', {
                            paymentMethodId,
                            customerId,
                            agreementEmail,
                        });
                    }
                } catch (error: unknown) {
                    // Non-critical - we'll still update the database
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.warn('Failed to verify billing agreement customer', {
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

            loggingService.info('PayPal payment method attached to customer', {
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
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        // PayPal doesn't have a default payment method concept in their API
        // Handle this in our database
        const dbPaymentMethod = await PaymentMethod.findOne({
            gateway: 'paypal',
            gatewayPaymentMethodId: paymentMethodId,
            gatewayCustomerId: customerId,
        });

        if (!dbPaymentMethod) {
            throw new Error(`Payment method ${paymentMethodId} not found for customer ${customerId}`);
        }

        // Unset other default payment methods for this customer
        await PaymentMethod.updateMany(
            {
                gateway: 'paypal',
                gatewayCustomerId: customerId,
                _id: { $ne: dbPaymentMethod._id },
            },
            { $set: { isDefault: false } }
        );

        // Set this payment method as default
        dbPaymentMethod.isDefault = true;
        await dbPaymentMethod.save();

        const dbPaymentMethodId = dbPaymentMethod._id ? String(dbPaymentMethod._id) : 'unknown';
        loggingService.info('PayPal default payment method set in database', {
            customerId,
            paymentMethodId,
            dbPaymentMethodId,
        });
    }

    async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
        try {
            if (!this.paypalClient) {
                throw new Error('PayPal SDK not initialized');
            }

            loggingService.info('Creating PayPal subscription', {
                planId: params.planId,
                interval: params.interval,
                amount: params.amount,
                currency: params.currency,
            });

            // Get PayPal OAuth token for REST API calls
            const clientId = process.env.PAYPAL_CLIENT_ID;
            const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
            const baseURL = process.env.PAYPAL_MODE === 'live' 
                ? 'https://api-m.paypal.com'
                : 'https://api-m.sandbox.paypal.com';

            if (!clientId || !clientSecret) {
                throw new Error('PayPal credentials not configured');
            }

            // Get access token
            const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const tokenResponse = await fetch(`${baseURL}/v1/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'grant_type=client_credentials',
            });

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                loggingService.error('Failed to get PayPal OAuth token', { error: errorText });
                throw new Error('Failed to authenticate with PayPal');
            }

            const tokenData = await tokenResponse.json() as { access_token: string };
            const accessToken = tokenData.access_token;

            // Step 1: Create a PayPal Product using REST API
            const productPayload = {
                name: `Cost Katana ${params.planId}`,
                description: `${params.planId} subscription plan`,
                type: 'SERVICE',
                category: 'SOFTWARE',
            };

            loggingService.info('Creating PayPal product via REST API', { productPayload });

            const productResponse = await fetch(`${baseURL}/v1/catalogs/products`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(productPayload),
            });

            if (!productResponse.ok) {
                const errorText = await productResponse.text();
                loggingService.error('Failed to create PayPal product', { 
                    status: productResponse.status,
                    error: errorText,
                });
                throw new Error(`Failed to create PayPal product: ${productResponse.status} - ${errorText}`);
            }

            const product = await productResponse.json() as { id: string };
            const productId = product.id;
            loggingService.info('PayPal product created successfully', { productId });

            // Step 2: Create a Billing Plan using REST API
            const billingPlanPayload = {
                product_id: productId,
                name: `${params.planId} - ${params.interval}`,
                description: `${params.planId} subscription - ${params.interval} billing`,
                status: 'ACTIVE',
                billing_cycles: [{
                    frequency: {
                        interval_unit: params.interval === 'monthly' ? 'MONTH' : 'YEAR',
                        interval_count: 1,
                    },
                    tenure_type: 'REGULAR',
                    sequence: 1,
                    total_cycles: 0, // 0 means infinite
                    pricing_scheme: {
                        fixed_price: {
                            value: params.amount.toFixed(2),
                            currency_code: params.currency.toUpperCase(),
                        },
                    },
                }],
                payment_preferences: {
                    auto_bill_outstanding: true,
                    setup_fee: {
                        value: '0',
                        currency_code: params.currency.toUpperCase(),
                    },
                    setup_fee_failure_action: 'CONTINUE',
                    payment_failure_threshold: 3,
                },
            };

            loggingService.info('Creating PayPal billing plan via REST API', { billingPlanPayload });

            const planResponse = await fetch(`${baseURL}/v1/billing/plans`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(billingPlanPayload),
            });

            if (!planResponse.ok) {
                const errorText = await planResponse.text();
                loggingService.error('Failed to create PayPal billing plan', {
                    status: planResponse.status,
                    error: errorText,
                    productId,
                });
                throw new Error(`Failed to create PayPal billing plan: ${planResponse.status} - ${errorText}`);
            }

            const plan = await planResponse.json() as { id: string };
            const billingPlanId = plan.id;
            loggingService.info('PayPal billing plan created successfully', {
                billingPlanId,
                productId,
            });

            // Step 3: Create a Subscription using the billing plan
            // This creates a subscription in APPROVAL_PENDING status
            // The frontend SDK will redirect user to approve it
            const subscriptionPayload = {
                plan_id: billingPlanId,
                start_time: params.trialDays 
                    ? new Date(Date.now() + params.trialDays * 24 * 60 * 60 * 1000).toISOString()
                    : undefined,
                subscriber: {
                    email_address: params.customerId, // PayPal uses email as customer ID
                },
                application_context: {
                    brand_name: 'Cost Katana',
                    locale: 'en-US',
                    shipping_preference: 'NO_SHIPPING',
                    user_action: 'SUBSCRIBE_NOW',
                    payment_method: {
                        payer_selected: 'PAYPAL',
                        payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
                    },
                    return_url: process.env.PAYPAL_RETURN_URL ?? `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/subscription/success`,
                    cancel_url: process.env.PAYPAL_CANCEL_URL ?? `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/subscription/cancel`,
                },
            };

            loggingService.info('Creating PayPal subscription via REST API', { subscriptionPayload });

            const subscriptionResponse = await fetch(`${baseURL}/v1/billing/subscriptions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(subscriptionPayload),
            });

            if (!subscriptionResponse.ok) {
                const errorText = await subscriptionResponse.text();
                loggingService.error('Failed to create PayPal subscription', {
                    status: subscriptionResponse.status,
                    error: errorText,
                    billingPlanId,
                });
                throw new Error(`Failed to create PayPal subscription: ${subscriptionResponse.status} - ${errorText}`);
            }

            const subscription = await subscriptionResponse.json() as { 
                id: string; 
                status: string;
                links?: Array<{ href: string; rel: string }>;
            };
            const subscriptionId = subscription.id;
            
            loggingService.info('PayPal subscription created successfully', {
                subscriptionId,
                billingPlanId,
                productId,
                status: subscription.status,
            });

            // Step 4: Return the subscription ID for the frontend SDK to use
            // The subscription will be in APPROVAL_PENDING status
            const now = new Date();
            const periodEnd = new Date(now);
            if (params.interval === 'monthly') {
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            } else {
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            }

            return {
                subscriptionId: subscriptionId, // Return subscription ID for frontend SDK
                status: subscription.status === 'APPROVAL_PENDING' ? 'incomplete' : 
                        subscription.status === 'ACTIVE' ? 'active' : 'incomplete',
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                trialEnd: params.trialDays ? new Date(now.getTime() + params.trialDays * 24 * 60 * 60 * 1000) : undefined,
                metadata: {
                    ...params.metadata,
                    planId: billingPlanId, // Billing plan ID for reference
                    productId: productId,
                    paypalStatus: subscription.status,
                },
            };
        } catch (error: any) {
            loggingService.error('PayPal createSubscription error', {
                error: error.message,
                stack: error.stack,
                details: error.response?.details || error.details,
            });
            throw error;
        }
    }

    async getSubscription(subscriptionId: string): Promise<any> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }
        const paypal = require('@paypal/checkout-server-sdk');
        const request = new paypal.billingSubscriptions.SubscriptionsGetRequest(subscriptionId);
        const response = await this.paypalClient.execute(request);
        return response.result;
    }

    async updateSubscription(params: UpdateSubscriptionParams): Promise<UpdateSubscriptionResult> {
        try {
            if (!this.paypalClient) {
                throw new Error('PayPal SDK not initialized');
            }

            
            // PayPal subscription updates are limited - mainly for cancellation
            if (params.cancelAtPeriodEnd !== undefined) {
                if (params.cancelAtPeriodEnd) {
                    // Cancel subscription
                    const paypal = require('@paypal/checkout-server-sdk');
                    const cancelRequest = new paypal.billingSubscriptions.SubscriptionsCancelRequest(params.subscriptionId);
                    cancelRequest.requestBody({
                        reason: 'User requested cancellation at period end',
                    });
                    await this.paypalClient.execute(cancelRequest);
                }
            }

            const subscription = await this.getSubscription(params.subscriptionId);

            const nextBillingTime = subscription.billing_info?.next_billing_time;
            const currentPeriodStart = nextBillingTime 
                ? new Date(typeof nextBillingTime === 'string' ? nextBillingTime : nextBillingTime * 1000)
                : new Date();
            
            const intervalDays = params.interval === 'monthly' ? 30 : 365;
            const currentPeriodEnd = nextBillingTime
                ? new Date(new Date(typeof nextBillingTime === 'string' ? nextBillingTime : nextBillingTime * 1000).getTime() + intervalDays * 24 * 60 * 60 * 1000)
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

            return {
                subscriptionId: subscription.id,
                status: subscription.status ?? 'active',
                currentPeriodStart: currentPeriodStart,
                currentPeriodEnd: currentPeriodEnd,
                cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
            };
        } catch (error: any) {
            loggingService.error('PayPal updateSubscription error', { error: error.message });
            throw error;
        }
    }

    async cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult> {
        try {
            if (!this.paypalClient) {
                throw new Error('PayPal SDK not initialized');
            }

            const paypal = require('@paypal/checkout-server-sdk');
            const request = new paypal.billingSubscriptions.SubscriptionsCancelRequest(params.subscriptionId);
            
            if (params.reason) {
                request.requestBody({ reason: params.reason });
            }
            
            await this.paypalClient.execute(request);

            const subscription = await this.getSubscription(params.subscriptionId);

            return {
                subscriptionId: params.subscriptionId,
                status: subscription.status === 'CANCELLED' ? 'canceled' : subscription.status,
                canceledAt: new Date(),
                cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
            };
        } catch (error: any) {
            loggingService.error('PayPal cancelSubscription error', { error: error.message });
            throw error;
        }
    }

    async reactivateSubscription(subscriptionId: string): Promise<CreateSubscriptionResult> {
        if (!this.paypalClient) {
            throw new Error('PayPal SDK not initialized');
        }

        try {
            const paypal = require('@paypal/checkout-server-sdk');
            
            // Get current subscription status
            const subscription = await this.getSubscription(subscriptionId);
            
            // PayPal doesn't support direct reactivation of cancelled subscriptions
            // However, we can try to reactivate if it's in SUSPENDED state
            if (subscription.status === 'SUSPENDED') {
                // Try to reactivate suspended subscription
                const reactivateRequest = new paypal.billingSubscriptions.SubscriptionsActivateRequest(subscriptionId);
                reactivateRequest.requestBody({
                    reason: 'Subscription reactivated by user',
                });
                
                const response = await this.paypalClient.execute(reactivateRequest);
                const reactivatedSubscription = response.result;

                return {
                    subscriptionId: reactivatedSubscription.id,
                    status: reactivatedSubscription.status === 'ACTIVE' ? 'active' : 'incomplete',
                    currentPeriodStart: new Date(reactivatedSubscription.billing_info?.last_payment?.time ?? Date.now()),
                    currentPeriodEnd: new Date(reactivatedSubscription.billing_info?.next_billing_time ?? Date.now() + 30 * 24 * 60 * 60 * 1000),
                };
            } else if (subscription.status === 'CANCELLED' || subscription.status === 'EXPIRED') {
                // Cannot reactivate cancelled/expired subscriptions
                throw new Error('PayPal does not support reactivation of cancelled or expired subscriptions. Please create a new subscription.');
            } else if (subscription.status === 'ACTIVE') {
                // Already active
                return {
                    subscriptionId: subscription.id,
                    status: 'active',
                    currentPeriodStart: new Date(subscription.billing_info?.last_payment?.time ?? Date.now()),
                    currentPeriodEnd: new Date(subscription.billing_info?.next_billing_time ?? Date.now() + 30 * 24 * 60 * 60 * 1000),
                };
            } else {
                throw new Error(`Cannot reactivate subscription in ${subscription.status} state. Please create a new subscription.`);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('PayPal reactivateSubscription error', { 
                subscriptionId, 
                error: errorMessage 
            });
            throw error;
        }
    }

    async charge(params: ChargeParams): Promise<ChargeResult> {
        try {
            if (!this.paypalClient) {
                throw new Error('PayPal SDK not initialized');
            }

            const paypal = require('@paypal/checkout-server-sdk');
            
            // Check if we have a saved payment method (billing agreement)
            const dbPaymentMethod = await PaymentMethod.findOne({
                gateway: 'paypal',
                gatewayPaymentMethodId: params.paymentMethodId,
                gatewayCustomerId: params.customerId,
                isActive: true,
            }).catch(() => null);

            // For recurring payments with saved billing agreements, use reference transactions
            if (dbPaymentMethod && dbPaymentMethod.setupForRecurring) {
                // Check if payment method ID is a billing agreement ID
                if (params.paymentMethodId.startsWith('I-') || params.paymentMethodId.match(/^[A-Z0-9]{14}$/)) {
                    try {
                        // Use billing agreement for reference transaction
                        // Note: This requires PayPal Reference Transactions feature enabled
                        const request = new paypal.orders.OrdersCreateRequest();
                        request.requestBody({
                            intent: 'CAPTURE',
                            purchase_units: [{
                                amount: {
                                    currency_code: params.currency.toUpperCase(),
                                    value: params.amount.toFixed(2),
                                },
                                description: params.description ?? 'Cost Katana Payment',
                                payment_instruction: {
                                    platform_fees: [],
                                    disbursement_mode: 'INSTANT',
                                },
                            }],
                            payment_source: {
                                billing: {
                                    billing_agreement_id: params.paymentMethodId,
                                },
                            },
                        });

                        const response = await this.paypalClient.execute(request);
                        const order = response.result;

                        // Capture the order immediately
                        if (order.status === 'CREATED') {
                            const captureRequest = new paypal.orders.OrdersCaptureRequest(order.id);
                            const captureResponse = await this.paypalClient.execute(captureRequest);
                            const capture = captureResponse.result;

                            return {
                                transactionId: capture.id,
                                status: capture.status === 'COMPLETED' ? 'succeeded' : 'pending',
                                amount: params.amount,
                                currency: params.currency,
                                metadata: {
                                    orderId: order.id,
                                    billingAgreementId: params.paymentMethodId,
                                },
                            };
                        }

                        return {
                            transactionId: order.id,
                            status: 'pending',
                            amount: params.amount,
                            currency: params.currency,
                        };
                    } catch (billingError: unknown) {
                        // If billing agreement charge fails, fall back to regular order
                        const errorMessage = billingError instanceof Error ? billingError.message : String(billingError);
                        loggingService.warn('Billing agreement charge failed, using regular order', {
                            error: errorMessage,
                        });
                    }
                }
            }

            // Regular order creation for one-time payments
            const request = new paypal.orders.OrdersCreateRequest();
            request.requestBody({
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: {
                        currency_code: params.currency.toUpperCase(),
                        value: params.amount.toFixed(2),
                    },
                    description: params.description ?? 'Cost Katana Payment',
                    payee: {
                        email_address: params.customerId, // PayPal customer email
                    },
                }],
            });

            const response = await this.paypalClient.execute(request);
            const order = response.result;

            // For immediate capture, we need to capture the order
            // Note: This requires the customer to approve the payment first
            // For auto-debit, use subscriptions instead
            if (order.status === 'CREATED') {
                // Return order with approval links for customer to complete payment
                return {
                    transactionId: order.id,
                    status: 'pending',
                    amount: params.amount,
                    currency: params.currency,
                    metadata: {
                        orderId: order.id,
                        approvalUrl: order.links?.find((link: { rel: string }) => link.rel === 'approve')?.href,
                        note: 'Customer approval required. Use approvalUrl to redirect customer.',
                    },
                };
            }

            return {
                transactionId: order.id,
                status: 'pending',
                amount: params.amount,
                currency: params.currency,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('PayPal charge error', { error: errorMessage });
            throw error;
        }
    }

    async refund(params: RefundParams): Promise<RefundResult> {
        try {
            if (!this.paypalClient) {
                throw new Error('PayPal SDK not initialized');
            }

            const paypal = require('@paypal/checkout-server-sdk');
            const request = new paypal.payments.CapturesRefundRequest(params.transactionId);
            
            if (params.amount) {
                request.requestBody({
                    amount: {
                        value: params.amount.toFixed(2),
                        currency_code: 'USD',
                    },
                    note_to_payer: params.reason ?? 'Refund requested',
                });
            } else {
                // Full refund
                request.requestBody({
                    note_to_payer: params.reason ?? 'Full refund requested',
                });
            }
            
            const response = await this.paypalClient.execute(request);
            const refund = response.result;

            return {
                refundId: refund.id,
                status: refund.status === 'COMPLETED' ? 'succeeded' : refund.status === 'PENDING' ? 'pending' : 'failed',
                amount: parseFloat(refund.amount?.value || '0'),
            };
        } catch (error: any) {
            loggingService.error('PayPal refund error', { error: error.message });
            throw error;
        }
    }

    verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
        try {
            if (!this.paypalClient) {
                loggingService.warn('PayPal SDK not initialized, cannot verify webhook signature');
                return false;
            }

            const webhookId = this.webhookId ?? secret;
            if (!webhookId) {
                loggingService.error('PayPal webhook ID not configured');
                return false;
            }

            // Validate signature is not empty
            if (!signature || signature.length === 0) {
                loggingService.warn('PayPal webhook signature is empty');
                return false;
            }

            // Validate signature format (PayPal transmission signatures are base64 encoded, typically 88+ characters)
            // Minimum reasonable length for a valid signature
            if (signature.length < 20) {
                loggingService.warn('PayPal webhook signature too short', {
                    signatureLength: signature.length,
                });
                return false;
            }

            // Validate webhook ID format (PayPal webhook IDs are typically alphanumeric, 20+ characters)
            if (webhookId.length < 10) {
                loggingService.warn('PayPal webhook ID too short', {
                    webhookIdLength: webhookId.length,
                });
                return false;
            }

            // Validate payload is not empty
            if (!payload || payload.length === 0) {
                loggingService.warn('PayPal webhook payload is empty');
                return false;
            }

            // Validate payload is valid JSON
            let parsedPayload: unknown;
            try {
                parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
            } catch (parseError: unknown) {
                const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
                loggingService.warn('PayPal webhook payload is not valid JSON', {
                    error: errorMessage,
                });
                return false;
            }

            // Validate payload structure contains expected PayPal webhook event fields
            if (typeof parsedPayload === 'object' && parsedPayload !== null) {
                const event = parsedPayload as Record<string, unknown>;
                
                // PayPal webhook events should have at least one of these identifiers
                const hasId = typeof event.id === 'string' && event.id.length > 0;
                const hasEventType = typeof event.event_type === 'string' && event.event_type.length > 0;
                const hasType = typeof event.type === 'string' && event.type.length > 0;
                const hasResource = event.resource !== undefined || event.data !== undefined;

                if (!hasId && !hasEventType && !hasType) {
                    loggingService.warn('PayPal webhook payload missing required event identifiers', {
                        hasId,
                        hasEventType,
                        hasType,
                        hasResource,
                    });
                    return false;
                }

                // Validate event type format (PayPal event types are typically like "PAYMENT.SALE.COMPLETED")
                if (hasEventType) {
                    const eventType = event.event_type as string;
                    if (eventType.length < 5 || eventType.length > 100) {
                        loggingService.warn('PayPal webhook event type has invalid length', {
                            eventType,
                            length: eventType.length,
                        });
                        return false;
                    }
                }

                // Validate timestamp if present (should be ISO 8601 or Unix timestamp)
                if (event.create_time || event.time) {
                    const timestamp = event.create_time ?? event.time;
                    if (typeof timestamp === 'string') {
                        // ISO 8601 format validation (basic check)
                        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
                        if (!isoRegex.test(timestamp)) {
                            loggingService.warn('PayPal webhook timestamp format invalid', {
                                timestamp,
                            });
                            // Don't fail - timestamp format might vary
                        }
                    } else if (typeof timestamp === 'number') {
                        // Unix timestamp validation (should be reasonable)
                        const now = Math.floor(Date.now() / 1000);
                        const timestampValue = timestamp;
                        // Allow timestamps within last 10 years and future 1 hour
                        if (timestampValue < now - 315360000 || timestampValue > now + 3600) {
                            loggingService.warn('PayPal webhook timestamp out of reasonable range', {
                                timestamp: timestampValue,
                                now,
                            });
                            // Don't fail - might be valid but unusual
                        }
                    }
                }
            } else {
                loggingService.warn('PayPal webhook payload is not an object');
                return false;
            }

            // Basic format validation passed
            loggingService.debug('PayPal webhook signature basic validation passed', {
                signatureLength: signature.length,
                webhookIdLength: webhookId.length,
                payloadLength: payload.length,
                hasEventId: typeof parsedPayload === 'object' && parsedPayload !== null && 'id' in parsedPayload,
            });

            // Note: Full cryptographic verification requires async API call to PayPal
            // This method provides synchronous validation only
            // The webhook handler should call verifyWebhookSignatureAsync() for full verification
            // with proper headers (PAYPAL-AUTH-ALGO, PAYPAL-CERT-URL, PAYPAL-TRANSMISSION-ID, etc.)
            return true;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('PayPal webhook signature verification failed', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
            });
            return false;
        }
    }

    /**
     * Verify webhook signature using PayPal's verification API (async)
     * This should be called from the webhook handler with proper headers
     */
    async verifyWebhookSignatureAsync(
        payload: string,
        headers: Record<string, string>
    ): Promise<boolean> {
        try {
            if (!this.paypalClient) {
                loggingService.warn('PayPal SDK not initialized, cannot verify webhook signature');
                return false;
            }

            const webhookId = this.webhookId;
            if (!webhookId) {
                loggingService.error('PayPal webhook ID not configured');
                return false;
            }

            const paypal = require('@paypal/checkout-server-sdk');
            
            // Extract required headers
            const authAlgo = headers['paypal-auth-algo'] || headers['PAYPAL-AUTH-ALGO'];
            const certUrl = headers['paypal-cert-url'] || headers['PAYPAL-CERT-URL'];
            const transmissionId = headers['paypal-transmission-id'] || headers['PAYPAL-TRANSMISSION-ID'];
            const transmissionSig = headers['paypal-transmission-sig'] || headers['PAYPAL-TRANSMISSION-SIG'];
            const transmissionTime = headers['paypal-transmission-time'] || headers['PAYPAL-TRANSMISSION-TIME'];

            if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
                loggingService.error('Missing required PayPal webhook headers', {
                    hasAuthAlgo: !!authAlgo,
                    hasCertUrl: !!certUrl,
                    hasTransmissionId: !!transmissionId,
                    hasTransmissionSig: !!transmissionSig,
                    hasTransmissionTime: !!transmissionTime,
                });
                return false;
            }

            // Create verification request
            const request = new paypal.notifications.WebhooksVerifyRequest(webhookId);
            request.requestBody({
                auth_algo: authAlgo,
                cert_url: certUrl,
                transmission_id: transmissionId,
                transmission_sig: transmissionSig,
                transmission_time: transmissionTime,
                webhook_id: webhookId,
                webhook_event: JSON.parse(payload),
            });

            const response = await this.paypalClient.execute(request);
            const verification = response.result;

            return verification.verification_status === 'SUCCESS';
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('PayPal webhook signature verification failed', { error: errorMessage });
            return false;
        }
    }

    parseWebhookEvent(payload: unknown, _headers: Record<string, string>): WebhookEvent {
        const event = payload as {
            id?: string;
            event_version?: string;
            event_type?: string;
            type?: string;
            resource?: unknown;
            data?: unknown;
            create_time?: string | number;
            time?: string | number;
        };

        const timestamp = event.create_time || event.time
            ? (typeof (event.create_time || event.time) === 'number'
                ? new Date((event.create_time || event.time) as number * 1000)
                : new Date(event.create_time || event.time as string))
            : new Date();

        return {
            id: event.id ?? event.event_version ?? '',
            type: event.event_type ?? event.type ?? '',
            data: event.resource ?? event.data ?? event,
            timestamp: timestamp,
        };
    }
}

