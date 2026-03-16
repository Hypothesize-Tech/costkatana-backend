import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type SubscriptionHistoryDocument = HydratedDocument<SubscriptionHistory>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class SubscriptionHistory {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
  })
  subscriptionId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'upgrade',
      'downgrade',
      'cancel',
      'reactivate',
      'pause',
      'resume',
      'payment_method_update',
      'billing_cycle_update',
      'discount_applied',
      'discount_removed',
      'trial_started',
      'trial_ended',
      'payment_failed',
      'payment_succeeded',
      'status_change',
    ],
    required: true,
  })
  changeType:
    | 'upgrade'
    | 'downgrade'
    | 'cancel'
    | 'reactivate'
    | 'pause'
    | 'resume'
    | 'payment_method_update'
    | 'billing_cycle_update'
    | 'discount_applied'
    | 'discount_removed'
    | 'trial_started'
    | 'trial_ended'
    | 'payment_failed'
    | 'payment_succeeded'
    | 'status_change';

  @Prop({
    type: String,
    enum: ['free', 'plus', 'pro', 'enterprise'],
  })
  oldPlan?: 'free' | 'plus' | 'pro' | 'enterprise';

  @Prop({
    type: String,
    enum: ['free', 'plus', 'pro', 'enterprise'],
  })
  newPlan?: 'free' | 'plus' | 'pro' | 'enterprise';

  @Prop({
    type: String,
    enum: [
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'paused',
    ],
  })
  oldStatus?:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'incomplete'
    | 'paused';

  @Prop({
    type: String,
    enum: [
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'paused',
    ],
  })
  newStatus?:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'incomplete'
    | 'paused';

  @Prop({
    type: String,
    enum: ['user', 'admin', 'system'],
    required: true,
    default: 'user',
  })
  changedBy: 'user' | 'admin' | 'system';

  @Prop()
  reason?: string;

  @Prop({
    type: MongooseSchema.Types.Mixed,
    default: {},
  })
  metadata?: Record<string, any>;

  @Prop()
  createdAt: Date;
}

export const SubscriptionHistorySchema =
  SchemaFactory.createForClass(SubscriptionHistory);

// Indexes
SubscriptionHistorySchema.index({ subscriptionId: 1, createdAt: -1 });
SubscriptionHistorySchema.index({ userId: 1, createdAt: -1 });
SubscriptionHistorySchema.index({ changeType: 1 });
SubscriptionHistorySchema.index({ createdAt: -1 });
