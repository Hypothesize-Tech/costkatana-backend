import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type DocsCommentDocument = HydratedDocument<DocsComment>;

@Schema({ timestamps: true })
export class DocsComment {
  @Prop({ required: true, index: true })
  pageId: string;

  @Prop({ required: true })
  pagePath: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop()
  userAvatar?: string;

  @Prop({ required: true, maxlength: 5000 })
  content: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'DocsComment',
    default: null,
  })
  parentId?: MongooseSchema.Types.ObjectId;

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  upvotes: MongooseSchema.Types.ObjectId[];

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  downvotes: MongooseSchema.Types.ObjectId[];

  @Prop({ default: false })
  isEdited: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: 0 })
  replyCount: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DocsCommentSchema = SchemaFactory.createForClass(DocsComment);

DocsCommentSchema.index({ pageId: 1, createdAt: -1 });
DocsCommentSchema.index({ parentId: 1 });
