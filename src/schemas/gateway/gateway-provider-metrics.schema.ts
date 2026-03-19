import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GatewayProviderMetricsDocument = GatewayProviderMetrics & Document;

/**
 * Persistent gateway provider/model performance metrics for production scalability.
 * Complements Redis cache with durable MongoDB storage for analytics and routing decisions.
 */
@Schema({
  timestamps: true,
  collection: 'gateway_provider_metrics',
})
export class GatewayProviderMetrics {
  @Prop({ required: true, index: true })
  provider: string;

  @Prop({ required: true, index: true })
  model: string;

  @Prop({ type: Number, default: 0 })
  totalRequests: number;

  @Prop({ type: Number, default: 0 })
  successfulRequests: number;

  @Prop({ type: Number, default: 0 })
  totalLatency: number;

  @Prop({ type: Number, default: 0 })
  averageLatency: number;

  @Prop({ type: [Number], default: [] })
  recentLatencies: number[];

  @Prop({ type: Date, default: Date.now })
  lastUpdated: Date;
}

export const GatewayProviderMetricsSchema = SchemaFactory.createForClass(
  GatewayProviderMetrics,
);

GatewayProviderMetricsSchema.index({ provider: 1, model: 1 }, { unique: true });
GatewayProviderMetricsSchema.index({ lastUpdated: -1 });
