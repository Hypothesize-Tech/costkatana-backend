import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface AgentAction {
  actionType:
    | 'tool_call'
    | 'model_invocation'
    | 'agent_trace_step'
    | 'data_retrieval'
    | 'external_api'
    | 'decision_point';
  actionName: string;

  toolId?: string;
  modelId?: string;
  provider?: string;

  inputSummary?: string;
  inputTokens?: number;
  outputSummary?: string;
  outputTokens?: number;

  latencyMs: number;
  cost?: number;

  success: boolean;
  errorMessage?: string;
  errorType?: string;

  reasoning?: string;
  confidence?: number;
  alternatives?: string[];

  timestamp: Date;
}

export interface AgentCostBreakdown {
  totalCost: number;

  modelCosts: number;
  toolCosts: number;
  apiCosts: number;
  dataRetrievalCosts: number;

  planningCost: number;
  executionCost: number;
  validationCost: number;

  retriedActionsCost: number;
  abandonedPathsCost: number;
  redundantCallsCost: number;
}

export interface AgentPerformance {
  totalDurationMs: number;
  planningTimeMs: number;
  executionTimeMs: number;
  validationTimeMs: number;

  actionsAttempted: number;
  actionsSuccessful: number;
  actionsRetried: number;
  actionsFailed: number;

  goalAchieved: boolean;
  goalAchievementScore?: number;
  userSatisfaction?: number;

  totalTokens: number;
  avgTokensPerAction: number;
  peakMemoryMb?: number;
}

export interface AgentAnomaly {
  anomalyType:
    | 'infinite_loop'
    | 'excessive_retries'
    | 'high_cost'
    | 'low_success_rate'
    | 'redundant_actions'
    | 'timeout'
    | 'resource_waste';
  severity: 'low' | 'medium' | 'high' | 'critical';

  description: string;
  detectedAt: Date;

  affectedActions: number[];
  costImpact?: number;
  timeImpact?: number;

  suggestedFix?: string;
  autoFixable: boolean;
}

export interface AgentConfiguration {
  agentType:
    | 'chat'
    | 'agent_trace'
    | 'optimization'
    | 'analysis'
    | 'multi_agent'
    | 'custom';
  agentVersion?: string;

  primaryModel: string;
  fallbackModels?: string[];
  temperature?: number;
  maxIterations?: number;
  timeout?: number;

  availableTools: string[];

  maxCost?: number;
  maxDuration?: number;

  customSettings?: Record<string, any>;
}

export type AgentDecisionLogDocument = HydratedDocument<AgentDecisionLog>;

@Schema({ timestamps: true })
export class AgentDecisionLog {
  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ required: true, unique: true, index: true })
  agentSessionId: string;

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

  @Prop({ required: true, index: true })
  requestId: string;

  @Prop({ index: true })
  conversationId?: string;

  @Prop({
    type: {
      agentType: {
        type: String,
        required: true,
        enum: [
          'chat',
          'agent_trace',
          'optimization',
          'analysis',
          'multi_agent',
          'custom',
        ],
      },
      agentVersion: String,
      primaryModel: { type: String, required: true },
      fallbackModels: [String],
      temperature: Number,
      maxIterations: Number,
      timeout: Number,
      availableTools: { type: [String], required: true },
      maxCost: Number,
      maxDuration: Number,
      customSettings: mongoose.Schema.Types.Mixed,
    },
    required: true,
  })
  configuration: AgentConfiguration;

  @Prop({ required: true, maxlength: 1000 })
  userGoal: string;

  @Prop({ maxlength: 2000 })
  userInputSummary?: string;

  @Prop([
    {
      actionType: {
        type: String,
        required: true,
        enum: [
          'tool_call',
          'model_invocation',
          'agent_trace_step',
          'data_retrieval',
          'external_api',
          'decision_point',
        ],
      },
      actionName: { type: String, required: true },
      toolId: String,
      modelId: String,
      provider: String,
      inputSummary: { type: String, maxlength: 500 },
      inputTokens: Number,
      outputSummary: { type: String, maxlength: 500 },
      outputTokens: Number,
      latencyMs: { type: Number, required: true },
      cost: Number,
      success: { type: Boolean, required: true },
      errorMessage: String,
      errorType: String,
      reasoning: String,
      confidence: { type: Number, min: 0, max: 1 },
      alternatives: [String],
      timestamp: { type: Date, required: true },
    },
  ])
  actions: AgentAction[];

  @Prop({
    type: {
      totalDurationMs: { type: Number, required: true },
      planningTimeMs: { type: Number, required: true, default: 0 },
      executionTimeMs: { type: Number, required: true, default: 0 },
      validationTimeMs: { type: Number, required: true, default: 0 },
      actionsAttempted: { type: Number, required: true, default: 0 },
      actionsSuccessful: { type: Number, required: true, default: 0 },
      actionsRetried: { type: Number, required: true, default: 0 },
      actionsFailed: { type: Number, required: true, default: 0 },
      goalAchieved: { type: Boolean, required: true },
      goalAchievementScore: { type: Number, min: 0, max: 1 },
      userSatisfaction: { type: Number, min: 1, max: 5 },
      totalTokens: { type: Number, required: true, default: 0 },
      avgTokensPerAction: { type: Number, required: true, default: 0 },
      peakMemoryMb: Number,
    },
    required: true,
  })
  performance: AgentPerformance;

  @Prop({
    type: {
      totalCost: { type: Number, required: true, default: 0 },
      modelCosts: { type: Number, required: true, default: 0 },
      toolCosts: { type: Number, required: true, default: 0 },
      apiCosts: { type: Number, required: true, default: 0 },
      dataRetrievalCosts: { type: Number, required: true, default: 0 },
      planningCost: { type: Number, required: true, default: 0 },
      executionCost: { type: Number, required: true, default: 0 },
      validationCost: { type: Number, required: true, default: 0 },
      retriedActionsCost: { type: Number, required: true, default: 0 },
      abandonedPathsCost: { type: Number, required: true, default: 0 },
      redundantCallsCost: { type: Number, required: true, default: 0 },
    },
    required: true,
  })
  costBreakdown: AgentCostBreakdown;

  @Prop([
    {
      anomalyType: {
        type: String,
        required: true,
        enum: [
          'infinite_loop',
          'excessive_retries',
          'high_cost',
          'low_success_rate',
          'redundant_actions',
          'timeout',
          'resource_waste',
        ],
      },
      severity: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high', 'critical'],
      },
      description: { type: String, required: true },
      detectedAt: { type: Date, required: true },
      affectedActions: [Number],
      costImpact: Number,
      timeImpact: Number,
      suggestedFix: String,
      autoFixable: { type: Boolean, required: true, default: false },
    },
  ])
  anomalies: AgentAnomaly[];

  @Prop({
    type: {
      status: {
        type: String,
        required: true,
        enum: ['success', 'partial_success', 'failure', 'timeout', 'cancelled'],
      },
      result: { type: String, maxlength: 2000 },
      errorMessage: String,
      completeness: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        default: 0,
      },
      accuracy: { type: Number, required: true, min: 0, max: 1, default: 0 },
      relevance: { type: Number, required: true, min: 0, max: 1, default: 0 },
    },
    required: false,
  })
  outcome?: {
    status: 'success' | 'partial_success' | 'failure' | 'timeout' | 'cancelled';
    result?: string;
    errorMessage?: string;
    completeness: number;
    accuracy: number;
    relevance: number;
  };

  @Prop({
    type: {
      rating: { type: Number, min: 1, max: 5 },
      helpful: Boolean,
      feedback: String,
      reportedIssues: [String],
    },
    required: false,
  })
  userFeedback?: {
    rating?: number;
    helpful?: boolean;
    feedback?: string;
    reportedIssues?: string[];
  };

  @Prop({
    type: {
      efficiencyScore: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        default: 0.5,
      },
      costEfficiencyScore: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        default: 0.5,
      },
      qualityScore: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        default: 0.5,
      },
      reliabilityScore: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        default: 0.5,
      },
      improvementAreas: { type: [String], default: [] },
      estimatedSavingsPotential: Number,
    },
    required: true,
  })
  learningSignals: {
    efficiencyScore: number;
    costEfficiencyScore: number;
    qualityScore: number;
    reliabilityScore: number;
    improvementAreas: string[];
    estimatedSavingsPotential?: number;
  };

  @Prop({ required: true, index: true })
  startedAt: Date;

  @Prop({ required: true })
  completedAt: Date;

  @Prop({
    type: String,
    required: true,
    enum: ['production', 'staging', 'development'],
    default: 'production',
  })
  environment: 'production' | 'staging' | 'development';

  @Prop()
  clientVersion?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AgentDecisionLogSchema =
  SchemaFactory.createForClass(AgentDecisionLog);

// Compound indexes for common queries
AgentDecisionLogSchema.index({ userId: 1, startedAt: -1 });
AgentDecisionLogSchema.index({ agentId: 1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'configuration.agentType': 1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'outcome.status': 1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'costBreakdown.totalCost': -1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'performance.goalAchieved': 1, startedAt: -1 });

// Index for anomaly queries
AgentDecisionLogSchema.index({
  'anomalies.anomalyType': 1,
  'anomalies.severity': 1,
});
AgentDecisionLogSchema.index({ 'anomalies.severity': 1, startedAt: -1 });

// Index for learning queries
AgentDecisionLogSchema.index({ 'learningSignals.efficiencyScore': -1 });
AgentDecisionLogSchema.index({ 'learningSignals.costEfficiencyScore': -1 });

// TTL index for cleanup
const ttlDays = parseInt(process.env.AGENT_LOG_TTL_DAYS || '90');
AgentDecisionLogSchema.index(
  { startedAt: 1 },
  { expireAfterSeconds: ttlDays * 24 * 60 * 60 },
);
