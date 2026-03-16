import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IVisualization {
  type: 'stat-card' | 'line' | 'bar' | 'pie' | 'area' | 'table';
  metric: string;
  title: string;
  size: 'small' | 'medium' | 'large' | 'full';
  data?: any;
  chartConfig?: any;
}

export interface ILogQueryMessage {
  role: 'user' | 'assistant';
  content: string;
  query?: string;
  mongoQuery?: any;
  resultsCount?: number;
  visualization?: IVisualization;
  timestamp: Date;
}

export type LogQueryConversationDocument =
  HydratedDocument<LogQueryConversation>;

@Schema({ timestamps: true })
export class LogQueryConversation {
  @Prop({ required: true, unique: true, index: true })
  conversationId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop([
    {
      role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true,
      },
      content: { type: String, required: true },
      query: String,
      mongoQuery: mongoose.Schema.Types.Mixed,
      resultsCount: Number,
      visualization: {
        type: {
          type: String,
          enum: ['stat-card', 'line', 'bar', 'pie', 'area', 'table'],
        },
        metric: String,
        title: String,
        size: {
          type: String,
          enum: ['small', 'medium', 'large', 'full'],
        },
        data: mongoose.Schema.Types.Mixed,
        chartConfig: mongoose.Schema.Types.Mixed,
      },
      timestamp: { type: Date, default: Date.now },
    },
  ])
  messages: ILogQueryMessage[];

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const LogQueryConversationSchema =
  SchemaFactory.createForClass(LogQueryConversation);

// Compound index for efficient queries
LogQueryConversationSchema.index({ userId: 1, createdAt: -1 });

// TTL index - auto-delete after 30 days
LogQueryConversationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
