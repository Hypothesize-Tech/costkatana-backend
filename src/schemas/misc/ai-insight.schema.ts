import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true, collection: 'aiinsights' })
export class AIInsight {
  @Prop({ required: true })
  type: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: any;

  @Prop({ default: Date.now })
  timestamp?: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AIInsightSchema = SchemaFactory.createForClass(AIInsight);

// Indexes
AIInsightSchema.index({ type: 1, userId: 1 });
AIInsightSchema.index({ timestamp: -1 });
AIInsightSchema.index({ 'metadata.templateId': 1 });

export type AIInsightDocument = HydratedDocument<AIInsight>;
