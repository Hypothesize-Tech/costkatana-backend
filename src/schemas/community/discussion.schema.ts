import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IDiscussionReply {
  userId: MongooseSchema.Types.ObjectId;
  userName: string;
  userAvatar?: string;
  content: string;
  upvotes: MongooseSchema.Types.ObjectId[];
  downvotes: MongooseSchema.Types.ObjectId[];
  isEdited: boolean;
  isDeleted: boolean;
  userRole?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Alias for reply documents (matches legacy `DiscussionReply` import path). */
export type DiscussionReply = IDiscussionReply;

export type DiscussionDocument = HydratedDocument<Discussion>;

@Schema({ timestamps: true })
export class Discussion {
  @Prop({ required: true, maxlength: 300 })
  title: string;

  @Prop({ required: true, maxlength: 20000 })
  content: string;

  @Prop({
    required: true,
    enum: [
      'general',
      'help',
      'feature-request',
      'bug-report',
      'showcase',
      'tutorial',
    ],
  })
  category:
    | 'general'
    | 'help'
    | 'feature-request'
    | 'bug-report'
    | 'showcase'
    | 'tutorial';

  @Prop([{ type: String, maxlength: 50 }])
  tags: string[];

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

  @Prop()
  userRole?: string;

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  upvotes: MongooseSchema.Types.ObjectId[];

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  downvotes: MongooseSchema.Types.ObjectId[];

  @Prop({ default: 0 })
  viewCount: number;

  @Prop({ default: 0 })
  replyCount: number;

  @Prop([
    {
      userId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      userName: { type: String, required: true },
      userAvatar: String,
      content: { type: String, required: true, maxlength: 10000 },
      upvotes: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }],
      downvotes: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }],
      isEdited: { type: Boolean, default: false },
      isDeleted: { type: Boolean, default: false },
      userRole: String,
    },
  ])
  replies: IDiscussionReply[];

  @Prop({ default: false })
  isPinned: boolean;

  @Prop({ default: false })
  isLocked: boolean;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ default: Date.now })
  lastActivityAt: Date;

  @Prop()
  relatedPageId?: string;

  @Prop()
  relatedPagePath?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DiscussionSchema = SchemaFactory.createForClass(Discussion);

DiscussionSchema.index({ category: 1, lastActivityAt: -1 });
DiscussionSchema.index({ isPinned: -1, lastActivityAt: -1 });
DiscussionSchema.index({ tags: 1 });
