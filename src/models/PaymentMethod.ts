import mongoose, { Schema, Document, ObjectId } from 'mongoose';

export interface IPaymentMethod extends Document {
    userId: ObjectId;
    gateway: 'stripe' | 'razorpay' | 'paypal';
    
    // Gateway customer IDs
    gatewayCustomerId: string; // Stripe customer ID, Razorpay customer ID, PayPal payer ID
    
    // Gateway payment method IDs
    gatewayPaymentMethodId: string; // Stripe payment method ID, Razorpay payment method ID, PayPal billing agreement ID
    
    // Payment method type
    type: 'card' | 'upi' | 'bank_account' | 'wallet' | 'paypal_account';
    
    // Card details (for Stripe and Razorpay cards)
    card?: {
        last4: string;
        brand?: string; // visa, mastercard, amex, etc.
        expiryMonth?: number;
        expiryYear?: number;
        maskedNumber: string; // e.g., "**** **** **** 1234"
    };
    
    // UPI details (for Razorpay)
    upi?: {
        upiId: string;
        vpa: string; // Virtual Payment Address
    };
    
    // Bank account details (for Razorpay)
    bankAccount?: {
        maskedAccountNumber: string;
        ifsc?: string;
        bankName?: string;
    };
    
    // PayPal account
    paypalAccount?: {
        email: string;
    };
    
    // Status
    isDefault: boolean;
    isActive: boolean;
    
    // Recurring payment setup
    setupForRecurring: boolean;
    recurringStatus: 'active' | 'failed' | 'expired' | 'cancelled';
    
    // Expiry (for cards)
    expiryDate?: Date;
    
    // Gateway-specific metadata
    gatewayMetadata?: Record<string, any>;
    
    createdAt: Date;
    updatedAt: Date;
}

const paymentMethodSchema = new Schema<IPaymentMethod>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    gateway: {
        type: String,
        enum: ['stripe', 'razorpay', 'paypal'],
        required: true,
        index: true,
    },
    gatewayCustomerId: {
        type: String,
        required: true,
    },
    gatewayPaymentMethodId: {
        type: String,
        required: true,
        unique: true,
    },
    type: {
        type: String,
        enum: ['card', 'upi', 'bank_account', 'wallet', 'paypal_account'],
        required: true,
    },
    card: {
        last4: String,
        brand: String,
        expiryMonth: Number,
        expiryYear: Number,
        maskedNumber: String,
    },
    upi: {
        upiId: String,
        vpa: String,
    },
    bankAccount: {
        maskedAccountNumber: String,
        ifsc: String,
        bankName: String,
    },
    paypalAccount: {
        email: String,
    },
    isDefault: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    setupForRecurring: {
        type: Boolean,
        default: false,
    },
    recurringStatus: {
        type: String,
        enum: ['active', 'failed', 'expired', 'cancelled'],
        default: 'active',
    },
    expiryDate: Date,
    gatewayMetadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

// Indexes
paymentMethodSchema.index({ userId: 1, isDefault: 1 });
paymentMethodSchema.index({ userId: 1, isActive: 1 });
paymentMethodSchema.index({ gatewayCustomerId: 1 });
paymentMethodSchema.index({ gatewayPaymentMethodId: 1 });
paymentMethodSchema.index({ recurringStatus: 1 });

// Ensure only one default payment method per user
paymentMethodSchema.pre('save', async function(next) {
    if (this.isDefault && this.isModified('isDefault')) {
        await mongoose.model('PaymentMethod').updateMany(
            { userId: this.userId, _id: { $ne: this._id } },
            { $set: { isDefault: false } }
        );
    }
    next();
});

export const PaymentMethod = mongoose.model<IPaymentMethod>('PaymentMethod', paymentMethodSchema);

