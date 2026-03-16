import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type TemplateExecutionDocument = HydratedDocument<TemplateExecution>;

@Schema({ timestamps: true, collection: 'template_executions' })
export class TemplateExecution {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PromptTemplate',
    required: true,
    index: true,
  })
  templateId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  variables: Record<string, any>;

  // Execution details
  @Prop({ required: true })
  modelUsed: string;

  @Prop()
  modelRecommended?: string;

  @Prop({ default: false })
  recommendationFollowed: boolean;

  // Response data
  @Prop({ required: true })
  aiResponse: string;

  @Prop({ required: true, default: 0 })
  promptTokens: number;

  @Prop({ required: true, default: 0 })
  completionTokens: number;

  @Prop({ required: true, default: 0 })
  totalTokens: number;

  // Cost tracking
  @Prop({ required: true, default: 0 })
  actualCost: number;

  @Prop({ required: true, default: 0 })
  baselineCost: number;

  @Prop({ required: true, default: 0 })
  savingsAmount: number;

  @Prop({ required: true, default: 0 })
  savingsPercentage: number;

  // Performance
  @Prop({ required: true, default: 0 })
  latencyMs: number;

  // Metadata
  @Prop({ default: Date.now, index: true })
  executedAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Usage' })
  usageRecordId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const TemplateExecutionSchema =
  SchemaFactory.createForClass(TemplateExecution);

// Indexes for efficient queries
TemplateExecutionSchema.index({ templateId: 1, executedAt: -1 });
TemplateExecutionSchema.index({ userId: 1, executedAt: -1 });
TemplateExecutionSchema.index({ modelUsed: 1 });
