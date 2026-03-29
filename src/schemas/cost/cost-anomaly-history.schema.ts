import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Cost anomaly history per AWS / connection (event stream).
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

CostAnomalyHistorySchema.index({ connectionId: 1, timestamp: -1 });
CostAnomalyHistorySchema.index({ userId: 1, timestamp: -1 });
