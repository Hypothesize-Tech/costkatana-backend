import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CostTrackingRecordDocument = HydratedDocument<CostTrackingRecord>;

@Schema({ timestamps: true })
export class CostTrackingRecord {
  @Prop({ required: true })
  repoFullName: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: ['embedding', 'query', 'generation'] })
  operationType: 'embedding' | 'query' | 'generation';

  @Prop({ required: true, default: 1 })
  count: number;

  @Prop()
  tokensUsed?: number;

  @Prop({ required: true, default: 0 })
  cost: number;

  @Prop({ type: Date, default: Date.now })
  timestamp: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const CostTrackingRecordSchema =
  SchemaFactory.createForClass(CostTrackingRecord);

// Indexes for performance
CostTrackingRecordSchema.index({ repoFullName: 1, timestamp: -1 });
CostTrackingRecordSchema.index({ userId: 1, timestamp: -1 });
CostTrackingRecordSchema.index({ operationType: 1, timestamp: -1 });

/**
 * Cost Anomaly Tracking Schema
 */
@Schema({ timestamps: true })
export class CostAnomalyHistory {
  @Prop({ required: true })
  connectionId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: Date, default: Date.now })
  timestamp: Date;

  @Prop({ required: true })
  userId: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const CostAnomalyHistorySchema =
  SchemaFactory.createForClass(CostAnomalyHistory);

/**
 * Customer Cost Metrics Schema
 */
@Schema({ timestamps: true })
export class CustomerCostMetrics {
  @Prop({ required: true })
  customerId: string;

  @Prop({ default: 0 })
  totalCostIncrease: number;

  @Prop({ default: 0 })
  totalCostDecrease: number;

  @Prop({ default: 0 })
  netCostChange: number;

  @Prop({ default: 0 })
  actionsExecuted: number;

  @Prop({ default: 0 })
  anomalyCount: number;

  @Prop()
  lastAnomalyAt?: Date;

  @Prop({ default: 0 })
  budgetLimit: number;

  @Prop({ type: Date, default: Date.now })
  lastUpdated: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const CustomerCostMetricsSchema =
  SchemaFactory.createForClass(CustomerCostMetrics);

/**
 * Cost Alert History Schema
 */
@Schema({ timestamps: true })
export class CostAlert {
  @Prop({ required: true })
  customerId: string;

  @Prop({
    required: true,
    enum: [
      'cost_increase',
      'rate_limit',
      'unexpected_region',
      'self_monitoring',
    ],
  })
  type:
    | 'cost_increase'
    | 'rate_limit'
    | 'unexpected_region'
    | 'self_monitoring';

  @Prop({ required: true })
  message: string;

  @Prop({ required: true, enum: ['warning', 'critical'] })
  severity: 'warning' | 'critical';

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ default: false })
  acknowledged: boolean;

  @Prop()
  acknowledgedAt?: Date;

  @Prop()
  acknowledgedBy?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const CostAlertSchema = SchemaFactory.createForClass(CostAlert);

// Indexes for performance
CostAnomalyHistorySchema.index({ connectionId: 1, timestamp: -1 });
CostAnomalyHistorySchema.index({ userId: 1, timestamp: -1 });
CustomerCostMetricsSchema.index({ customerId: 1 }, { unique: true });
CostAlertSchema.index({ customerId: 1, createdAt: -1 });
CostAlertSchema.index({ acknowledged: 1, createdAt: -1 });
