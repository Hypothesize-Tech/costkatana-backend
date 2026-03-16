import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocsPageViewDocument = HydratedDocument<DocsPageView>;

@Schema({ timestamps: true })
export class DocsPageView {
  @Prop({ required: true, index: true })
  pageId: string;

  @Prop({ required: true })
  pagePath: string;

  @Prop({ required: true, index: true })
  sessionId: string;

  @Prop()
  ipHash?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  referrer?: string;

  @Prop({ default: 0 })
  timeOnPage?: number;

  @Prop({ min: 0, max: 100, default: 0 })
  scrollDepth?: number;

  @Prop([String])
  sectionsViewed?: string[];

  @Prop({
    type: String,
    enum: ['desktop', 'tablet', 'mobile'],
  })
  deviceType?: 'desktop' | 'tablet' | 'mobile';

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DocsPageViewSchema = SchemaFactory.createForClass(DocsPageView);

// Compound index for session-based page views
DocsPageViewSchema.index({ pageId: 1, sessionId: 1 });
DocsPageViewSchema.index({ createdAt: -1 });
