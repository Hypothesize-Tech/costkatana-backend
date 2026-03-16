import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserExampleDocument = UserExample & Document;

@Schema({ timestamps: true })
export class UserExample {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  code: string;

  @Prop({ required: true })
  language: string;

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

  @Prop({ default: 'pending', enum: ['pending', 'approved', 'rejected'] })
  status: string;

  @Prop({ default: false })
  isDeleted: boolean;

  @Prop()
  userRole?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const UserExampleSchema = SchemaFactory.createForClass(UserExample);

// Indexes
UserExampleSchema.index({ status: 1, createdAt: -1 });
UserExampleSchema.index({ category: 1 });
UserExampleSchema.index({ language: 1 });
UserExampleSchema.index({ tags: 1 });
