import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IOriginalRequest {
  model: string;
  provider: string;
  estimatedCost: number;
  promptLength?: number;
  prompt?: string;
}

export interface IModifiedRequest {
  model: string;
  provider: string;
  actualCost: number;
  promptLength?: number;
  prompt?: string;
}

export interface IInterventionMetadata {
  userTier?: string;
  priority?: string;
  budgetRemaining?: number;
  [key: string]: any;
}

export type InterventionLogDocument = HydratedDocument<InterventionLog>;

@Schema({ timestamps: true, collection: 'intervention_logs' })
export class InterventionLog {
  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  flowId: string;

  @Prop({
    type: String,
    enum: [
      'model_downgrade',
      'provider_switch',
      'prompt_compression',
      'budget_block',
      'rate_limit_switch',
    ],
    required: true,
    index: true,
  })
  interventionType:
    | 'model_downgrade'
    | 'provider_switch'
    | 'prompt_compression'
    | 'budget_block'
    | 'rate_limit_switch';

  @Prop({
    type: {
      model: { type: String, required: true },
      provider: { type: String, required: true },
      estimatedCost: { type: Number, required: true },
      promptLength: Number,
      prompt: String,
    },
  })
  originalRequest: IOriginalRequest;

  @Prop({
    type: {
      model: { type: String, required: true },
      provider: { type: String, required: true },
      actualCost: { type: Number, required: true },
      promptLength: Number,
      prompt: String,
    },
  })
  modifiedRequest: IModifiedRequest;

  @Prop({ required: true })
  reason: string;

  @Prop({ required: true, default: 0 })
  costSaved: number;

  @Prop({ min: -1, max: 1 })
  qualityImpact?: number;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: IInterventionMetadata;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const InterventionLogSchema =
  SchemaFactory.createForClass(InterventionLog);

// Compound indexes for efficient queries
InterventionLogSchema.index({ userId: 1, timestamp: -1 });
InterventionLogSchema.index({ interventionType: 1, timestamp: -1 });
InterventionLogSchema.index({ flowId: 1, timestamp: -1 });

// TTL index - automatically remove old logs after 90 days
InterventionLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });
