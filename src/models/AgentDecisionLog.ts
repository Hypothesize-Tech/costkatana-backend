import mongoose, { Schema, Document } from 'mongoose';

/**
 * Tool or action chosen by the agent
 */
export interface AgentAction {
  actionType: 'tool_call' | 'model_invocation' | 'agent_trace_step' | 'data_retrieval' | 'external_api' | 'decision_point';
  actionName: string;
  
  // Tool/model details
  toolId?: string;
  modelId?: string;
  provider?: string;
  
  // Input/output
  inputSummary?: string; // Sanitized summary, not full prompt
  inputTokens?: number;
  outputSummary?: string;
  outputTokens?: number;
  
  // Performance
  latencyMs: number;
  cost?: number;
  
  // Result
  success: boolean;
  errorMessage?: string;
  errorType?: string;
  
  // Context
  reasoning?: string; // Agent's reasoning for this action
  confidence?: number; // 0-1, agent's confidence in this choice
  alternatives?: string[]; // Other actions considered
  
  timestamp: Date;
}

/**
 * Cost breakdown for agent execution
 */
export interface AgentCostBreakdown {
  totalCost: number;
  
  // Per-component costs
  modelCosts: number;
  toolCosts: number;
  apiCosts: number;
  dataRetrievalCosts: number;
  
  // Cost by phase
  planningCost: number;
  executionCost: number;
  validationCost: number;
  
  // Waste indicators
  retriedActionsCost: number;
  abandonedPathsCost: number;
  redundantCallsCost: number;
}

/**
 * Performance metrics for agent execution
 */
export interface AgentPerformance {
  // Timing
  totalDurationMs: number;
  planningTimeMs: number;
  executionTimeMs: number;
  validationTimeMs: number;
  
  // Efficiency
  actionsAttempted: number;
  actionsSuccessful: number;
  actionsRetried: number;
  actionsFailed: number;
  
  // Quality
  goalAchieved: boolean;
  goalAchievementScore?: number; // 0-1
  userSatisfaction?: number; // 1-5
  
  // Resource usage
  totalTokens: number;
  avgTokensPerAction: number;
  peakMemoryMb?: number;
}

/**
 * Detected inefficiency or problem pattern
 */
export interface AgentAnomaly {
  anomalyType: 'infinite_loop' | 'excessive_retries' | 'high_cost' | 'low_success_rate' | 'redundant_actions' | 'timeout' | 'resource_waste';
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  description: string;
  detectedAt: Date;
  
  // Evidence
  affectedActions: number[]; // Indices of actions in the actions array
  costImpact?: number;
  timeImpact?: number;
  
  // Recommendation
  suggestedFix?: string;
  autoFixable: boolean;
}

/**
 * Agent configuration at time of execution
 */
export interface AgentConfiguration {
  agentType: 'chat' | 'agent_trace' | 'optimization' | 'analysis' | 'multi_agent' | 'custom';
  agentVersion?: string;
  
  // Model configuration
  primaryModel: string;
  fallbackModels?: string[];
  temperature?: number;
  maxIterations?: number;
  timeout?: number;
  
  // Tools available
  availableTools: string[];
  
  // Constraints
  maxCost?: number;
  maxDuration?: number;
  
  // Custom settings
  customSettings?: Record<string, any>;
}

/**
 * Agent Decision Log Document
 * Tracks agent behavior, decisions, and outcomes for analysis and optimization
 */
export interface IAgentDecisionLog extends Document {
  // Agent identification
  agentId: string;
  agentSessionId: string; // Unique session/execution ID
  
  // User context
  userId: mongoose.Types.ObjectId;
  tenantId?: string;
  workspaceId?: string;
  
  // Request context
  requestId: string;
  conversationId?: string;
  
  // Agent configuration
  configuration: AgentConfiguration;
  
  // User input (sanitized)
  userGoal: string; // High-level goal description
  userInputSummary?: string; // Sanitized input summary
  
  // Actions taken by agent
  actions: AgentAction[];
  
  // Performance metrics
  performance: AgentPerformance;
  
  // Cost breakdown
  costBreakdown: AgentCostBreakdown;
  
  // Detected issues
  anomalies: AgentAnomaly[];
  
  // Final outcome
  outcome: {
    status: 'success' | 'partial_success' | 'failure' | 'timeout' | 'cancelled';
    result?: string; // Sanitized result summary
    errorMessage?: string;
    
    // Quality indicators
    completeness: number; // 0-1
    accuracy: number; // 0-1
    relevance: number; // 0-1
  };
  
  // User feedback
  userFeedback?: {
    rating?: number; // 1-5
    helpful?: boolean;
    feedback?: string;
    reportedIssues?: string[];
  };
  
  // Learning signals
  learningSignals: {
    efficiencyScore: number; // 0-1, higher = more efficient
    costEfficiencyScore: number; // 0-1, cost relative to value
    qualityScore: number; // 0-1, based on outcome quality
    reliabilityScore: number; // 0-1, success rate of actions
    
    // Recommendations for improvement
    improvementAreas: string[];
    estimatedSavingsPotential?: number;
  };
  
  // Timestamps
  startedAt: Date;
  completedAt: Date;
  
  // Metadata
  environment: 'production' | 'staging' | 'development';
  clientVersion?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const AgentActionSchema = new Schema({
  actionType: {
    type: String,
    required: true,
    enum: ['tool_call', 'model_invocation', 'agent_trace_step', 'data_retrieval', 'external_api', 'decision_point']
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
  timestamp: { type: Date, required: true }
}, { _id: false });

const AgentCostBreakdownSchema = new Schema({
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
  redundantCallsCost: { type: Number, required: true, default: 0 }
}, { _id: false });

const AgentPerformanceSchema = new Schema({
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
  peakMemoryMb: Number
}, { _id: false });

const AgentAnomalySchema = new Schema({
  anomalyType: {
    type: String,
    required: true,
    enum: ['infinite_loop', 'excessive_retries', 'high_cost', 'low_success_rate', 'redundant_actions', 'timeout', 'resource_waste']
  },
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical']
  },
  description: { type: String, required: true },
  detectedAt: { type: Date, required: true },
  affectedActions: [Number],
  costImpact: Number,
  timeImpact: Number,
  suggestedFix: String,
  autoFixable: { type: Boolean, required: true, default: false }
}, { _id: false });

const AgentConfigurationSchema = new Schema({
  agentType: {
    type: String,
    required: true,
    enum: ['chat', 'agent_trace', 'optimization', 'analysis', 'multi_agent', 'custom']
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
  customSettings: Schema.Types.Mixed
}, { _id: false });

const AgentDecisionLogSchema = new Schema<IAgentDecisionLog>({
  agentId: {
    type: String,
    required: true,
    index: true
  },
  agentSessionId: {
    type: String,
    required: true,
    unique: true,
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
  
  requestId: {
    type: String,
    required: true,
    index: true
  },
  conversationId: { type: String, index: true },
  
  configuration: {
    type: AgentConfigurationSchema,
    required: true
  },
  
  userGoal: {
    type: String,
    required: true,
    maxlength: 1000
  },
  userInputSummary: {
    type: String,
    maxlength: 2000
  },
  
  actions: {
    type: [AgentActionSchema],
    required: true,
    default: []
  },
  
  performance: {
    type: AgentPerformanceSchema,
    required: true
  },
  
  costBreakdown: {
    type: AgentCostBreakdownSchema,
    required: true
  },
  
  anomalies: {
    type: [AgentAnomalySchema],
    default: []
  },
  
  outcome: {
    status: {
      type: String,
      required: true,
      enum: ['success', 'partial_success', 'failure', 'timeout', 'cancelled']
    },
    result: { type: String, maxlength: 2000 },
    errorMessage: String,
    completeness: { type: Number, required: true, min: 0, max: 1, default: 0 },
    accuracy: { type: Number, required: true, min: 0, max: 1, default: 0 },
    relevance: { type: Number, required: true, min: 0, max: 1, default: 0 }
  },
  
  userFeedback: {
    rating: { type: Number, min: 1, max: 5 },
    helpful: Boolean,
    feedback: String,
    reportedIssues: [String]
  },
  
  learningSignals: {
    efficiencyScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
    costEfficiencyScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
    qualityScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
    reliabilityScore: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
    improvementAreas: { type: [String], default: [] },
    estimatedSavingsPotential: Number
  },
  
  startedAt: {
    type: Date,
    required: true,
    index: true
  },
  completedAt: {
    type: Date,
    required: true
  },
  
  environment: {
    type: String,
    required: true,
    enum: ['production', 'staging', 'development'],
    default: 'production'
  },
  clientVersion: String
}, {
  timestamps: true
});

// Compound indexes for common queries
AgentDecisionLogSchema.index({ userId: 1, startedAt: -1 });
AgentDecisionLogSchema.index({ agentId: 1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'configuration.agentType': 1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'outcome.status': 1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'costBreakdown.totalCost': -1, startedAt: -1 });
AgentDecisionLogSchema.index({ 'performance.goalAchieved': 1, startedAt: -1 });

// Index for anomaly queries
AgentDecisionLogSchema.index({ 'anomalies.anomalyType': 1, 'anomalies.severity': 1 });
AgentDecisionLogSchema.index({ 'anomalies.severity': 1, startedAt: -1 });

// Index for learning queries
AgentDecisionLogSchema.index({ 'learningSignals.efficiencyScore': -1 });
AgentDecisionLogSchema.index({ 'learningSignals.costEfficiencyScore': -1 });

// TTL index for cleanup (optional, default 90 days)
const ttlDays = parseInt(process.env.AGENT_LOG_TTL_DAYS || '90');
AgentDecisionLogSchema.index({ startedAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });

export const AgentDecisionLog = mongoose.model<IAgentDecisionLog>(
  'AgentDecisionLog',
  AgentDecisionLogSchema
);

