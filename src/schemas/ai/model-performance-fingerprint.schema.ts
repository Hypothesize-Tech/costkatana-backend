import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Percentile latency statistics
 */
export class PercentileStats {
  @Prop({ required: true, default: 0 })
  p50: number; // median

  @Prop({ required: true, default: 0 })
  p90: number;

  @Prop({ required: true, default: 0 })
  p95: number;

  @Prop({ required: true, default: 0 })
  p99: number;
}

/**
 * Rolling window performance metrics
 */
export class WindowMetrics {
  @Prop({ type: PercentileStats, required: true })
  latency: PercentileStats;

  @Prop({ required: true, default: 0 })
  totalRequests: number;

  @Prop({ required: true, default: 0 })
  successfulRequests: number;

  @Prop({ required: true, default: 0 })
  failedRequests: number;

  @Prop({ required: true, default: 0, min: 0, max: 1 })
  failureRate: number; // 0-1

  @Prop({ required: true, default: 0 })
  avgInputTokens: number;

  @Prop({ required: true, default: 0 })
  avgOutputTokens: number;

  @Prop({ required: true, default: 0 })
  totalTokens: number;

  @Prop({ required: true, default: 0 })
  totalCost: number;

  @Prop({ required: true, default: 0 })
  avgCostPerRequest: number;

  @Prop({ required: true, default: 0 })
  costPer1KTokens: number;

  @Prop({ required: true, default: 0, min: 0, max: 1 })
  cacheHitRate: number; // 0-1

  @Prop({ required: true, default: 0 })
  avgCacheHitBenefit: number; // Cost saved per cache hit

  @Prop({ min: 1, max: 5 })
  avgUserRating?: number; // 1-5 scale

  @Prop({ default: 0 })
  successTagCount?: number; // User-flagged successful outcomes

  @Prop({ default: 0 })
  failureTagCount?: number; // User-flagged failures

  @Prop({ required: true })
  windowStart: Date;

  @Prop({ required: true })
  windowEnd: Date;

  @Prop({ required: true, default: Date.now })
  lastUpdated: Date;
}

/**
 * Model capability performance
 */
export class CapabilityPerformance {
  @Prop({ required: true })
  capability: string; // e.g., 'code_generation', 'summarization', 'chat'

  @Prop({ required: true, min: 0, max: 1 })
  performanceScore: number; // 0-1 composite score

  @Prop({ required: true, min: 0, max: 1 })
  costEfficiency: number; // 0-1 (lower cost = higher score)

  @Prop({ required: true, min: 0, max: 1 })
  qualityScore: number; // 0-1 based on user feedback

  @Prop({ required: true, default: 0 })
  sampleSize: number;
}

/**
 * Trend analysis data
 */
export class PerformanceTrend {
  @Prop({
    required: true,
    enum: ['latency', 'cost', 'failure_rate', 'quality'],
  })
  metric: 'latency' | 'cost' | 'failure_rate' | 'quality';

  @Prop({
    required: true,
    enum: ['improving', 'degrading', 'stable'],
  })
  direction: 'improving' | 'degrading' | 'stable';

  @Prop({ required: true })
  percentageChange: number; // Compared to previous period

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number; // 0-1 statistical confidence
}

/**
 * Model Performance Fingerprint Document
 * Aggregated real-world performance data per model
 */
@Schema({ timestamps: true, collection: 'modelperformancefingerprints' })
export class ModelPerformanceFingerprint {
  // Model identification
  @Prop({ required: true, unique: true, index: true })
  modelId: string; // e.g., 'gpt-4', 'claude-3-sonnet'

  @Prop({ required: true, index: true })
  provider: string; // e.g., 'openai', 'anthropic'

  @Prop({ required: true })
  modelName: string; // Human-readable name

  // Rolling window metrics
  @Prop({ type: WindowMetrics, required: true })
  window24h: WindowMetrics;

  @Prop({ type: WindowMetrics, required: true })
  window7d: WindowMetrics;

  @Prop({ type: WindowMetrics, required: true })
  window30d: WindowMetrics;

  @Prop({ type: WindowMetrics, required: true })
  lifetime: WindowMetrics;

  // Capability-specific performance
  @Prop({ type: [CapabilityPerformance], default: [] })
  capabilities: CapabilityPerformance[];

  // Performance trends
  @Prop({ type: [PerformanceTrend], default: [] })
  trends: PerformanceTrend[];

  // Routing weights (updated by learning loop)
  @Prop({ required: true, default: 0.5, min: 0, max: 1, index: true })
  routingWeight: number; // 0-1, higher = prefer this model

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  confidenceScore: number; // 0-1, statistical confidence in the weight

  // Comparative rankings (within provider or global)
  @Prop({ min: 1 })
  rankingByLatency?: number; // 1 = fastest

  @Prop({ min: 1 })
  rankingByCost?: number; // 1 = cheapest

  @Prop({ min: 1 })
  rankingByQuality?: number; // 1 = best quality

  // Data quality metrics
  @Prop({ required: true, default: 0, min: 0, max: 1 })
  dataCompleteness: number; // 0-1, percentage of expected metrics populated

  @Prop({ required: true, default: Date.now })
  lastAggregationRun: Date;

  @Prop({ required: true, default: () => new Date(Date.now() + 3600000) }) // 1 hour from now
  nextScheduledUpdate: Date;

  // Metadata
  @Prop({ required: true, default: true, index: true })
  isActive: boolean; // Model still available/supported

  @Prop({ required: true, default: false })
  isDeprecated: boolean;

  @Prop()
  deprecationDate?: Date;

  @Prop()
  replacementModelId?: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const ModelPerformanceFingerprintSchema = SchemaFactory.createForClass(
  ModelPerformanceFingerprint,
);

// Compound indexes for common queries
ModelPerformanceFingerprintSchema.index({ provider: 1, isActive: 1 });
ModelPerformanceFingerprintSchema.index({ routingWeight: -1, isActive: 1 });
ModelPerformanceFingerprintSchema.index({
  'window24h.failureRate': 1,
  isActive: 1,
});
ModelPerformanceFingerprintSchema.index({
  'window24h.costPer1KTokens': 1,
  isActive: 1,
});
ModelPerformanceFingerprintSchema.index({
  'window24h.latency.p50': 1,
  isActive: 1,
});

// Static methods for common queries
ModelPerformanceFingerprintSchema.statics.findBestModelsForCapability =
  async function (capability: string, maxCost?: number, minQuality?: number) {
    const query: any = {
      isActive: true,
      'capabilities.capability': capability,
    };

    const models = await this.find(query)
      .sort({ routingWeight: -1, 'window24h.costPer1KTokens': 1 })
      .limit(10)
      .lean();

    // Filter by cost and quality if specified
    return models.filter((model: any) => {
      const capPerf = model.capabilities.find(
        (c: any) => c.capability === capability,
      );
      if (!capPerf) return false;

      if (maxCost && model.window24h.costPer1KTokens > maxCost) return false;
      if (minQuality && capPerf.qualityScore < minQuality) return false;

      return true;
    });
  };

ModelPerformanceFingerprintSchema.statics.getPerformanceTrend = async function (
  modelId: string,
  metric: 'latency' | 'cost' | 'failure_rate' | 'quality',
) {
  const fingerprint = await this.findOne({ modelId }).lean();
  if (!fingerprint) return null;

  return fingerprint.trends.find((t: any) => t.metric === metric) || null;
};

export type ModelPerformanceFingerprintDocument =
  HydratedDocument<ModelPerformanceFingerprint>;
