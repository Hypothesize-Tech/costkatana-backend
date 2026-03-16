import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

// User Memory Model - Stores general user memory and insights
export interface IModelPerformanceRating {
  rating: number;
  usageCount: number;
  lastUsed: Date;
}

export interface ITopicInterest {
  frequency: number;
  lastMentioned: Date;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface INotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  weeklyDigest: boolean;
  costAlerts: boolean;
  newFeatures: boolean;
}

export interface IPrivacySettings {
  shareData: boolean;
  trackUsage: boolean;
  personalizedRecommendations: boolean;
  retainConversations: boolean;
  allowModelTraining: boolean;
}

export interface IUsagePatterns {
  peakHours: number[];
  averageSessionLength: number;
  preferredQueryTypes: string[];
  responseTimePreference: number;
}

export type UserMemoryDocument = HydratedDocument<UserMemory>;

@Schema({ timestamps: true })
export class UserMemory {
  @Prop({ required: true })
  userId: string;

  @Prop({
    type: String,
    enum: ['preference', 'pattern', 'security', 'context', 'insight'],
    required: true,
  })
  memoryType: 'preference' | 'pattern' | 'security' | 'context' | 'insight';

  @Prop({ required: true, maxlength: 5000 })
  content: string;

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number;

  @Prop({ required: true, maxlength: 100 })
  source: string;

  @Prop([{ type: String, maxlength: 50 }])
  tags: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: any;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop()
  expiresAt?: Date;

  // Vector fields for semantic search
  @Prop([Number])
  semanticEmbedding?: number[]; // 1024 dimensions for Amazon Titan v2

  @Prop()
  vectorizedAt?: Date; // Timestamp when vectorization was completed

  @Prop({ maxlength: 2000 })
  semanticContent?: string; // The content that was actually embedded (may be processed/truncated)

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UserMemorySchema = SchemaFactory.createForClass(UserMemory);

// Compound indexes for efficient queries
UserMemorySchema.index({ userId: 1, memoryType: 1, isActive: 1 });

// Conversation Memory Model - Stores individual conversations for similarity search
export interface IConversationMetadata {
  timestamp: Date;
  modelUsed?: string;
  chatMode?: 'fastest' | 'cheapest' | 'balanced';
  cost?: number;
  responseTime?: number;
  queryLength: number;
  responseLength: number;
  topics?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  userSatisfaction?: number;
  [key: string]: any;
}

export type ConversationMemoryDocument = HydratedDocument<ConversationMemory>;

@Schema({ timestamps: true })
export class ConversationMemory {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  conversationId: string;

  @Prop({ required: true, maxlength: 10000 })
  query: string;

  @Prop({ required: true, maxlength: 50000 })
  response: string;

  @Prop([Number])
  queryEmbedding?: number[]; // 1024 dimensions for Amazon Titan v2

  @Prop([Number])
  responseEmbedding?: number[]; // 1024 dimensions for response vectorization

  @Prop()
  vectorizedAt?: Date; // Timestamp when vectorization was completed

  @Prop({
    type: {
      timestamp: { type: Date, required: true },
      modelUsed: String,
      chatMode: { type: String, enum: ['fastest', 'cheapest', 'balanced'] },
      cost: Number,
      responseTime: Number,
      queryLength: { type: Number, required: true },
      responseLength: { type: Number, required: true },
      topics: [String],
      sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
      userSatisfaction: { type: Number, min: 1, max: 5 },
    },
    required: false,
  })
  metadata?: IConversationMetadata;

  @Prop({ type: Boolean, default: false })
  isArchived: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ConversationMemorySchema =
  SchemaFactory.createForClass(ConversationMemory);

// User Preferences Model - Stores user preferences and learned behaviors
export type UserPreferenceDocument = HydratedDocument<UserPreference>;

@Schema({ timestamps: true })
export class UserPreference {
  @Prop({ required: true, unique: true })
  userId: string;

  @Prop({ maxlength: 100 })
  preferredModel?: string;

  @Prop({ type: String, enum: ['fastest', 'cheapest', 'balanced'] })
  preferredChatMode?: 'fastest' | 'cheapest' | 'balanced';

  @Prop({ maxlength: 50 })
  preferredStyle?: string;

  @Prop({
    type: String,
    enum: ['concise', 'detailed', 'comprehensive'],
    default: 'detailed',
  })
  responseLength?: 'concise' | 'detailed' | 'comprehensive';

  @Prop({
    type: String,
    enum: ['beginner', 'intermediate', 'expert'],
    default: 'intermediate',
  })
  technicalLevel?: 'beginner' | 'intermediate' | 'expert';

  @Prop([{ type: String, maxlength: 50 }])
  commonTopics: string[];

  @Prop({
    type: String,
    enum: ['cheap', 'balanced', 'premium'],
    default: 'balanced',
  })
  costPreference?: 'cheap' | 'balanced' | 'premium';

  // Learned preferences from interactions
  @Prop({
    type: Map,
    of: {
      rating: { type: Number, min: 1, max: 5 },
      usageCount: { type: Number, default: 0 },
      lastUsed: Date,
    },
    default: {},
  })
  modelPerformanceRatings: Map<string, IModelPerformanceRating>;

  @Prop({
    type: Map,
    of: {
      frequency: { type: Number, default: 1 },
      lastMentioned: Date,
      sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative'],
        default: 'neutral',
      },
    },
    default: {},
  })
  topicInterests: Map<string, ITopicInterest>;

  // Notification preferences
  @Prop({
    type: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      weeklyDigest: { type: Boolean, default: true },
      costAlerts: { type: Boolean, default: true },
      newFeatures: { type: Boolean, default: true },
    },
    required: false,
  })
  notificationPreferences?: INotificationPreferences;

  // Privacy settings
  @Prop({
    type: {
      shareData: { type: Boolean, default: false },
      trackUsage: { type: Boolean, default: true },
      personalizedRecommendations: { type: Boolean, default: true },
      retainConversations: { type: Boolean, default: true },
      allowModelTraining: { type: Boolean, default: false },
    },
    required: false,
  })
  privacySettings?: IPrivacySettings;

  // Usage patterns
  @Prop({
    type: {
      peakHours: [{ type: Number, min: 0, max: 23 }],
      averageSessionLength: { type: Number, default: 0 },
      preferredQueryTypes: [String],
      responseTimePreference: { type: Number, default: 30 }, // 30 seconds default
    },
    required: false,
  })
  usagePatterns?: IUsagePatterns;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UserPreferenceSchema =
  SchemaFactory.createForClass(UserPreference);

UserPreferenceSchema.index({ userId: 1, isActive: 1 });
UserPreferenceSchema.index({ commonTopics: 1 });
UserPreferenceSchema.index({ preferredModel: 1 });

// Memory Analytics Model
export interface IConversationStats {
  totalConversations: number;
  averageQueryLength: number;
  averageResponseLength: number;
  mostCommonTopics: string[];
  modelUsageDistribution: Map<string, number>;
  satisfactionScore: number;
}

export interface IBehaviorPatterns {
  peakUsageHours: number[];
  queryComplexityTrend: 'increasing' | 'decreasing' | 'stable';
  topicDiversityScore: number;
  engagementScore: number;
}

export interface ISecurityInsights {
  suspiciousPatternCount: number;
  riskLevel: 'low' | 'medium' | 'high';
  flaggedQueries: number;
}

export type MemoryAnalyticsDocument = HydratedDocument<MemoryAnalytics>;

@Schema({ timestamps: true })
export class MemoryAnalytics {
  @Prop({ required: true })
  userId: string;

  @Prop({
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true,
  })
  analyticsType: 'daily' | 'weekly' | 'monthly';

  @Prop({ required: true })
  period: Date;

  @Prop({
    type: {
      totalConversations: { type: Number, default: 0 },
      averageQueryLength: { type: Number, default: 0 },
      averageResponseLength: { type: Number, default: 0 },
      mostCommonTopics: [String],
      modelUsageDistribution: { type: Map, of: Number, default: {} },
      satisfactionScore: { type: Number, min: 1, max: 5, default: 3 },
    },
    required: false,
  })
  conversationStats?: IConversationStats;

  @Prop({
    type: {
      peakUsageHours: [Number],
      queryComplexityTrend: {
        type: String,
        enum: ['increasing', 'decreasing', 'stable'],
        default: 'stable',
      },
      topicDiversityScore: { type: Number, min: 0, max: 1, default: 0.5 },
      engagementScore: { type: Number, min: 0, max: 1, default: 0.5 },
    },
    required: false,
  })
  behaviorPatterns?: IBehaviorPatterns;

  @Prop({
    type: {
      suspiciousPatternCount: { type: Number, default: 0 },
      riskLevel: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low',
      },
      flaggedQueries: { type: Number, default: 0 },
    },
    required: false,
  })
  securityInsights?: ISecurityInsights;

  @Prop([String])
  recommendations: string[];

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const MemoryAnalyticsSchema =
  SchemaFactory.createForClass(MemoryAnalytics);

MemoryAnalyticsSchema.index({ userId: 1, analyticsType: 1, period: -1 });
