import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type {
  PaymentGatewayType,
  CreateSubscriptionParams,
  CreateSubscriptionResult,
  UpdateSubscriptionParams,
  UpdateSubscriptionResult,
  CancelSubscriptionParams,
  CancelSubscriptionResult,
  RefundParams,
  RefundResult,
  ChargeParams,
  ChargeResult,
  WebhookEvent,
} from './payment-gateway.interface';

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);
  private stripe: any = null;
  private razorpay: any = null;
  private paypal: any = null;

  constructor(private configService: ConfigService) {
    // Stripe initialization
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (secretKey) {
      try {
        const Stripe = require('stripe');
        this.stripe = new Stripe(secretKey, {
          apiVersion: '2024-12-18.acacia',
        });
        this.logger.log('Stripe SDK initialized');
      } catch (error) {
        this.logger.warn('Stripe SDK not available', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set; Stripe gateway disabled');
    }

    // Razorpay initialization
    const razorpayKeyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const razorpayKeySecret = this.configService.get<string>(
      'RAZORPAY_KEY_SECRET',
    );
    if (razorpayKeyId && razorpayKeySecret) {
      try {
        const Razorpay = require('razorpay');
        this.razorpay = new Razorpay({
          key_id: razorpayKeyId,
          key_secret: razorpayKeySecret,
        });
        this.logger.log('Razorpay SDK initialized');
      } catch (error) {
        this.logger.warn('Razorpay SDK not available', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      this.logger.warn(
        'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set; Razorpay gateway disabled',
      );
    }

    // PayPal initialization
    const paypalClientId = this.configService.get<string>('PAYPAL_CLIENT_ID');
    const paypalClientSecret = this.configService.get<string>(
      'PAYPAL_CLIENT_SECRET',
    );
    const paypalMode = this.configService.get<string>('PAYPAL_MODE', 'sandbox');
    if (paypalClientId && paypalClientSecret) {
      try {
        const paypal = require('@paypal/checkout-server-sdk');
        const environment =
          paypalMode === 'live'
            ? new paypal.core.LiveEnvironment(
                paypalClientId,
                paypalClientSecret,
              )
            : new paypal.core.SandboxEnvironment(
                paypalClientId,
                paypalClientSecret,
              );
        this.paypal = new paypal.core.PayPalHttpClient(environment);
        this.logger.log('PayPal SDK initialized');
      } catch (error) {
        this.logger.warn('PayPal SDK not available', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      this.logger.warn(
        'PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not set; PayPal gateway disabled',
      );
    }
  }

  /**
   * Get Stripe SDK instance
   */
  getStripeGateway(): any {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }
    return this.stripe;
  }

  /**
   * Get Razorpay SDK instance
   */
  getRazorpayGateway(): any {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }
    return this.razorpay;
  }

  /**
   * Get PayPal SDK instance
   */
  getPayPalGateway(): any {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }
    return this.paypal;
  }

  /**
   * Create customer in payment gateway
   */
  async createCustomer(
    gateway: PaymentGatewayType,
    customerData: {
      email: string;
      name?: string;
      userId: string;
    },
  ): Promise<{ customerId: string }> {
    if (gateway === 'stripe') {
      return this.createStripeCustomer(customerData);
    }
    if (gateway === 'razorpay') {
      return this.createRazorpayCustomer(customerData);
    }
    if (gateway === 'paypal') {
      return this.createPayPalCustomer(customerData);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  /**
   * Create payment method in payment gateway
   */
  async createPaymentMethod(
    gateway: PaymentGatewayType,
    paymentMethodData: {
      type: string;
      customerId: string;
      [key: string]: any;
    },
  ): Promise<{ paymentMethodId: string }> {
    if (gateway === 'stripe') {
      return this.createStripePaymentMethod(paymentMethodData);
    }
    if (gateway === 'razorpay') {
      return this.createRazorpayPaymentMethod(paymentMethodData);
    }
    if (gateway === 'paypal') {
      return this.createPayPalPaymentMethod(paymentMethodData);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  private async createStripeCustomer(customerData: {
    email: string;
    name?: string;
    userId: string;
  }): Promise<{ customerId: string }> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const customer = await this.stripe.customers.create({
      email: customerData.email,
      name: customerData.name || customerData.email,
      metadata: {
        userId: customerData.userId,
      },
    });

    return { customerId: customer.id };
  }

  private async createRazorpayCustomer(customerData: {
    email: string;
    name?: string;
    userId: string;
  }): Promise<{ customerId: string }> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    const customer = await this.razorpay.customers.create({
      email: customerData.email,
      name: customerData.name || customerData.email,
      contact: '', // Optional phone number
      notes: {
        userId: customerData.userId,
      },
    });

    return { customerId: customer.id };
  }

  private async createPayPalCustomer(customerData: {
    email: string;
    name?: string;
    userId: string;
  }): Promise<{ customerId: string }> {
    // PayPal doesn't have a traditional "customer" concept like Stripe/Razorpay
    // We can create a billing agreement or just return the email as identifier
    return { customerId: customerData.email };
  }

  private async createStripePaymentMethod(paymentMethodData: {
    type: string;
    customerId: string;
    paymentMethodId?: string;
    [key: string]: unknown;
  }): Promise<{ paymentMethodId: string }> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    // PCI DSS: Raw card data must NEVER touch the server. The client MUST use
    // Stripe.js or Stripe Elements to create a PaymentMethod and send only the
    // payment method ID (pm_xxx).
    if (
      paymentMethodData.type === 'card' &&
      (paymentMethodData.cardNumber || paymentMethodData.cvc)
    ) {
      throw new Error(
        'Raw card data cannot be sent to the server for PCI compliance. ' +
          'Use Stripe.js or Stripe Elements on the client to create a PaymentMethod, ' +
          'then pass the paymentMethodId (pm_xxx) in the request.',
      );
    }

    let paymentMethodId: string;

    if (paymentMethodData.paymentMethodId) {
      // Client created PaymentMethod via Stripe.js - validate format and attach
      const id = String(paymentMethodData.paymentMethodId).trim();
      if (!id.startsWith('pm_')) {
        throw new Error(
          'Invalid Stripe payment method ID. Must start with pm_. ' +
            'Create it using Stripe.js stripe.createPaymentMethod() on the client.',
        );
      }
      paymentMethodId = id;
    } else if (paymentMethodData.type !== 'card') {
      throw new Error(
        `Unsupported Stripe payment method type: ${paymentMethodData.type}. ` +
          'For cards, provide paymentMethodId from Stripe.js.',
      );
    } else {
      throw new Error(
        'paymentMethodId is required for card. Create it using Stripe.js stripe.createPaymentMethod() on the client.',
      );
    }

    // Attach to customer
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: paymentMethodData.customerId,
    });

    const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);

    return {
      paymentMethodId: pm.id,
    };
  }

  private async createRazorpayPaymentMethod(paymentMethodData: {
    type: string;
    customerId: string;
    razorpayTokenId?: string;
    cardNumber?: string;
    cardExpiryMonth?: number;
    cardExpiryYear?: number;
    cardCvc?: string;
    cardholderName?: string;
    upiId?: string;
    bankAccountNumber?: string;
    ifsc?: string;
    bankName?: string;
    [key: string]: unknown;
  }): Promise<{ paymentMethodId: string }> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    if (!paymentMethodData.customerId) {
      throw new Error(
        'Customer ID is required for Razorpay payment method creation',
      );
    }

    if (paymentMethodData.type === 'card') {
      // PCI DSS: Raw card data must NEVER touch the server.
      if (paymentMethodData.cardNumber || paymentMethodData.cardCvc) {
        throw new Error(
          'Raw card data cannot be sent to the server for PCI compliance. ' +
            'Use Razorpay Checkout or Razorpay Elements on the client to tokenize the card, ' +
            'then pass the razorpayTokenId in the request.',
        );
      }
      if (paymentMethodData.razorpayTokenId) {
        try {
          const token = await this.razorpay.tokens.create({
            customer_id: paymentMethodData.customerId,
            method: 'card',
            token: paymentMethodData.razorpayTokenId,
          });
          return { paymentMethodId: token.id };
        } catch (tokenError: unknown) {
          const errorMessage =
            tokenError instanceof Error
              ? tokenError.message
              : String(tokenError);
          this.logger.error('Razorpay token creation failed', {
            error: errorMessage,
          });
          throw new Error(
            `Razorpay card tokenization failed: ${errorMessage}. ` +
              'Ensure razorpayTokenId was created via Razorpay Checkout/Elements on the client.',
          );
        }
      }
      throw new Error(
        'razorpayTokenId is required for card. Create it using Razorpay Checkout or Razorpay Elements on the client.',
      );
    }

    if (paymentMethodData.type === 'upi' && paymentMethodData.upiId) {
      return {
        paymentMethodId: `upi_${paymentMethodData.customerId}_${Date.now()}`,
      };
    }

    if (
      paymentMethodData.type === 'bank_account' &&
      paymentMethodData.bankAccountNumber &&
      paymentMethodData.ifsc
    ) {
      return {
        paymentMethodId: `bank_${paymentMethodData.customerId}_${Date.now()}`,
      };
    }

    throw new Error(
      `Unsupported Razorpay payment method type: ${paymentMethodData.type}. For cards, provide cardNumber, cardExpiryMonth, cardExpiryYear, cardCvc.`,
    );
  }

  private async createPayPalPaymentMethod(paymentMethodData: {
    type: string;
    customerId: string;
    paypalEmail?: string;
    [key: string]: unknown;
  }): Promise<{ paymentMethodId: string }> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    if (
      paymentMethodData.type === 'paypal' ||
      paymentMethodData.type === 'paypal_account'
    ) {
      const email =
        paymentMethodData.paypalEmail || paymentMethodData.customerId;
      if (!email || typeof email !== 'string') {
        throw new Error(
          'PayPal email is required for PayPal payment method creation',
        );
      }
      const sanitizedEmail = email.includes('@')
        ? email.replace('@', '_at_')
        : email;
      return {
        paymentMethodId: `paypal_${sanitizedEmail}_${Date.now()}`,
      };
    }

    throw new Error(
      `Unsupported PayPal payment method type: ${paymentMethodData.type}. PayPal requires paypalEmail.`,
    );
  }

  /**
   * Create subscription in payment gateway
   */
  async createSubscription(
    gateway: PaymentGatewayType,
    params: CreateSubscriptionParams,
  ): Promise<CreateSubscriptionResult> {
    if (gateway === 'stripe') {
      return this.createStripeSubscription(params);
    }
    if (gateway === 'razorpay') {
      return this.createRazorpaySubscription(params);
    }
    if (gateway === 'paypal') {
      return this.createPayPalSubscription(params);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  /**
   * Update subscription in payment gateway
   */
  async updateSubscription(
    gateway: PaymentGatewayType,
    params: UpdateSubscriptionParams,
  ): Promise<UpdateSubscriptionResult> {
    if (gateway === 'stripe') {
      return this.updateStripeSubscription(params);
    }
    if (gateway === 'razorpay') {
      return this.updateRazorpaySubscription(params);
    }
    if (gateway === 'paypal') {
      return this.updatePayPalSubscription(params);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  /**
   * Cancel subscription in payment gateway
   */
  async cancelSubscription(
    gateway: PaymentGatewayType,
    params: CancelSubscriptionParams,
  ): Promise<CancelSubscriptionResult> {
    if (gateway === 'stripe') {
      return this.cancelStripeSubscription(params);
    }
    if (gateway === 'razorpay') {
      return this.cancelRazorpaySubscription(params);
    }
    if (gateway === 'paypal') {
      return this.cancelPayPalSubscription(params);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  /**
   * Process refund through the configured payment gateway.
   * Uses Stripe when gateway is 'stripe', Razorpay when gateway is 'razorpay', PayPal when gateway is 'paypal'.
   */
  async refund(
    gateway: PaymentGatewayType,
    params: RefundParams,
  ): Promise<RefundResult> {
    if (gateway === 'stripe') {
      return this.refundStripe(params);
    }
    if (gateway === 'razorpay') {
      return this.refundRazorpay(params);
    }
    if (gateway === 'paypal') {
      return this.refundPaypal(params);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  private async refundStripe(params: RefundParams): Promise<RefundResult> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const refundParams: Record<string, unknown> = {
      payment_intent: params.transactionId,
    };
    if (params.amount != null && params.amount > 0) {
      refundParams.amount = Math.round(params.amount * 100);
    }
    if (params.reason) {
      refundParams.reason = 'requested_by_customer';
      refundParams.metadata = { reason: params.reason };
    }

    const refund = await this.stripe.refunds.create(refundParams);

    const status: RefundResult['status'] =
      refund.status === 'succeeded'
        ? 'succeeded'
        : refund.status === 'pending'
          ? 'pending'
          : 'failed';

    return {
      refundId: refund.id,
      status,
      amount: (refund.amount ?? 0) / 100,
    };
  }

  private async refundRazorpay(params: RefundParams): Promise<RefundResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    const refundParams: Record<string, unknown> = {
      payment_id: params.transactionId,
    };

    if (params.amount != null && params.amount > 0) {
      // Razorpay expects amount in paisa (smallest currency unit)
      refundParams.amount = Math.round(params.amount * 100);
    }

    if (params.reason) {
      refundParams.notes = { reason: params.reason };
    }

    const refund = await this.razorpay.payments.refund(
      params.transactionId,
      refundParams,
    );

    const status: RefundResult['status'] =
      refund.status === 'processed'
        ? 'succeeded'
        : refund.status === 'pending'
          ? 'pending'
          : 'failed';

    return {
      refundId: refund.id,
      status,
      amount: (refund.amount ?? 0) / 100,
    };
  }

  private async refundPaypal(params: RefundParams): Promise<RefundResult> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    const paypal = require('@paypal/checkout-server-sdk');
    const request = new paypal.payments.CapturesRefundRequest(
      params.transactionId,
    );

    const refundRequest: any = {
      amount: {
        value: params.amount?.toFixed(2) || '0.00',
        currency_code: 'USD', // Default to USD, could be parameterized
      },
    };

    if (params.reason) {
      refundRequest.note_to_payer = params.reason;
    }

    request.requestBody(refundRequest);

    const response = await this.paypal.execute(request);
    const refund = response.result;

    const status: RefundResult['status'] =
      refund.status === 'COMPLETED'
        ? 'succeeded'
        : refund.status === 'PENDING'
          ? 'pending'
          : 'failed';

    return {
      refundId: refund.id,
      status,
      amount: parseFloat(refund.amount.value),
    };
  }

  /**
   * Charge a payment method (e.g. for one-time or overage).
   */
  async charge(
    gateway: PaymentGatewayType,
    params: ChargeParams,
  ): Promise<ChargeResult> {
    if (gateway === 'stripe') {
      return this.chargeStripe(params);
    }
    if (gateway === 'razorpay') {
      return this.chargeRazorpay(params);
    }
    if (gateway === 'paypal') {
      return this.chargePaypal(params);
    }
    throw new Error(`Unknown payment gateway: ${gateway}`);
  }

  private async chargeStripe(params: ChargeParams): Promise<ChargeResult> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(params.amount * 100),
      currency: (params.currency || 'usd').toLowerCase(),
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      confirm: true,
      description: params.description,
      metadata: params.metadata,
    });

    const status: ChargeResult['status'] =
      paymentIntent.status === 'succeeded'
        ? 'succeeded'
        : paymentIntent.status === 'processing'
          ? 'pending'
          : 'failed';

    return {
      transactionId: paymentIntent.id,
      status,
      amount: params.amount,
      currency: params.currency,
      metadata: params.metadata,
    };
  }

  private async chargeRazorpay(params: ChargeParams): Promise<ChargeResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    try {
      // Convert amount to paise (Razorpay uses smallest currency unit)
      const amountInPaise = Math.round(params.amount * 100);

      // For one-time payments, create order and payment link
      // In a full implementation, you'd check for saved payment methods
      // and use direct payment capture for recurring charges

      // Create order
      const order = await this.razorpay.orders.create({
        amount: amountInPaise,
        currency: (params.currency || 'INR').toUpperCase(),
        receipt:
          params.metadata?.receipt ||
          `receipt_${Date.now()}_${params.customerId}`,
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
          currency: (params.currency || 'INR').toUpperCase(),
          description: params.description ?? 'Payment',
          customer: {
            name: '',
            contact: '',
            email: '',
          },
          notify: {
            sms: false,
            email: false,
          },
          reminder_enable: false,
          notes: {
            orderId: order.id,
            customerId: params.customerId,
            ...params.metadata,
          },
        });

        return {
          transactionId: order.id,
          status: 'pending', // Payment link created, awaiting payment
          amount: params.amount,
          currency: params.currency || 'INR',
          metadata: {
            ...params.metadata,
            orderId: order.id,
            paymentLinkId: paymentLink.id,
            paymentLinkUrl: paymentLink.short_url,
            receipt: order.receipt,
          },
        };
      } catch (linkError) {
        // If payment link creation fails, return order (customer can pay via other means)
        this.logger.warn('Payment link creation failed, returning order only', {
          error:
            linkError instanceof Error ? linkError.message : 'Unknown error',
          orderId: order.id,
        });

        return {
          transactionId: order.id,
          status: 'pending',
          amount: params.amount,
          currency: params.currency || 'INR',
          metadata: {
            ...params.metadata,
            orderId: order.id,
            receipt: order.receipt,
            note: 'Payment link creation failed. Use order ID for manual payment.',
          },
        };
      }
    } catch (error) {
      this.logger.error('Razorpay charge error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        customerId: params.customerId,
        paymentMethodId: params.paymentMethodId,
        amount: params.amount,
      });
      throw error;
    }
  }

  private async chargePaypal(params: ChargeParams): Promise<ChargeResult> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    const paypal = require('@paypal/checkout-server-sdk');
    const request = new paypal.orders.OrdersCreateRequest();

    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: (params.currency || 'USD').toUpperCase(),
            value: params.amount.toFixed(2),
          },
          description: params.description,
        },
      ],
      application_context: {
        brand_name: 'Cost Katana',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
      },
    });

    const response = await this.paypal.execute(request);
    const order = response.result;

    const status: ChargeResult['status'] = 'pending'; // Order created, payment pending

    return {
      transactionId: order.id,
      status,
      amount: params.amount,
      currency: params.currency || 'USD',
      metadata: {
        ...params.metadata,
        orderId: order.id,
        paypalOrderId: order.id,
      },
    };
  }

  // Subscription management private methods

  private async createStripeSubscription(
    params: CreateSubscriptionParams,
  ): Promise<CreateSubscriptionResult> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const subscriptionData: any = {
      customer: params.customerId,
      items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: `Subscription - ${params.planId}`,
            },
            unit_amount: Math.round(params.amount * 100),
            recurring: {
              interval: params.interval,
            },
          },
        },
      ],
      default_payment_method: params.paymentMethodId,
      metadata: params.metadata || {},
    };

    if (params.trialDays && params.trialDays > 0) {
      subscriptionData.trial_period_days = params.trialDays;
    }

    const subscription =
      await this.stripe.subscriptions.create(subscriptionData);

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : undefined,
      metadata: subscription.metadata,
    };
  }

  private async createRazorpaySubscription(
    params: CreateSubscriptionParams,
  ): Promise<CreateSubscriptionResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    const startAt =
      Math.floor(Date.now() / 1000) +
      (params.trialDays ? params.trialDays * 24 * 60 * 60 : 0);

    const subscription = await this.razorpay.subscriptions.create({
      plan_id: params.planId,
      customer_id: params.customerId,
      customer_notify: 1,
      start_at: startAt,
      notes: params.metadata || {},
    });

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_start * 1000),
      currentPeriodEnd: new Date(subscription.current_end * 1000),
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : undefined,
      metadata: subscription.notes,
    };
  }

  private async createPayPalSubscription(
    params: CreateSubscriptionParams,
  ): Promise<CreateSubscriptionResult> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    const paypal = require('@paypal/checkout-server-sdk');

    const request = new paypal.billing.SubscriptionsCreateRequest();

    request.requestBody({
      plan_id: params.planId,
      subscriber: {
        email_address: params.metadata?.email,
      },
      application_context: {
        brand_name: 'Cost Katana',
        user_action: 'SUBSCRIBE_NOW',
      },
    });

    const response = await this.paypal.execute(request);
    const subscription = response.result;

    const periodStart = new Date();
    const periodEnd = this.extractPayPalPeriodEnd(subscription);

    return {
      subscriptionId: subscription.id,
      status: subscription.status.toLowerCase(),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      metadata: params.metadata,
    };
  }

  /**
   * Extract billing period end from PayPal subscription object.
   * Uses next_billing_time from billing_info when available.
   */
  private extractPayPalPeriodEnd(subscription: Record<string, unknown>): Date {
    const billingInfo = subscription.billing_info as
      | Record<string, unknown>
      | undefined;
    if (billingInfo?.next_billing_time) {
      const next = billingInfo.next_billing_time;
      if (typeof next === 'string') return new Date(next);
      if (typeof next === 'number') return new Date(next * 1000);
    }
    const lastPayment = billingInfo?.last_payment as
      | Record<string, unknown>
      | undefined;
    if (lastPayment?.time) {
      const last = lastPayment.time;
      if (typeof last === 'string') return new Date(last);
      if (typeof last === 'number') return new Date(last * 1000);
    }
    const plan = subscription.plan as Record<string, unknown> | undefined;
    const cycles = plan?.billing_cycles as
      | Record<string, unknown>[]
      | undefined;
    const cycle = cycles?.[0] as Record<string, unknown> | undefined;
    if (cycle) {
      const frequency = cycle.frequency as
        | { interval_unit?: string; interval_count?: number }
        | undefined;
      const months =
        frequency?.interval_unit === 'MONTH'
          ? (frequency?.interval_count ?? 1)
          : 1;
      const end = new Date();
      end.setMonth(end.getMonth() + months);
      return end;
    }
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  private async updateStripeSubscription(
    params: UpdateSubscriptionParams,
  ): Promise<UpdateSubscriptionResult> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const updateData: any = {
      metadata: params.metadata || {},
    };

    if (params.amount !== undefined) {
      // Update the subscription item price
      const subscription = await this.stripe.subscriptions.retrieve(
        params.subscriptionId,
      );
      const item = subscription.items.data[0];

      await this.stripe.subscriptions.update(params.subscriptionId, {
        items: [
          {
            id: item.id,
            price_data: {
              currency: 'usd',
              product: item.price.product,
              unit_amount: Math.round(params.amount * 100),
              recurring: {
                interval: params.interval || item.price.recurring.interval,
              },
            },
          },
        ],
        proration_behavior: 'create_prorations',
      });
    }

    if (params.paymentMethodId) {
      updateData.default_payment_method = params.paymentMethodId;
    }

    if (params.cancelAtPeriodEnd !== undefined) {
      updateData.cancel_at_period_end = params.cancelAtPeriodEnd;
    }

    const updatedSubscription = await this.stripe.subscriptions.update(
      params.subscriptionId,
      updateData,
    );

    return {
      subscriptionId: updatedSubscription.id,
      status: updatedSubscription.status,
      currentPeriodStart: new Date(
        updatedSubscription.current_period_start * 1000,
      ),
      currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000),
      cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
    };
  }

  private async updateRazorpaySubscription(
    params: UpdateSubscriptionParams,
  ): Promise<UpdateSubscriptionResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    if (params.amount !== undefined || params.interval !== undefined) {
      throw new Error(
        'Razorpay does not support direct amount or interval updates on existing subscriptions. ' +
          'Create a new plan in Razorpay Dashboard, then create a new subscription and migrate the customer.',
      );
    }

    const updateData: Record<string, unknown> = {
      notes: params.metadata || {},
    };

    if (params.cancelAtPeriodEnd !== undefined) {
      if (params.cancelAtPeriodEnd) {
        await this.razorpay.subscriptions.pause(params.subscriptionId, {
          pause_at: 'next_billing_cycle',
        });
        updateData.status = 'paused';
      } else {
        await this.razorpay.subscriptions.resume(params.subscriptionId);
        updateData.status = 'active';
      }
    }

    const subscription = await this.razorpay.subscriptions.fetch(
      params.subscriptionId,
    );

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_start * 1000),
      currentPeriodEnd: new Date(subscription.current_end * 1000),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    };
  }

  private async updatePayPalSubscription(
    params: UpdateSubscriptionParams,
  ): Promise<UpdateSubscriptionResult> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    const paypal = require('@paypal/checkout-server-sdk');

    if (params.cancelAtPeriodEnd !== undefined) {
      if (params.cancelAtPeriodEnd) {
        // Cancel subscription
        const request = new paypal.billing.SubscriptionsCancelRequest(
          params.subscriptionId,
        );
        request.requestBody({
          reason: params.metadata?.reason || 'Customer requested cancellation',
        });
        await this.paypal.execute(request);
      }
      // PayPal doesn't support resuming cancelled subscriptions easily
    }

    // Fetch updated subscription details
    const request = new paypal.billing.SubscriptionsGetRequest(
      params.subscriptionId,
    );
    const response = await this.paypal.execute(request);
    const subscription = response.result as Record<string, unknown>;

    const periodEnd = this.extractPayPalPeriodEnd(subscription);

    return {
      subscriptionId: subscription.id as string,
      status: (subscription.status as string).toLowerCase(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    };
  }

  private async cancelStripeSubscription(
    params: CancelSubscriptionParams,
  ): Promise<CancelSubscriptionResult> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const cancelData: any = {};

    if (params.cancelAtPeriodEnd) {
      cancelData.cancel_at_period_end = true;
    }

    const subscription = await this.stripe.subscriptions.update(
      params.subscriptionId,
      cancelData,
    );

    if (!params.cancelAtPeriodEnd) {
      await this.stripe.subscriptions.cancel(params.subscriptionId);
    }

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      canceledAt: params.cancelAtPeriodEnd ? undefined : new Date(),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd || false,
    };
  }

  private async cancelRazorpaySubscription(
    params: CancelSubscriptionParams,
  ): Promise<CancelSubscriptionResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    if (params.cancelAtPeriodEnd) {
      // Pause subscription
      await this.razorpay.subscriptions.pause(params.subscriptionId, {
        pause_at: 'next_billing_cycle',
      });
    } else {
      // Cancel immediately
      await this.razorpay.subscriptions.cancel(params.subscriptionId, {
        cancel_at_cycle_end: false,
      });
    }

    const subscription = await this.razorpay.subscriptions.fetch(
      params.subscriptionId,
    );

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      canceledAt: params.cancelAtPeriodEnd ? undefined : new Date(),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd || false,
    };
  }

  private async cancelPayPalSubscription(
    params: CancelSubscriptionParams,
  ): Promise<CancelSubscriptionResult> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    const paypal = require('@paypal/checkout-server-sdk');
    const request = new paypal.billing.SubscriptionsCancelRequest(
      params.subscriptionId,
    );

    request.requestBody({
      reason: params.reason || 'Customer requested cancellation',
    });

    await this.paypal.execute(request);

    // Fetch cancelled subscription details
    const getRequest = new paypal.billing.SubscriptionsGetRequest(
      params.subscriptionId,
    );
    const response = await this.paypal.execute(getRequest);
    const subscription = response.result;

    return {
      subscriptionId: subscription.id,
      status: subscription.status.toLowerCase(),
      canceledAt: new Date(),
      cancelAtPeriodEnd: false, // PayPal cancellations are immediate
    };
  }

  /**
   * Verify webhook signature for a payment gateway
   */
  verifyWebhookSignature(
    gateway: PaymentGatewayType,
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    try {
      if (gateway === 'stripe') {
        return this.verifyStripeWebhookSignature(payload, signature, secret);
      }
      if (gateway === 'razorpay') {
        return this.verifyRazorpayWebhookSignature(payload, signature, secret);
      }
      if (gateway === 'paypal') {
        return this.verifyPayPalWebhookSignature(payload, signature, secret);
      }
      this.logger.warn(
        `Unsupported gateway for webhook verification: ${gateway}`,
      );
      return false;
    } catch (error: any) {
      this.logger.error(
        `Webhook signature verification failed for ${gateway}`,
        {
          error: error.message,
        },
      );
      return false;
    }
  }

  /**
   * Verify webhook signature for a payment gateway with full cryptographic validation (async)
   */
  async verifyWebhookSignatureAsync(
    gateway: PaymentGatewayType,
    payload: string,
    signature: string,
    secret: string,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    try {
      if (gateway === 'stripe') {
        return this.verifyStripeWebhookSignatureAsync(
          payload,
          signature,
          secret,
        );
      }
      if (gateway === 'razorpay') {
        return this.verifyRazorpayWebhookSignatureAsync(
          payload,
          signature,
          secret,
        );
      }
      if (gateway === 'paypal') {
        return this.verifyPayPalWebhookSignatureAsync(
          payload,
          signature,
          secret,
          headers,
        );
      }
      this.logger.warn(
        `Unsupported gateway for webhook verification: ${gateway}`,
      );
      return false;
    } catch (error: any) {
      this.logger.error(
        `Async webhook signature verification failed for ${gateway}`,
        {
          error: error.message,
        },
      );
      return false;
    }
  }

  /**
   * Parse webhook event for a payment gateway
   */
  parseWebhookEvent(
    gateway: PaymentGatewayType,
    payload: unknown,
    headers: Record<string, string>,
  ): WebhookEvent {
    try {
      if (gateway === 'stripe') {
        return this.parseStripeWebhookEvent(payload);
      }
      if (gateway === 'razorpay') {
        return this.parseRazorpayWebhookEvent(payload);
      }
      if (gateway === 'paypal') {
        return this.parsePayPalWebhookEvent(payload);
      }
      throw new Error(`Unsupported gateway for webhook parsing: ${gateway}`);
    } catch (error: any) {
      this.logger.error(`Webhook event parsing failed for ${gateway}`, {
        error: error.message,
      });
      // Return a default event structure if parsing fails
      return {
        id: '',
        type: 'unknown',
        data: payload,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get subscription details from payment gateway
   */
  async getSubscription(
    gateway: PaymentGatewayType,
    subscriptionId: string,
  ): Promise<any> {
    if (gateway === 'stripe') {
      return this.getStripeSubscription(subscriptionId);
    }
    if (gateway === 'razorpay') {
      return this.getRazorpaySubscription(subscriptionId);
    }
    if (gateway === 'paypal') {
      return this.getPayPalSubscription(subscriptionId);
    }
    throw new Error(
      `Unsupported gateway for subscription retrieval: ${gateway}`,
    );
  }

  /**
   * Retry failed payment for a subscription
   */
  async retryFailedPayment(
    gateway: PaymentGatewayType,
    subscriptionId: string,
    paymentMethodId: string,
  ): Promise<ChargeResult> {
    if (gateway === 'stripe') {
      return this.retryStripeFailedPayment(subscriptionId, paymentMethodId);
    }
    if (gateway === 'razorpay') {
      return this.retryRazorpayFailedPayment(subscriptionId, paymentMethodId);
    }
    if (gateway === 'paypal') {
      return this.retryPayPalFailedPayment(subscriptionId, paymentMethodId);
    }
    throw new Error(`Unsupported gateway for payment retry: ${gateway}`);
  }

  private verifyStripeWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    try {
      if (!this.stripe) {
        this.logger.warn(
          'Stripe SDK not initialized, cannot verify webhook signature',
        );
        return false;
      }

      const webhookSecret =
        secret || this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
      if (!webhookSecret) {
        this.logger.error('Stripe webhook secret not configured');
        return false;
      }

      try {
        const event = this.stripe.webhooks.constructEvent(
          payload,
          signature,
          webhookSecret,
        );
        return event !== null && event !== undefined;
      } catch (err: any) {
        this.logger.error('Stripe webhook signature verification failed', {
          error: err.message,
          type: err.type,
        });
        return false;
      }
    } catch (error) {
      this.logger.error('Stripe webhook signature verification error', {
        error,
      });
      return false;
    }
  }

  private verifyRazorpayWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    try {
      const webhookSecret =
        secret || this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
      if (!webhookSecret) {
        this.logger.error('Razorpay webhook secret not configured');
        return false;
      }

      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error('Razorpay webhook signature verification failed', {
        error,
      });
      return false;
    }
  }

  private verifyPayPalWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    try {
      if (!this.paypal) {
        this.logger.warn(
          'PayPal SDK not initialized, cannot verify webhook signature',
        );
        return false;
      }

      const webhookId =
        this.configService.get<string>('PAYPAL_WEBHOOK_ID') || secret;
      if (!webhookId) {
        this.logger.error('PayPal webhook ID not configured');
        return false;
      }

      // Validate signature is not empty
      if (!signature || signature.length === 0) {
        this.logger.warn('PayPal webhook signature is empty');
        return false;
      }

      // Validate signature format (PayPal transmission signatures are base64 encoded, typically 88+ characters)
      if (signature.length < 20) {
        this.logger.warn('PayPal webhook signature too short', {
          signatureLength: signature.length,
        });
        return false;
      }

      // Validate payload is not empty
      if (!payload || payload.length === 0) {
        this.logger.warn('PayPal webhook payload is empty');
        return false;
      }

      // Validate payload is valid JSON
      let parsedPayload: unknown;
      try {
        parsedPayload =
          typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (parseError: unknown) {
        const errorMessage =
          parseError instanceof Error ? parseError.message : String(parseError);
        this.logger.warn('PayPal webhook payload is not valid JSON', {
          error: errorMessage,
        });
        return false;
      }

      // Validate payload structure contains expected PayPal webhook event fields
      if (typeof parsedPayload === 'object' && parsedPayload !== null) {
        const event = parsedPayload as Record<string, unknown>;

        // PayPal webhook events should have at least one of these identifiers
        const hasId = typeof event.id === 'string' && event.id.length > 0;
        const hasEventType =
          typeof event.event_type === 'string' && event.event_type.length > 0;
        const hasType = typeof event.type === 'string' && event.type.length > 0;
        const hasResource =
          event.resource !== undefined || event.data !== undefined;

        if (!hasId && !hasEventType && !hasType) {
          this.logger.warn(
            'PayPal webhook payload missing required event identifiers',
            {
              hasId,
              hasEventType,
              hasType,
              hasResource,
            },
          );
          return false;
        }
      } else {
        this.logger.warn('PayPal webhook payload is not an object');
        return false;
      }

      // Basic format validation passed
      this.logger.debug('PayPal webhook signature basic validation passed', {
        signatureLength: signature.length,
        webhookIdLength: webhookId.length,
        payloadLength: payload.length,
        hasEventId:
          typeof parsedPayload === 'object' &&
          parsedPayload !== null &&
          'id' in parsedPayload,
      });

      // Basic format validation passed - full cryptographic verification requires async API call
      // The webhook handler should call verifyWebhookSignatureAsync() for full verification
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('PayPal webhook signature verification failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  private parseStripeWebhookEvent(payload: unknown): WebhookEvent {
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
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error('Failed to parse Stripe webhook payload', {
          error: errorMessage,
        });
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

  private parseRazorpayWebhookEvent(payload: unknown): WebhookEvent {
    const event = payload as {
      event?: string;
      id?: string;
      type?: string;
      payload?: unknown;
      data?: unknown;
      created_at?: number | string;
    };

    const timestamp = event.created_at
      ? typeof event.created_at === 'number'
        ? new Date(event.created_at * 1000)
        : new Date(event.created_at)
      : new Date();

    return {
      id: event.event ?? event.id ?? '',
      type: event.event ?? event.type ?? '',
      data: event.payload ?? event.data ?? event,
      timestamp: timestamp,
    };
  }

  private parsePayPalWebhookEvent(payload: unknown): WebhookEvent {
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

    const timestamp =
      event.create_time || event.time
        ? typeof (event.create_time || event.time) === 'number'
          ? new Date(((event.create_time || event.time) as number) * 1000)
          : new Date(event.create_time || (event.time as string))
        : new Date();

    return {
      id: event.id ?? event.event_version ?? '',
      type: event.event_type ?? event.type ?? '',
      data: event.resource ?? event.data ?? event,
      timestamp: timestamp,
    };
  }

  private async getStripeSubscription(subscriptionId: string): Promise<any> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  private async getRazorpaySubscription(subscriptionId: string): Promise<any> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    return await this.razorpay.subscriptions.fetch(subscriptionId);
  }

  private async getPayPalSubscription(subscriptionId: string): Promise<any> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    const paypal = require('@paypal/checkout-server-sdk');
    const request = new paypal.billing.SubscriptionsGetRequest(subscriptionId);
    const response = await this.paypal.execute(request);
    return response.result;
  }

  private async retryStripeFailedPayment(
    subscriptionId: string,
    paymentMethodId: string,
  ): Promise<ChargeResult> {
    if (!this.stripe) {
      throw new Error('Stripe SDK not initialized');
    }

    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    const amount = subscription.amount ?? 0;
    const currency = subscription.currency ?? 'USD';
    const customerId = subscription.customer ?? '';

    if (!customerId) {
      throw new Error('Customer ID not found in subscription');
    }

    // Attempt to charge
    const charge = await this.stripe.paymentIntents.create({
      amount: amount,
      currency: currency.toLowerCase(),
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      description: `Retry payment for subscription ${subscriptionId}`,
    });

    return {
      transactionId: charge.id,
      status: charge.status === 'succeeded' ? 'succeeded' : 'failed',
      amount: charge.amount / 100, // Convert from cents
      currency: charge.currency,
      metadata: charge.metadata,
    };
  }

  private async retryRazorpayFailedPayment(
    subscriptionId: string,
    paymentMethodId: string,
  ): Promise<ChargeResult> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    const subscription =
      await this.razorpay.subscriptions.fetch(subscriptionId);
    const amount = subscription.amount ?? 0;
    const currency = subscription.currency ?? 'INR';
    const customerId = subscription.customer_id ?? '';

    if (!customerId) {
      throw new Error('Customer ID not found in subscription');
    }

    // Create a new payment order with enhanced payment method handling
    // Razorpay doesn't natively support payment_method_id in order creation,
    // but we can enhance the integration by storing payment method references
    // and using them for better payment flow management
    const orderPayload: any = {
      amount: amount,
      currency: currency,
      customer_id: customerId,
      payment_capture: 1,
      notes: {
        subscription_id: subscriptionId,
        retry: 'true',
        retry_attempt: new Date().toISOString(),
      },
    };

    // Enhanced payment method handling for Razorpay
    if (paymentMethodId) {
      // Store payment method ID for reference and potential future use
      orderPayload.notes.payment_method_id = paymentMethodId;
      orderPayload.notes.payment_method_type = 'saved_card'; // Assuming card-based payment method

      // Add additional metadata for better tracking
      orderPayload.notes.customer_payment_preference = 'saved_method';
      orderPayload.notes.payment_retry_context =
        'subscription_failure_recovery';

      this.logger.debug(
        'Razorpay retry order created with saved payment method',
        {
          subscriptionId,
          paymentMethodId,
          amount,
          currency,
        },
      );
    } else {
      // Fallback when no specific payment method is provided
      orderPayload.notes.payment_method_type = 'customer_default';
      orderPayload.notes.payment_retry_context =
        'subscription_failure_recovery_no_method';

      this.logger.debug(
        'Razorpay retry order created without specific payment method',
        {
          subscriptionId,
          amount,
          currency,
        },
      );
    }

    const order = await this.razorpay.orders.create(orderPayload);

    return {
      transactionId: order.id,
      status: 'pending', // Razorpay orders start as pending
      amount: order.amount / 100, // Convert from paisa
      currency: order.currency,
      metadata: order.notes,
    };
  }

  private async retryPayPalFailedPayment(
    subscriptionId: string,
    paymentMethodId: string,
  ): Promise<ChargeResult> {
    if (!this.paypal) {
      throw new Error('PayPal SDK not initialized');
    }

    // PayPal subscriptions don't typically need manual retries as they handle this automatically
    // But if we need to trigger a billing cycle, we can update the subscription
    const paypal = require('@paypal/checkout-server-sdk');

    // Get current subscription
    const getRequest = new paypal.billing.SubscriptionsGetRequest(
      subscriptionId,
    );
    const getResponse = await this.paypal.execute(getRequest);
    const subscription = getResponse.result;

    // For PayPal, we typically just return success as PayPal handles retries automatically
    // But we can log the attempt
    this.logger.log('PayPal subscription retry attempted', {
      subscriptionId,
      paymentMethodId,
      status: subscription.status,
    });

    return {
      transactionId: subscriptionId,
      status: 'pending', // PayPal will handle the actual retry
      amount: 0, // Amount is not available in subscription object
      currency: 'USD', // Default assumption
      metadata: { retry_attempted: true },
    };
  }

  // Async webhook signature verification methods with full cryptographic validation

  private async verifyStripeWebhookSignatureAsync(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    if (!this.stripe) {
      this.logger.warn(
        'Stripe SDK not initialized, cannot verify webhook signature',
      );
      return false;
    }

    try {
      // Use Stripe's constructEvent for full cryptographic verification
      this.stripe.webhooks.constructEvent(payload, signature, secret);
      this.logger.debug(
        'Stripe webhook signature verified successfully (async)',
      );
      return true;
    } catch (error: any) {
      this.logger.error(
        'Stripe webhook signature verification failed (async)',
        {
          error: error.message,
        },
      );
      return false;
    }
  }

  private async verifyRazorpayWebhookSignatureAsync(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    try {
      // Razorpay webhook verification requires payload, signature, and secret
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isValid = signature === expectedSignature;

      if (isValid) {
        this.logger.debug(
          'Razorpay webhook signature verified successfully (async)',
        );
      } else {
        this.logger.warn(
          'Razorpay webhook signature verification failed (async)',
        );
      }

      return isValid;
    } catch (error: any) {
      this.logger.error(
        'Razorpay webhook signature verification error (async)',
        {
          error: error.message,
        },
      );
      return false;
    }
  }

  private async verifyPayPalWebhookSignatureAsync(
    payload: string,
    signature: string,
    secret: string,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    if (!this.paypal) {
      this.logger.warn(
        'PayPal SDK not initialized, cannot verify webhook signature',
      );
      return false;
    }

    try {
      // PayPal requires full cryptographic verification using their API
      const paypal = require('@paypal/checkout-server-sdk');

      // Extract required headers for PayPal webhook verification
      const authAlgo =
        headers?.['paypal-auth-algo'] || headers?.['PAYPAL-AUTH-ALGO'];
      const certUrl =
        headers?.['paypal-cert-url'] || headers?.['PAYPAL-CERT-URL'];
      const transmissionId =
        headers?.['paypal-transmission-id'] ||
        headers?.['PAYPAL-TRANSMISSION-ID'];
      const transmissionSig = signature;
      const transmissionTime =
        headers?.['paypal-transmission-time'] ||
        headers?.['PAYPAL-TRANSMISSION-TIME'];

      if (
        !authAlgo ||
        !certUrl ||
        !transmissionId ||
        !transmissionSig ||
        !transmissionTime
      ) {
        this.logger.warn(
          'PayPal webhook missing required headers for verification',
          {
            hasAuthAlgo: !!authAlgo,
            hasCertUrl: !!certUrl,
            hasTransmissionId: !!transmissionId,
            hasTransmissionSig: !!transmissionSig,
            hasTransmissionTime: !!transmissionTime,
          },
        );
        return false;
      }

      // Create webhook verification request
      const verifyRequest =
        new paypal.webhooks.WebhooksVerifySignatureRequest();
      verifyRequest.requestBody({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_event: JSON.parse(payload),
      });

      const response = await this.paypal.execute(verifyRequest);

      // PayPal returns SUCCESS or FAILURE
      const isValid = response.result.verification_status === 'SUCCESS';

      if (isValid) {
        this.logger.debug(
          'PayPal webhook signature verified successfully (async)',
        );
      } else {
        this.logger.warn(
          'PayPal webhook signature verification failed (async)',
          {
            status: response.result.verification_status,
          },
        );
      }

      return isValid;
    } catch (error: any) {
      this.logger.error('PayPal webhook signature verification error (async)', {
        error: error.message,
      });
      return false;
    }
  }

  isGatewayAvailable(gateway: PaymentGatewayType): boolean {
    if (gateway === 'stripe') return !!this.stripe;
    if (gateway === 'razorpay') return !!this.razorpay;
    if (gateway === 'paypal') return !!this.paypal;
    return false;
  }
}
