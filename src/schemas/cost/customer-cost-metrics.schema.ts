import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Aggregated customer cost metrics (materialized).
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

CustomerCostMetricsSchema.index({ customerId: 1 }, { unique: true });
