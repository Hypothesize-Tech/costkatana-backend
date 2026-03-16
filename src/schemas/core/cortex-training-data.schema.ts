/**
 * Cortex Training Data Schema (NestJS)
 * Matches Express CortexTrainingData collection for production parity.
 * Used for training data collection, export, and feedback.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CortexTrainingDataDocument = HydratedDocument<CortexTrainingData>;

@Schema({ timestamps: true, collection: 'cortex_training_data' })
export class CortexTrainingData {
  @Prop({ required: true, index: true })
  sessionId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ default: Date.now, index: true })
  timestamp: Date;

  @Prop({ required: true })
  originalPrompt: string;

  @Prop({ required: true })
  originalTokenCount: number;

  @Prop({
    type: {
      encoderPrompt: String,
      coreProcessorPrompt: String,
      decoderPrompt: String,
      generatedAt: Date,
      model: String,
    },
  })
  lispInstructions?: {
    encoderPrompt?: string;
    coreProcessorPrompt?: string;
    decoderPrompt?: string;
    generatedAt?: Date;
    model?: string;
  };

  @Prop({
    type: {
      inputText: String,
      outputLisp: MongooseSchema.Types.Mixed,
      confidence: Number,
      processingTime: Number,
      model: String,
      tokenCounts: { input: Number, output: Number },
    },
  })
  encoderStage?: Record<string, unknown>;

  @Prop({
    type: {
      inputLisp: MongooseSchema.Types.Mixed,
      outputLisp: MongooseSchema.Types.Mixed,
      answerType: String,
      processingTime: Number,
      model: String,
      tokenCounts: { input: Number, output: Number },
    },
  })
  coreProcessorStage?: Record<string, unknown>;

  @Prop({
    type: {
      inputLisp: MongooseSchema.Types.Mixed,
      outputText: String,
      style: String,
      processingTime: Number,
      model: String,
      tokenCounts: { input: Number, output: Number },
    },
  })
  decoderStage?: Record<string, unknown>;

  @Prop({
    type: {
      totalProcessingTime: Number,
      totalTokenReduction: Number,
      tokenReductionPercentage: Number,
      costSavings: Number,
      qualityScore: Number,
    },
  })
  performance?: {
    totalProcessingTime?: number;
    totalTokenReduction?: number;
    tokenReductionPercentage?: number;
    costSavings?: number;
    qualityScore?: number;
  };

  @Prop({
    type: {
      service: String,
      category: String,
      complexity: { type: String, enum: ['simple', 'medium', 'complex'] },
      language: String,
      userAgent: String,
      requestId: String,
    },
  })
  context?: {
    service?: string;
    category?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    language?: string;
    userAgent?: string;
    requestId?: string;
  };

  @Prop({
    type: {
      isSuccessful: Boolean,
      userFeedback: Number,
      errorType: String,
      improvementSuggestions: [String],
    },
  })
  trainingLabels?: {
    isSuccessful?: boolean;
    userFeedback?: number;
    errorType?: string;
    improvementSuggestions?: string[];
  };
}

export const CortexTrainingDataSchema =
  SchemaFactory.createForClass(CortexTrainingData);

CortexTrainingDataSchema.index({ userId: 1, timestamp: -1 });
CortexTrainingDataSchema.index({
  'context.service': 1,
  'context.complexity': 1,
});
CortexTrainingDataSchema.index({ 'performance.tokenReductionPercentage': -1 });
CortexTrainingDataSchema.index({ sessionId: 1, timestamp: 1 });
