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

CostTrackingRecordSchema.index({ repoFullName: 1, timestamp: -1 });
CostTrackingRecordSchema.index({ userId: 1, timestamp: -1 });
CostTrackingRecordSchema.index({ operationType: 1, timestamp: -1 });
