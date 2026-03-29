import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

/**
 * Unified activity types: account/security (logging) + product UX (team-project).
 * Keep in sync with persisted documents — do not remove values without migration.
 */
export const ACTIVITY_TYPES = [
  'account_closure_cancelled',
  'account_closure_initiated',
  'account_reactivated',
  'alert_created',
  'alert_resolved',
  'alert_settings_updated',
  'api_call',
  'api_key_created',
  'api_key_deleted',
  'api_key_updated',
  'bulk_optimization',
  'cost_audit_completed',
  'dashboard_api_key_created',
  'dashboard_api_key_deleted',
  'export_generated',
  'file_uploaded',
  'login',
  'logout',
  'optimization_applied',
  'optimization_created',
  'optimization_feedback',
  'password_change',
  'payment_failed',
  'payment_succeeded',
  'preferences_updated',
  'primary_email_changed',
  'profile_updated',
  'project_created',
  'project_deleted',
  'project_updated',
  'quality_scored',
  'reference_extraction_failed',
  'reference_features_extracted',
  'reference_features_updated',
  'reference_image_uploaded',
  'secondary_email_added',
  'secondary_email_removed',
  'settings_changed',
  'settings_updated',
  'subscription_cancelled',
  'subscription_changed',
  'subscription_created',
  'subscription_updated',
  'team_invitation_sent',
  'team_member_added',
  'team_member_removed',
  'template_ai_generated',
  'template_analysis_completed',
  'template_created',
  'template_deleted',
  'template_duplicated',
  'template_effectiveness_predicted',
  'template_feedback_added',
  'template_optimized',
  'template_optimization_suggested',
  'template_shared',
  'template_updated',
  'template_used',
  'template_used_with_context',
  'template_variables_detected',
  'tip_applied',
  'tip_viewed',
  'workspace_created',
  'workspace_updated',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface IActivityMetadata {
  service?: string;
  model?: string;
  cost?: number;
  saved?: number;
  optimizationId?: MongooseSchema.Types.ObjectId;
  alertId?: MongooseSchema.Types.ObjectId;
  tipId?: MongooseSchema.Types.ObjectId;
  qualityScoreId?: MongooseSchema.Types.ObjectId;
  templateId?: MongooseSchema.Types.ObjectId;
  templateName?: string;
  templateCategory?: string;
  templateVersion?: number;
  intent?: string;
  confidence?: number;
  optimizationType?: 'token' | 'cost' | 'quality' | 'model-specific';
  tokenReduction?: number;
  costSaving?: number;
  effectivenessScore?: number;
  variablesCount?: number;
  targetModel?: string;
  originalTemplateId?: MongooseSchema.Types.ObjectId;
  duplicatedTemplateId?: MongooseSchema.Types.ObjectId;
  rating?: number;
  feedback?: string;
  [key: string]: any;
}

export type ActivityDocument = HydratedDocument<Activity>;

@Schema({ timestamps: true, collection: 'activities' })
export class Activity {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ACTIVITY_TYPES,
    required: true,
  })
  type: ActivityType;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: IActivityMetadata;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

ActivitySchema.index({ userId: 1, createdAt: -1 });
ActivitySchema.index({ userId: 1, type: 1, createdAt: -1 });
ActivitySchema.index({ type: 1 });
ActivitySchema.index({ createdAt: -1 });
