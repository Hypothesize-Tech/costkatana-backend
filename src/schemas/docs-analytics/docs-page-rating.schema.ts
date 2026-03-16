import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocsPageRatingDocument = HydratedDocument<DocsPageRating>;

@Schema({ timestamps: true })
export class DocsPageRating {
  @Prop({ required: true, index: true })
  pageId: string;

  @Prop({ required: true })
  pagePath: string;

  @Prop({
    type: String,
    enum: ['up', 'down'],
    required: true,
  })
  rating: 'up' | 'down';

  @Prop({ min: 1, max: 5 })
  starRating?: number;

  @Prop({ required: true })
  sessionId: string;

  @Prop()
  ipHash?: string;

  @Prop()
  userAgent?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const DocsPageRatingSchema =
  SchemaFactory.createForClass(DocsPageRating);

// Compound index for preventing duplicate ratings per session
DocsPageRatingSchema.index({ pageId: 1, sessionId: 1 }, { unique: true });
