import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IndexingMetricsDocument = IndexingMetrics & Document;

@Schema({ timestamps: true })
export class IndexingMetrics {
  @Prop({ required: true })
  repoFullName: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ default: 0 })
  recallAtK: number; // Recall@K for retrieval (calculated from ground truth)

  @Prop({ default: 0 })
  mrr: number; // Mean Reciprocal Rank (calculated from search results)

  @Prop({ default: 0 })
  embeddingComputeCost: number; // USD

  @Prop({ default: 0 })
  vectorDBCost: number; // USD

  @Prop({ default: 0 })
  averageLatency: number; // ms

  @Prop({ default: 0 })
  indexingTime: number; // ms per file

  @Prop({
    type: {
      total: { type: Number, default: 0 },
      byType: { type: Map, of: Number, default: {} },
      byLanguage: { type: Map, of: Number, default: {} },
    },
    _id: false,
    default: { total: 0, byType: {}, byLanguage: {} },
  })
  chunkCounts: {
    total: number;
    byType: Record<string, number>;
    byLanguage: Record<string, number>;
  };

  @Prop({
    type: {
      averageLatency: { type: Number, default: 0 },
      p95Latency: { type: Number, default: 0 },
      queriesPerSecond: { type: Number, default: 0 },
    },
    _id: false,
    default: { averageLatency: 0, p95Latency: 0, queriesPerSecond: 0 },
  })
  searchPerformance: {
    averageLatency: number;
    p95Latency: number;
    queriesPerSecond: number;
  };

  @Prop({ default: Date.now })
  lastUpdated: Date;
}

export const IndexingMetricsSchema =
  SchemaFactory.createForClass(IndexingMetrics);

export type IndexingOperationDocument = IndexingOperation & Document;
export type SearchOperationDocument = SearchOperation & Document;

// Add indexes for efficient queries
IndexingMetricsSchema.index({ repoFullName: 1, userId: 1 }, { unique: true });
IndexingMetricsSchema.index({ lastUpdated: -1 });
IndexingMetricsSchema.index({ 'searchPerformance.averageLatency': 1 });
IndexingMetricsSchema.index({ recallAtK: -1, mrr: -1 });

@Schema({ timestamps: true })
export class IndexingOperation {
  @Prop({ required: true })
  repoFullName: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  fileCount: number;

  @Prop({ required: true })
  chunkCount: number;

  @Prop({ required: true })
  duration: number; // ms

  @Prop({ required: true, default: 0 })
  cost: number; // USD

  @Prop({
    type: {
      function: { type: Number, default: 0 },
      class: { type: Number, default: 0 },
      method: { type: Number, default: 0 },
      doc: { type: Number, default: 0 },
      config: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    _id: false,
    default: { function: 0, class: 0, method: 0, doc: 0, config: 0, other: 0 },
  })
  chunkTypes: {
    function: number;
    class: number;
    method: number;
    doc: number;
    config: number;
    other: number;
  };

  @Prop({
    type: Map,
    of: Number,
    default: {},
  })
  chunkLanguages: Map<string, number>;
}

export const IndexingOperationSchema =
  SchemaFactory.createForClass(IndexingOperation);

// Add indexes for efficient queries
IndexingOperationSchema.index({ repoFullName: 1, createdAt: -1 });
IndexingOperationSchema.index({ userId: 1, createdAt: -1 });
IndexingOperationSchema.index({ createdAt: -1 });
IndexingOperationSchema.index({ cost: -1 });

@Schema({ timestamps: true })
export class SearchOperation {
  @Prop({ required: true })
  query: string;

  @Prop()
  repoFullName?: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  latency: number; // ms

  @Prop({ required: true, default: 0 })
  resultCount: number;

  @Prop({ default: 0 })
  recallAtK?: number; // If ground truth is available

  @Prop({ default: 0 })
  mrr?: number; // Mean Reciprocal Rank for this query

  @Prop({ default: 0 })
  cost: number; // USD for this search
}

export const SearchOperationSchema =
  SchemaFactory.createForClass(SearchOperation);

// Add indexes for efficient queries
SearchOperationSchema.index({ repoFullName: 1, createdAt: -1 });
SearchOperationSchema.index({ userId: 1, createdAt: -1 });
SearchOperationSchema.index({ createdAt: -1 });
SearchOperationSchema.index({ latency: 1 });
SearchOperationSchema.index({ cost: -1 });
