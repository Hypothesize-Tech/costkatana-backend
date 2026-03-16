import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DiscussionDocument = Discussion & Document;

@Schema({ timestamps: true })
export class DiscussionReply {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop()
  userAvatar?: string;

  @Prop({ required: true, maxlength: 10000 })
  content: string;

  @Prop([{ type: Types.ObjectId, ref: 'User' }])
  upvotes: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'User' }])
  downvotes: Types.ObjectId[];

  @Prop({ default: false })
  isEdited: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop()
  userRole?: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

@Schema({ timestamps: true })
export class Discussion {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true })
  category: string;

  @Prop([String])
  tags: string[];

  @Prop()
  relatedPageId?: string;

  @Prop()
  relatedPagePath?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop()
  userAvatar?: string;

  @Prop([{ type: Types.ObjectId, ref: 'User' }])
  upvotes: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'User' }])
  downvotes: Types.ObjectId[];

  @Prop({ default: 0 })
  viewCount: number;

  @Prop({ default: 0 })
  replyCount: number;

  @Prop({ type: [DiscussionReply] })
  replies: DiscussionReply[];

  @Prop({ default: false })
  isPinned: boolean;

  @Prop({ default: false })
  isLocked: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: Date.now })
  lastActivityAt: Date;

  @Prop()
  userRole?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const DiscussionSchema = SchemaFactory.createForClass(Discussion);

// Indexes
DiscussionSchema.index({ isPinned: -1, lastActivityAt: -1 });
DiscussionSchema.index({ category: 1 });
DiscussionSchema.index({ tags: 1 });
