import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export interface UserTierMetrics {
  requests: number;
  successRate: number;
  averageCost: number;
}

export interface TaskTypeMetrics {
  requests: number;
  successRate: number;
  averageQualityScore: number;
}

export interface PromptComplexityMetrics {
  low: { requests: number; successRate: number };
  medium: { requests: number; successRate: number };
  high: { requests: number; successRate: number };
}

export interface ContextMetrics {
  byUserTier: Map<string, UserTierMetrics>;
  byTaskType: Map<string, TaskTypeMetrics>;
  byPromptComplexity: PromptComplexityMetrics;
}

export type ModelPerformanceHistoryDocument =
  HydratedDocument<ModelPerformanceHistory>;

@Schema({ timestamps: true, collection: 'model_performance_history' })
export class ModelPerformanceHistory {
  @Prop({ required: true, index: true })
  modelName: string;

  @Prop({ required: true, index: true })
  provider: string;

  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  @Prop({
    type: {
      totalRequests: { type: Number, required: true, default: 0 },
      successfulRequests: { type: Number, required: true, default: 0 },
      failedRequests: { type: Number, required: true, default: 0 },
      averageCost: { type: Number, required: true, default: 0 },
      averageLatency: { type: Number, required: true, default: 0 },
      averageQualityScore: { type: Number, required: false },
      totalCostSaved: { type: Number, required: false },
    },
    required: false,
  })
  metrics?: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageCost: number;
    averageLatency: number;
    averageQualityScore?: number;
    totalCostSaved?: number;
  };

  @Prop({
    type: {
      byUserTier: { type: Map, of: mongoose.Schema.Types.Mixed },
      byTaskType: { type: Map, of: mongoose.Schema.Types.Mixed },
      byPromptComplexity: {
        low: {
          requests: { type: Number, default: 0 },
          successRate: { type: Number, default: 0 },
        },
        medium: {
          requests: { type: Number, default: 0 },
          successRate: { type: Number, default: 0 },
        },
        high: {
          requests: { type: Number, default: 0 },
          successRate: { type: Number, default: 0 },
        },
      },
    },
    required: false,
  })
  contextMetrics?: ContextMetrics;

  @Prop({ required: true, min: 0, max: 100, default: 50 })
  performanceScore: number; // 0-100 composite score

  @Prop({ required: true, min: 0, max: 1, default: 0.5 })
  recommendationConfidence: number; // 0-1 confidence for recommendations

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ModelPerformanceHistorySchema = SchemaFactory.createForClass(
  ModelPerformanceHistory,
);

// Compound indexes for performance queries
ModelPerformanceHistorySchema.index({
  modelName: 1,
  provider: 1,
  timestamp: -1,
});
ModelPerformanceHistorySchema.index({ performanceScore: -1, timestamp: -1 });
ModelPerformanceHistorySchema.index({
  'metrics.averageCost': 1,
  'metrics.averageQualityScore': -1,
});

// TTL index - keep 180 days of history
ModelPerformanceHistorySchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 15552000 },
); // 180 days
