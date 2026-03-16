import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatMessageDocument = ChatMessage & Document;

@Schema({
  timestamps: true,
  collection: 'communityChatMessages',
})
export class ChatMessage {
  @Prop({
    type: Types.ObjectId,
    ref: 'ChatSession',
    required: true,
    index: true,
  })
  sessionId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  senderName: string;

  @Prop({
    enum: ['user', 'support', 'system', 'ai'],
    required: true,
  })
  senderType: 'user' | 'support' | 'system' | 'ai';

  @Prop({ required: true, maxlength: 10000 })
  content: string;

  @Prop({
    enum: ['text', 'code', 'link', 'image', 'file'],
    default: 'text',
  })
  messageType: 'text' | 'code' | 'link' | 'image' | 'file';

  @Prop({
    type: [
      {
        name: String,
        url: String,
        type: String,
        size: Number,
      },
    ],
  })
  attachments?: {
    name: string;
    url: string;
    type: string;
    size: number;
  }[];

  @Prop({ default: false })
  isAiGenerated: boolean;

  @Prop({ default: false })
  isRead: boolean;

  @Prop()
  readAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt?: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ sessionId: 1, createdAt: 1 });
