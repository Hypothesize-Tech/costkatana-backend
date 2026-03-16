import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface AggregatedMetrics {
  // Request statistics
  totalRequests: number;
  uniqueTenants: number; // Count, not IDs

  // Latency statistics (ms)
  p25Latency: number;
  p50Latency: number;
  p75Latency: number;
  p90Latency: number;
  p95Latency: number;
  p99Latency: number;
  avgLatency: number;

  // Cost statistics (USD)
  avgCostPerRequest: number;
  p25Cost: number;
  p50Cost: number;
  p75Cost: number;
  p90Cost: number;
  p95Cost: number;
  avgCostPer1KTokens: number;

  // Token statistics
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;

  // Quality metrics
  successRate: number;
  errorRate: number;
  avgRetryCount: number;

  // Cache metrics
  avgCacheHitRate: number;
}

export interface ModelComparison {
  modelId: string;

  // Relative performance (normalized 0-1, higher is better)
  relativeSpeed: number; // 1 = fastest in category
  relativeCost: number; // 1 = cheapest in category
  relativeQuality: number; // 1 = best quality in category
  relativeReliability: number; // 1 = most reliable

  // Composite scores
  overallScore: number; // Weighted combination
  valueScore: number; // Quality / cost ratio

  // Sample size
  sampleSize: number;
}

export interface PerformanceTrend {
  date: Date;

  avgLatency: number;
  avgCost: number;
  successRate: number;
  requestCount: number;
}

export interface BestPractice {
  practiceType:
    | 'model_selection'
    | 'caching_strategy'
    | 'prompt_design'
    | 'rate_limiting'
    | 'error_handling';
  description: string;

  // Evidence
  adoptionRate: number; // 0-1, percentage of tenants using this
  avgCostSavings: number; // USD
  avgPerformanceImprovement: number; // Percentage

  // Recommendation strength
  confidence: number; // 0-1
  priority: 'low' | 'medium' | 'high';
}

export interface PrivacyGuarantees {
  kAnonymity: number; // k-anonymity parameter (minimum group size)
  differentialPrivacy: boolean;
  noiseLevel?: number; // If differential privacy is applied
  tenantDataRetention: string; // e.g., "aggregated_only", "30_days"
}

export type GlobalBenchmarkDocument = HydratedDocument<GlobalBenchmark>;

@Schema({ timestamps: true })
export class GlobalBenchmark {
  // Benchmark identification
  @Prop({ required: true, unique: true, index: true })
  benchmarkId: string;

  @Prop({ required: true })
  benchmarkName: string;

  // Scope
  @Prop({
    type: String,
    required: true,
    enum: ['model', 'provider', 'capability', 'global'],
    index: true,
  })
  scope: 'model' | 'provider' | 'capability' | 'global';

  @Prop({ index: true })
  scopeValue?: string; // e.g., specific model ID, provider name, or capability type

  // Aggregated metrics
  @Prop({
    type: {
      totalRequests: { type: Number, required: true, default: 0 },
      uniqueTenants: { type: Number, required: true, default: 0 },
      p25Latency: { type: Number, required: true, default: 0 },
      p50Latency: { type: Number, required: true, default: 0 },
      p75Latency: { type: Number, required: true, default: 0 },
      p90Latency: { type: Number, required: true, default: 0 },
      p95Latency: { type: Number, required: true, default: 0 },
      p99Latency: { type: Number, required: true, default: 0 },
      avgLatency: { type: Number, required: true, default: 0 },
      avgCostPerRequest: { type: Number, required: true, default: 0 },
      p25Cost: { type: Number, required: true, default: 0 },
      p50Cost: { type: Number, required: true, default: 0 },
      p75Cost: { type: Number, required: true, default: 0 },
      p90Cost: { type: Number, required: true, default: 0 },
      p95Cost: { type: Number, required: true, default: 0 },
      avgCostPer1KTokens: { type: Number, required: true, default: 0 },
      avgInputTokens: { type: Number, required: true, default: 0 },
      avgOutputTokens: { type: Number, required: true, default: 0 },
      avgTotalTokens: { type: Number, required: true, default: 0 },
      successRate: { type: Number, required: true, min: 0, max: 1, default: 0 },
      errorRate: { type: Number, required: true, min: 0, max: 1, default: 0 },
      avgRetryCount: { type: Number, required: true, default: 0 },
      avgCacheHitRate: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        default: 0,
      },
    },
    required: true,
  })
  metrics: AggregatedMetrics;

  // Model comparisons (if scope is provider or global)
  @Prop([
    {
      modelId: { type: String, required: true },
      relativeSpeed: { type: Number, required: true, min: 0, max: 1 },
      relativeCost: { type: Number, required: true, min: 0, max: 1 },
      relativeQuality: { type: Number, required: true, min: 0, max: 1 },
      relativeReliability: { type: Number, required: true, min: 0, max: 1 },
      overallScore: { type: Number, required: true, min: 0, max: 1 },
      valueScore: { type: Number, required: true, min: 0, max: 1 },
      sampleSize: { type: Number, required: true },
    },
  ])
  modelComparisons: ModelComparison[];

  // Performance trends (last 30 days)
  @Prop([
    {
      date: { type: Date, required: true },
      avgLatency: { type: Number, required: true },
      avgCost: { type: Number, required: true },
      successRate: { type: Number, required: true, min: 0, max: 1 },
      requestCount: { type: Number, required: true },
    },
  ])
  trends: PerformanceTrend[];

  // Best practices
  @Prop([
    {
      practiceType: {
        type: String,
        required: true,
        enum: [
          'model_selection',
          'caching_strategy',
          'prompt_design',
          'rate_limiting',
          'error_handling',
        ],
      },
      description: { type: String, required: true },
      adoptionRate: { type: Number, required: true, min: 0, max: 1 },
      avgCostSavings: { type: Number, required: true },
      avgPerformanceImprovement: { type: Number, required: true },
      confidence: { type: Number, required: true, min: 0, max: 1 },
      priority: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high'],
      },
    },
  ])
  bestPractices: BestPractice[];

  // Data quality
  @Prop({ required: true, min: 0, max: 1, default: 0 })
  dataCompleteness: number; // 0-1

  @Prop({ required: true, default: 0 })
  sampleSizeTotal: number;

  @Prop({ required: true, default: 3 }) // Minimum 3 tenants for privacy
  minTenantThreshold: number;

  // Time period
  @Prop({ required: true, index: true })
  periodStart: Date;

  @Prop({ required: true, index: true })
  periodEnd: Date;

  // Update metadata
  @Prop({ required: true })
  lastAggregationRun: Date;

  @Prop({ required: true })
  nextScheduledUpdate: Date;

  @Prop({ required: true, default: 0 })
  aggregationDurationMs: number;

  // Privacy guarantees
  @Prop({
    type: {
      kAnonymity: { type: Number, required: true, default: 3 },
      differentialPrivacy: { type: Boolean, required: true, default: false },
      noiseLevel: Number,
      tenantDataRetention: {
        type: String,
        required: true,
        default: 'aggregated_only',
      },
    },
    required: false,
  })
  privacyGuarantees?: PrivacyGuarantees;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GlobalBenchmarkSchema =
  SchemaFactory.createForClass(GlobalBenchmark);

// Compound indexes for common queries
GlobalBenchmarkSchema.index({ scope: 1, scopeValue: 1, periodEnd: -1 });
GlobalBenchmarkSchema.index({ 'metrics.avgCostPerRequest': 1, scope: 1 });
GlobalBenchmarkSchema.index({ 'metrics.avgLatency': 1, scope: 1 });
GlobalBenchmarkSchema.index({ periodStart: 1, periodEnd: 1 });
