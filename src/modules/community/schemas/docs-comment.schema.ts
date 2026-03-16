import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DocsCommentDocument = DocsComment & Document;

@Schema({ timestamps: true })
export class DocsComment {
  @Prop({ required: true, index: true })
  pageId: string;

  @Prop({ required: true })
  pagePath: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop()
  userAvatar?: string;

  @Prop({ required: true, maxlength: 5000 })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'DocsComment', default: null })
  parentId?: Types.ObjectId;

  @Prop([{ type: Types.ObjectId, ref: 'User' }])
  upvotes: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'User' }])
  downvotes: Types.ObjectId[];

  @Prop({ default: false })
  isEdited: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: 0 })
  replyCount: number;

  @Prop()
  userRole?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const DocsCommentSchema = SchemaFactory.createForClass(DocsComment);

// Indexes
DocsCommentSchema.index({ pageId: 1, createdAt: -1 });
DocsCommentSchema.index({ parentId: 1 });
