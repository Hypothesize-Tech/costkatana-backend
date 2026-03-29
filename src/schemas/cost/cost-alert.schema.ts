import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Cost alert instances (notifications).
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

CostAlertSchema.index({ customerId: 1, createdAt: -1 });
CostAlertSchema.index({ acknowledged: 1, createdAt: -1 });
