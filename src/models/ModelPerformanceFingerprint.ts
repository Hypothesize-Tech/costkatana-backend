import mongoose, { Schema, Document } from 'mongoose';

/**
 * Percentile latency statistics
 */
export interface PercentileStats {
  p50: number; // median
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Rolling window performance metrics
 */
export interface WindowMetrics {
  // Latency statistics (ms)
  latency: PercentileStats;
  
  // Request statistics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failureRate: number; // 0-1
  
  // Token statistics
  avgInputTokens: number;
  avgOutputTokens: number;
  totalTokens: number;
  
  // Cost statistics (USD)
  totalCost: number;
  avgCostPerRequest: number;
  costPer1KTokens: number;
  
  // Cache statistics
  cacheHitRate: number; // 0-1
  avgCacheHitBenefit: number; // Cost saved per cache hit
  
  // Quality metrics (when available)
  avgUserRating?: number; // 1-5 scale
  successTagCount?: number; // User-flagged successful outcomes
  failureTagCount?: number; // User-flagged failures
  
  // Temporal info
  windowStart: Date;
  windowEnd: Date;
  lastUpdated: Date;
}

/**
 * Model capability performance
 */
export interface CapabilityPerformance {
  capability: string; // e.g., 'code_generation', 'summarization', 'chat'
  performanceScore: number; // 0-1 composite score
  costEfficiency: number; // 0-1 (lower cost = higher score)
  qualityScore: number; // 0-1 based on user feedback
  sampleSize: number;
}

/**
 * Trend analysis data
 */
export interface PerformanceTrend {
  metric: 'latency' | 'cost' | 'failure_rate' | 'quality';
  direction: 'improving' | 'degrading' | 'stable';
  percentageChange: number; // Compared to previous period
  confidence: number; // 0-1 statistical confidence
}

/**
 * Model Performance Fingerprint Document
 * Aggregated real-world performance data per model
 */
export interface IModelPerformanceFingerprint extends Document {
  // Model identification
  modelId: string; // e.g., 'gpt-4', 'claude-3-sonnet'
  provider: string; // e.g., 'openai', 'anthropic'
  modelName: string; // Human-readable name
  
  // Rolling window metrics
  window24h: WindowMetrics;
  window7d: WindowMetrics;
  window30d: WindowMetrics;
  lifetime: WindowMetrics;
  
  // Capability-specific performance
  capabilities: CapabilityPerformance[];
  
  // Performance trends
  trends: PerformanceTrend[];
  
  // Routing weights (updated by learning loop)
  routingWeight: number; // 0-1, higher = prefer this model
  confidenceScore: number; // 0-1, statistical confidence in the weight
  
  // Comparative rankings (within provider or global)
  rankingByLatency?: number; // 1 = fastest
  rankingByCost?: number; // 1 = cheapest
  rankingByQuality?: number; // 1 = best quality
  
  // Data quality metrics
  dataCompleteness: number; // 0-1, percentage of expected metrics populated
  lastAggregationRun: Date;
  nextScheduledUpdate: Date;
  
  // Metadata
  isActive: boolean; // Model still available/supported
  isDeprecated: boolean;
  deprecationDate?: Date;
  replacementModelId?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const PercentileStatsSchema = new Schema({
  p50: { type: Number, required: true, default: 0 },
  p90: { type: Number, required: true, default: 0 },
  p95: { type: Number, required: true, default: 0 },
  p99: { type: Number, required: true, default: 0 }
}, { _id: false });

const WindowMetricsSchema = new Schema({
  latency: { type: PercentileStatsSchema, required: true },
  totalRequests: { type: Number, required: true, default: 0 },
  successfulRequests: { type: Number, required: true, default: 0 },
  failedRequests: { type: Number, required: true, default: 0 },
  failureRate: { type: Number, required: true, default: 0, min: 0, max: 1 },
  avgInputTokens: { type: Number, required: true, default: 0 },
  avgOutputTokens: { type: Number, required: true, default: 0 },
  totalTokens: { type: Number, required: true, default: 0 },
  totalCost: { type: Number, required: true, default: 0 },
  avgCostPerRequest: { type: Number, required: true, default: 0 },
  costPer1KTokens: { type: Number, required: true, default: 0 },
  cacheHitRate: { type: Number, required: true, default: 0, min: 0, max: 1 },
  avgCacheHitBenefit: { type: Number, required: true, default: 0 },
  avgUserRating: { type: Number, min: 1, max: 5 },
  successTagCount: { type: Number, default: 0 },
  failureTagCount: { type: Number, default: 0 },
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
  lastUpdated: { type: Date, required: true, default: Date.now }
}, { _id: false });

const CapabilityPerformanceSchema = new Schema({
  capability: { type: String, required: true },
  performanceScore: { type: Number, required: true, min: 0, max: 1 },
  costEfficiency: { type: Number, required: true, min: 0, max: 1 },
  qualityScore: { type: Number, required: true, min: 0, max: 1 },
  sampleSize: { type: Number, required: true, default: 0 }
}, { _id: false });

const PerformanceTrendSchema = new Schema({
  metric: { 
    type: String, 
    required: true,
    enum: ['latency', 'cost', 'failure_rate', 'quality']
  },
  direction: {
    type: String,
    required: true,
    enum: ['improving', 'degrading', 'stable']
  },
  percentageChange: { type: Number, required: true },
  confidence: { type: Number, required: true, min: 0, max: 1 }
}, { _id: false });

const ModelPerformanceFingerprintSchema = new Schema<IModelPerformanceFingerprint>({
  modelId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  provider: {
    type: String,
    required: true,
    index: true
  },
  modelName: {
    type: String,
    required: true
  },
  
  window24h: {
    type: WindowMetricsSchema,
    required: true
  },
  window7d: {
    type: WindowMetricsSchema,
    required: true
  },
  window30d: {
    type: WindowMetricsSchema,
    required: true
  },
  lifetime: {
    type: WindowMetricsSchema,
    required: true
  },
  
  capabilities: {
    type: [CapabilityPerformanceSchema],
    default: []
  },
  
  trends: {
    type: [PerformanceTrendSchema],
    default: []
  },
  
  routingWeight: {
    type: Number,
    required: true,
    default: 0.5,
    min: 0,
    max: 1,
    index: true
  },
  confidenceScore: {
    type: Number,
    required: true,
    default: 0.5,
    min: 0,
    max: 1
  },
  
  rankingByLatency: { type: Number, min: 1 },
  rankingByCost: { type: Number, min: 1 },
  rankingByQuality: { type: Number, min: 1 },
  
  dataCompleteness: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 1
  },
  lastAggregationRun: {
    type: Date,
    required: true,
    default: Date.now
  },
  nextScheduledUpdate: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 3600000) // 1 hour from now
  },
  
  isActive: {
    type: Boolean,
    required: true,
    default: true,
    index: true
  },
  isDeprecated: {
    type: Boolean,
    required: true,
    default: false
  },
  deprecationDate: Date,
  replacementModelId: String
}, {
  timestamps: true
});

// Compound indexes for common queries
ModelPerformanceFingerprintSchema.index({ provider: 1, isActive: 1 });
ModelPerformanceFingerprintSchema.index({ routingWeight: -1, isActive: 1 });
ModelPerformanceFingerprintSchema.index({ 'window24h.failureRate': 1, isActive: 1 });
ModelPerformanceFingerprintSchema.index({ 'window24h.costPer1KTokens': 1, isActive: 1 });
ModelPerformanceFingerprintSchema.index({ 'window24h.latency.p50': 1, isActive: 1 });

// Static methods for common queries
ModelPerformanceFingerprintSchema.statics.findBestModelsForCapability = async function(
  capability: string,
  maxCost?: number,
  minQuality?: number
): Promise<IModelPerformanceFingerprint[]> {
  const query: any = {
    isActive: true,
    'capabilities.capability': capability
  };
  
  const models = await this.find(query)
    .sort({ routingWeight: -1, 'window24h.costPer1KTokens': 1 })
    .limit(10)
    .lean();
  
  // Filter by cost and quality if specified
  return models.filter((model: any) => {
    const capPerf = model.capabilities.find((c: any) => c.capability === capability);
    if (!capPerf) return false;
    
    if (maxCost && model.window24h.costPer1KTokens > maxCost) return false;
    if (minQuality && capPerf.qualityScore < minQuality) return false;
    
    return true;
  });
};

ModelPerformanceFingerprintSchema.statics.getPerformanceTrend = async function(
  modelId: string,
  metric: 'latency' | 'cost' | 'failure_rate' | 'quality'
): Promise<PerformanceTrend | null> {
  const fingerprint = await this.findOne({ modelId }).lean();
  if (!fingerprint) return null;
  
  return fingerprint.trends.find((t: PerformanceTrend) => t.metric === metric) || null;
};

export const ModelPerformanceFingerprint = mongoose.model<IModelPerformanceFingerprint>(
  'ModelPerformanceFingerprint',
  ModelPerformanceFingerprintSchema
);

