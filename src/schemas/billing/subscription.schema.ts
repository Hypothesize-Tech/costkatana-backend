import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ _id: false })
export class SubscriptionUsage {
  @Prop({ default: 0 })
  tokens: number;

  @Prop({ default: 0 })
  requests: number;

  @Prop({ default: 0 })
  logs: number;

  @Prop({ default: 0 })
  cost: number;

  @Prop()
  lastActivity?: Date;
}

@Schema({ _id: false })
export class SubscriptionLimits {
  @Prop({ default: 1000000 })
  tokensPerMonth: number;

  @Prop({ default: 5000 })
  requestsPerMonth: number;

  @Prop({ default: 5000 })
  logsPerMonth: number;
}

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true, type: String, ref: 'User' })
  userId: string;

  @Prop({
    required: true,
    enum: ['free', 'plus', 'pro', 'enterprise'],
    default: 'free',
  })
  plan: 'free' | 'plus' | 'pro' | 'enterprise';

  @Prop({
    enum: ['active', 'trialing', 'cancelled', 'past_due', 'unpaid'],
    default: 'active',
  })
  status: 'active' | 'trialing' | 'cancelled' | 'past_due' | 'unpaid';

  @Prop({ type: SubscriptionLimits, default: () => ({}) })
  usageLimits: SubscriptionLimits;

  @Prop({ type: SubscriptionUsage, default: () => ({ current: {} }) })
  usage: {
    current: SubscriptionUsage;
    previous?: SubscriptionUsage;
  };

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ required: true })
  currentPeriodStart: Date;

  @Prop({ required: true })
  currentPeriodEnd: Date;

  @Prop({ default: false })
  cancelAtPeriodEnd: boolean;

  @Prop()
  cancelledAt?: Date;

  @Prop({ type: String, ref: 'PaymentMethod' })
  paymentMethodId?: string;

  @Prop({ type: Object })
  billing?: {
    amount: number;
    currency: string;
    interval: 'monthly' | 'yearly';
    nextBillingDate?: Date;
    updatedAt?: Date;
  };

  @Prop()
  gatewaySubscriptionId?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// Indexes
SubscriptionSchema.index({ userId: 1 });
SubscriptionSchema.index({ status: 1 });
SubscriptionSchema.index({ currentPeriodEnd: 1 });
