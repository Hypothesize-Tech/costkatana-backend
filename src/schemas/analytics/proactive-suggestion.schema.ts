import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IProactiveSuggestionContext {
  currentModel?: string;
  suggestedModel?: string;
  currentCost?: number;
  projectedCost?: number;
  pattern?: string;
  requests?: number;
}

export interface IProactiveSuggestionAction {
  type: 'accept' | 'reject' | 'learn_more' | 'customize';
  label: string;
  params?: Record<string, unknown>;
}

export interface IProactiveSuggestionFeedback {
  action: 'accepted' | 'rejected' | 'dismissed';
  reason?: string;
  appliedAt?: Date;
  resultMetrics?: {
    actualSavings?: number;
    userSatisfaction?: number;
  };
}

export type ProactiveSuggestionDocument = HydratedDocument<ProactiveSuggestion>;

@Schema({ timestamps: true, collection: 'proactive_suggestions' })
export class ProactiveSuggestion {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    required: true,
    enum: [
      'model_downgrade',
      'semantic_cache',
      'context_compression',
      'lazy_summarization',
      'batch_requests',
      'cheaper_provider',
    ],
  })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  estimatedSavings: number;

  @Prop({ required: true })
  savingsPercentage: number;

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  context?: IProactiveSuggestionContext;

  @Prop({ type: [MongooseSchema.Types.Mixed] })
  actions?: IProactiveSuggestionAction[];

  @Prop({ required: true, enum: ['low', 'medium', 'high', 'critical'] })
  priority: string;

  @Prop({
    default: 'pending',
    enum: ['pending', 'accepted', 'rejected', 'expired'],
  })
  status: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  feedback?: IProactiveSuggestionFeedback;
}

export const ProactiveSuggestionSchema =
  SchemaFactory.createForClass(ProactiveSuggestion);

ProactiveSuggestionSchema.index({ userId: 1, status: 1, createdAt: -1 });
ProactiveSuggestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
