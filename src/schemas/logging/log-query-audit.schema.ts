import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type LogQueryAuditDocument = HydratedDocument<LogQueryAudit>;

@Schema()
export class LogQueryAudit {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  naturalLanguageQuery: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  generatedMongoQuery: any;

  @Prop({ default: 0 })
  resultsCount: number;

  @Prop({ required: true })
  executionTime: number;

  @Prop({
    type: String,
    enum: ['success', 'blocked', 'error'],
    required: true,
  })
  status: 'success' | 'blocked' | 'error';

  @Prop()
  error?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const LogQueryAuditSchema = SchemaFactory.createForClass(LogQueryAudit);

// Compound indexes for efficient queries
LogQueryAuditSchema.index({ userId: 1, timestamp: -1 });
LogQueryAuditSchema.index({ status: 1, timestamp: -1 });

// TTL index - auto-delete after 90 days
LogQueryAuditSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
