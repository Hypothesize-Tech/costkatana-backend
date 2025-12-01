
export type PaymentGateway = 'stripe' | 'razorpay' | 'paypal';

export interface CreateCustomerParams {
    email: string;
    name: string;
    userId: string;
    metadata?: Record<string, any>;
}

export interface CreateCustomerResult {
    customerId: string;
    gateway: PaymentGateway;
}

export interface CreatePaymentMethodParams {
    customerId: string;
    type: 'card' | 'upi' | 'bank_account' | 'paypal';
    // Card details
    cardNumber?: string;
    cardExpiryMonth?: number;
    cardExpiryYear?: number;
    cardCvc?: string;
    cardholderName?: string;
    // UPI details
    upiId?: string;
    // Bank account details
    bankAccountNumber?: string;
    ifsc?: string;
    bankName?: string;
    // PayPal
    paypalEmail?: string;
    metadata?: Record<string, any>;
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
        ifsc?: string;
        bankName?: string;
    };
    paypalAccount?: {
        email: string;
    };
    metadata?: Record<string, any>;
}

export interface CreateSubscriptionParams {
    customerId: string;
    paymentMethodId: string;
    planId: string;
    amount: number;
    currency: string;
    interval: 'monthly' | 'yearly';
    trialDays?: number;
    metadata?: Record<string, any>;
}

export interface CreateSubscriptionResult {
    subscriptionId: string;
    status: 'active' | 'trialing' | 'incomplete' | 'past_due';
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    trialEnd?: Date;
    metadata?: Record<string, any>;
}

export interface UpdateSubscriptionParams {
    subscriptionId: string;
    amount?: number;
    interval?: 'monthly' | 'yearly';
    paymentMethodId?: string;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, any>;
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

export interface ChargeParams {
    customerId: string;
    paymentMethodId: string;
    amount: number;
    currency: string;
    description?: string;
    metadata?: Record<string, any>;
}

export interface ChargeResult {
    transactionId: string;
    status: 'succeeded' | 'pending' | 'failed';
    amount: number;
    currency: string;
    metadata?: Record<string, any>;
}

export interface RefundParams {
    transactionId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, any>;
}

export interface RefundResult {
    refundId: string;
    status: 'succeeded' | 'pending' | 'failed';
    amount: number;
}

export interface WebhookEvent {
    id: string;
    type: string;
    data: any;
    timestamp: Date;
}

export interface IPaymentGateway {
    gateway: PaymentGateway;
    
    // Customer management
    createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult>;
    getCustomer(customerId: string): Promise<any>;
    updateCustomer(customerId: string, updates: Record<string, any>): Promise<any>;
    deleteCustomer(customerId: string): Promise<void>;
    
    // Payment method management
    createPaymentMethod(params: CreatePaymentMethodParams): Promise<CreatePaymentMethodResult>;
    getPaymentMethod(paymentMethodId: string): Promise<any>;
    updatePaymentMethod(paymentMethodId: string, updates: Record<string, any>): Promise<any>;
    deletePaymentMethod(paymentMethodId: string): Promise<void>;
    attachPaymentMethodToCustomer(paymentMethodId: string, customerId: string): Promise<void>;
    setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
    
    // Subscription management
    createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>;
    getSubscription(subscriptionId: string): Promise<any>;
    updateSubscription(params: UpdateSubscriptionParams): Promise<UpdateSubscriptionResult>;
    cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult>;
    reactivateSubscription(subscriptionId: string): Promise<CreateSubscriptionResult>;
    
    // Payment operations
    charge(params: ChargeParams): Promise<ChargeResult>;
    refund(params: RefundParams): Promise<RefundResult>;
    
    // Webhook handling
    verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
    parseWebhookEvent(payload: any, headers: Record<string, string>): WebhookEvent;
}

