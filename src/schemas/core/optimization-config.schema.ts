import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type OptimizationConfigDocument = HydratedDocument<OptimizationConfig>;

@Schema({ timestamps: true })
export class OptimizationConfig {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  value: any;

  @Prop({ type: String, default: 'system' })
  scope: 'system' | 'user' | 'project';

  @Prop({ type: String })
  description?: string;

  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const OptimizationConfigSchema =
  SchemaFactory.createForClass(OptimizationConfig);

// Indexes
OptimizationConfigSchema.index({ key: 1, scope: 1 });
OptimizationConfigSchema.index({ scope: 1 });
OptimizationConfigSchema.index({ enabled: 1 });
