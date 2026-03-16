import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

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

@Schema({ timestamps: true })
export class Activity {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'login',
      'api_call',
      'optimization_created',
      'optimization_applied',
      'alert_created',
      'alert_resolved',
      'tip_viewed',
      'tip_applied',
      'quality_scored',
      'settings_updated',
      'profile_updated',
      'dashboard_api_key_created',
      'dashboard_api_key_deleted',
      'file_uploaded',
      'export_generated',
      'bulk_optimization',
      'cost_audit_completed',
      'subscription_changed',
      'template_created',
      'template_updated',
      'template_deleted',
      'template_duplicated',
      'template_ai_generated',
      'template_optimized',
      'template_used',
      'template_shared',
      'template_feedback_added',
      'template_variables_detected',
      'template_effectiveness_predicted',
      'reference_image_uploaded',
      'reference_features_extracted',
      'reference_extraction_failed',
      'reference_features_updated',
    ],
    required: true,
  })
  type:
    | 'login'
    | 'api_call'
    | 'optimization_created'
    | 'optimization_applied'
    | 'alert_created'
    | 'alert_resolved'
    | 'tip_viewed'
    | 'tip_applied'
    | 'quality_scored'
    | 'settings_updated'
    | 'profile_updated'
    | 'dashboard_api_key_created'
    | 'dashboard_api_key_deleted'
    | 'file_uploaded'
    | 'export_generated'
    | 'bulk_optimization'
    | 'cost_audit_completed'
    | 'subscription_changed'
    | 'template_created'
    | 'template_updated'
    | 'template_deleted'
    | 'template_duplicated'
    | 'template_ai_generated'
    | 'template_optimized'
    | 'template_used'
    | 'template_used_with_context'
    | 'template_shared'
    | 'template_feedback_added'
    | 'template_variables_detected'
    | 'template_effectiveness_predicted'
    | 'reference_image_uploaded'
    | 'reference_features_extracted'
    | 'reference_extraction_failed'
    | 'reference_features_updated';

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

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

// Indexes for efficient querying
ActivitySchema.index({ userId: 1, createdAt: -1 });
ActivitySchema.index({ userId: 1, type: 1, createdAt: -1 });
