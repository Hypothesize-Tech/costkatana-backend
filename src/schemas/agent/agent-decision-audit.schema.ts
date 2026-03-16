import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

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

  costWeight: number;
  latencyWeight: number;
  qualityWeight: number;

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

  cpuUsagePercent?: number;
  memoryUsageMB?: number;
  diskUsageMB?: number;
  networkBytesSent?: number;
  networkBytesReceived?: number;

  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  queueTimeMs?: number;

  estimatedCost?: number;
  actualCost?: number;
  costBreakdown?: {
    inputTokensCost: number;
    outputTokensCost: number;
    computeCost: number;
    storageCost: number;
  };

  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;

  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'killed';
  exitCode?: number;
  errorMessage?: string;
  errorStack?: string;
}

export interface IHumanReview {
  reviewerId: MongooseSchema.Types.ObjectId;
  reviewerEmail: string;
  reviewerName: string;

  reviewStatus: 'pending' | 'approved' | 'rejected' | 'escalated';
  reviewedAt?: Date;
  reviewComments?: string;

  approvalRequired: boolean;
  approvalGranted?: boolean;
  approvalReason?: string;
}

export interface IAgentDecisionAuditMethods {
  requiresHumanReview(): boolean;
  isHighRisk(): boolean;
  canBeReversed(): boolean;
}

export type AgentDecisionAuditDocument = HydratedDocument<AgentDecisionAudit> &
  IAgentDecisionAuditMethods;

@Schema({ timestamps: true, collection: 'agent_decision_audits' })
export class AgentDecisionAudit implements IAgentDecisionAuditMethods {
  // Identity
  @Prop({ required: true, unique: true, index: true })
  decisionId: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AgentIdentity',
    required: true,
    index: true,
  })
  agentIdentityId: MongooseSchema.Types.ObjectId;

  // Context
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Workspace', index: true })
  workspaceId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    index: true,
  })
  organizationId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', index: true })
  projectId?: MongooseSchema.Types.ObjectId;

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
    | 'other';

  @Prop({
    type: String,
    enum: ['operational', 'strategic', 'tactical', 'emergency'],
    required: true,
    default: 'operational',
  })
  decisionCategory: 'operational' | 'strategic' | 'tactical' | 'emergency';

  // Decision details
  @Prop({ required: true })
  decision: string;

  @Prop({ required: true })
  reasoning: string;

  @Prop([
    {
      option: { type: String, required: true },
      reasoning: { type: String, required: true },
      estimatedCost: Number,
      estimatedLatency: Number,
      estimatedQuality: Number,
      confidenceScore: { type: Number, min: 0, max: 1 },
      rejectionReason: { type: String, required: true },
      tradeoffAnalysis: String,
    },
  ])
  alternativesConsidered: IAlternativeConsidered[];

  // Strategic reasoning
  @Prop({
    tradeoffType: {
      type: String,
      enum: [
        'cost_vs_latency',
        'cost_vs_quality',
        'latency_vs_quality',
        'all_three',
      ],
    },
    costWeight: { type: Number, min: 0, max: 1 },
    latencyWeight: { type: Number, min: 0, max: 1 },
    qualityWeight: { type: Number, min: 0, max: 1 },
    costImpact: {
      estimated: Number,
      actual: Number,
      savings: Number,
    },
    latencyImpact: {
      estimated: Number,
      actual: Number,
      overhead: Number,
    },
    qualityImpact: {
      estimated: Number,
      actual: Number,
      degradation: Number,
    },
    strategy: {
      type: String,
      enum: [
        'cost_optimized',
        'speed_optimized',
        'quality_optimized',
        'balanced',
      ],
    },
    rationale: String,
    policyReference: String,
  })
  strategicTradeoff?: IStrategicTradeoff;

  @Prop([
    {
      adrNumber: { type: String, required: true },
      adrTitle: { type: String, required: true },
      decisionDate: { type: Date, required: true },
      status: {
        type: String,
        enum: ['proposed', 'accepted', 'deprecated', 'superseded'],
        required: true,
      },
      relevance: { type: String, required: true },
    },
  ])
  architecturalDecisions?: IArchitecturalDecisionReference[];

  @Prop({
    policiesApplied: [String],
    policyOverrides: [String],
    complianceScore: { type: Number, min: 0, max: 1 },
  })
  policyCompliance?: {
    policiesApplied: string[];
    policyOverrides?: string[];
    complianceScore: number;
  };

  // Confidence
  @Prop({ required: true, min: 0, max: 1, index: true })
  confidenceScore: number;

  @Prop([String])
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

  @Prop({
    costImpact: {
      type: String,
      enum: ['negligible', 'low', 'medium', 'high', 'critical'],
      default: 'low',
    },
    performanceImpact: {
      type: String,
      enum: ['negligible', 'low', 'medium', 'high', 'critical'],
      default: 'low',
    },
    securityImpact: {
      type: String,
      enum: ['negligible', 'low', 'medium', 'high', 'critical'],
      default: 'low',
    },
    userExperienceImpact: {
      type: String,
      enum: ['negligible', 'low', 'medium', 'high', 'critical'],
      default: 'low',
    },
    overallRiskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true,
    },
  })
  impactAssessment?: IDecisionImpact;

  @Prop([String])
  mitigationStrategies?: string[];

  // Execution
  @Prop({
    executionId: { type: String, required: true },
    sandboxId: String,
    processId: Number,
    containerId: String,
    cpuUsagePercent: Number,
    memoryUsageMB: Number,
    diskUsageMB: Number,
    networkBytesSent: Number,
    networkBytesReceived: Number,
    startTime: { type: Date, required: true },
    endTime: Date,
    durationMs: Number,
    queueTimeMs: Number,
    estimatedCost: Number,
    actualCost: Number,
    costBreakdown: {
      inputTokensCost: Number,
      outputTokensCost: Number,
      computeCost: Number,
      storageCost: Number,
    },
    inputTokens: Number,
    outputTokens: Number,
    totalTokens: Number,
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'timeout', 'killed'],
      required: true,
    },
    exitCode: Number,
    errorMessage: String,
    errorStack: String,
  })
  executionContext: IExecutionContext;

  // Data
  @Prop({
    prompt: String,
    context: mongoose.Schema.Types.Mixed,
    parameters: mongoose.Schema.Types.Mixed,
    userIntent: String,
  })
  inputData?: {
    prompt?: string;
    context?: any;
    parameters?: Record<string, any>;
    userIntent?: string;
  };

  @Prop({
    result: mongoose.Schema.Types.Mixed,
    modelResponse: String,
    actionsTaken: [String],
    sideEffects: [String],
  })
  outputData?: {
    result?: any;
    modelResponse?: string;
    actionsTaken?: string[];
    sideEffects?: string[];
  };

  // Human oversight
  @Prop({
    reviewerId: { type: MongooseSchema.Types.ObjectId, ref: 'User' },
    reviewerEmail: String,
    reviewerName: String,
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'escalated'],
      default: 'pending',
    },
    reviewedAt: Date,
    reviewComments: String,
    approvalRequired: Boolean,
    approvalGranted: Boolean,
    approvalReason: String,
  })
  humanReview?: IHumanReview;

  // Audit
  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  @Prop({ index: true })
  correlationId?: string;

  @Prop({ index: true })
  parentDecisionId?: string;

  @Prop([String])
  childDecisionIds?: string[];

  // Compliance
  @Prop([String])
  complianceFlags?: string[];

  @Prop({ default: false })
  legalHold: boolean;

  @Prop({ default: false })
  retentionOverride: boolean;

  // Learning
  @Prop({ min: 0, max: 5 })
  feedbackScore?: number;

  @Prop()
  feedbackComments?: string;

  @Prop()
  wasSuccessful?: boolean;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  successMetrics?: Record<string, number>;

  // Metadata
  @Prop([String])
  tags?: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed })
  customMetadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  requiresHumanReview(): boolean {
    return (
      this.requiresApproval &&
      (!this.humanReview || this.humanReview.reviewStatus === 'pending')
    );
  }

  isHighRisk(): boolean {
    return this.riskLevel === 'high' || this.riskLevel === 'critical';
  }

  canBeReversed(): boolean {
    return (
      this.reversible &&
      this.executionContext.status === 'completed' &&
      !this.legalHold
    );
  }
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

// TTL index for automatic cleanup
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
