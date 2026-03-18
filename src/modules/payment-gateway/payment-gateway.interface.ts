export type PaymentGatewayType = 'stripe' | 'razorpay' | 'paypal';

export interface CreateCustomerParams {
  email: string;
  name?: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCustomerResult {
  customerId: string;
  gateway: PaymentGatewayType;
}

export interface CreatePaymentMethodParams {
  customerId: string;
  type: 'card' | 'upi' | 'bank_account' | 'paypal';
  /**
   * PCI DSS: For Stripe cards, the client MUST use Stripe.js/Elements to create
   * a PaymentMethod and pass only this token. Raw card data must never touch the server.
   */
  paymentMethodId?: string;
  /**
   * Razorpay: Token from Razorpay Checkout/Elements (client-side tokenization).
   * Do not pass raw card data - use Razorpay.js to obtain a token.
   */
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
  paypalEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentMethodResult {
  paymentMethodId: string;
  type: 'card' | 'upi' | 'bank_account' | 'paypal_account';
  card?: {
    last4: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
  };
  upi?: {
    upiId: string;
    vpa: string;
  };
  bankAccount?: {
    maskedAccountNumber: string;
    bankName?: string;
  };
  paypal?: {
    email: string;
  };
}

export interface CreateSubscriptionParams {
  customerId: string;
  paymentMethodId: string;
  planId: string;
  amount: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  trialDays?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
  status: 'active' | 'trialing' | 'incomplete' | 'past_due';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd?: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateSubscriptionParams {
  subscriptionId: string;
  amount?: number;
  interval?: 'monthly' | 'yearly';
  paymentMethodId?: string;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateSubscriptionResult {
  subscriptionId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface CancelSubscriptionParams {
  subscriptionId: string;
  cancelAtPeriodEnd?: boolean;
  reason?: string;
}

export interface CancelSubscriptionResult {
  subscriptionId: string;
  status: string;
  canceledAt?: Date;
  cancelAtPeriodEnd: boolean;
}

export interface RefundParams {
  transactionId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  refundId: string;
  status: 'succeeded' | 'pending' | 'failed';
  amount: number;
}

export interface ChargeParams {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  transactionId: string;
  status: 'succeeded' | 'pending' | 'failed';
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: unknown;
  timestamp: Date;
}

export interface IPaymentGateway {
  // Existing methods...

  /**
   * Verify webhook signature for a payment gateway (synchronous basic validation)
   */
  verifyWebhookSignature(
    gateway: PaymentGatewayType,
    payload: string,
    signature: string,
    secret: string,
  ): boolean;

  /**
   * Verify webhook signature for a payment gateway with full cryptographic validation (async)
   */
  verifyWebhookSignatureAsync(
    gateway: PaymentGatewayType,
    payload: string,
    signature: string,
    secret: string,
    headers?: Record<string, string>,
  ): Promise<boolean>;

  /**
   * Parse webhook event for a payment gateway
   */
  parseWebhookEvent(
    gateway: PaymentGatewayType,
    payload: unknown,
    headers: Record<string, string>,
  ): WebhookEvent;

  /**
   * Get subscription details from payment gateway
   */
  getSubscription(
    gateway: PaymentGatewayType,
    subscriptionId: string,
  ): Promise<any>;

  /**
   * Retry failed payment for a subscription
   */
  retryFailedPayment(
    gateway: PaymentGatewayType,
    subscriptionId: string,
    paymentMethodId: string,
  ): Promise<ChargeResult>;
}
