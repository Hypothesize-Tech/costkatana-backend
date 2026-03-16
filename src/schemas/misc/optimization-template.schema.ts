import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OptimizationTemplateDocument =
  HydratedDocument<OptimizationTemplate>;

@Schema({ timestamps: true })
export class OptimizationTemplate {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  category: string;

  @Prop({ required: true })
  template: string;

  @Prop({ type: [String], default: [] })
  variables: string[];

  @Prop({ default: 25 })
  expectedReduction: number;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const OptimizationTemplateSchema =
  SchemaFactory.createForClass(OptimizationTemplate);

// Indexes
OptimizationTemplateSchema.index({ category: 1 });
OptimizationTemplateSchema.index({ enabled: 1 });
