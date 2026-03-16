import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type AIInsightDocument = HydratedDocument<AIInsight>;

@Schema({ timestamps: true })
export class AIInsight {
  @Prop({ required: true })
  type: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: any;

  @Prop({ type: Date, default: Date.now })
  timestamp: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AIInsightSchema = SchemaFactory.createForClass(AIInsight);

// Indexes
AIInsightSchema.index({ type: 1, userId: 1 });
AIInsightSchema.index({ timestamp: -1 });
AIInsightSchema.index({ 'metadata.templateId': 1 });
