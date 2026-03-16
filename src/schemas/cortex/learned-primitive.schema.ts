import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true, collection: 'learned_primitives' })
export class LearnedPrimitive {
  @Prop({ required: true, unique: true })
  id!: number;

  @Prop({ required: true, unique: true })
  name!: string;

  @Prop({ required: true, enum: ['action', 'concept', 'property', 'modifier'] })
  type!: 'action' | 'concept' | 'property' | 'modifier';

  @Prop({ required: true })
  definition!: string;

  @Prop({ type: [String], default: [] })
  examples!: string[];

  @Prop({ type: Number, min: 0, max: 1, default: 0.5 })
  confidence!: number;

  @Prop({ type: Number, default: 1 })
  frequency!: number;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ required: true })
  lastUsed!: Date;
}

export type LearnedPrimitiveDocument = LearnedPrimitive & Document;

export const LearnedPrimitiveSchema =
  SchemaFactory.createForClass(LearnedPrimitive);

// Indexes for efficient querying
LearnedPrimitiveSchema.index({ confidence: -1 });
LearnedPrimitiveSchema.index({ frequency: -1 });
LearnedPrimitiveSchema.index({ lastUsed: -1 });
LearnedPrimitiveSchema.index({ type: 1 });
