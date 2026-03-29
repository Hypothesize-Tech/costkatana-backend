/**
 * Full trace chat message document: previews, optional full-content URLs, attachments,
 * and optional semantic embeddings for the trace module.
 *
 * For compact, lightweight trace rows (preview text + ids), use {@link TraceMessage}
 * from `trace-message.schema.ts` instead — different collection and query patterns.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

export class MessageAttachment {
  @Prop({
    enum: ['uploaded', 'google'],
    required: true,
  })
  type: 'uploaded' | 'google';

  @Prop({ required: true })
  fileId: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  fileType: string;

  @Prop({ required: true })
  url: string;

  @Prop()
  extractedText?: string;

  @Prop()
  extractedAt?: Date;
}

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, unique: true })
  messageId: string;

  @Prop({ required: true })
  sessionId: string;

  @Prop({ required: true })
  traceId: string;

  @Prop({
    enum: ['user', 'assistant', 'system', 'tool'],
    required: true,
  })
  role: 'user' | 'assistant' | 'system' | 'tool';

  @Prop({ required: true, maxlength: 500 })
  contentPreview: string;

  @Prop({ default: false })
  fullContentStored: boolean;

  @Prop()
  fullContentUrl?: string;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: [MessageAttachment] })
  attachments?: MessageAttachment[];

  // Vector fields for smart sampling and semantic search
  @Prop({
    type: [Number],
    validate: {
      validator: function (v: number[]) {
        return !v || v.length === 0 || v.length === 1024;
      },
      message: 'Semantic embedding must be 1024 dimensions for Amazon Titan v2',
    },
  })
  semanticEmbedding?: number[];

  @Prop({ min: 0, max: 1, default: 0 })
  learningValue?: number;

  @Prop({ default: false, index: true })
  isVectorized?: boolean;

  @Prop({ maxlength: 500 })
  vectorSelectionReason?: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ sessionId: 1, timestamp: 1 });
MessageSchema.index({ traceId: 1, timestamp: 1 });
