import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DailyAnchorSummaryDocument = DailyAnchorSummary & Document;

@Schema({
  timestamps: true,
  collection: 'daily_anchor_summaries',
  // Keep daily summaries for 2 years
  expires: 2 * 365 * 24 * 60 * 60, // 2 years in seconds
})
export class DailyAnchorSummary {
  @Prop({ required: true, unique: true, index: true })
  date: string; // Format: YYYY-MM-DD

  @Prop({ required: true, type: Number, default: 0 })
  anchorCount: number;

  @Prop({ required: true, type: Number, default: 0 })
  totalEntries: number;

  @Prop({ type: String })
  firstAnchorId?: string;

  @Prop({ type: String })
  lastAnchorId?: string;

  @Prop({ required: true })
  dailyHash: string;

  // TTL index will automatically delete old records
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const DailyAnchorSummarySchema =
  SchemaFactory.createForClass(DailyAnchorSummary);

// Additional indexes for performance
DailyAnchorSummarySchema.index({ createdAt: -1 });
