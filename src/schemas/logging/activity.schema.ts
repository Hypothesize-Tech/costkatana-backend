import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ActivityDocument = HydratedDocument<Activity>;

@Schema({ timestamps: true })
export class Activity {
  @Prop({ required: true, type: String, ref: 'User' })
  userId: string;

  @Prop({
    required: true,
    enum: [
      'login',
      'logout',
      'password_change',
      'profile_updated',
      'preferences_updated',
      'secondary_email_added',
      'secondary_email_removed',
      'primary_email_changed',
      'alert_settings_updated',
      'api_key_created',
      'api_key_deleted',
      'project_created',
      'project_updated',
      'project_deleted',
      'subscription_created',
      'subscription_updated',
      'subscription_cancelled',
      'payment_succeeded',
      'payment_failed',
      'account_closure_initiated',
      'account_closure_cancelled',
      'account_reactivated',
      'team_invitation_sent',
      'team_member_added',
      'team_member_removed',
      'workspace_created',
      'workspace_updated',
      'settings_changed',
      'quality_scored',
      'tip_viewed',
      'tip_applied',
    ],
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

// Indexes
ActivitySchema.index({ userId: 1, createdAt: -1 });
ActivitySchema.index({ type: 1 });
ActivitySchema.index({ createdAt: -1 });
