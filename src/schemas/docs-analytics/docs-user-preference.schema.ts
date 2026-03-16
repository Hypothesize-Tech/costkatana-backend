import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface IVisitedPage {
  pageId: string;
  pagePath: string;
  visitCount: number;
  totalTime: number;
  lastVisited: Date;
}

export type DocsUserPreferenceDocument = HydratedDocument<DocsUserPreference>;

@Schema({ timestamps: true })
export class DocsUserPreference {
  @Prop({ required: true, unique: true, index: true })
  sessionId: string;

  @Prop([
    {
      pageId: { type: String, required: true },
      pagePath: { type: String, required: true },
      visitCount: { type: Number, default: 1 },
      totalTime: { type: Number, default: 0 },
      lastVisited: { type: Date, default: Date.now },
    },
  ])
  visitedPages: IVisitedPage[];

  @Prop([String])
  preferredTopics: string[];

  @Prop({
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner',
  })
  readingLevel: 'beginner' | 'intermediate' | 'advanced';

  @Prop({ default: Date.now })
  lastActive: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DocsUserPreferenceSchema =
  SchemaFactory.createForClass(DocsUserPreference);
