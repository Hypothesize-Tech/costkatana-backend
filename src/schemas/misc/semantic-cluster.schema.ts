import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface IClusterExample {
  telemetryId?: string;
  usageId?: string;
  content: string;
  embedding: number[];
  similarity: number;
  cost: number;
  latency: number;
  timestamp: Date;
}

export interface IClusterCostAnalysis {
  totalCost: number;
  avgCostPerRequest: number;
  medianCost: number;
  p90Cost: number;
  modelCosts: number;
  cacheCosts: number;
  cacheHitRate: number;
  potentialSavingsWithCache: number;
  potentialSavingsWithCheaperModel: number;
  costVsGlobalAvg: number;
  isHighCost: boolean;
}

export interface ITopModel {
  modelId: string;
  frequency: number;
  avgCost: number;
  avgLatency: number;
}

export interface IClusterPerformanceAnalysis {
  avgLatency: number;
  p50Latency: number;
  p90Latency: number;
  p95Latency: number;
  avgTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  successRate: number;
  errorRate: number;
  topModels: ITopModel[];
}

export interface ITopUser {
  userId: string;
  requestCount: number;
  totalCost: number;
}

export interface IClusterUsagePattern {
  peakHours: number[];
  peakDays: number[];
  requestsPerDay: number;
  requestsPerUser: number;
  uniqueUsers: number;
  topUsers: ITopUser[];
  growthRate: number;
  isGrowing: boolean;
}

export interface IOptimizationRecommendation {
  type:
    | 'model_switch'
    | 'enable_cache'
    | 'prompt_optimization'
    | 'batch_processing'
    | 'rate_limiting';
  description: string;
  estimatedSavings: number;
  estimatedSavingsPercentage: number;
  implementationEffort: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface IClusterOptimization {
  priority: 'low' | 'medium' | 'high' | 'critical';
  recommendations: IOptimizationRecommendation[];
  totalEstimatedSavings: number;
  totalEstimatedSavingsPercentage: number;
}

export type SemanticClusterDocument = HydratedDocument<SemanticCluster>;

@Schema({ timestamps: true })
export class SemanticCluster {
  @Prop({ required: true, unique: true, index: true })
  clusterId: string;

  @Prop({ required: true })
  clusterName: string;

  @Prop({ type: [Number], required: true })
  centroid: number[];

  @Prop({ required: true })
  centroidDimensions: number;

  @Prop({ required: true, min: 0, index: true })
  size: number;

  @Prop({ required: true, min: 0, max: 1 })
  density: number;

  @Prop({
    type: [
      {
        telemetryId: String,
        usageId: String,
        content: { type: String, required: true, maxlength: 1000 },
        embedding: { type: [Number], required: true },
        similarity: { type: Number, required: true, min: 0, max: 1 },
        cost: { type: Number, required: true },
        latency: { type: Number, required: true },
        timestamp: { type: Date, required: true },
      },
    ],
  })
  examples: IClusterExample[];

  @Prop({ required: true })
  semanticDescription: string;

  @Prop([String])
  keywords: string[];

  @Prop({ required: true, index: true })
  category: string;

  @Prop({
    type: {
      totalCost: { type: Number, required: true },
      avgCostPerRequest: { type: Number, required: true },
      medianCost: { type: Number, required: true },
      p90Cost: { type: Number, required: true },
      modelCosts: { type: Number, required: true },
      cacheCosts: { type: Number, required: true },
      cacheHitRate: { type: Number, required: true, min: 0, max: 1 },
      potentialSavingsWithCache: { type: Number, required: true },
      potentialSavingsWithCheaperModel: { type: Number, required: true },
      costVsGlobalAvg: { type: Number, required: true },
      isHighCost: { type: Boolean, required: true },
    },
  })
  costAnalysis: IClusterCostAnalysis;

  @Prop({
    type: {
      avgLatency: { type: Number, required: true },
      p50Latency: { type: Number, required: true },
      p90Latency: { type: Number, required: true },
      p95Latency: { type: Number, required: true },
      avgTokens: { type: Number, required: true },
      avgInputTokens: { type: Number, required: true },
      avgOutputTokens: { type: Number, required: true },
      successRate: { type: Number, required: true, min: 0, max: 1 },
      errorRate: { type: Number, required: true, min: 0, max: 1 },
      topModels: [
        {
          modelId: String,
          frequency: Number,
          avgCost: Number,
          avgLatency: Number,
        },
      ],
    },
  })
  performanceAnalysis: IClusterPerformanceAnalysis;

  @Prop({
    type: {
      peakHours: { type: [Number], default: [] },
      peakDays: { type: [Number], default: [] },
      requestsPerDay: { type: Number, required: true },
      requestsPerUser: { type: Number, required: true },
      uniqueUsers: { type: Number, required: true },
      topUsers: [
        {
          userId: String,
          requestCount: Number,
          totalCost: Number,
        },
      ],
      growthRate: { type: Number, required: true },
      isGrowing: { type: Boolean, required: true },
    },
  })
  usagePattern: IClusterUsagePattern;

  @Prop({
    type: {
      priority: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high', 'critical'],
      },
      recommendations: [
        {
          type: {
            type: String,
            enum: [
              'model_switch',
              'enable_cache',
              'prompt_optimization',
              'batch_processing',
              'rate_limiting',
            ],
          },
          description: String,
          estimatedSavings: Number,
          estimatedSavingsPercentage: Number,
          implementationEffort: {
            type: String,
            enum: ['low', 'medium', 'high'],
          },
          confidence: { type: Number, min: 0, max: 1 },
        },
      ],
      totalEstimatedSavings: { type: Number, required: true },
      totalEstimatedSavingsPercentage: { type: Number, required: true },
    },
  })
  optimization: IClusterOptimization;

  @Prop({ required: true, index: true })
  dataStartDate: Date;

  @Prop({ required: true, index: true })
  dataEndDate: Date;

  @Prop({ required: true })
  clusteringAlgorithm: string;

  @Prop({ required: true, min: 0, max: 1 })
  clusteringConfidence: number;

  @Prop({ required: true })
  lastAnalyzedAt: Date;

  @Prop({ required: true })
  nextScheduledAnalysis: Date;

  @Prop({ required: true, default: true, index: true })
  isActive: boolean;

  @Prop()
  mergedInto?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const SemanticClusterSchema =
  SchemaFactory.createForClass(SemanticCluster);

// Compound indexes for common queries
SemanticClusterSchema.index({ category: 1, 'costAnalysis.isHighCost': 1 });
SemanticClusterSchema.index({ 'costAnalysis.totalCost': -1, isActive: 1 });
SemanticClusterSchema.index({ size: -1, isActive: 1 });
SemanticClusterSchema.index({ 'optimization.priority': 1, isActive: 1 });
SemanticClusterSchema.index({ 'costAnalysis.potentialSavingsWithCache': -1 });
