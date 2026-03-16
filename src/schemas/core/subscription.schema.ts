import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IBilling {
  amount: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  nextBillingDate?: Date;
  billingCycleAnchor?: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  proratedAmount?: number;
}

export interface IDiscount {
  code?: string;
  amount?: number;
  type?: 'percentage' | 'fixed';
  expiresAt?: Date;
}

export interface ICortexDailyUsage {
  limit: number; // 0, 3, 30, or -1 for unlimited
  currentCount: number;
  lastResetDate: Date;
}

export interface ILimits {
  tokensPerMonth: number;
  requestsPerMonth: number;
  logsPerMonth: number;
  projects: number;
  agentTraces: number;
  seats: number;
  cortexDailyUsage: ICortexDailyUsage;
}

export interface IGracePeriod {
  gracePeriodEnd?: Date;
  gracePeriodReason?: string;
}

export interface IUsage {
  tokensUsed: number;
  requestsUsed: number;
  logsUsed: number;
  agentTracesUsed: number;
  optimizationsUsed: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['free', 'plus', 'pro', 'enterprise'],
    required: true,
    default: 'free',
  })
  plan: 'free' | 'plus' | 'pro' | 'enterprise';

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
    required: true,
    default: 'active',
  })
  status:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'incomplete'
    | 'paused';

  @Prop({ type: Date, required: true, default: Date.now })
  startDate: Date;

  @Prop()
  endDate?: Date;

  @Prop()
  trialStart?: Date;

  @Prop()
  trialEnd?: Date;

  @Prop({ type: Boolean, default: false })
  isTrial: boolean;

  @Prop({
    type: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: 'USD' },
      interval: {
        type: String,
        enum: ['monthly', 'yearly'],
        default: 'monthly',
      },
      nextBillingDate: Date,
      billingCycleAnchor: Date,
      cancelAtPeriodEnd: { type: Boolean, default: false },
      canceledAt: Date,
      proratedAmount: Number,
    },
  })
  billing: IBilling;

  @Prop({
    type: String,
    enum: ['stripe', 'razorpay', 'paypal', null],
    default: null,
  })
  paymentGateway: 'stripe' | 'razorpay' | 'paypal' | null;

  @Prop()
  gatewayCustomerId?: string;

  @Prop()
  gatewaySubscriptionId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PaymentMethod' })
  paymentMethodId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: {
      code: String,
      amount: Number,
      type: { type: String, enum: ['percentage', 'fixed'] },
      expiresAt: Date,
    },
  })
  discount?: IDiscount;

  @Prop({
    type: {
      tokensPerMonth: { type: Number, required: true },
      requestsPerMonth: { type: Number, required: true },
      logsPerMonth: { type: Number, required: true },
      projects: { type: Number, required: true },
      agentTraces: { type: Number, required: true },
      seats: { type: Number, default: 1 },
      cortexDailyUsage: {
        limit: { type: Number, default: 0 },
        currentCount: { type: Number, default: 0 },
        lastResetDate: { type: Date, default: Date.now },
      },
    },
  })
  limits: ILimits;

  @Prop([String])
  allowedModels: string[];

  @Prop([String])
  features: string[];

  @Prop({
    type: {
      gracePeriodEnd: Date,
      gracePeriodReason: String,
    },
  })
  gracePeriod?: IGracePeriod;

  @Prop({
    type: {
      tokensUsed: { type: Number, default: 0 },
      requestsUsed: { type: Number, default: 0 },
      logsUsed: { type: Number, default: 0 },
      agentTracesUsed: { type: Number, default: 0 },
      optimizationsUsed: { type: Number, default: 0 },
      currentPeriodStart: { type: Date, default: Date.now },
      currentPeriodEnd: {
        type: Date,
        default: function () {
          const date = new Date();
          date.setMonth(date.getMonth() + 1);
          return date;
        },
      },
    },
  })
  usage: IUsage;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// Indexes
SubscriptionSchema.index({ userId: 1 });
SubscriptionSchema.index({ status: 1 });
SubscriptionSchema.index({ plan: 1 });
SubscriptionSchema.index({ 'billing.nextBillingDate': 1 });
SubscriptionSchema.index({ gatewaySubscriptionId: 1 });
SubscriptionSchema.index({ paymentGateway: 1 });
