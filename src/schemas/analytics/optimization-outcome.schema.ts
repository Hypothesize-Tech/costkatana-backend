import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IOptimizationContext {
  originalModel: string;
  suggestedModel: string;
  promptComplexity: number;
  userTier: string;
  taskType?: string;
  promptLength?: number;
  estimatedCost?: number;
}

@Schema()
export class OptimizationContext {
  @Prop({ required: true })
  originalModel: string;

  @Prop({ required: true })
  suggestedModel: string;

  @Prop({ required: true })
  promptComplexity: number;

  @Prop({ required: true })
  userTier: string;

  @Prop()
  taskType?: string;

  @Prop()
  promptLength?: number;

  @Prop()
  estimatedCost?: number;
}

export const OptimizationContextSchema =
  SchemaFactory.createForClass(OptimizationContext);

export interface IOptimizationOutcomeResult {
  applied: boolean;
  userApproved: boolean;
  costSaved: number;
  qualityScore?: number;
  userRating?: number;
  errorOccurred?: boolean;
  executionTime?: number;
}

@Schema()
export class OptimizationOutcomeResult {
  @Prop({ required: true, default: false })
  applied: boolean;

  @Prop({ required: true, default: false })
  userApproved: boolean;

  @Prop({ required: true, default: 0 })
  costSaved: number;

  @Prop({ type: Number, min: 0, max: 1 })
  qualityScore?: number;

  @Prop({ type: Number, min: 1, max: 5 })
  userRating?: number;

  @Prop({ default: false })
  errorOccurred?: boolean;

  @Prop()
  executionTime?: number;
}

export const OptimizationOutcomeResultSchema = SchemaFactory.createForClass(
  OptimizationOutcomeResult,
);

@Schema()
export class LearningSignals {
  @Prop({ type: Number, min: 0, max: 1 })
  acceptanceRate?: number;

  @Prop({ type: Number, min: 0, max: 1 })
  successRate?: number;

  @Prop()
  averageSavings?: number;

  @Prop({ type: Number, min: 0, max: 1 })
  confidenceScore?: number;
}

export const LearningSignalsSchema =
  SchemaFactory.createForClass(LearningSignals);

export type OptimizationOutcomeDocument = HydratedDocument<OptimizationOutcome>;

@Schema({ timestamps: true, collection: 'optimization_outcomes' })
export class OptimizationOutcome {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  optimizationId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  @Prop({ required: true, index: true })
  optimizationType: string;

  @Prop({ type: OptimizationContextSchema })
  context: OptimizationContext;

  @Prop({ type: OptimizationOutcomeResultSchema })
  outcome: OptimizationOutcomeResult;

  @Prop({ type: LearningSignalsSchema })
  learningSignals?: LearningSignals;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const OptimizationOutcomeSchema =
  SchemaFactory.createForClass(OptimizationOutcome);

// Compound indexes for learning queries
OptimizationOutcomeSchema.index({
  userId: 1,
  optimizationType: 1,
  timestamp: -1,
});
OptimizationOutcomeSchema.index({
  'context.originalModel': 1,
  'context.suggestedModel': 1,
});
OptimizationOutcomeSchema.index({
  'outcome.applied': 1,
  'outcome.userApproved': 1,
});
OptimizationOutcomeSchema.index({
  optimizationType: 1,
  'outcome.applied': 1,
  timestamp: -1,
});
