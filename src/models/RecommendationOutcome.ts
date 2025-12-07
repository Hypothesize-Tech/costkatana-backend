import mongoose, { Schema, Document } from 'mongoose';

/**
 * Recommendation context when the recommendation was made
 */
export interface RecommendationContext {
  // What triggered the recommendation
  trigger: 'usage_pattern' | 'cost_spike' | 'performance_degradation' | 'new_model_available' | 'manual_analysis' | 'scheduled_review';
  
  // Context at time of recommendation
  userBehavior?: {
    costSensitivity: 'low' | 'medium' | 'high';
    qualityTolerance: 'low' | 'medium' | 'high';
    riskTolerance: 'low' | 'medium' | 'high';
    avgCostPerDay: number;
    avgRequestsPerDay: number;
  };
  
  // Model performance at time of recommendation
  currentModel?: {
    modelId: string;
    avgLatency: number;
    avgCost: number;
    failureRate: number;
  };
  
  suggestedModel?: {
    modelId: string;
    expectedLatency: number;
    expectedCost: number;
    expectedSavings: number;
  };
  
  // Additional context
  metadata?: Record<string, any>;
}

/**
 * User interaction with the recommendation
 */
export interface UserInteraction {
  status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'dismissed' | 'ignored';
  
  viewedAt?: Date;
  respondedAt?: Date;
  
  // User feedback
  feedback?: string;
  rating?: number; // 1-5
  
  // Acceptance details
  acceptanceReason?: string;
  rejectionReason?: string;
  
  // Time to decision
  decisionTimeSeconds?: number;
}

/**
 * Actual outcome after recommendation was accepted/applied
 */
export interface ActualOutcome {
  // Performance metrics
  actualLatency?: number;
  actualCost?: number;
  actualFailureRate?: number;
  actualSavings?: number;
  
  // Success indicators
  success: boolean;
  successScore?: number; // 0-1 composite score
  
  // Error tracking
  errors?: Array<{
    type: string;
    message: string;
    timestamp: Date;
    resolved: boolean;
  }>;
  
  // User satisfaction
  userSatisfaction?: number; // 1-5
  userRetainedChange?: boolean; // Did user keep the change or revert?
  
  // Measurement period
  measurementStart: Date;
  measurementEnd: Date;
  sampleSize: number;
}

/**
 * Weight updates resulting from this outcome
 */
export interface WeightUpdate {
  entityType: 'model' | 'routing_strategy' | 'optimization_technique' | 'recommendation_type';
  entityId: string;
  
  previousWeight: number;
  newWeight: number;
  deltaWeight: number;
  
  reason: string;
  confidence: number; // 0-1
  appliedAt: Date;
}

/**
 * Recommendation Outcome Document
 * Tracks what happened after a recommendation was made
 */
export interface IRecommendationOutcome extends Document {
  // Link to original recommendation
  recommendationId: mongoose.Types.ObjectId;
  recommendationType: 'model_switch' | 'prompt_optimization' | 'usage_pattern' | 'cost_alert' | 'efficiency_tip' | 'caching_strategy' | 'routing_change';
  
  // User context
  userId: mongoose.Types.ObjectId;
  tenantId?: string;
  workspaceId?: string;
  
  // Recommendation context
  context: RecommendationContext;
  
  // User interaction
  interaction: UserInteraction;
  
  // Actual outcome (populated after measurement period)
  outcome?: ActualOutcome;
  
  // Weight updates triggered by this outcome
  weightUpdates: WeightUpdate[];
  
  // Learning signals
  learningSignals: {
    recommendationQuality: number; // 0-1, how good was the recommendation
    predictionAccuracy: number; // 0-1, how accurate was the expected outcome
    userTrust: number; // 0-1, confidence user has in recommendations
    systemLearning: number; // 0-1, how much the system learned from this
  };
  
  // Timestamps
  recommendedAt: Date;
  outcomeRecordedAt?: Date;
  learningAppliedAt?: Date;
  
  // Metadata
  isTestRecommendation?: boolean; // For A/B testing
  experimentId?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const RecommendationContextSchema = new Schema({
  trigger: {
    type: String,
    required: true,
    enum: ['usage_pattern', 'cost_spike', 'performance_degradation', 'new_model_available', 'manual_analysis', 'scheduled_review']
  },
  userBehavior: {
    costSensitivity: { type: String, enum: ['low', 'medium', 'high'] },
    qualityTolerance: { type: String, enum: ['low', 'medium', 'high'] },
    riskTolerance: { type: String, enum: ['low', 'medium', 'high'] },
    avgCostPerDay: Number,
    avgRequestsPerDay: Number
  },
  currentModel: {
    modelId: String,
    avgLatency: Number,
    avgCost: Number,
    failureRate: Number
  },
  suggestedModel: {
    modelId: String,
    expectedLatency: Number,
    expectedCost: Number,
    expectedSavings: Number
  },
  metadata: Schema.Types.Mixed
}, { _id: false });

const UserInteractionSchema = new Schema({
  status: {
    type: String,
    required: true,
    enum: ['pending', 'viewed', 'accepted', 'rejected', 'dismissed', 'ignored'],
    default: 'pending',
    index: true
  },
  viewedAt: Date,
  respondedAt: Date,
  feedback: String,
  rating: { type: Number, min: 1, max: 5 },
  acceptanceReason: String,
  rejectionReason: String,
  decisionTimeSeconds: Number
}, { _id: false });

const ActualOutcomeSchema = new Schema({
  actualLatency: Number,
  actualCost: Number,
  actualFailureRate: Number,
  actualSavings: Number,
  success: { type: Boolean, required: true },
  successScore: { type: Number, min: 0, max: 1 },
  errors: [{
    type: String,
    message: String,
    timestamp: Date,
    resolved: Boolean
  }],
  userSatisfaction: { type: Number, min: 1, max: 5 },
  userRetainedChange: Boolean,
  measurementStart: { type: Date, required: true },
  measurementEnd: { type: Date, required: true },
  sampleSize: { type: Number, required: true }
}, { _id: false });

const WeightUpdateSchema = new Schema({
  entityType: {
    type: String,
    required: true,
    enum: ['model', 'routing_strategy', 'optimization_technique', 'recommendation_type']
  },
  entityId: { type: String, required: true },
  previousWeight: { type: Number, required: true },
  newWeight: { type: Number, required: true },
  deltaWeight: { type: Number, required: true },
  reason: { type: String, required: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  appliedAt: { type: Date, required: true, default: Date.now }
}, { _id: false });

const RecommendationOutcomeSchema = new Schema<IRecommendationOutcome>({
  recommendationId: {
    type: Schema.Types.ObjectId,
    ref: 'AIRecommendation',
    required: true,
    index: true
  },
  recommendationType: {
    type: String,
    required: true,
    enum: ['model_switch', 'prompt_optimization', 'usage_pattern', 'cost_alert', 'efficiency_tip', 'caching_strategy', 'routing_change'],
    index: true
  },
  
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tenantId: { type: String, index: true },
  workspaceId: { type: String, index: true },
  
  context: {
    type: RecommendationContextSchema,
    required: true
  },
  
  interaction: {
    type: UserInteractionSchema,
    required: true
  },
  
  outcome: ActualOutcomeSchema,
  
  weightUpdates: {
    type: [WeightUpdateSchema],
    default: []
  },
  
  learningSignals: {
    recommendationQuality: { type: Number, required: true, default: 0.5, min: 0, max: 1 },
    predictionAccuracy: { type: Number, required: true, default: 0.5, min: 0, max: 1 },
    userTrust: { type: Number, required: true, default: 0.5, min: 0, max: 1 },
    systemLearning: { type: Number, required: true, default: 0.5, min: 0, max: 1 }
  },
  
  recommendedAt: {
    type: Date,
    required: true,
    index: true
  },
  outcomeRecordedAt: Date,
  learningAppliedAt: Date,
  
  isTestRecommendation: {
    type: Boolean,
    default: false
  },
  experimentId: String
}, {
  timestamps: true
});

// Compound indexes for common queries
RecommendationOutcomeSchema.index({ userId: 1, recommendedAt: -1 });
RecommendationOutcomeSchema.index({ recommendationType: 1, 'interaction.status': 1 });
RecommendationOutcomeSchema.index({ 'interaction.status': 1, recommendedAt: -1 });
RecommendationOutcomeSchema.index({ 'outcome.success': 1, recommendationType: 1 });
RecommendationOutcomeSchema.index({ tenantId: 1, recommendedAt: -1 });

// Index for learning signal queries
RecommendationOutcomeSchema.index({ 'learningSignals.recommendationQuality': -1 });
RecommendationOutcomeSchema.index({ 'learningSignals.predictionAccuracy': -1 });

export const RecommendationOutcome = mongoose.model<IRecommendationOutcome>(
  'RecommendationOutcome',
  RecommendationOutcomeSchema
);

