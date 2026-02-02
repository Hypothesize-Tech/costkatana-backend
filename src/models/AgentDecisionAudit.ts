import mongoose, { Document, Schema } from 'mongoose';

/**
 * Alternative Considered - Track alternatives for decision transparency
 */
export interface IAlternativeConsidered {
  option: string;
  reasoning: string;
  estimatedCost?: number;
  estimatedLatency?: number;
  estimatedQuality?: number;  // 🆕 Quality impact 0-1
  confidenceScore?: number;
  rejectionReason: string;
  tradeoffAnalysis?: string;  // 🆕 Explicit tradeoff description
}

/**
 * Strategic Tradeoff - Document cost vs performance vs quality tradeoffs
 * 
 * RATIONALE: Make strategic reasoning explicit in decision audit trail
 * TRADEOFF: Slightly more storage vs Complete architectural visibility
 */
export interface IStrategicTradeoff {
  tradeoffType: 'cost_vs_latency' | 'cost_vs_quality' | 'latency_vs_quality' | 'all_three';
  
  // Weights applied (sum should be ~1.0)
  costWeight: number;      // 0-1
  latencyWeight: number;   // 0-1
  qualityWeight: number;   // 0-1
  
  // Quantified impact
  costImpact: {
    estimated: number;     // USD
    actual?: number;       // USD
    savings?: number;      // USD (negative = increased cost)
  };
  
  latencyImpact: {
    estimated: number;     // milliseconds
    actual?: number;       // milliseconds
    overhead?: number;     // milliseconds
  };
  
  qualityImpact: {
    estimated: number;     // 0-1 score
    actual?: number;       // 0-1 score
    degradation?: number;  // 0-1 (negative = improvement)
  };
  
  // Strategic justification
  strategy: 'cost_optimized' | 'speed_optimized' | 'quality_optimized' | 'balanced';
  rationale: string;
  policyReference?: string;  // e.g., "strategicPolicies.config.ts#ROUTING_STRATEGY_POLICIES"
}

/**
 * Architectural Decision Reference - Link to ADRs
 */
export interface IArchitecturalDecisionReference {
  adrNumber: string;        // e.g., "ADR-003"
  adrTitle: string;         // e.g., "Cortex Meta-Language for Token Reduction"
  decisionDate: Date;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  relevance: string;        // Why this ADR is relevant to this decision
}

/**
 * Decision Impact Assessment
 */
export interface IDecisionImpact {
  costImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  performanceImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  securityImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  userExperienceImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Execution Context - Detailed context of the decision execution
 */
export interface IExecutionContext {
  executionId: string;
  sandboxId?: string;
  processId?: number;
  containerId?: string;
  
  // Resource usage
  cpuUsagePercent?: number;
  memoryUsageMB?: number;
  diskUsageMB?: number;
  networkBytesSent?: number;
  networkBytesReceived?: number;
  
  // Timing
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  queueTimeMs?: number;
  
  // Cost
  estimatedCost?: number;
  actualCost?: number;
  costBreakdown?: {
    inputTokensCost: number;
    outputTokensCost: number;
    computeCost: number;
    storageCost: number;
  };
  
  // Tokens
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  
  // Status
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'killed';
  exitCode?: number;
  errorMessage?: string;
  errorStack?: string;
}

/**
 * Human Review - Track human oversight and approvals
 */
export interface IHumanReview {
  reviewerId: mongoose.Types.ObjectId;
  reviewerEmail: string;
  reviewerName: string;
  
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'escalated';
  reviewedAt?: Date;
  reviewComments?: string;
  
  approvalRequired: boolean;
  approvalGranted?: boolean;
  approvalReason?: string;
}

/**
 * Agent Decision Audit - Comprehensive audit trail for agent decisions
 * Enables post-mortem analysis, compliance, and debugging
 */
export interface IAgentDecisionAudit extends Document {
  // Identity
  decisionId: string;
  agentId: string;
  agentIdentityId: mongoose.Types.ObjectId;
  
  // Context
  userId: mongoose.Types.ObjectId;
  workspaceId?: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  
  // Decision classification
  decisionType: 
    | 'model_selection' 
    | 'action_execution' 
    | 'resource_allocation' 
    | 'capability_invocation'
    | 'data_access'
    | 'api_call'
    | 'agent_trace_step'
    | 'optimization'
    | 'other';
  
  decisionCategory: 'operational' | 'strategic' | 'tactical' | 'emergency';
  
  // Decision details
  decision: string; // The actual decision made
  reasoning: string; // Why this decision was made
  alternativesConsidered: IAlternativeConsidered[];
  
  // 🆕 Strategic reasoning
  strategicTradeoff?: IStrategicTradeoff;
  architecturalDecisions?: IArchitecturalDecisionReference[];
  policyCompliance?: {
    policiesApplied: string[];     // e.g., ["cortexOperation", "fallbackPricing"]
    policyOverrides?: string[];    // Policies explicitly overridden
    complianceScore: number;       // 0-1, how well decision follows policy
  };
  
  // Confidence and certainty
  confidenceScore: number; // 0-1, how confident the agent is
  uncertaintyFactors?: string[]; // What factors introduce uncertainty
  
  // Control and governance
  humanOverrideable: boolean; // Can a human override this decision?
  reversible: boolean; // Can this decision be reversed?
  requiresApproval: boolean; // Does this need human approval?
  autoApproved: boolean; // Was this auto-approved based on rules?
  
  // Risk assessment
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  impactAssessment?: IDecisionImpact;
  mitigationStrategies?: string[];
  
  // Execution
  executionContext: IExecutionContext;
  
  // Inputs that influenced the decision
  inputData?: {
    prompt?: string;
    context?: any;
    parameters?: Record<string, any>;
    userIntent?: string;
  };
  
  // Output and result
  outputData?: {
    result?: any;
    modelResponse?: string;
    actionsTaken?: string[];
    sideEffects?: string[];
  };
  
  // Human oversight
  humanReview?: IHumanReview;
  
  // Audit trail
  timestamp: Date;
  correlationId?: string; // Link related decisions
  parentDecisionId?: string; // For hierarchical decisions
  childDecisionIds?: string[];
  
  // Compliance and legal
  complianceFlags?: string[]; // GDPR, HIPAA, SOC2, etc.
  legalHold?: boolean;
  retentionOverride?: boolean;
  
  // Learning and improvement
  feedbackScore?: number; // User feedback on decision quality
  feedbackComments?: string;
  wasSuccessful?: boolean;
  successMetrics?: Record<string, number>;
  
  // Metadata
  tags?: string[];
  customMetadata?: Record<string, any>;
}

const AlternativeConsideredSchema = new Schema<IAlternativeConsidered>({
  option: { type: String, required: true },
  reasoning: { type: String, required: true },
  estimatedCost: Number,
  estimatedLatency: Number,
  estimatedQuality: Number,  // 🆕 Quality impact
  confidenceScore: { type: Number, min: 0, max: 1 },
  rejectionReason: { type: String, required: true },
  tradeoffAnalysis: String   // 🆕 Explicit tradeoff
}, { _id: false });

const StrategicTradeoffSchema = new Schema({
  tradeoffType: { 
    type: String, 
    enum: ['cost_vs_latency', 'cost_vs_quality', 'latency_vs_quality', 'all_three'],
    required: true 
  },
  
  costWeight: { type: Number, min: 0, max: 1 },
  latencyWeight: { type: Number, min: 0, max: 1 },
  qualityWeight: { type: Number, min: 0, max: 1 },
  
  costImpact: {
    estimated: Number,
    actual: Number,
    savings: Number
  },
  
  latencyImpact: {
    estimated: Number,
    actual: Number,
    overhead: Number
  },
  
  qualityImpact: {
    estimated: Number,
    actual: Number,
    degradation: Number
  },
  
  strategy: { 
    type: String,
    enum: ['cost_optimized', 'speed_optimized', 'quality_optimized', 'balanced'],
    required: true
  },
  rationale: { type: String, required: true },
  policyReference: String
}, { _id: false });

const ArchitecturalDecisionReferenceSchema = new Schema({
  adrNumber: { type: String, required: true },
  adrTitle: { type: String, required: true },
  decisionDate: { type: Date, required: true },
  status: {
    type: String,
    enum: ['proposed', 'accepted', 'deprecated', 'superseded'],
    required: true
  },
  relevance: { type: String, required: true }
}, { _id: false });

const DecisionImpactSchema = new Schema<IDecisionImpact>({
  costImpact: { 
    type: String, 
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  performanceImpact: { 
    type: String, 
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  securityImpact: { 
    type: String, 
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  userExperienceImpact: { 
    type: String, 
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  overallRiskLevel: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'],
    required: true
  }
}, { _id: false });

const ExecutionContextSchema = new Schema<IExecutionContext>({
  executionId: { type: String, required: true },
  sandboxId: String,
  processId: Number,
  containerId: String,
  
  // Resource usage
  cpuUsagePercent: Number,
  memoryUsageMB: Number,
  diskUsageMB: Number,
  networkBytesSent: Number,
  networkBytesReceived: Number,
  
  // Timing
  startTime: { type: Date, required: true },
  endTime: Date,
  durationMs: Number,
  queueTimeMs: Number,
  
  // Cost
  estimatedCost: Number,
  actualCost: Number,
  costBreakdown: {
    inputTokensCost: Number,
    outputTokensCost: Number,
    computeCost: Number,
    storageCost: Number
  },
  
  // Tokens
  inputTokens: Number,
  outputTokens: Number,
  totalTokens: Number,
  
  // Status
  status: { 
    type: String, 
    enum: ['pending', 'running', 'completed', 'failed', 'timeout', 'killed'],
    required: true
  },
  exitCode: Number,
  errorMessage: String,
  errorStack: String
}, { _id: false });

const HumanReviewSchema = new Schema<IHumanReview>({
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerEmail: { type: String, required: true },
  reviewerName: { type: String, required: true },
  
  reviewStatus: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'escalated'],
    required: true,
    default: 'pending'
  },
  reviewedAt: Date,
  reviewComments: String,
  
  approvalRequired: { type: Boolean, required: true },
  approvalGranted: Boolean,
  approvalReason: String
}, { _id: false });

const AgentDecisionAuditSchema = new Schema<IAgentDecisionAudit>({
  // Identity
  decisionId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  agentId: { 
    type: String, 
    required: true,
    index: true 
  },
  agentIdentityId: { 
    type: Schema.Types.ObjectId, 
    ref: 'AgentIdentity', 
    required: true,
    index: true 
  },
  
  // Context
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  workspaceId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Workspace',
    index: true 
  },
  organizationId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Organization',
    index: true 
  },
  projectId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Project',
    index: true 
  },
  
  // Decision classification
  decisionType: { 
    type: String, 
    enum: [
      'model_selection', 
      'action_execution', 
      'resource_allocation', 
      'capability_invocation',
      'data_access',
      'api_call',
      'agent_trace_step',
      'optimization',
      'other'
    ],
    required: true,
    index: true
  },
  
  decisionCategory: { 
    type: String, 
    enum: ['operational', 'strategic', 'tactical', 'emergency'],
    required: true,
    default: 'operational'
  },
  
  // Decision details
  decision: { type: String, required: true },
  reasoning: { type: String, required: true },
  alternativesConsidered: [AlternativeConsideredSchema],
  
  // 🆕 Strategic reasoning
  strategicTradeoff: StrategicTradeoffSchema,
  architecturalDecisions: [ArchitecturalDecisionReferenceSchema],
  policyCompliance: {
    policiesApplied: [String],
    policyOverrides: [String],
    complianceScore: { type: Number, min: 0, max: 1 }
  },
  
  // Confidence
  confidenceScore: { 
    type: Number, 
    required: true,
    min: 0,
    max: 1,
    index: true
  },
  uncertaintyFactors: [String],
  
  // Control
  humanOverrideable: { type: Boolean, required: true, default: true },
  reversible: { type: Boolean, required: true, default: true },
  requiresApproval: { type: Boolean, required: true, default: false },
  autoApproved: { type: Boolean, default: false },
  
  // Risk
  riskLevel: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
    index: true
  },
  impactAssessment: DecisionImpactSchema,
  mitigationStrategies: [String],
  
  // Execution
  executionContext: { 
    type: ExecutionContextSchema, 
    required: true 
  },
  
  // Data
  inputData: {
    prompt: String,
    context: Schema.Types.Mixed,
    parameters: Schema.Types.Mixed,
    userIntent: String
  },
  
  outputData: {
    result: Schema.Types.Mixed,
    modelResponse: String,
    actionsTaken: [String],
    sideEffects: [String]
  },
  
  // Human oversight
  humanReview: HumanReviewSchema,
  
  // Audit
  timestamp: { 
    type: Date, 
    required: true, 
    default: Date.now,
    index: true 
  },
  correlationId: { 
    type: String,
    index: true 
  },
  parentDecisionId: { 
    type: String,
    index: true 
  },
  childDecisionIds: [String],
  
  // Compliance
  complianceFlags: [String],
  legalHold: { type: Boolean, default: false },
  retentionOverride: { type: Boolean, default: false },
  
  // Learning
  feedbackScore: { type: Number, min: 0, max: 5 },
  feedbackComments: String,
  wasSuccessful: Boolean,
  successMetrics: Schema.Types.Mixed,
  
  // Metadata
  tags: [String],
  customMetadata: Schema.Types.Mixed
}, {
  timestamps: true,
  collection: 'agent_decision_audits'
});

// Compound indexes for common queries
AgentDecisionAuditSchema.index({ agentId: 1, timestamp: -1 });
AgentDecisionAuditSchema.index({ userId: 1, timestamp: -1 });
AgentDecisionAuditSchema.index({ decisionType: 1, riskLevel: 1, timestamp: -1 });
AgentDecisionAuditSchema.index({ 'executionContext.status': 1, timestamp: -1 });
AgentDecisionAuditSchema.index({ 'humanReview.reviewStatus': 1 });
AgentDecisionAuditSchema.index({ legalHold: 1 }, { sparse: true });

// TTL index for automatic cleanup (based on retention)
// Note: Actual retention handled by application logic for compliance
AgentDecisionAuditSchema.index({ timestamp: 1 }, { expireAfterSeconds: 220752000 }); // 7 years

// Instance methods
AgentDecisionAuditSchema.methods.requiresHumanReview = function(): boolean {
  return this.requiresApproval && 
         (!this.humanReview || this.humanReview.reviewStatus === 'pending');
};

AgentDecisionAuditSchema.methods.isHighRisk = function(): boolean {
  return this.riskLevel === 'high' || this.riskLevel === 'critical';
};

AgentDecisionAuditSchema.methods.canBeReversed = function(): boolean {
  return this.reversible && 
         this.executionContext.status === 'completed' &&
         !this.legalHold;
};

export const AgentDecisionAudit = mongoose.model<IAgentDecisionAudit>(
  'AgentDecisionAudit', 
  AgentDecisionAuditSchema
);

