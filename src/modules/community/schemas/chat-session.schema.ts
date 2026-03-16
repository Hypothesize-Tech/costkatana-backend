import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatSessionDocument = ChatSession & Document;

@Schema({ timestamps: true })
export class ChatSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true })
  userEmail: string;

  @Prop({ required: true, maxlength: 200 })
  subject: string;

  @Prop({
    enum: ['active', 'waiting', 'resolved', 'closed'],
    default: 'waiting',
  })
  status: 'active' | 'waiting' | 'resolved' | 'closed';

  @Prop({
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  })
  priority: 'low' | 'normal' | 'high' | 'urgent';

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  @Prop()
  assignedToName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedAdminId?: Types.ObjectId;

  @Prop()
  adminJoinedAt?: Date;

  @Prop({ default: true })
  aiEnabled: boolean;

  @Prop()
  lastAiResponseAt?: Date;

  @Prop({ default: 0 })
  messageCount: number;

  @Prop({ default: Date.now })
  lastMessageAt: Date;

  @Prop()
  resolvedAt?: Date;

  @Prop()
  closedAt?: Date;

  @Prop({ min: 1, max: 5 })
  rating?: number;

  @Prop({ maxlength: 1000 })
  feedback?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);

ChatSessionSchema.index({ status: 1, lastMessageAt: -1 });
ChatSessionSchema.index({ assignedTo: 1, status: 1 });
