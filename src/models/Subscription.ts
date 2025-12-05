import mongoose, { Schema, Document, ObjectId } from 'mongoose';

export interface ISubscription extends Document {
    userId: ObjectId;
    plan: 'free' | 'plus' | 'pro' | 'enterprise';
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'paused';
    
    // Dates
    startDate: Date;
    endDate?: Date;
    trialStart?: Date;
    trialEnd?: Date;
    isTrial: boolean;
    
    // Billing information
    billing: {
        amount: number;
        currency: string;
        interval: 'monthly' | 'yearly';
        nextBillingDate?: Date;
        billingCycleAnchor?: Date;
        cancelAtPeriodEnd: boolean;
        canceledAt?: Date;
        proratedAmount?: number;
    };
    
    // Payment gateway information (supports Stripe, Razorpay, PayPal)
    paymentGateway: 'stripe' | 'razorpay' | 'paypal' | null;
    gatewayCustomerId?: string; // Stripe customer ID, Razorpay customer ID, PayPal payer ID
    gatewaySubscriptionId?: string; // Stripe subscription ID, Razorpay subscription ID, PayPal billing agreement ID
    paymentMethodId?: ObjectId; // Reference to PaymentMethod model
    
    // Discount/coupon
    discount?: {
        code?: string;
        amount?: number;
        type?: 'percentage' | 'fixed';
        expiresAt?: Date;
    };
    
    // Limits
    limits: {
        tokensPerMonth: number;
        requestsPerMonth: number;
        logsPerMonth: number;
        projects: number;
        workflows: number;
        seats: number;
        cortexDailyUsage: {
            limit: number; // 0, 3, 30, or -1 for unlimited
            currentCount: number;
            lastResetDate: Date;
        };
    };
    
    // Allowed models and features
    allowedModels: string[];
    features: string[];
    
    // Grace period
    gracePeriod?: {
        gracePeriodEnd?: Date;
        gracePeriodReason?: string;
    };
    
    // Usage tracking
    usage: {
        tokensUsed: number;
        requestsUsed: number;
        logsUsed: number;
        workflowsUsed: number;
        optimizationsUsed: number;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
    };
    
    createdAt: Date;
    updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
    },
    plan: {
        type: String,
        enum: ['free', 'plus', 'pro', 'enterprise'],
        required: true,
        default: 'free',
    },
    status: {
        type: String,
        enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'paused'],
        required: true,
        default: 'active',
    },
    startDate: {
        type: Date,
        required: true,
        default: Date.now,
    },
    endDate: Date,
    trialStart: Date,
    trialEnd: Date,
    isTrial: {
        type: Boolean,
        default: false,
    },
    billing: {
        amount: {
            type: Number,
            default: 0,
        },
        currency: {
            type: String,
            default: 'USD',
        },
        interval: {
            type: String,
            enum: ['monthly', 'yearly'],
            default: 'monthly',
        },
        nextBillingDate: Date,
        billingCycleAnchor: Date,
        cancelAtPeriodEnd: {
            type: Boolean,
            default: false,
        },
        canceledAt: Date,
        proratedAmount: Number,
    },
    paymentGateway: {
        type: String,
        enum: ['stripe', 'razorpay', 'paypal', null],
        default: null,
    },
    gatewayCustomerId: String,
    gatewaySubscriptionId: String,
    paymentMethodId: {
        type: Schema.Types.ObjectId,
        ref: 'PaymentMethod',
    },
    discount: {
        code: String,
        amount: Number,
        type: {
            type: String,
            enum: ['percentage', 'fixed'],
        },
        expiresAt: Date,
    },
    limits: {
        tokensPerMonth: {
            type: Number,
            required: true,
        },
        requestsPerMonth: {
            type: Number,
            required: true,
        },
        logsPerMonth: {
            type: Number,
            required: true,
        },
        projects: {
            type: Number,
            required: true,
        },
        workflows: {
            type: Number,
            required: true,
        },
        seats: {
            type: Number,
            default: 1,
        },
        cortexDailyUsage: {
            limit: {
                type: Number,
                default: 0, // 0 = not available, 3 = Plus, 30 = Pro, -1 = unlimited
            },
            currentCount: {
                type: Number,
                default: 0,
            },
            lastResetDate: {
                type: Date,
                default: Date.now,
            },
        },
    },
    allowedModels: [{
        type: String,
    }],
    features: [{
        type: String,
    }],
    gracePeriod: {
        gracePeriodEnd: Date,
        gracePeriodReason: String,
    },
    usage: {
        tokensUsed: {
            type: Number,
            default: 0,
        },
        requestsUsed: {
            type: Number,
            default: 0,
        },
        logsUsed: {
            type: Number,
            default: 0,
        },
        workflowsUsed: {
            type: Number,
            default: 0,
        },
        optimizationsUsed: {
            type: Number,
            default: 0,
        },
        currentPeriodStart: {
            type: Date,
            default: Date.now,
        },
        currentPeriodEnd: {
            type: Date,
            default: function() {
                const date = new Date();
                date.setMonth(date.getMonth() + 1);
                return date;
            },
        },
    },
}, {
    timestamps: true,
});

// Indexes
subscriptionSchema.index({ userId: 1 });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ plan: 1 });
subscriptionSchema.index({ 'billing.nextBillingDate': 1 });
subscriptionSchema.index({ gatewaySubscriptionId: 1 });
subscriptionSchema.index({ paymentGateway: 1 });

export const Subscription = mongoose.model<ISubscription>('Subscription', subscriptionSchema);

