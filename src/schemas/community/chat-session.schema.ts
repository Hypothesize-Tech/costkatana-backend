import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type ChatSessionDocument = HydratedDocument<ChatSession>;

@Schema({ timestamps: true })
export class ChatSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true })
  userEmail: string;

  @Prop({ required: true, maxlength: 200 })
  subject: string;

  @Prop({
    type: String,
    enum: ['active', 'waiting', 'resolved', 'closed'],
    default: 'waiting',
  })
  status: 'active' | 'waiting' | 'resolved' | 'closed';

  @Prop({
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  })
  priority: 'low' | 'normal' | 'high' | 'urgent';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  assignedTo?: MongooseSchema.Types.ObjectId;

  @Prop()
  assignedToName?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  assignedAdminId?: MongooseSchema.Types.ObjectId;

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

  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);

ChatSessionSchema.index({ status: 1, lastMessageAt: -1 });
ChatSessionSchema.index({ assignedTo: 1, status: 1 });
