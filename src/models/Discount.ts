import mongoose, { Schema, Document, ObjectId } from 'mongoose';

export interface IDiscount extends Document {
    code: string;
    type: 'percentage' | 'fixed';
    amount: number; // Percentage (0-100) or fixed amount in USD
    validFrom: Date;
    validUntil: Date;
    maxUses: number; // -1 for unlimited
    currentUses: number;
    applicablePlans: Array<'free' | 'plus' | 'pro' | 'enterprise'>; // Empty array means all plans
    minAmount?: number; // Minimum purchase amount required
    userId?: ObjectId; // If specified, only this user can use it
    isActive: boolean;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
}

const discountSchema = new Schema<IDiscount>({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true,
    },
    type: {
        type: String,
        enum: ['percentage', 'fixed'],
        required: true,
    },
    amount: {
        type: Number,
        required: true,
        min: 0,
    },
    validFrom: {
        type: Date,
        required: true,
        default: Date.now,
    },
    validUntil: {
        type: Date,
        required: true,
    },
    maxUses: {
        type: Number,
        required: true,
        default: -1, // -1 means unlimited
    },
    currentUses: {
        type: Number,
        default: 0,
        min: 0,
    },
    applicablePlans: {
        type: [String],
        enum: ['free', 'plus', 'pro', 'enterprise'],
        default: [],
    },
    minAmount: {
        type: Number,
        min: 0,
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },
    description: {
        type: String,
    },
}, {
    timestamps: true,
});

// Indexes
discountSchema.index({ code: 1, isActive: 1 });
discountSchema.index({ validUntil: 1 });
discountSchema.index({ userId: 1 });

// Validation: For percentage type, amount should be between 0 and 100
discountSchema.pre('save', function(next) {
    if (this.type === 'percentage' && (this.amount < 0 || this.amount > 100)) {
        next(new Error('Percentage discount must be between 0 and 100'));
    } else {
        next();
    }
});

export const Discount = mongoose.model<IDiscount>('Discount', discountSchema);

