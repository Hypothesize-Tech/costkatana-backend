import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IExperimentModel {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface IExperimentRequest {
  prompt?: string;
  models?: IExperimentModel[];
  evaluationCriteria?: string[];
  iterations?: number;
  comparisonMode?: 'quality' | 'cost' | 'speed' | 'comprehensive';
  executeOnBedrock?: boolean;
}

export interface IExperimentMetadata {
  duration: number;
  iterations: number;
  confidence: number;
}

export type ExperimentDocument = HydratedDocument<Experiment>;

@Schema({ timestamps: true })
export class Experiment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop()
  sessionId?: string;

  @Prop()
  resultId?: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    type: String,
    enum: ['model_comparison', 'what_if', 'fine_tuning'],
    required: true,
  })
  type: 'model_comparison' | 'what_if' | 'fine_tuning';

  @Prop({
    type: String,
    enum: ['running', 'completed', 'failed'],
    required: true,
    default: 'running',
  })
  status: 'running' | 'completed' | 'failed';

  @Prop({ required: true, default: Date.now })
  startTime: Date;

  @Prop()
  endTime?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  results: any;

  @Prop({
    type: {
      duration: { type: Number, default: 0 },
      iterations: { type: Number, default: 1 },
      confidence: { type: Number, default: 0.5 },
    },
  })
  metadata: IExperimentMetadata;

  @Prop({
    type: {
      prompt: String,
      models: [
        {
          provider: String,
          model: String,
          temperature: Number,
          maxTokens: Number,
        },
      ],
      evaluationCriteria: [String],
      iterations: Number,
      comparisonMode: {
        type: String,
        enum: ['quality', 'cost', 'speed', 'comprehensive'],
      },
      executeOnBedrock: Boolean,
    },
  })
  request: IExperimentRequest;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ExperimentSchema = SchemaFactory.createForClass(Experiment);

// Indexes
ExperimentSchema.index({ userId: 1, createdAt: -1 });
ExperimentSchema.index({ userId: 1, status: 1 });
ExperimentSchema.index({ resultId: 1 }, { sparse: true });
ExperimentSchema.index({ sessionId: 1 }, { sparse: true });
