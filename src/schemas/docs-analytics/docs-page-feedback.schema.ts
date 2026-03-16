import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocsPageFeedbackDocument = HydratedDocument<DocsPageFeedback>;

@Schema({ timestamps: true })
export class DocsPageFeedback {
  @Prop({ required: true, index: true })
  pageId: string;

  @Prop({ required: true })
  pagePath: string;

  @Prop({
    type: String,
    enum: ['bug', 'improvement', 'question', 'other'],
    required: true,
  })
  feedbackType: 'bug' | 'improvement' | 'question' | 'other';

  @Prop({ required: true, maxlength: 2000 })
  message: string;

  @Prop({ match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })
  email?: string;

  @Prop({ required: true })
  sessionId: string;

  @Prop()
  ipHash?: string;

  @Prop()
  userAgent?: string;

  @Prop({
    type: String,
    enum: ['new', 'reviewed', 'resolved'],
    default: 'new',
  })
  status: 'new' | 'reviewed' | 'resolved';

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DocsPageFeedbackSchema =
  SchemaFactory.createForClass(DocsPageFeedback);

DocsPageFeedbackSchema.index({ status: 1, createdAt: -1 });
