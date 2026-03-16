import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IScoringCriteria {
  accuracy?: number;
  relevance?: number;
  completeness?: number;
  coherence?: number;
  factuality?: number;
}

export interface ICostSavings {
  amount: number;
  percentage: number;
}

export interface IUserFeedback {
  rating?: 1 | 2 | 3 | 4 | 5;
  isAcceptable: boolean;
  comment?: string;
  timestamp: Date;
}

export interface IQualityScoreMetadata {
  promptLength?: number;
  responseLength?: number;
  processingTime?: number;
  optimizationDetails?: any;
}

export type QualityScoreDocument = HydratedDocument<QualityScore>;

@Schema({ timestamps: true })
export class QualityScore {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Usage' })
  usageId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Optimization' })
  optimizationId?: MongooseSchema.Types.ObjectId;

  @Prop({ min: 1, max: 100 })
  originalScore?: number;

  @Prop({ required: true, min: 1, max: 100 })
  optimizedScore: number;

  @Prop({
    type: String,
    enum: ['ai_model', 'user_feedback', 'automated', 'hybrid'],
    required: true,
  })
  scoringMethod: 'ai_model' | 'user_feedback' | 'automated' | 'hybrid';

  @Prop()
  scoringModel?: string;

  @Prop({
    type: {
      accuracy: { type: Number, min: 0, max: 100 },
      relevance: { type: Number, min: 0, max: 100 },
      completeness: { type: Number, min: 0, max: 100 },
      coherence: { type: Number, min: 0, max: 100 },
      factuality: { type: Number, min: 0, max: 100 },
    },
  })
  scoringCriteria?: IScoringCriteria;

  @Prop({
    type: {
      amount: { type: Number, required: true },
      percentage: { type: Number, required: true },
    },
  })
  costSavings: ICostSavings;

  @Prop([{ type: String, required: true }])
  optimizationType: string[];

  @Prop({
    type: {
      rating: { type: Number, min: 1, max: 5 },
      isAcceptable: Boolean,
      comment: String,
      timestamp: Date,
    },
  })
  userFeedback?: IUserFeedback;

  @Prop({
    type: {
      promptLength: Number,
      responseLength: Number,
      processingTime: Number,
      optimizationDetails: mongoose.Schema.Types.Mixed,
    },
  })
  metadata?: IQualityScoreMetadata;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const QualityScoreSchema = SchemaFactory.createForClass(QualityScore);

// Indexes for efficient querying
QualityScoreSchema.index({ userId: 1, createdAt: -1 });
QualityScoreSchema.index({ optimizedScore: 1, 'costSavings.amount': -1 });

// Virtual for quality delta
QualityScoreSchema.virtual('qualityDelta').get(function () {
  if (this.originalScore) {
    return this.optimizedScore - this.originalScore;
  }
  return null;
});

// Virtual for quality retention percentage
QualityScoreSchema.virtual('qualityRetention').get(function () {
  if (this.originalScore) {
    return (this.optimizedScore / this.originalScore) * 100;
  }
  return 100;
});
