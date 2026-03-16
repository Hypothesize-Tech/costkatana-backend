import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true, collection: 'trace_messages' })
export class TraceMessage {
  @Prop({ required: true, unique: true })
  messageId: string;

  @Prop({ required: true })
  sessionId: string;

  @Prop({ required: true })
  traceId: string;

  @Prop({ enum: ['user', 'assistant', 'system', 'tool'], required: true })
  role: 'user' | 'assistant' | 'system' | 'tool';

  @Prop({ required: true, maxlength: 500 })
  contentPreview: string;

  @Prop({ default: false })
  fullContentStored: boolean;

  @Prop()
  fullContentUrl?: string;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;
}

export type TraceMessageDocument = HydratedDocument<TraceMessage>;
export const TraceMessageSchema = SchemaFactory.createForClass(TraceMessage);

TraceMessageSchema.index({ sessionId: 1, timestamp: 1 });
TraceMessageSchema.index({ traceId: 1, timestamp: 1 });
