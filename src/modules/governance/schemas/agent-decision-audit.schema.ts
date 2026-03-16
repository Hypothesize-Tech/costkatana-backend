import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export interface IAlternativeConsidered {
  option: string;
  reasoning: string;
  estimatedCost?: number;
  estimatedLatency?: number;
  estimatedQuality?: number;
  confidenceScore?: number;
  rejectionReason: string;
  tradeoffAnalysis?: string;
}

export interface IStrategicTradeoff {
  tradeoffType:
    | 'cost_vs_latency'
    | 'cost_vs_quality'
    | 'latency_vs_quality'
    | 'all_three';

  // Weights applied (sum should be ~1.0)
  costWeight: number;
  latencyWeight: number;
  qualityWeight: number;

  // Quantified impact
  costImpact: {
    estimated: number;
    actual?: number;
    savings?: number;
  };

  latencyImpact: {
    estimated: number;
    actual?: number;
    overhead?: number;
  };

  qualityImpact: {
    estimated: number;
    actual?: number;
    degradation?: number;
  };

  // Strategic justification
  strategy:
    | 'cost_optimized'
    | 'speed_optimized'
    | 'quality_optimized'
    | 'balanced';
  rationale: string;
  policyReference?: string;
}

export interface IArchitecturalDecisionReference {
  adrNumber: string;
  adrTitle: string;
  decisionDate: Date;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  relevance: string;
}

export interface IDecisionImpact {
  costImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  performanceImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  securityImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  userExperienceImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

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
  /** Whether the execution succeeded (e.g. for authentication decisions) */
  success?: boolean;
  exitCode?: number;
  errorMessage?: string;
  errorStack?: string;
}

export interface IHumanReview {
  reviewerId: Types.ObjectId;
  reviewerEmail: string;
  reviewerName: string;

  reviewStatus: 'pending' | 'approved' | 'rejected' | 'escalated';
  reviewedAt?: Date;
  reviewComments?: string;

  approvalRequired: boolean;
  approvalGranted?: boolean;
  approvalReason?: string;
}

export type IAgentDecisionAudit = Document & {
  // Identity
  decisionId: string;
  agentId: string;
  agentIdentityId: Types.ObjectId;

  // Context
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
  projectId?: Types.ObjectId;

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
    | 'authentication'
    | 'other';

  decisionCategory: 'operational' | 'strategic' | 'tactical' | 'emergency';

  // Decision details
  decision: string;
  reasoning: string;
  alternativesConsidered: IAlternativeConsidered[];

  // Strategic reasoning
  strategicTradeoff?: IStrategicTradeoff;
  architecturalDecisions?: IArchitecturalDecisionReference[];
  policyCompliance?: {
    policiesApplied: string[];
    policyOverrides?: string[];
    complianceScore: number;
  };

  // Confidence and certainty
  confidenceScore: number;
  uncertaintyFactors?: string[];

  // Control and governance
  humanOverrideable: boolean;
  reversible: boolean;
  requiresApproval: boolean;
  autoApproved: boolean;

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
  correlationId?: string;
  parentDecisionId?: string;
  childDecisionIds?: string[];

  // Compliance and legal
  complianceFlags?: string[];
  legalHold?: boolean;
  retentionOverride?: boolean;

  // Learning and improvement
  feedbackScore?: number;
  feedbackComments?: string;
  wasSuccessful?: boolean;
  successMetrics?: Record<string, number>;

  // Metadata
  tags?: string[];
  customMetadata?: Record<string, any>;
};

@Schema({ _id: false })
export class AlternativeConsidered {
  @Prop({ required: true })
  option: string;

  @Prop({ required: true })
  reasoning: string;

  @Prop()
  estimatedCost?: number;

  @Prop()
  estimatedLatency?: number;

  @Prop()
  estimatedQuality?: number;

  @Prop({ min: 0, max: 1 })
  confidenceScore?: number;

  @Prop({ required: true })
  rejectionReason: string;

  @Prop()
  tradeoffAnalysis?: string;
}

@Schema({ _id: false })
export class StrategicTradeoff {
  @Prop({
    type: String,
    enum: [
      'cost_vs_latency',
      'cost_vs_quality',
      'latency_vs_quality',
      'all_three',
    ],
    required: true,
  })
  tradeoffType:
    | 'cost_vs_latency'
    | 'cost_vs_quality'
    | 'latency_vs_quality'
    | 'all_three';

  @Prop({ min: 0, max: 1 })
  costWeight: number;

  @Prop({ min: 0, max: 1 })
  latencyWeight: number;

  @Prop({ min: 0, max: 1 })
  qualityWeight: number;

  @Prop({ type: Object, required: true })
  costImpact: {
    estimated: number;
    actual?: number;
    savings?: number;
  };

  @Prop({ type: Object, required: true })
  latencyImpact: {
    estimated: number;
    actual?: number;
    overhead?: number;
  };

  @Prop({ type: Object, required: true })
  qualityImpact: {
    estimated: number;
    actual?: number;
    degradation?: number;
  };

  @Prop({
    type: String,
    enum: [
      'cost_optimized',
      'speed_optimized',
      'quality_optimized',
      'balanced',
    ],
    required: true,
  })
  strategy:
    | 'cost_optimized'
    | 'speed_optimized'
    | 'quality_optimized'
    | 'balanced';

  @Prop({ required: true })
  rationale: string;

  @Prop()
  policyReference?: string;
}

@Schema({ _id: false })
export class ArchitecturalDecisionReference {
  @Prop({ required: true })
  adrNumber: string;

  @Prop({ required: true })
  adrTitle: string;

  @Prop({ required: true })
  decisionDate: Date;

  @Prop({
    type: String,
    enum: ['proposed', 'accepted', 'deprecated', 'superseded'],
    required: true,
  })
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';

  @Prop({ required: true })
  relevance: string;
}

@Schema({ _id: false })
export class DecisionImpact {
  @Prop({
    type: String,
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low',
  })
  costImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';

  @Prop({
    type: String,
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low',
  })
  performanceImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';

  @Prop({
    type: String,
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low',
  })
  securityImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';

  @Prop({
    type: String,
    enum: ['negligible', 'low', 'medium', 'high', 'critical'],
    default: 'low',
  })
  userExperienceImpact: 'negligible' | 'low' | 'medium' | 'high' | 'critical';

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
  })
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

@Schema({ _id: false })
export class ExecutionContext {
  @Prop({ required: true })
  executionId: string;

  @Prop()
  sandboxId?: string;

  @Prop()
  processId?: number;

  @Prop()
  containerId?: string;

  // Resource usage
  @Prop()
  cpuUsagePercent?: number;

  @Prop()
  memoryUsageMB?: number;

  @Prop()
  diskUsageMB?: number;

  @Prop()
  networkBytesSent?: number;

  @Prop()
  networkBytesReceived?: number;

  // Timing
  @Prop({ required: true })
  startTime: Date;

  @Prop()
  endTime?: Date;

  @Prop()
  durationMs?: number;

  @Prop()
  queueTimeMs?: number;

  // Cost
  @Prop()
  estimatedCost?: number;

  @Prop()
  actualCost?: number;

  @Prop({ type: Object })
  costBreakdown?: {
    inputTokensCost: number;
    outputTokensCost: number;
    computeCost: number;
    storageCost: number;
  };

  // Tokens
  @Prop()
  inputTokens?: number;

  @Prop()
  outputTokens?: number;

  @Prop()
  totalTokens?: number;

  // Status
  @Prop({
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'timeout', 'killed'],
    required: true,
  })
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'killed';

  @Prop()
  exitCode?: number;

  @Prop()
  errorMessage?: string;

  @Prop()
  errorStack?: string;
}

@Schema({ _id: false })
export class HumanReview {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  reviewerId: Types.ObjectId;

  @Prop({ required: true })
  reviewerEmail: string;

  @Prop({ required: true })
  reviewerName: string;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected', 'escalated'],
    default: 'pending',
  })
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'escalated';

  @Prop()
  reviewedAt?: Date;

  @Prop()
  reviewComments?: string;

  @Prop({ required: true })
  approvalRequired: boolean;

  @Prop()
  approvalGranted?: boolean;

  @Prop()
  approvalReason?: string;
}

@Schema({
  timestamps: true,
  collection: 'agent_decision_audits',
})
export class AgentDecisionAudit {
  // Identity
  @Prop({
    required: true,
    unique: true,
    index: true,
  })
  decisionId: string;

  @Prop({
    required: true,
    index: true,
  })
  agentId: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'AgentIdentity',
    required: true,
    index: true,
  })
  agentIdentityId: Types.ObjectId;

  // Context
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Workspace',
    index: true,
  })
  workspaceId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    index: true,
  })
  organizationId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Project',
    index: true,
  })
  projectId?: Types.ObjectId;

  // Decision classification
  @Prop({
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
      'authentication',
      'other',
    ],
    required: true,
    index: true,
  })
  decisionType:
    | 'model_selection'
    | 'action_execution'
    | 'resource_allocation'
    | 'capability_invocation'
    | 'data_access'
    | 'api_call'
    | 'agent_trace_step'
    | 'optimization'
    | 'authentication'
    | 'other';

  @Prop({
    type: String,
    enum: ['operational', 'strategic', 'tactical', 'emergency'],
    default: 'operational',
  })
  decisionCategory: 'operational' | 'strategic' | 'tactical' | 'emergency';

  // Decision details
  @Prop({ required: true })
  decision: string;

  @Prop({ required: true })
  reasoning: string;

  @Prop({ type: [AlternativeConsidered] })
  alternativesConsidered: IAlternativeConsidered[];

  // Strategic reasoning
  @Prop({ type: StrategicTradeoff })
  strategicTradeoff?: IStrategicTradeoff;

  @Prop({ type: [ArchitecturalDecisionReference] })
  architecturalDecisions?: IArchitecturalDecisionReference[];

  @Prop({ type: Object })
  policyCompliance?: {
    policiesApplied: string[];
    policyOverrides?: string[];
    complianceScore: number;
  };

  // Confidence
  @Prop({
    required: true,
    min: 0,
    max: 1,
    index: true,
  })
  confidenceScore: number;

  @Prop({ type: [String] })
  uncertaintyFactors?: string[];

  // Control
  @Prop({ required: true, default: true })
  humanOverrideable: boolean;

  @Prop({ required: true, default: true })
  reversible: boolean;

  @Prop({ required: true, default: false })
  requiresApproval: boolean;

  @Prop({ default: false })
  autoApproved: boolean;

  // Risk
  @Prop({
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
    index: true,
  })
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  @Prop({ type: DecisionImpact })
  impactAssessment?: IDecisionImpact;

  @Prop({ type: [String] })
  mitigationStrategies?: string[];

  // Execution
  @Prop({
    type: ExecutionContext,
    required: true,
  })
  executionContext: IExecutionContext;

  // Data
  @Prop({ type: Object })
  inputData?: {
    prompt?: string;
    context?: any;
    parameters?: Record<string, any>;
    userIntent?: string;
  };

  @Prop({ type: Object })
  outputData?: {
    result?: any;
    modelResponse?: string;
    actionsTaken?: string[];
    sideEffects?: string[];
  };

  // Human oversight
  @Prop({ type: HumanReview })
  humanReview?: IHumanReview;

  // Audit
  @Prop({
    required: true,
    default: Date.now,
    index: true,
  })
  timestamp: Date;

  @Prop({ index: true })
  correlationId?: string;

  @Prop({ index: true })
  parentDecisionId?: string;

  @Prop({ type: [String] })
  childDecisionIds?: string[];

  // Compliance
  @Prop({ type: [String] })
  complianceFlags?: string[];

  @Prop({ default: false })
  legalHold?: boolean;

  @Prop({ default: false })
  retentionOverride?: boolean;

  // Learning
  @Prop({ min: 0, max: 5 })
  feedbackScore?: number;

  @Prop()
  feedbackComments?: string;

  @Prop()
  wasSuccessful?: boolean;

  @Prop({ type: Object })
  successMetrics?: Record<string, number>;

  // Metadata
  @Prop({ type: [String] })
  tags?: string[];

  @Prop({ type: Object })
  customMetadata?: Record<string, any>;
}

export const AgentDecisionAuditSchema =
  SchemaFactory.createForClass(AgentDecisionAudit);

// Compound indexes for common queries
AgentDecisionAuditSchema.index({ agentId: 1, timestamp: -1 });
AgentDecisionAuditSchema.index({ userId: 1, timestamp: -1 });
AgentDecisionAuditSchema.index({
  decisionType: 1,
  riskLevel: 1,
  timestamp: -1,
});
AgentDecisionAuditSchema.index({ 'executionContext.status': 1, timestamp: -1 });
AgentDecisionAuditSchema.index({ 'humanReview.reviewStatus': 1 });
AgentDecisionAuditSchema.index({ legalHold: 1 }, { sparse: true });

// TTL index for automatic cleanup (based on retention)
AgentDecisionAuditSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 220752000 },
); // 7 years

// Instance methods
AgentDecisionAuditSchema.methods.requiresHumanReview = function (): boolean {
  return (
    this.requiresApproval &&
    (!this.humanReview || this.humanReview.reviewStatus === 'pending')
  );
};

AgentDecisionAuditSchema.methods.isHighRisk = function (): boolean {
  return this.riskLevel === 'high' || this.riskLevel === 'critical';
};

AgentDecisionAuditSchema.methods.canBeReversed = function (): boolean {
  return (
    this.reversible &&
    this.executionContext.status === 'completed' &&
    !this.legalHold
  );
};
