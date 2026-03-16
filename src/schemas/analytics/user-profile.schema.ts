import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserProfileDocument = UserProfile & Document;

@Schema({
  timestamps: true,
  collection: 'user_profiles',
  // Keep user profiles for 1 year
  expires: 365 * 24 * 60 * 60, // 1 year in seconds
})
export class UserProfile {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ type: Number, default: 0.5 })
  promptComplexity: number;

  @Prop({ type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' })
  userTier: 'free' | 'pro' | 'enterprise';

  @Prop({ type: String, enum: ['low', 'medium', 'high'], default: 'medium' })
  costBudget: 'low' | 'medium' | 'high';

  @Prop({ type: String, default: 'general' })
  taskType: string;

  @Prop({ type: Number, default: 100 })
  promptLength: number;

  @Prop({ type: [String], default: [] })
  previousSuggestions: string[];

  @Prop({ type: Number, default: 0.5 })
  acceptanceRate: number;

  @Prop({ type: Number, default: 0 })
  totalSuggestionsShown: number;

  @Prop({ type: Number, default: 0 })
  totalSuggestionsAccepted: number;

  @Prop({ type: Date })
  lastUpdated: Date;

  // TTL index will automatically delete old records
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);

// Additional indexes for performance
UserProfileSchema.index({ userId: 1 }, { unique: true });
UserProfileSchema.index({ userTier: 1, taskType: 1 });
UserProfileSchema.index({ lastUpdated: -1 });
