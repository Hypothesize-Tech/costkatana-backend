import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AlertDocument = HydratedDocument<Alert>;

@Schema({ timestamps: true })
export class Alert {
  @Prop({ required: true, type: String, ref: 'User' })
  userId: string;

  @Prop({
    required: true,
    enum: [
      'cost_threshold',
      'usage_limit',
      'payment_failed',
      'subscription_expiring',
      'api_key_expired',
      'security_alert',
      'system_maintenance',
      'feature_update',
      'test',
    ],
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ default: false })
  read: boolean;

  @Prop()
  readAt?: Date;

  @Prop({ default: false })
  snoozed: boolean;

  @Prop()
  snoozedUntil?: Date;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const AlertSchema = SchemaFactory.createForClass(Alert);

// Indexes
AlertSchema.index({ userId: 1, createdAt: -1 });
AlertSchema.index({ userId: 1, read: 1 });
AlertSchema.index({ snoozedUntil: 1 });
