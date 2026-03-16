import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

export type CommunityChatMessageDocument =
  HydratedDocument<CommunityChatMessage>;

@Schema({ timestamps: true, collection: 'communityChatMessages' })
export class CommunityChatMessage {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'ChatSession',
    required: true,
    index: true,
  })
  sessionId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  senderId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  senderName: string;

  @Prop({
    type: String,
    enum: ['user', 'support', 'system', 'ai'],
    required: true,
  })
  senderType: 'user' | 'support' | 'system' | 'ai';

  @Prop({ default: false })
  isAiGenerated: boolean;

  @Prop({ required: true, maxlength: 10000 })
  content: string;

  @Prop({
    type: String,
    enum: ['text', 'code', 'link', 'image', 'file'],
    default: 'text',
  })
  messageType: 'text' | 'code' | 'link' | 'image' | 'file';

  @Prop([
    {
      name: String,
      url: String,
      type: String,
      size: Number,
    },
  ])
  attachments?: IAttachment[];

  @Prop({ default: false })
  isRead: boolean;

  @Prop()
  readAt?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const CommunityChatMessageSchema =
  SchemaFactory.createForClass(CommunityChatMessage);

CommunityChatMessageSchema.index({ sessionId: 1, createdAt: 1 });
