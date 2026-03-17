import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CostAllocationRuleDocument = HydratedDocument<CostAllocationRule>;

@Schema({ timestamps: true })
export class CostAllocationRule {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], required: true })
  tagFilters: string[];

  @Prop({ required: true, min: 0, max: 100 })
  allocationPercentage: number;

  @Prop({ required: true })
  department: string;

  @Prop({ required: true })
  team: string;

  @Prop({ required: true })
  costCenter: string;

  @Prop({ required: true, type: String, ref: 'User' })
  createdBy: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const CostAllocationRuleSchema =
  SchemaFactory.createForClass(CostAllocationRule);
CostAllocationRuleSchema.index({ createdBy: 1, isActive: 1 });
