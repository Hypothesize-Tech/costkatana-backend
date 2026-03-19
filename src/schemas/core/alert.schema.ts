import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IAlertData {
  currentValue?: number;
  threshold?: number;
  percentage?: number;
  period?: string;
  recommendations?: string[];
  [key: string]: any;
}

export interface IAlertMetadata {
  isTest?: boolean;
  testType?: string;
  costImpact?: number;
  [key: string]: any;
}

export interface IDeliveryStatus {
  status: 'pending' | 'sent' | 'failed' | 'retrying';
  sentAt?: Date;
  responseTime?: number;
  attempts: number;
  lastError?: string;
}

export type AlertDocument = HydratedDocument<Alert>;

@Schema({ timestamps: true })
export class Alert {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'cost_threshold',
      'usage_spike',
      'usage_limit', // user/alert compatibility
      'optimization_available',
      'weekly_summary',
      'monthly_summary',
      'error_rate',
      'cost',
      'optimization',
      'anomaly',
      'system',
      'performance',
      'agent_trace_budget',
      'agent_trace_spike',
      'agent_trace_inefficiency',
      'agent_trace_failure',
      'payment_failed', // user/alert compatibility
      'subscription_expiring',
      'api_key_expired',
      'security_alert',
      'system_maintenance',
      'feature_update',
      'test',
    ],
    required: true,
  })
  type:
    | 'cost_threshold'
    | 'usage_spike'
    | 'usage_limit'
    | 'optimization_available'
    | 'weekly_summary'
    | 'monthly_summary'
    | 'error_rate'
    | 'cost'
    | 'optimization'
    | 'anomaly'
    | 'system'
    | 'performance'
    | 'agent_trace_budget'
    | 'agent_trace_spike'
    | 'agent_trace_inefficiency'
    | 'agent_trace_failure'
    | 'payment_failed'
    | 'subscription_expiring'
    | 'api_key_expired'
    | 'security_alert'
    | 'system_maintenance'
    | 'feature_update'
    | 'test';

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
  })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  data: IAlertData;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: IAlertMetadata;

  @Prop({ type: Boolean, default: false })
  sent: boolean;

  @Prop()
  sentAt?: Date;

  @Prop()
  sentTo?: string;

  @Prop({ type: Boolean, default: false })
  read: boolean;

  @Prop()
  readAt?: Date;

  @Prop()
  snoozedUntil?: Date;

  @Prop({ type: Boolean, default: false })
  snoozed?: boolean;

  @Prop({ type: Boolean, default: false })
  actionRequired: boolean;

  @Prop({ type: Boolean, default: false })
  actionTaken?: boolean;

  @Prop()
  actionTakenAt?: Date;

  @Prop()
  actionDetails?: string;

  @Prop()
  expiresAt?: Date;

  @Prop([String])
  deliveryChannels?: string[];

  @Prop({
    type: Map,
    of: {
      status: {
        type: String,
        enum: ['pending', 'sent', 'failed', 'retrying'],
        default: 'pending',
      },
      sentAt: Date,
      responseTime: Number,
      attempts: { type: Number, default: 0 },
      lastError: String,
    },
    default: new Map(),
  })
  deliveryStatus?: Map<string, IDeliveryStatus>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AlertSchema = SchemaFactory.createForClass(Alert);

// Compound indexes
AlertSchema.index({ userId: 1, sent: 1 });
AlertSchema.index({ userId: 1, read: 1 });
AlertSchema.index({ userId: 1, type: 1, createdAt: -1 });
AlertSchema.index({ snoozedUntil: 1 });
AlertSchema.index({ createdAt: -1 });

// TTL index for automatic deletion of expired alerts
AlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
