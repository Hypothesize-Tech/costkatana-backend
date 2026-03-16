import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UserExampleDocument = HydratedDocument<UserExample>;

@Schema({ timestamps: true })
export class UserExample {
  @Prop({ required: true, maxlength: 200 })
  title: string;

  @Prop({ required: true, maxlength: 2000 })
  description: string;

  @Prop({ required: true, maxlength: 50000 })
  code: string;

  @Prop({
    required: true,
    enum: [
      'typescript',
      'javascript',
      'python',
      'bash',
      'json',
      'yaml',
      'other',
    ],
  })
  language:
    | 'typescript'
    | 'javascript'
    | 'python'
    | 'bash'
    | 'json'
    | 'yaml'
    | 'other';

  @Prop({
    required: true,
    enum: [
      'getting-started',
      'integration',
      'optimization',
      'analytics',
      'gateway',
      'agent_trace',
      'other',
    ],
  })
  category:
    | 'getting-started'
    | 'integration'
    | 'optimization'
    | 'analytics'
    | 'gateway'
    | 'agent_trace'
    | 'other';

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

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  upvotes: MongooseSchema.Types.ObjectId[];

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'User' }])
  downvotes: MongooseSchema.Types.ObjectId[];

  @Prop({ default: 0 })
  viewCount: number;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  })
  status: 'pending' | 'approved' | 'rejected';

  @Prop()
  relatedPageId?: string;

  @Prop()
  relatedPagePath?: string;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UserExampleSchema = SchemaFactory.createForClass(UserExample);

UserExampleSchema.index({ status: 1, createdAt: -1 });
UserExampleSchema.index({ category: 1 });
UserExampleSchema.index({ tags: 1 });
UserExampleSchema.index({ language: 1 });
