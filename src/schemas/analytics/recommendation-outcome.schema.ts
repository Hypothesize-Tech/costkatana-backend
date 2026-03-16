import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IUserBehavior {
  costSensitivity: 'low' | 'medium' | 'high';
  qualityTolerance: 'low' | 'medium' | 'high';
  riskTolerance: 'low' | 'medium' | 'high';
  avgCostPerDay: number;
  avgRequestsPerDay: number;
}

export interface IModelPerformance {
  modelId: string;
  avgLatency: number;
  avgCost: number;
  failureRate: number;
}

export interface ISuggestedModel {
  modelId: string;
  expectedLatency: number;
  expectedCost: number;
  expectedSavings: number;
}

export interface IRecommendationContext {
  trigger:
    | 'usage_pattern'
    | 'cost_spike'
    | 'performance_degradation'
    | 'new_model_available'
    | 'manual_analysis'
    | 'scheduled_review';
  userBehavior?: IUserBehavior;
  currentModel?: IModelPerformance;
  suggestedModel?: ISuggestedModel;
  metadata?: Record<string, any>;
}

export interface IUserInteraction {
  status:
    | 'pending'
    | 'viewed'
    | 'accepted'
    | 'rejected'
    | 'dismissed'
    | 'ignored';
  viewedAt?: Date;
  respondedAt?: Date;
  feedback?: string;
  rating?: number;
  acceptanceReason?: string;
  rejectionReason?: string;
  decisionTimeSeconds?: number;
}

export interface IOutcomeError {
  type: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
}

export interface IActualOutcome {
  actualLatency?: number;
  actualCost?: number;
  actualFailureRate?: number;
  actualSavings?: number;
  success: boolean;
  successScore?: number;
  errors?: IOutcomeError[];
  userSatisfaction?: number;
  userRetainedChange?: boolean;
  measurementStart: Date;
  measurementEnd: Date;
  sampleSize: number;
}

export interface IWeightUpdate {
  entityType:
    | 'model'
    | 'routing_strategy'
    | 'optimization_technique'
    | 'recommendation_type';
  entityId: string;
  previousWeight: number;
  newWeight: number;
  deltaWeight: number;
  reason: string;
  confidence: number;
  appliedAt: Date;
}

export interface ILearningSignals {
  recommendationQuality: number;
  predictionAccuracy: number;
  userTrust: number;
  systemLearning: number;
}

export type RecommendationOutcomeDocument =
  HydratedDocument<RecommendationOutcome>;

@Schema({ timestamps: true })
export class RecommendationOutcome {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AIRecommendation',
    required: true,
    index: true,
  })
  recommendationId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [
      'model_switch',
      'prompt_optimization',
      'usage_pattern',
      'cost_alert',
      'efficiency_tip',
      'caching_strategy',
      'routing_change',
    ],
    index: true,
  })
  recommendationType:
    | 'model_switch'
    | 'prompt_optimization'
    | 'usage_pattern'
    | 'cost_alert'
    | 'efficiency_tip'
    | 'caching_strategy'
    | 'routing_change';

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ index: true })
  tenantId?: string;

  @Prop({ index: true })
  workspaceId?: string;

  @Prop({
    type: {
      trigger: {
        type: String,
        required: true,
        enum: [
          'usage_pattern',
          'cost_spike',
          'performance_degradation',
          'new_model_available',
          'manual_analysis',
          'scheduled_review',
        ],
      },
      userBehavior: {
        costSensitivity: { type: String, enum: ['low', 'medium', 'high'] },
        qualityTolerance: { type: String, enum: ['low', 'medium', 'high'] },
        riskTolerance: { type: String, enum: ['low', 'medium', 'high'] },
        avgCostPerDay: Number,
        avgRequestsPerDay: Number,
      },
      currentModel: {
        modelId: String,
        avgLatency: Number,
        avgCost: Number,
        failureRate: Number,
      },
      suggestedModel: {
        modelId: String,
        expectedLatency: Number,
        expectedCost: Number,
        expectedSavings: Number,
      },
      metadata: mongoose.Schema.Types.Mixed,
    },
  })
  context: IRecommendationContext;

  @Prop({
    type: {
      status: {
        type: String,
        required: true,
        enum: [
          'pending',
          'viewed',
          'accepted',
          'rejected',
          'dismissed',
          'ignored',
        ],
        default: 'pending',
        index: true,
      },
      viewedAt: Date,
      respondedAt: Date,
      feedback: String,
      rating: { type: Number, min: 1, max: 5 },
      acceptanceReason: String,
      rejectionReason: String,
      decisionTimeSeconds: Number,
    },
  })
  interaction: IUserInteraction;

  @Prop({
    type: {
      actualLatency: Number,
      actualCost: Number,
      actualFailureRate: Number,
      actualSavings: Number,
      success: { type: Boolean, required: true },
      successScore: { type: Number, min: 0, max: 1 },
      errors: [
        {
          type: String,
          message: String,
          timestamp: Date,
          resolved: Boolean,
        },
      ],
      userSatisfaction: { type: Number, min: 1, max: 5 },
      userRetainedChange: Boolean,
      measurementStart: { type: Date, required: true },
      measurementEnd: { type: Date, required: true },
      sampleSize: { type: Number, required: true },
    },
  })
  outcome?: IActualOutcome;

  @Prop({
    type: [
      {
        entityType: {
          type: String,
          required: true,
          enum: [
            'model',
            'routing_strategy',
            'optimization_technique',
            'recommendation_type',
          ],
        },
        entityId: { type: String, required: true },
        previousWeight: { type: Number, required: true },
        newWeight: { type: Number, required: true },
        deltaWeight: { type: Number, required: true },
        reason: { type: String, required: true },
        confidence: { type: Number, required: true, min: 0, max: 1 },
        appliedAt: { type: Date, required: true, default: Date.now },
      },
    ],
  })
  weightUpdates: IWeightUpdate[];

  @Prop({
    type: {
      recommendationQuality: {
        type: Number,
        required: true,
        default: 0.5,
        min: 0,
        max: 1,
      },
      predictionAccuracy: {
        type: Number,
        required: true,
        default: 0.5,
        min: 0,
        max: 1,
      },
      userTrust: { type: Number, required: true, default: 0.5, min: 0, max: 1 },
      systemLearning: {
        type: Number,
        required: true,
        default: 0.5,
        min: 0,
        max: 1,
      },
    },
  })
  learningSignals: ILearningSignals;

  @Prop({ type: Date, required: true, index: true })
  recommendedAt: Date;

  @Prop()
  outcomeRecordedAt?: Date;

  @Prop()
  learningAppliedAt?: Date;

  @Prop({ type: Boolean, default: false })
  isTestRecommendation?: boolean;

  @Prop()
  experimentId?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const RecommendationOutcomeSchema = SchemaFactory.createForClass(
  RecommendationOutcome,
);

// Compound indexes for common queries
RecommendationOutcomeSchema.index({ userId: 1, recommendedAt: -1 });
RecommendationOutcomeSchema.index({
  recommendationType: 1,
  'interaction.status': 1,
});
RecommendationOutcomeSchema.index({
  'interaction.status': 1,
  recommendedAt: -1,
});
RecommendationOutcomeSchema.index({
  'outcome.success': 1,
  recommendationType: 1,
});
RecommendationOutcomeSchema.index({ tenantId: 1, recommendedAt: -1 });

// Index for learning signal queries
RecommendationOutcomeSchema.index({
  'learningSignals.recommendationQuality': -1,
});
RecommendationOutcomeSchema.index({ 'learningSignals.predictionAccuracy': -1 });
