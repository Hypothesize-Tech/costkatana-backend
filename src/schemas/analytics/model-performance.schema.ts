import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ModelPerformanceDocument = ModelPerformance & Document;

@Schema({
  timestamps: true,
  collection: 'model_performance',
  // Keep model performance data for 1 year
  expires: 365 * 24 * 60 * 60, // 1 year in seconds
})
export class ModelPerformance {
  @Prop({ required: true, index: true })
  modelId: string;

  @Prop({ required: true, index: true })
  suggestionType: string;

  @Prop({ type: Number, default: 0 })
  totalSuggestions: number;

  @Prop({ type: Number, default: 0 })
  acceptedSuggestions: number;

  @Prop({ type: Number, default: 3.0 })
  averageRating: number;

  @Prop({ type: Number, default: 0 })
  totalCostSaved: number;

  @Prop({ type: Number, default: 0 })
  totalTokensSaved: number;

  @Prop({ type: Number, default: 0 })
  averageResponseTime: number;

  @Prop({ type: Number, default: 0 })
  successRate: number; // percentage of successful suggestions

  @Prop({ type: Number, default: 0 })
  averageCostSavingsPercentage: number;

  @Prop({ type: Date })
  lastUpdated: Date;

  // Performance metrics over time
  @Prop({
    type: [
      {
        date: Date,
        suggestions: Number,
        accepted: Number,
        costSaved: Number,
        rating: Number,
      },
    ],
    default: [],
  })
  dailyStats: Array<{
    date: Date;
    suggestions: number;
    accepted: number;
    costSaved: number;
    rating: number;
  }>;

  // TTL index will automatically delete old records
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const ModelPerformanceSchema =
  SchemaFactory.createForClass(ModelPerformance);

// Additional indexes for performance
ModelPerformanceSchema.index(
  { modelId: 1, suggestionType: 1 },
  { unique: true },
);
ModelPerformanceSchema.index({ totalSuggestions: -1 });
ModelPerformanceSchema.index({ successRate: -1 });
ModelPerformanceSchema.index({ lastUpdated: -1 });
