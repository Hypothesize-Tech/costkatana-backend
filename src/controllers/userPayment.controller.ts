import { Response, NextFunction, Request } from 'express';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
import { SubscriptionService } from '../services/subscription.service';
import { paymentGatewayManager } from '../services/paymentGateway/paymentGatewayManager.service';
import { PaymentMethod } from '../models/PaymentMethod';
import { convertCurrency, getCurrencyForCountry, convertToSmallestUnit } from '../utils/currencyConverter';
import mongoose from 'mongoose';

/**
 * Controller for managing payment gateway operations (Stripe, PayPal, Razorpay)
 */
export class UserPaymentController {
    /**
     * Helper to add CORS headers to response
     */
    private static addCorsHeaders(req: any, res: Response): void {
        const origin = req.headers.origin;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
    }
    
    /**
     * Authentication validation utility
     */
    private static validateAuthentication(req: any, res: Response): { requestId: string; userId: string } | { requestId: null; userId: null } {
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id;

        if (!userId) {
            // Add CORS headers for error response
            UserPaymentController.addCorsHeaders(req, res);
            res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
            return { requestId: null, userId: null };
        }

        return { requestId, userId };
    }
    /**
     * Create Stripe setup intent for payment method collection
     * POST /api/user/subscription/create-stripe-setup-intent
     */
    static async createStripeSetupIntent(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserPaymentController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Get user for customer creation
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create or get Stripe customer
            const customerResult = await paymentGatewayManager.createCustomer('stripe', {
                email: user.email,
                name: user.name || user.email,
                userId: userId.toString(),
            });

            // Create setup intent using Stripe gateway
            const stripeGateway = paymentGatewayManager.getGateway('stripe') as any;
            
            // Access Stripe instance - we need to create setup intent directly
            // Import Stripe SDK
            const Stripe = require('stripe') as any;
            if (!process.env.STRIPE_SECRET_KEY) {
                res.status(500).json({
                    success: false,
                    message: 'Stripe is not configured',
                });
                return;
            }
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
                apiVersion: '2024-12-18.acacia',
            }) as any;

            const setupIntent = await stripe.setupIntents.create({
                customer: customerResult.customerId,
                payment_method_types: ['card'],
                usage: 'off_session', // For recurring payments
            }) as any;

            // Log gateway for debugging
            loggingService.debug('Stripe gateway initialized', {
                requestId,
                userId,
                gatewayType: stripeGateway.constructor.name,
            });

            res.json({
                success: true,
                data: {
                    clientSecret: setupIntent.client_secret as string,
                    customerId: customerResult.customerId,
                },
            });
        } catch (error: any) {
            loggingService.error('Create Stripe setup intent failed', {
                requestId,
                userId,
                error: error.message as string,
            });
            next(error);
        }
        return;
    }

    /**
     * Confirm Stripe payment and upgrade subscription
     * POST /api/user/subscription/confirm-stripe-payment
     */
    static async confirmStripePayment(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserPaymentController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { setupIntentId, paymentMethodId, plan: planRaw, billingInterval, discountCode } = req.body as any;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!paymentMethodId || !plan) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: 'Payment method ID and plan are required',
                });
                return;
            }

            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan',
                });
                return;
            }

            // Get user
            const user = await User.findById(userId);
            if (!user) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Access Stripe instance for payment method retrieval
            const Stripe = require('stripe') as any;
            if (!process.env.STRIPE_SECRET_KEY) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Stripe is not configured',
                });
                return;
            }
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
                apiVersion: '2024-12-18.acacia',
            }) as any;

            // Get Stripe gateway service
            const stripeGateway = paymentGatewayManager.getGateway('stripe') as any;

            // Get payment method details first to check if it's already attached
            const paymentMethodDetails = await stripeGateway.getPaymentMethod(paymentMethodId as string) as any;
            
            // Get or create Stripe customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'stripe' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                const customerResult = await paymentGatewayManager.createCustomer('stripe', {
                    email: user.email,
                    name: user.name || user.email,
                    userId: userId.toString(),
                });
                gatewayCustomerId = customerResult.customerId;
            }

            // Attach payment method to customer only if not already attached
            // Check if payment method already has a customer attached
            if (paymentMethodDetails.customer) {
                // Payment method is already attached to a customer
                if (paymentMethodDetails.customer !== gatewayCustomerId) {
                    // It's attached to a different customer - this shouldn't happen in normal flow
                    // but we'll log it and continue with the current customer
                    loggingService.warn('Payment method attached to different customer', {
                        requestId,
                        userId,
                        paymentMethodId: paymentMethodId as string,
                        existingCustomer: paymentMethodDetails.customer,
                        targetCustomer: gatewayCustomerId,
                    });
                }
                // Payment method is already attached to the correct customer, no need to attach again
            } else {
                // Payment method is not attached to any customer, attach it now
                try {
                    await stripeGateway.attachPaymentMethodToCustomer(paymentMethodId as string, gatewayCustomerId);
                } catch (attachError: any) {
                    // If it's already attached (race condition), that's okay
                    if (attachError.message && attachError.message.includes('already been attached')) {
                        loggingService.info('Payment method already attached (race condition)', {
                            requestId,
                            userId,
                            paymentMethodId: paymentMethodId as string,
                        });
                    } else {
                        // Re-throw if it's a different error
                        throw attachError;
                    }
                }
            }

            // Log setup intent ID for debugging
            if (setupIntentId) {
                loggingService.debug('Setup intent confirmed', {
                    requestId,
                    userId,
                    setupIntentId: setupIntentId as string,
                });
            }

            // Create or update payment method in database
            let paymentMethod: any = await PaymentMethod.findOne({
                gateway: 'stripe',
                gatewayPaymentMethodId: paymentMethodId as string,
                userId,
            });

            if (!paymentMethod) {
                paymentMethod = new PaymentMethod({
                    userId,
                    gateway: 'stripe',
                    gatewayCustomerId: gatewayCustomerId,
                    gatewayPaymentMethodId: paymentMethodId as string,
                    type: 'card',
                    card: {
                        last4: (paymentMethodDetails.card?.last4 || '') as string,
                        brand: (paymentMethodDetails.card?.brand || '') as string,
                        expiryMonth: (paymentMethodDetails.card?.exp_month || 0) as number,
                        expiryYear: (paymentMethodDetails.card?.exp_year || 0) as number,
                        maskedNumber: `**** **** **** ${paymentMethodDetails.card?.last4 || ''}`,
                    },
                    isDefault: true,
                    isActive: true,
                    setupForRecurring: true,
                    recurringStatus: 'active',
                });
                await paymentMethod.save();
            }

            // Set as default payment method
            await stripeGateway.setDefaultPaymentMethod(gatewayCustomerId, paymentMethodId as string);

            // Log stripe instance for debugging
            loggingService.debug('Stripe instance created', {
                requestId,
                userId,
                stripeVersion: stripe.VERSION,
            });

            // Upgrade subscription
            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan as 'plus' | 'pro' | 'enterprise',
                'stripe',
                paymentMethod._id.toString(),
                { interval: (billingInterval as 'monthly' | 'yearly') || 'monthly', discountCode: discountCode as string }
            );

            res.json({
                success: true,
                message: 'Stripe payment confirmed and subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Confirm Stripe payment failed', {
                requestId,
                userId,
                error: error.message as string,
            });
            next(error);
        }
        return;
    }

    /**
     * Create PayPal subscription plan
     * POST /api/user/subscription/create-paypal-plan
     */
    static async createPayPalPlan(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserPaymentController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { plan: planRaw, billingInterval, amount, currency = 'USD', discountCode } = req.body;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!plan || !billingInterval || !amount) {
                res.status(400).json({
                    success: false,
                    message: 'Plan, billing interval, and amount are required',
                });
                return;
            }
            
            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan',
                });
                return;
            }

            // Apply discount if provided
            let finalAmount = parseFloat(amount);
            if (discountCode) {
                try {
                    const { Discount } = await import('../models/Discount');
                    const codeUpper = discountCode.toUpperCase().trim();
                    const discount = await Discount.findOne({
                        code: codeUpper,
                        isActive: true,
                    });

                    if (discount) {
                        // Validate discount (basic checks)
                        const now = new Date();
                        if (now >= discount.validFrom && now <= discount.validUntil) {
                            if (discount.maxUses === -1 || discount.currentUses < discount.maxUses) {
                                const normalizedPlan = plan ? (plan as string).toLowerCase() : null;
                                if (discount.applicablePlans.length === 0 || (normalizedPlan && discount.applicablePlans.includes(normalizedPlan as any))) {
                                    if (!discount.minAmount || finalAmount >= discount.minAmount) {
                                        // Calculate discount
                                        let discountAmount = 0;
                                        if (discount.type === 'percentage') {
                                            discountAmount = (finalAmount * discount.amount) / 100;
                                        } else {
                                            discountAmount = discount.amount;
                                        }
                                        discountAmount = Math.min(discountAmount, finalAmount);
                                        finalAmount = Math.max(0, finalAmount - discountAmount);
                                    }
                                }
                            }
                        }
                    }
                } catch (discountError: any) {
                    loggingService.warn('Error applying discount code in PayPal plan creation', {
                        requestId,
                        userId,
                        discountCode,
                        error: discountError?.message,
                    });
                    // Continue without discount if validation fails
                }
            }

            // Get user for email
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create PayPal customer
            const customerResult = await paymentGatewayManager.createCustomer('paypal', {
                email: user.email,
                name: user.name || user.email,
                userId: userId.toString(),
            });

            // Create subscription in PayPal (this creates the billing plan first, then the subscription)
            // The backend creates a PayPal billing plan and returns the plan ID to the frontend SDK
            // The frontend SDK will use this plan ID to create the subscription when user approves
            const paypalGateway = paymentGatewayManager.getGateway('paypal');
            const subscriptionResult = await paypalGateway.createSubscription({
                customerId: customerResult.customerId,
                paymentMethodId: '', // Not needed for initial creation
                planId: `${plan}_${billingInterval}`,
                amount: finalAmount,
                currency: currency.toUpperCase(),
                interval: billingInterval,
                metadata: {
                    userId: userId.toString(),
                    plan: plan,
                    discountCode: discountCode || undefined,
                },
            });

            // Extract the plan ID from metadata (set by PayPal service)
            const planId = subscriptionResult.metadata?.planId || subscriptionResult.subscriptionId;

            res.json({
                success: true,
                data: {
                    planId: planId, // PayPal billing plan ID for frontend SDK
                    subscriptionId: subscriptionResult.subscriptionId, // Subscription ID for reference
                },
            });
        } catch (error: any) {
            loggingService.error('Create PayPal plan failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Handle PayPal subscription approval and upgrade
     * POST /api/user/subscription/approve-paypal
     */
    static async approvePayPalSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserPaymentController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { subscriptionId, plan: planRaw, billingInterval, discountCode } = req.body;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!subscriptionId) {
                res.status(400).json({
                    success: false,
                    message: 'PayPal subscription ID is required',
                });
                return;
            }

            if (!plan || !['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan',
                });
                return;
            }

            // Get PayPal subscription details
            const paypalGateway = paymentGatewayManager.getGateway('paypal');
            const paypalSubscription = await paypalGateway.getSubscription(subscriptionId);

            if (!paypalSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'PayPal subscription not found',
                });
                return;
            }

            // Get user email for PayPal customer ID
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create or get PayPal customer
            const customerResult = await paymentGatewayManager.createCustomer('paypal', {
                email: user.email,
                name: user.name || user.email,
                userId: userId.toString(),
            });

            // Create payment method from PayPal subscription
            const paymentMethodResult = await paymentGatewayManager.createPaymentMethod('paypal', {
                type: 'paypal',
                customerId: customerResult.customerId,
                paypalEmail: user.email,
            });

            // Find or create payment method in database
            let paymentMethod: any = await PaymentMethod.findOne({
                gateway: 'paypal',
                gatewayPaymentMethodId: paymentMethodResult.paymentMethodId,
                userId,
            });

            if (!paymentMethod) {
                paymentMethod = new PaymentMethod({
                    userId,
                    gateway: 'paypal',
                    gatewayCustomerId: customerResult.customerId,
                    gatewayPaymentMethodId: subscriptionId, // Use subscription ID as payment method ID
                    type: 'paypal_account',
                    paypalAccount: {
                        email: user.email,
                    },
                    isDefault: true,
                    isActive: true,
                    setupForRecurring: true,
                    recurringStatus: 'active',
                });
                await paymentMethod.save();
            }

            // Upgrade subscription
            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan,
                'paypal',
                paymentMethod._id.toString(),
                { interval: billingInterval || 'monthly', discountCode }
            );

            // Update subscription with PayPal subscription ID
            updatedSubscription.gatewaySubscriptionId = subscriptionId;
            await updatedSubscription.save();

            res.json({
                success: true,
                message: 'PayPal subscription approved and subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Approve PayPal subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Create Razorpay order for subscription
     * POST /api/user/subscription/create-razorpay-order
     */
    static async createRazorpayOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserPaymentController.validateAuthentication(req, res);
        if (!userId) return;

            try {
                const body = req.body as any;
                const { plan: planRaw, billingInterval, amount, currency, country, discountCode } = {
                    plan: body.plan as string,
                    billingInterval: body.billingInterval as 'monthly' | 'yearly',
                    amount: body.amount as number,
                    currency: body.currency as string | undefined,
                    country: body.country as string | undefined,
                    discountCode: body.discountCode as string | undefined,
                };

                // Normalize plan name to lowercase
                const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!plan || !billingInterval || !amount) {
                res.status(400).json({
                    success: false,
                    message: 'Plan, billing interval, and amount are required',
                });
                return;
            }

            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for upgrade',
                });
                return;
            }

            // Get user
            const user = await User.findById(userId);
            if (!user) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            // Validate user email (required for Razorpay customer creation)
            if (!user.email) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: 'User email is required to create a Razorpay order. Please update your profile with an email address.',
                });
                return;
            }

            // Check if Razorpay gateway is available and configured
            if (!paymentGatewayManager.isGatewayAvailable('razorpay')) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Razorpay payment gateway is not available. Please check your Razorpay configuration.',
                });
                return;
            }

            const razorpayGateway = paymentGatewayManager.getGateway('razorpay') as any;
            if (!razorpayGateway || !razorpayGateway.razorpay) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Razorpay SDK is not initialized. Please check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set in your environment variables.',
                });
                return;
            }

            // Validate Razorpay credentials are configured
            if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Razorpay credentials are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.',
                });
                return;
            }

            // Get or create Razorpay customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'razorpay' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                try {
                    const customerResult = await paymentGatewayManager.createCustomer('razorpay', {
                        email: user.email,
                        name: user.name || user.email || 'Customer',
                        userId: userId.toString(),
                    });
                    gatewayCustomerId = customerResult.customerId;
                } catch (customerError: any) {
                    // If customer creation fails, check if customer already exists
                    const errorMessage = customerError?.message || customerError?.error?.description || 'Failed to create Razorpay customer';
                    const errorCode = customerError?.statusCode || customerError?.code || customerError?.error?.code;
                    
                    // Check if error is due to customer already existing
                    const isCustomerExistsError = errorMessage.includes('already exists') || 
                                                 errorMessage.includes('Customer already exists') ||
                                                 errorCode === 400;
                    
                    if (isCustomerExistsError) {
                        // Try to find existing customer by email
                        try {
                            // Access Razorpay-specific method by casting to any
                            const razorpayGatewayService = razorpayGateway as any;
                            if (razorpayGatewayService && typeof razorpayGatewayService.findCustomerByEmail === 'function') {
                                const existingCustomerId = await razorpayGatewayService.findCustomerByEmail(user.email);
                                if (existingCustomerId) {
                                    gatewayCustomerId = existingCustomerId;
                                    loggingService.info('Found existing Razorpay customer', {
                                        requestId,
                                        userId,
                                        userEmail: user.email,
                                        customerId: existingCustomerId,
                                    });
                                } else {
                                    // Customer exists but we couldn't find it, throw original error
                                    throw customerError;
                                }
                            } else {
                                // Method not available, throw original error
                                throw customerError;
                            }
                        } catch (findError: any) {
                            // If finding customer fails, log and throw original error
                            loggingService.warn('Failed to find existing Razorpay customer', {
                                requestId,
                                userId,
                                userEmail: user.email,
                                findError: findError?.message || String(findError),
                            });
                            throw customerError;
                        }
                    } else {
                        // Different error, log and throw
                        loggingService.error('Failed to create Razorpay customer', {
                            requestId,
                            userId,
                            userEmail: user.email,
                            error: errorMessage,
                            errorCode,
                            errorDetails: customerError,
                            razorpayConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
                        });
                        
                        UserPaymentController.addCorsHeaders(req, res);
                        
                        // Provide more specific error messages based on error type
                        let userFriendlyMessage = 'Failed to create Razorpay customer. Please check your Razorpay configuration.';
                        if (errorMessage.includes('not initialized') || errorMessage.includes('Install razorpay')) {
                            userFriendlyMessage = 'Razorpay SDK is not properly initialized. Please check your server configuration.';
                        } else if (errorMessage.includes('Email is required')) {
                            userFriendlyMessage = 'Email address is required to create a Razorpay customer.';
                        } else if (errorCode === 401 || errorMessage.includes('authentication') || errorMessage.includes('Unauthorized')) {
                            userFriendlyMessage = 'Razorpay authentication failed. Please verify your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are correct.';
                        }
                        
                        res.status(500).json({
                            success: false,
                            message: userFriendlyMessage,
                            error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
                            errorCode: process.env.NODE_ENV === 'development' ? errorCode : undefined,
                        });
                        return;
                    }
                }
            }

            // Apply discount if provided
            let finalAmount = amount;
            if (discountCode) {
                try {
                    const { Discount } = await import('../models/Discount');
                    const codeUpper = discountCode.toUpperCase().trim();
                    const discount = await Discount.findOne({
                        code: codeUpper,
                        isActive: true,
                    });

                    if (discount) {
                        // Validate discount (basic checks)
                        const now = new Date();
                        if (now >= discount.validFrom && now <= discount.validUntil) {
                            if (discount.maxUses === -1 || discount.currentUses < discount.maxUses) {
                                const normalizedPlan = plan ? (plan as string).toLowerCase() : null;
                                if (discount.applicablePlans.length === 0 || (normalizedPlan && discount.applicablePlans.includes(normalizedPlan as any))) {
                                    if (!discount.minAmount || amount >= discount.minAmount) {
                                        // Calculate discount
                                        let discountAmount = 0;
                                        if (discount.type === 'percentage') {
                                            discountAmount = (amount * discount.amount) / 100;
                                        } else {
                                            discountAmount = discount.amount;
                                        }
                                        discountAmount = Math.min(discountAmount, amount);
                                        finalAmount = Math.max(0, amount - discountAmount);
                                    }
                                }
                            }
                        }
                    }
                } catch (discountError: any) {
                    loggingService.warn('Error applying discount code in order creation', {
                        requestId,
                        userId,
                        discountCode,
                        error: discountError?.message,
                    });
                    // Continue without discount if validation fails
                }
            }

            // Create Razorpay order
            // Determine currency based on country
            const orderCurrency = country ? getCurrencyForCountry(country) : (currency || 'USD').toUpperCase();
            
            // Convert amount if currency is different (using dynamic exchange rates)
            let orderAmount = finalAmount;
            if (currency && currency.toUpperCase() !== orderCurrency) {
                orderAmount = await convertCurrency(finalAmount, currency.toUpperCase(), orderCurrency);
            }
            
            // Ensure minimum amount (Razorpay requires at least 1.00 in base currency)
            const MINIMUM_ORDER_AMOUNT = 1.0; // 1 USD or 1 INR
            if (orderAmount < MINIMUM_ORDER_AMOUNT) {
                UserPaymentController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: `Order amount after discount (${orderCurrency} ${orderAmount.toFixed(2)}) is below the minimum required amount of ${orderCurrency} ${MINIMUM_ORDER_AMOUNT.toFixed(2)}. Please adjust your discount code.`,
                });
                return;
            }

            // Convert to smallest unit (paise for INR, cents for USD)
            const amountInSmallestUnit = convertToSmallestUnit(orderAmount, orderCurrency);

            const orderNotes: Record<string, any> = {
                userId: userId.toString(),
                plan,
                billingInterval,
                customerId: gatewayCustomerId,
                originalAmount: amount,
                finalAmount: finalAmount,
                originalCurrency: currency || 'USD',
            };

            // Store country in order notes if provided
            if (country) {
                orderNotes.country = country;
            }

            // Store discount code in order notes if provided
            if (discountCode) {
                orderNotes.discountCode = discountCode.toUpperCase().trim();
            }

            const order = await razorpayGateway.razorpay.orders.create({
                amount: amountInSmallestUnit,
                currency: orderCurrency,
                receipt: `sub_${plan}_${billingInterval}_${Date.now()}`,
                notes: orderNotes,
            });

            res.json({
                success: true,
                data: {
                    orderId: order.id,
                    amount: order.amount,
                    currency: order.currency,
                    keyId: process.env.RAZORPAY_KEY_ID,
                    country: country || null, // Return country for frontend confirmation
                    convertedAmount: orderAmount, // Return converted amount for display
                },
            });
        } catch (error: any) {
            // Extract error message from various error formats
            let errorMessage = 'Failed to create Razorpay order';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (error?.message) {
                errorMessage = error.message;
            } else if (error?.error?.description) {
                errorMessage = error.error.description;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
            
            // Check for minimum amount error
            const isMinimumAmountError = 
                errorMessage.includes('Order amount less than minimum') ||
                errorMessage.includes('minimum amount allowed') ||
                (error?.error?.code === 'BAD_REQUEST_ERROR' && errorMessage.includes('minimum'));
            
            loggingService.error('Create Razorpay order failed', {
                requestId,
                userId,
                error: errorMessage,
                errorDetails: error,
                isMinimumAmountError,
            });
            
            UserPaymentController.addCorsHeaders(req, res);
            
            if (isMinimumAmountError) {
                res.status(400).json({
                    success: false,
                    message: `Order amount after discount is below the minimum required amount. Please adjust your discount code to ensure the final amount is at least $1.00 (or ₹1.00).`,
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Failed to create Razorpay order',
                    error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
                });
            }
        }
    }

    /**
     * Confirm Razorpay payment and upgrade subscription
     * POST /api/user/subscription/confirm-razorpay-payment
     */
    static async confirmRazorpayPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserPaymentController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const body = req.body as any;
            const { paymentId, orderId, signature, plan: planRaw, billingInterval, discountCode } = {
                paymentId: body.paymentId as string,
                orderId: body.orderId as string,
                signature: body.signature as string,
                plan: body.plan as string,
                billingInterval: body.billingInterval as 'monthly' | 'yearly',
                discountCode: body.discountCode as string | undefined,
            };
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!paymentId || !orderId || !signature || !plan) {
                res.status(400).json({
                    success: false,
                    message: 'Payment ID, order ID, signature, and plan are required',
                });
                return;
            }

            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for upgrade',
                });
                return;
            }

            // Get user
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            // Verify payment signature
            const razorpayGateway = paymentGatewayManager.getGateway('razorpay') as any;
            if (!razorpayGateway || !razorpayGateway.razorpay) {
                res.status(500).json({ success: false, message: 'Razorpay is not configured' });
                return;
            }

            const crypto = require('crypto');
            const webhookSecret = process.env.RAZORPAY_KEY_SECRET || '';
            const generatedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(`${orderId}|${paymentId}`)
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

            if (payment.status !== 'captured' && payment.status !== 'authorized') {
                res.status(400).json({
                    success: false,
                    message: `Payment not successful. Status: ${payment.status}`,
                });
                return;
            }

            // Get or create Razorpay customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'razorpay' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                try {
                    const customerResult = await paymentGatewayManager.createCustomer('razorpay', {
                        email: user.email,
                        name: user.name || user.email || 'Customer',
                        userId: userId.toString(),
                    });
                    gatewayCustomerId = customerResult.customerId;
                } catch (customerError: any) {
                    // If customer creation fails, check if customer already exists
                    const errorMessage = customerError?.message || customerError?.error?.description || 'Failed to create Razorpay customer';
                    const errorCode = customerError?.statusCode || customerError?.code || customerError?.error?.code;
                    
                    // Check if error is due to customer already existing
                    const isCustomerExistsError = errorMessage.includes('already exists') || 
                                                 errorMessage.includes('Customer already exists') ||
                                                 errorCode === 400;
                    
                    if (isCustomerExistsError) {
                        // Try to find existing customer by email
                        try {
                            // Access Razorpay-specific method by casting to any
                            const razorpayGatewayService = razorpayGateway as any;
                            if (razorpayGatewayService && typeof razorpayGatewayService.findCustomerByEmail === 'function') {
                                const existingCustomerId = await razorpayGatewayService.findCustomerByEmail(user.email);
                                if (existingCustomerId) {
                                    gatewayCustomerId = existingCustomerId;
                                    loggingService.info('Found existing Razorpay customer', {
                                        requestId,
                                        userId,
                                        userEmail: user.email,
                                        customerId: existingCustomerId,
                                    });
                                } else {
                                    // Customer exists but we couldn't find it, throw original error
                                    throw customerError;
                                }
                            } else {
                                // Method not available, throw original error
                                throw customerError;
                            }
                        } catch (findError: any) {
                            // If finding customer fails, log and throw original error
                            loggingService.warn('Failed to find existing Razorpay customer', {
                                requestId,
                                userId,
                                userEmail: user.email,
                                findError: findError?.message || String(findError),
                            });
                            throw customerError;
                        }
                    } else {
                        // Different error, log and throw
                        loggingService.error('Failed to create Razorpay customer', {
                            requestId,
                            userId,
                            userEmail: user.email,
                            error: errorMessage,
                            errorCode,
                            errorDetails: customerError,
                        });
                        throw customerError;
                    }
                }
            }

            // Create or update payment method in database
            let paymentMethod = await PaymentMethod.findOne({
                gateway: 'razorpay',
                gatewayPaymentMethodId: paymentId,
                userId,
            });

            if (!paymentMethod && payment.method) {
                const cardDetails = payment.card || {};
                paymentMethod = new PaymentMethod({
                    userId: new mongoose.Types.ObjectId(userId.toString()),
                    gateway: 'razorpay',
                    gatewayCustomerId: gatewayCustomerId,
                    gatewayPaymentMethodId: paymentId,
                    type: payment.method === 'card' ? 'card' : payment.method,
                    card: payment.method === 'card' ? {
                        last4: cardDetails.last4 || '',
                        brand: cardDetails.network || '',
                        expiryMonth: cardDetails.expiry_month || 0,
                        expiryYear: cardDetails.expiry_year || 0,
                        maskedNumber: `**** **** **** ${cardDetails.last4 || ''}`,
                    } : undefined,
                    isDefault: true,
                    isActive: true,
                    setupForRecurring: true,
                    recurringStatus: 'active',
                });
                await paymentMethod.save();
            }

            // Upgrade subscription
            // For Razorpay, we'll create a subscription in Razorpay
            // The payment ID will be stored separately for reference
            const paymentMethodId = paymentMethod && paymentMethod._id ? paymentMethod._id.toString() : '';
            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan,
                'razorpay',
                paymentMethodId,
                { 
                    interval: billingInterval || 'monthly', 
                    discountCode
                }
            );

            // Store the payment ID for reference (in addition to the subscription ID)
            if (paymentId && !updatedSubscription.gatewaySubscriptionId) {
                updatedSubscription.gatewaySubscriptionId = paymentId;
            }

            res.json({
                success: true,
                message: 'Razorpay payment confirmed and subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Confirm Razorpay payment failed', {
                requestId,
                userId,
                error: error.message as string,
            });
            next(error);
        }
    }
}
