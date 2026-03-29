import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SimulationTrackingDocument = HydratedDocument<SimulationTracking>;

export const SIMULATION_TYPES = [
  'real_time_analysis',
  'prompt_optimization',
  'context_trimming',
  'model_comparison',
] as const;

@Schema({ timestamps: true, collection: 'simulation_tracking' })
export class SimulationTracking {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true })
  sessionId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Usage', required: false })
  originalUsageId?: Types.ObjectId;

  @Prop({ type: String, required: true, enum: SIMULATION_TYPES })
  simulationType: (typeof SIMULATION_TYPES)[number];

  @Prop({ required: true })
  originalModel: string;

  @Prop({ required: true })
  originalPrompt: string;

  @Prop({ required: true })
  originalCost: number;

  @Prop({ required: true })
  originalTokens: number;

  @Prop({
    type: {
      temperature: Number,
      maxTokens: Number,
      trimPercentage: Number,
      alternativeModels: [String],
    },
  })
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    trimPercentage?: number;
    alternativeModels?: string[];
  };

  @Prop({
    type: [
      {
        type: { type: String, required: true },
        description: { type: String, required: true },
        newModel: String,
        newCost: Number,
        savings: Number,
        savingsPercentage: Number,
        risk: { type: String, enum: ['low', 'medium', 'high'] },
        implementation: { type: String, enum: ['easy', 'moderate', 'complex'] },
        confidence: Number,
      },
    ],
    default: [],
  })
  optimizationOptions: Array<{
    type: string;
    description: string;
    newModel?: string;
    newCost?: number;
    savings?: number;
    savingsPercentage?: number;
    risk?: 'low' | 'medium' | 'high';
    implementation?: 'easy' | 'moderate' | 'complex';
    confidence?: number;
  }>;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  recommendations: unknown[];

  @Prop({ required: true })
  potentialSavings: number;

  @Prop({ required: true })
  confidence: number;

  @Prop({ default: Date.now })
  viewedAt: Date;

  @Prop()
  timeSpentViewing?: number;

  @Prop({ type: [Number], default: [] })
  optionsViewed: number[];

  @Prop({
    type: [
      {
        optionIndex: Number,
        appliedAt: Date,
        type: String,
        estimatedSavings: Number,
        actualSavings: Number,
        userFeedback: {
          satisfied: Boolean,
          comment: String,
          rating: { type: Number, min: 1, max: 5 },
        },
      },
    ],
    default: [],
  })
  appliedOptimizations: Array<{
    optionIndex: number;
    appliedAt: Date;
    type: string;
    estimatedSavings: number;
    actualSavings?: number;
    userFeedback?: {
      satisfied: boolean;
      comment?: string;
      rating?: number;
    };
  }>;

  @Prop()
  userAgent?: string;

  @Prop()
  ipAddress?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project' })
  projectId?: Types.ObjectId;

  /** Optional link to a model-comparison experiment for leaderboard drill-down */
  @Prop({ type: String })
  experimentId?: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const SimulationTrackingSchema =
  SchemaFactory.createForClass(SimulationTracking);

SimulationTrackingSchema.index({ userId: 1, createdAt: -1 });
SimulationTrackingSchema.index({ sessionId: 1 });
SimulationTrackingSchema.index({ simulationType: 1, createdAt: -1 });
SimulationTrackingSchema.index({ 'appliedOptimizations.appliedAt': -1 });
