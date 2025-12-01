import mongoose, { Schema, Document, ObjectId } from 'mongoose';

export interface ISubscriptionHistory extends Document {
    subscriptionId: ObjectId;
    userId: ObjectId;
    changeType: 'upgrade' | 'downgrade' | 'cancel' | 'reactivate' | 'pause' | 'resume' | 'payment_method_update' | 'billing_cycle_update' | 'discount_applied' | 'discount_removed' | 'trial_started' | 'trial_ended' | 'payment_failed' | 'payment_succeeded' | 'status_change';
    oldPlan?: 'free' | 'plus' | 'pro' | 'enterprise';
    newPlan?: 'free' | 'plus' | 'pro' | 'enterprise';
    oldStatus?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'paused';
    newStatus?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'paused';
    changedBy: 'user' | 'admin' | 'system';
    reason?: string;
    metadata?: Record<string, any>;
    createdAt: Date;
}

const subscriptionHistorySchema = new Schema<ISubscriptionHistory>({
    subscriptionId: {
        type: Schema.Types.ObjectId,
        ref: 'Subscription',
        required: true,
        index: true,
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    changeType: {
        type: String,
        enum: ['upgrade', 'downgrade', 'cancel', 'reactivate', 'pause', 'resume', 'payment_method_update', 'billing_cycle_update', 'discount_applied', 'discount_removed', 'trial_started', 'trial_ended', 'payment_failed', 'payment_succeeded', 'status_change'],
        required: true,
        index: true,
    },
    oldPlan: {
        type: String,
        enum: ['free', 'plus', 'pro', 'enterprise'],
    },
    newPlan: {
        type: String,
        enum: ['free', 'plus', 'pro', 'enterprise'],
    },
    oldStatus: {
        type: String,
        enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'paused'],
    },
    newStatus: {
        type: String,
        enum: ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'paused'],
    },
    changedBy: {
        type: String,
        enum: ['user', 'admin', 'system'],
        required: true,
        default: 'user',
    },
    reason: String,
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
});

// Indexes
subscriptionHistorySchema.index({ subscriptionId: 1, createdAt: -1 });
subscriptionHistorySchema.index({ userId: 1, createdAt: -1 });
subscriptionHistorySchema.index({ changeType: 1 });
subscriptionHistorySchema.index({ createdAt: -1 });

export const SubscriptionHistory = mongoose.model<ISubscriptionHistory>('SubscriptionHistory', subscriptionHistorySchema);

