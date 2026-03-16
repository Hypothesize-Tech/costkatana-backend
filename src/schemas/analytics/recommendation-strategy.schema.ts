import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type RecommendationStrategyDocument =
  HydratedDocument<RecommendationStrategy>;

@Schema({ timestamps: true })
export class RecommendationStrategy {
  @Prop({ required: true, unique: true, index: true })
  strategyId: string; // e.g., 'model_switch', 'prompt_optimization', 'usage_pattern'

  @Prop({ required: true })
  strategyName: string;

  @Prop({ required: true, index: true })
  strategyType:
    | 'model_switch'
    | 'prompt_optimization'
    | 'usage_pattern'
    | 'cost_alert'
    | 'efficiency_tip'
    | 'caching_strategy'
    | 'routing_change';

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  currentWeight: number; // 0-1, higher = more likely to be recommended

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  baselineWeight: number; // Original weight before learning

  @Prop({ required: true, default: 0 })
  totalRecommendations: number;

  @Prop({ required: true, default: 0 })
  totalAccepted: number;

  @Prop({ required: true, default: 0 })
  totalRejected: number;

  @Prop({ required: true, default: 0 })
  totalSuccessful: number;

  @Prop({ required: true, default: 0 })
  totalFailed: number;

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  acceptanceRate: number; // totalAccepted / totalRecommendations

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  successRate: number; // totalSuccessful / totalAccepted

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  confidence: number; // Statistical confidence in the weight

  @Prop({ required: true, default: 0 })
  averageSavings: number; // USD

  @Prop({ required: true, default: 0 })
  totalSavings: number; // USD

  @Prop({ required: true, default: 0 })
  averageProcessingTime: number; // ms

  @Prop({ required: true, default: Date.now })
  lastUpdated: Date;

  @Prop({ required: true, default: Date.now })
  lastRecommendation: Date;

  @Prop({ required: true, default: true, index: true })
  isActive: boolean;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const RecommendationStrategySchema = SchemaFactory.createForClass(
  RecommendationStrategy,
);

// Indexes for performance
RecommendationStrategySchema.index({ strategyType: 1, isActive: 1 });
RecommendationStrategySchema.index({ currentWeight: -1, isActive: 1 });
RecommendationStrategySchema.index({ acceptanceRate: -1, isActive: 1 });

// Static methods
RecommendationStrategySchema.statics.getStrategy = async function (
  strategyId: string,
): Promise<RecommendationStrategyDocument | null> {
  return this.findOne({ strategyId, isActive: true });
};

RecommendationStrategySchema.statics.getAllActiveStrategies =
  async function (): Promise<RecommendationStrategyDocument[]> {
    return this.find({ isActive: true }).sort({ currentWeight: -1 });
  };

RecommendationStrategySchema.statics.updateStrategyWeight = async function (
  strategyId: string,
  newWeight: number,
  reason: string,
  metadata?: any,
): Promise<RecommendationStrategyDocument | null> {
  const updateData: any = {
    currentWeight: Math.max(0, Math.min(1, newWeight)),
    lastUpdated: new Date(),
    metadata: metadata || {},
  };

  if (reason) {
    updateData.metadata.lastUpdateReason = reason;
  }

  return this.findOneAndUpdate(
    { strategyId },
    { $set: updateData },
    { new: true, upsert: true, runValidators: true },
  );
};
