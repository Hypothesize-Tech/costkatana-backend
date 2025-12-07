import mongoose, { Schema, Document } from 'mongoose';

/**
 * Representative example from a cluster
 */
export interface ClusterExample {
  telemetryId?: string;
  usageId?: string;
  content: string; // Sanitized/truncated example
  embedding: number[];
  similarity: number; // Similarity to cluster centroid
  cost: number;
  latency: number;
  timestamp: Date;
}

/**
 * Cost analysis for a cluster
 */
export interface ClusterCostAnalysis {
  totalCost: number;
  avgCostPerRequest: number;
  medianCost: number;
  p90Cost: number;
  
  // Cost breakdown
  modelCosts: number;
  cacheCosts: number;
  
  // Optimization potential
  cacheHitRate: number;
  potentialSavingsWithCache: number;
  potentialSavingsWithCheaperModel: number;
  
  // Comparisons
  costVsGlobalAvg: number; // Percentage difference
  isHighCost: boolean;
}

/**
 * Performance analysis for a cluster
 */
export interface ClusterPerformanceAnalysis {
  avgLatency: number;
  p50Latency: number;
  p90Latency: number;
  p95Latency: number;
  
  avgTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  
  successRate: number;
  errorRate: number;
  
  // Model usage
  topModels: Array<{
    modelId: string;
    frequency: number;
    avgCost: number;
    avgLatency: number;
  }>;
}

/**
 * Usage pattern within a cluster
 */
export interface ClusterUsagePattern {
  // Temporal patterns
  peakHours: number[]; // Hours of day (0-23)
  peakDays: number[]; // Days of week (0-6)
  
  // Frequency
  requestsPerDay: number;
  requestsPerUser: number;
  
  // User distribution
  uniqueUsers: number;
  topUsers: Array<{
    userId: string;
    requestCount: number;
    totalCost: number;
  }>;
  
  // Trends
  growthRate: number; // Percentage change month-over-month
  isGrowing: boolean;
}

/**
 * Optimization recommendations for a cluster
 */
export interface ClusterOptimization {
  priority: 'low' | 'medium' | 'high' | 'critical';
  
  recommendations: Array<{
    type: 'model_switch' | 'enable_cache' | 'prompt_optimization' | 'batch_processing' | 'rate_limiting';
    description: string;
    estimatedSavings: number;
    estimatedSavingsPercentage: number;
    implementationEffort: 'low' | 'medium' | 'high';
    confidence: number; // 0-1
  }>;
  
  totalEstimatedSavings: number;
  totalEstimatedSavingsPercentage: number;
}

/**
 * Semantic Cluster Document
 * Represents a group of similar requests/prompts discovered through embedding analysis
 */
export interface ISemanticCluster extends Document {
  // Cluster identification
  clusterId: string; // Unique cluster identifier
  clusterName: string; // Auto-generated descriptive name
  
  // Cluster centroid (average embedding)
  centroid: number[];
  centroidDimensions: number;
  
  // Cluster metadata
  size: number; // Number of requests in cluster
  density: number; // 0-1, how tightly grouped the cluster is
  
  // Representative examples
  examples: ClusterExample[];
  
  // Semantic description
  semanticDescription: string; // AI-generated description of what this cluster represents
  keywords: string[]; // Key terms/topics in this cluster
  category: string; // e.g., 'code_generation', 'summarization', 'chat', 'analysis'
  
  // Cost analysis
  costAnalysis: ClusterCostAnalysis;
  
  // Performance analysis
  performanceAnalysis: ClusterPerformanceAnalysis;
  
  // Usage patterns
  usagePattern: ClusterUsagePattern;
  
  // Optimization recommendations
  optimization: ClusterOptimization;
  
  // Time range for this cluster
  dataStartDate: Date;
  dataEndDate: Date;
  
  // Clustering metadata
  clusteringAlgorithm: string; // e.g., 'kmeans', 'dbscan', 'hierarchical'
  clusteringConfidence: number; // 0-1
  lastAnalyzedAt: Date;
  nextScheduledAnalysis: Date;
  
  // Lifecycle
  isActive: boolean; // Whether this cluster is still relevant
  mergedInto?: string; // If merged with another cluster
  
  createdAt: Date;
  updatedAt: Date;
}

const ClusterExampleSchema = new Schema({
  telemetryId: String,
  usageId: String,
  content: { type: String, required: true, maxlength: 1000 },
  embedding: { type: [Number], required: true },
  similarity: { type: Number, required: true, min: 0, max: 1 },
  cost: { type: Number, required: true },
  latency: { type: Number, required: true },
  timestamp: { type: Date, required: true }
}, { _id: false });

const ClusterCostAnalysisSchema = new Schema({
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
  isHighCost: { type: Boolean, required: true }
}, { _id: false });

const ClusterPerformanceAnalysisSchema = new Schema({
  avgLatency: { type: Number, required: true },
  p50Latency: { type: Number, required: true },
  p90Latency: { type: Number, required: true },
  p95Latency: { type: Number, required: true },
  avgTokens: { type: Number, required: true },
  avgInputTokens: { type: Number, required: true },
  avgOutputTokens: { type: Number, required: true },
  successRate: { type: Number, required: true, min: 0, max: 1 },
  errorRate: { type: Number, required: true, min: 0, max: 1 },
  topModels: [{
    modelId: String,
    frequency: Number,
    avgCost: Number,
    avgLatency: Number
  }]
}, { _id: false });

const ClusterUsagePatternSchema = new Schema({
  peakHours: { type: [Number], default: [] },
  peakDays: { type: [Number], default: [] },
  requestsPerDay: { type: Number, required: true },
  requestsPerUser: { type: Number, required: true },
  uniqueUsers: { type: Number, required: true },
  topUsers: [{
    userId: String,
    requestCount: Number,
    totalCost: Number
  }],
  growthRate: { type: Number, required: true },
  isGrowing: { type: Boolean, required: true }
}, { _id: false });

const ClusterOptimizationSchema = new Schema({
  priority: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical']
  },
  recommendations: [{
    type: {
      type: String,
      enum: ['model_switch', 'enable_cache', 'prompt_optimization', 'batch_processing', 'rate_limiting']
    },
    description: String,
    estimatedSavings: Number,
    estimatedSavingsPercentage: Number,
    implementationEffort: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    confidence: { type: Number, min: 0, max: 1 }
  }],
  totalEstimatedSavings: { type: Number, required: true },
  totalEstimatedSavingsPercentage: { type: Number, required: true }
}, { _id: false });

const SemanticClusterSchema = new Schema<ISemanticCluster>({
  clusterId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  clusterName: {
    type: String,
    required: true
  },
  
  centroid: {
    type: [Number],
    required: true
  },
  centroidDimensions: {
    type: Number,
    required: true
  },
  
  size: {
    type: Number,
    required: true,
    min: 0,
    index: true
  },
  density: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  
  examples: {
    type: [ClusterExampleSchema],
    default: []
  },
  
  semanticDescription: {
    type: String,
    required: true
  },
  keywords: {
    type: [String],
    default: []
  },
  category: {
    type: String,
    required: true,
    index: true
  },
  
  costAnalysis: {
    type: ClusterCostAnalysisSchema,
    required: true
  },
  
  performanceAnalysis: {
    type: ClusterPerformanceAnalysisSchema,
    required: true
  },
  
  usagePattern: {
    type: ClusterUsagePatternSchema,
    required: true
  },
  
  optimization: {
    type: ClusterOptimizationSchema,
    required: true
  },
  
  dataStartDate: {
    type: Date,
    required: true,
    index: true
  },
  dataEndDate: {
    type: Date,
    required: true,
    index: true
  },
  
  clusteringAlgorithm: {
    type: String,
    required: true
  },
  clusteringConfidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  lastAnalyzedAt: {
    type: Date,
    required: true
  },
  nextScheduledAnalysis: {
    type: Date,
    required: true
  },
  
  isActive: {
    type: Boolean,
    required: true,
    default: true,
    index: true
  },
  mergedInto: String
}, {
  timestamps: true
});

// Compound indexes for common queries
SemanticClusterSchema.index({ category: 1, 'costAnalysis.isHighCost': 1 });
SemanticClusterSchema.index({ 'costAnalysis.totalCost': -1, isActive: 1 });
SemanticClusterSchema.index({ size: -1, isActive: 1 });
SemanticClusterSchema.index({ 'optimization.priority': 1, isActive: 1 });
SemanticClusterSchema.index({ 'costAnalysis.potentialSavingsWithCache': -1 });

// Vector search index would need to be created in MongoDB Atlas for centroid searches
/*
db.semanticclusters.createSearchIndex({
  "name": "cluster_centroid_index",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "centroid",
        "numDimensions": 384,  // or 1536 depending on embedding model
        "similarity": "cosine"
      }
    ]
  }
});
*/

export const SemanticCluster = mongoose.model<ISemanticCluster>(
  'SemanticCluster',
  SemanticClusterSchema
);

