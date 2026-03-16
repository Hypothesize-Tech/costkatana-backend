import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SuggestionOutcomeDocument = SuggestionOutcome & Document;

@Schema({
  timestamps: true,
  collection: 'suggestion_outcomes',
  // Keep suggestion outcomes for 6 months
  expires: 180 * 24 * 60 * 60, // 6 months in seconds
})
export class SuggestionOutcome {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  suggestionId: string;

  @Prop({ required: true })
  suggestionType: string;

  @Prop({ type: Boolean, required: true })
  userAcceptance: boolean;

  @Prop({ type: Number, default: 0 })
  costSaved: number;

  @Prop({ type: Boolean, default: true })
  qualityMaintained: boolean;

  @Prop({ type: Number, min: 1, max: 5, default: 3 })
  userRating: number;

  @Prop({ type: Boolean, default: false })
  errorOccurred: boolean;

  @Prop({ type: String })
  rejectionReason?: string;

  @Prop({
    type: {
      tokensUsed: Number,
      costIncurred: Number,
      responseQuality: Number,
    },
  })
  actualUsage?: {
    tokensUsed: number;
    costIncurred: number;
    responseQuality: number;
  };

  @Prop({
    type: {
      promptComplexity: Number,
      userTier: { type: String, enum: ['free', 'pro', 'enterprise'] },
      costBudget: { type: String, enum: ['low', 'medium', 'high'] },
      taskType: String,
      promptLength: Number,
    },
  })
  context: {
    promptComplexity: number;
    userTier: 'free' | 'pro' | 'enterprise';
    costBudget: 'low' | 'medium' | 'high';
    taskType: string;
    promptLength: number;
  };

  // TTL index will automatically delete old records
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const SuggestionOutcomeSchema =
  SchemaFactory.createForClass(SuggestionOutcome);

// Additional indexes for performance
SuggestionOutcomeSchema.index({ userId: 1, createdAt: -1 });
SuggestionOutcomeSchema.index({ suggestionType: 1, userAcceptance: 1 });
SuggestionOutcomeSchema.index({ createdAt: -1 });
SuggestionOutcomeSchema.index({ userId: 1, suggestionType: 1 });
