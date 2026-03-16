import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserBehaviorPatternDocument = UserBehaviorPattern & Document;

@Schema({
  timestamps: true,
  collection: 'user_behavior_patterns',
})
export class UserBehaviorPattern {
  @Prop({
    type: String,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId: string;

  @Prop({
    type: {
      preferredModels: [
        {
          model: { type: String },
          frequency: { type: Number },
          avgCost: { type: Number },
        },
      ],
      commonPromptTypes: [
        {
          type: { type: String },
          frequency: { type: Number },
          avgTokens: { type: Number },
        },
      ],
      costSensitivity: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
      qualityTolerance: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'high',
      },
      peakUsageHours: [{ type: Number }],
      avgRequestsPerDay: { type: Number },
      avgCostPerDay: { type: Number },
    },
    _id: false,
  })
  usagePatterns: {
    preferredModels: Array<{
      model: string;
      frequency: number;
      avgCost: number;
    }>;
    commonPromptTypes: Array<{
      type: string;
      frequency: number;
      avgTokens: number;
    }>;
    costSensitivity: 'low' | 'medium' | 'high';
    qualityTolerance: 'low' | 'medium' | 'high';
    peakUsageHours: number[];
    avgRequestsPerDay: number;
    avgCostPerDay: number;
  };

  @Prop({
    type: {
      acceptanceRate: { type: Number },
      preferredOptimizationTypes: [
        {
          type: { type: String },
          acceptanceRate: { type: Number },
        },
      ],
      riskTolerance: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
      avgTimeToDecision: { type: Number },
      frequentlyRejectedOptimizations: [{ type: String }],
    },
    _id: false,
  })
  optimizationBehavior: {
    acceptanceRate: number;
    preferredOptimizationTypes: Array<{ type: string; acceptanceRate: number }>;
    riskTolerance: 'low' | 'medium' | 'high';
    avgTimeToDecision: number;
    frequentlyRejectedOptimizations: string[];
  };

  @Prop({
    type: {
      totalInteractions: { type: Number },
      successfulRecommendations: { type: Number },
      lastUpdated: { type: Date, default: Date.now },
      confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    },
    _id: false,
  })
  learningData: {
    totalInteractions: number;
    successfulRecommendations: number;
    lastUpdated: Date;
    confidence: number;
  };

  createdAt: Date;
  updatedAt: Date;
}

export const UserBehaviorPatternSchema =
  SchemaFactory.createForClass(UserBehaviorPattern);
