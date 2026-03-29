import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AICallRecordDocument = HydratedDocument<AICallRecord>;

@Schema({ timestamps: true, collection: 'ai_call_records' })
export class AICallRecord {
  @Prop({ required: true })
  service: string;

  @Prop({ required: true })
  operation: string;

  @Prop({ required: true })
  model: string;

  @Prop({ required: true })
  inputTokens: number;

  @Prop({ required: true })
  outputTokens: number;

  @Prop({ required: true, default: 0 })
  estimatedCost: number;

  @Prop()
  latency?: number;

  @Prop({ default: true })
  success?: boolean;

  @Prop()
  error?: string;

  @Prop()
  userId?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AICallRecordSchema = SchemaFactory.createForClass(AICallRecord);

// Indexes for efficient querying
AICallRecordSchema.index({ service: 1, createdAt: -1 });
AICallRecordSchema.index({ userId: 1, createdAt: -1 });
AICallRecordSchema.index({ model: 1, createdAt: -1 });
AICallRecordSchema.index({ createdAt: -1 }); // For time-based queries
AICallRecordSchema.index({ estimatedCost: -1 }); // For expensive queries
