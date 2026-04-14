import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CostChangeExplanationDocument =
  HydratedDocument<CostChangeExplanation>;

@Schema({ timestamps: true, collection: 'cost_change_explanations' })
export class CostChangeExplanation {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  anomalyTimestamp: Date;

  @Prop({ required: true })
  pctChange: number;

  @Prop({ required: true })
  absChangeUsd: number;

  @Prop()
  correlatedActivityType?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  correlatedActivityId?: MongooseSchema.Types.ObjectId;

  @Prop({ default: 0 })
  correlationConfidence: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  attribution: {
    team?: string;
    project?: string;
    endpoint?: string;
    model?: string;
    provider?: string;
  };

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  evidence: Record<string, unknown>;

  @Prop({ default: false })
  consumed: boolean;
}

export const CostChangeExplanationSchema = SchemaFactory.createForClass(
  CostChangeExplanation,
);

CostChangeExplanationSchema.index({ userId: 1, anomalyTimestamp: -1 });
CostChangeExplanationSchema.index({ userId: 1, consumed: 1 });
