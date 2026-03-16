import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AIRecommendationDocument = AIRecommendation & Document;

@Schema({
  timestamps: true,
  collection: 'ai_recommendations',
})
export class AIRecommendation {
  @Prop({
    type: String,
    ref: 'User',
    required: true,
  })
  userId: string;

  @Prop({
    type: String,
    enum: [
      'model_switch',
      'prompt_optimization',
      'usage_pattern',
      'cost_alert',
      'efficiency_tip',
    ],
    required: true,
  })
  type:
    | 'model_switch'
    | 'prompt_optimization'
    | 'usage_pattern'
    | 'cost_alert'
    | 'efficiency_tip';

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
  })
  priority: 'low' | 'medium' | 'high' | 'urgent';

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  description: string;

  @Prop({ type: String })
  reasoning: string;

  @Prop({
    type: {
      currentModel: { type: String },
      suggestedModel: { type: String },
      currentPrompt: { type: String },
      suggestedPrompt: { type: String },
      estimatedSavings: { type: Number },
      confidenceScore: { type: Number },
      implementationComplexity: {
        type: String,
        enum: ['easy', 'moderate', 'complex'],
        default: 'moderate',
      },
    },
    _id: false,
  })
  actionable: {
    currentModel?: string;
    suggestedModel?: string;
    currentPrompt?: string;
    suggestedPrompt?: string;
    estimatedSavings: number;
    confidenceScore: number;
    implementationComplexity: 'easy' | 'moderate' | 'complex';
  };

  @Prop({
    type: {
      triggeredBy: { type: String },
      relevantUsageIds: [{ type: String }],
      projectId: { type: String },
      basedOnPattern: { type: String },
    },
    _id: false,
  })
  context: {
    triggeredBy: string;
    relevantUsageIds?: string[];
    projectId?: string;
    basedOnPattern: string;
  };

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['pending', 'viewed', 'accepted', 'rejected', 'dismissed'],
        default: 'pending',
      },
      viewedAt: { type: Date },
      respondedAt: { type: Date },
      feedback: { type: String },
      rating: { type: Number, min: 1, max: 5 },
    },
    _id: false,
  })
  userInteraction: {
    status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'dismissed';
    viewedAt?: Date;
    respondedAt?: Date;
    feedback?: string;
    rating?: number;
  };

  @Prop({
    type: {
      actualSavings: { type: Number },
      userSatisfaction: { type: Number },
      implementationSuccess: { type: Boolean },
      followUpNeeded: { type: Boolean },
    },
    _id: false,
  })
  effectiveness: {
    actualSavings?: number;
    userSatisfaction?: number;
    implementationSuccess?: boolean;
    followUpNeeded?: boolean;
  };

  @Prop({
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const AIRecommendationSchema =
  SchemaFactory.createForClass(AIRecommendation);

// Create indexes
AIRecommendationSchema.index({ userId: 1, 'userInteraction.status': 1 });
AIRecommendationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
