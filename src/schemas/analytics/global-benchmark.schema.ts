import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Aggregated performance metrics (privacy-preserving)
 */
class AggregatedMetrics {
  @Prop({ required: true, default: 0 })
  totalRequests: number;

  @Prop({ required: true, default: 0 })
  uniqueTenants: number; // Count, not IDs

  // Latency statistics (ms)
  @Prop({ required: true, default: 0 })
  p25Latency: number;

  @Prop({ required: true, default: 0 })
  p50Latency: number;

  @Prop({ required: true, default: 0 })
  p75Latency: number;

  @Prop({ required: true, default: 0 })
  p90Latency: number;

  @Prop({ required: true, default: 0 })
  p95Latency: number;

  @Prop({ required: true, default: 0 })
  p99Latency: number;

  @Prop({ required: true, default: 0 })
  avgLatency: number;

  // Cost statistics (USD)
  @Prop({ required: true, default: 0 })
  avgCostPerRequest: number;

  @Prop({ required: true, default: 0 })
  p25Cost: number;

  @Prop({ required: true, default: 0 })
  p50Cost: number;

  @Prop({ required: true, default: 0 })
  p75Cost: number;

  @Prop({ required: true, default: 0 })
  p90Cost: number;

  @Prop({ required: true, default: 0 })
  p95Cost: number;

  @Prop({ required: true, default: 0 })
  avgCostPer1KTokens: number;

  // Token statistics
  @Prop({ required: true, default: 0 })
  avgInputTokens: number;

  @Prop({ required: true, default: 0 })
  avgOutputTokens: number;

  @Prop({ required: true, default: 0 })
  avgTotalTokens: number;

  // Quality metrics
  @Prop({ required: true, min: 0, max: 1, default: 0 })
  successRate: number;

  @Prop({ required: true, min: 0, max: 1, default: 0 })
  errorRate: number;

  @Prop({ required: true, default: 0 })
  avgRetryCount: number;

  // Cache metrics
  @Prop({ required: true, min: 0, max: 1, default: 0 })
  avgCacheHitRate: number;
}

/**
 * Model comparison data
 */
class ModelComparison {
  @Prop({ required: true })
  modelId: string;

  // Relative performance (normalized 0-1, higher is better)
  @Prop({ required: true, min: 0, max: 1 })
  relativeSpeed: number; // 1 = fastest in category

  @Prop({ required: true, min: 0, max: 1 })
  relativeCost: number; // 1 = cheapest in category

  @Prop({ required: true, min: 0, max: 1 })
  relativeQuality: number; // 1 = best quality in category

  @Prop({ required: true, min: 0, max: 1 })
  relativeReliability: number; // 1 = most reliable

  // Composite scores
  @Prop({ required: true, min: 0, max: 1 })
  overallScore: number; // Weighted combination

  @Prop({ required: true, min: 0, max: 1 })
  valueScore: number; // Quality / cost ratio

  // Sample size
  @Prop({ required: true })
  sampleSize: number;
}

/**
 * Trend data over time
 */
class PerformanceTrend {
  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  avgLatency: number;

  @Prop({ required: true })
  avgCost: number;

  @Prop({ required: true, min: 0, max: 1 })
  successRate: number;

  @Prop({ required: true })
  requestCount: number;
}

/**
 * Best practices derived from aggregate data
 */
class BestPractice {
  @Prop({
    required: true,
    enum: [
      'model_selection',
      'caching_strategy',
      'prompt_design',
      'rate_limiting',
      'error_handling',
    ],
  })
  practiceType:
    | 'model_selection'
    | 'caching_strategy'
    | 'prompt_design'
    | 'rate_limiting'
    | 'error_handling';

  @Prop({ required: true })
  description: string;

  // Evidence
  @Prop({ required: true, min: 0, max: 1 })
  adoptionRate: number; // 0-1, percentage of tenants using this

  @Prop({ required: true })
  avgCostSavings: number; // USD

  @Prop({ required: true })
  avgPerformanceImprovement: number; // Percentage

  // Recommendation strength
  @Prop({ required: true, min: 0, max: 1 })
  confidence: number; // 0-1

  @Prop({
    required: true,
    enum: ['low', 'medium', 'high'],
  })
  priority: 'low' | 'medium' | 'high';
}

/**
 * Privacy guarantees configuration
 */
class PrivacyGuarantees {
  @Prop({ required: true, default: 3 })
  kAnonymity: number; // k-anonymity parameter (minimum group size)

  @Prop({ required: true, default: false })
  differentialPrivacy: boolean;

  @Prop()
  noiseLevel?: number; // If differential privacy is applied

  @Prop({ required: true, default: 'aggregated_only' })
  tenantDataRetention: string; // e.g., "aggregated_only", "30_days"
}

/**
 * Global Benchmark Document
 * Anonymized, aggregated performance data across all tenants
 * Used to provide insights without exposing individual tenant data
 */
@Schema({ timestamps: true, collection: 'globalbenchmarks' })
export class GlobalBenchmark {
  // Benchmark identification
  @Prop({ required: true, unique: true, index: true })
  benchmarkId: string;

  @Prop({ required: true })
  benchmarkName: string;

  // Scope
  @Prop({
    required: true,
    enum: ['model', 'provider', 'capability', 'global'],
    index: true,
  })
  scope: 'model' | 'provider' | 'capability' | 'global';

  @Prop({ index: true })
  scopeValue?: string; // e.g., specific model ID, provider name, or capability type

  // Aggregated metrics
  @Prop({ type: AggregatedMetrics, required: true })
  metrics: AggregatedMetrics;

  // Model comparisons (if scope is provider or global)
  @Prop({ type: [ModelComparison], default: [] })
  modelComparisons: ModelComparison[];

  // Performance trends (last 30 days)
  @Prop({ type: [PerformanceTrend], default: [] })
  trends: PerformanceTrend[];

  // Best practices
  @Prop({ type: [BestPractice], default: [] })
  bestPractices: BestPractice[];

  // Data quality
  @Prop({ required: true, min: 0, max: 1, default: 0 })
  dataCompleteness: number; // 0-1

  @Prop({ required: true, default: 0 })
  sampleSizeTotal: number;

  @Prop({ required: true, default: 3 }) // Minimum 3 tenants for privacy
  minTenantThreshold: number; // Minimum tenants required for privacy

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
  @Prop({ type: PrivacyGuarantees, required: true })
  privacyGuarantees: PrivacyGuarantees;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const GlobalBenchmarkSchema =
  SchemaFactory.createForClass(GlobalBenchmark);

// Compound indexes for common queries
GlobalBenchmarkSchema.index({ scope: 1, scopeValue: 1, periodEnd: -1 });
GlobalBenchmarkSchema.index({ 'metrics.avgCostPerRequest': 1, scope: 1 });
GlobalBenchmarkSchema.index({ 'metrics.avgLatency': 1, scope: 1 });
GlobalBenchmarkSchema.index({ periodStart: 1, periodEnd: 1 });

export type GlobalBenchmarkDocument = HydratedDocument<GlobalBenchmark>;
