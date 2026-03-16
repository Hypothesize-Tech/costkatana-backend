import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export interface IAgentCapability {
  name: string;
  description: string;
  requiredPermissions: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

@Schema({ _id: false })
export class AgentCapability {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String] })
  requiredPermissions: string[];

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  })
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

@Schema({ _id: false })
export class SandboxConfig {
  @Prop({ default: 0.5, min: 0.1, max: 4 })
  maxCpuCores: number;

  @Prop({ default: 512, min: 128, max: 4096 })
  maxMemoryMB: number;

  @Prop({ default: 100, min: 10, max: 1024 })
  maxDiskMB: number;

  @Prop({ default: 300, min: 10, max: 3600 })
  maxExecutionTimeSeconds: number;

  @Prop({ type: [String] })
  allowedNetworkEndpoints: string[];

  @Prop({ type: [String] })
  allowedFilesystemPaths: string[];

  @Prop({
    type: String,
    enum: ['process', 'container', 'vm'],
    default: 'container',
  })
  isolationLevel: 'process' | 'container' | 'vm';
}

@Schema({ _id: false })
export class AllowedTimeWindow {
  @Prop({ min: 0, max: 23 })
  startHour: number;

  @Prop({ min: 0, max: 23 })
  endHour: number;

  @Prop({ type: [Number], min: 0, max: 6 })
  daysOfWeek: number[];
}

export type IAgentIdentity = Document & {
  agentId: string;
  agentName: string;
  agentType:
    | 'recommendation'
    | 'github'
    | 'multiagent'
    | 'custom'
    | 'agent_trace'
    | 'automation';

  // Ownership and hierarchy
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  organizationId?: Types.ObjectId;

  // Authentication
  tokenHash: string;
  tokenPrefix: string;

  // Authorization - Deny by default
  allowedModels: string[];
  allowedProviders: string[];
  allowedActions: ('read' | 'write' | 'delete' | 'execute' | 'admin')[];

  // Capabilities - Opt-in capabilities
  capabilities: IAgentCapability[];

  // Resource constraints - Defense in depth
  budgetCapPerRequest: number;
  budgetCapPerDay: number;
  budgetCapPerMonth: number;

  // Rate limiting
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  maxConcurrentExecutions: number;

  // Sandbox requirements
  sandboxRequired: boolean;
  sandboxConfig?: SandboxConfig;

  // Security settings
  ipWhitelist?: string[];
  requireMfa: boolean;
  allowedTimeWindows?: AllowedTimeWindow[];

  // Audit and compliance
  auditLevel: 'minimal' | 'standard' | 'comprehensive' | 'forensic';
  retentionPeriodDays: number;
  requireReasoningCapture: boolean;
  requireHumanApproval: string[];

  // State and lifecycle
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;

  // Usage tracking
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  failureCount: number;
  lastFailureAt?: Date;
  lastFailureReason?: string;

  // Metadata
  description?: string;
  tags?: string[];
  customMetadata?: Record<string, any>;
};

@Schema({
  timestamps: true,
  collection: 'agent_identities',
})
export class AgentIdentity {
  @Prop({
    required: true,
    unique: true,
    index: true,
  })
  agentId: string;

  @Prop({ required: true })
  agentName: string;

  @Prop({
    type: String,
    enum: [
      'recommendation',
      'github',
      'multiagent',
      'custom',
      'agent_trace',
      'automation',
    ],
    required: true,
    index: true,
  })
  agentType:
    | 'recommendation'
    | 'github'
    | 'multiagent'
    | 'custom'
    | 'agent_trace'
    | 'automation';

  // Ownership
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

  // Authentication
  @Prop({
    required: true,
    select: false, // Never return in queries by default
  })
  tokenHash: string;

  @Prop({ required: true })
  tokenPrefix: string;

  // Authorization - Default to empty (deny all)
  @Prop({ type: [String], default: [] })
  allowedModels: string[];

  @Prop({ type: [String], default: [] })
  allowedProviders: string[];

  @Prop({
    type: [String],
    enum: ['read', 'write', 'delete', 'execute', 'admin'],
    default: ['read'], // Read-only by default
  })
  allowedActions: ('read' | 'write' | 'delete' | 'execute' | 'admin')[];

  // Capabilities
  @Prop({ type: [AgentCapability], default: [] })
  capabilities: IAgentCapability[];

  // Resource constraints - Conservative defaults
  @Prop({
    required: true,
    default: 0.1, // $0.10 per request
    min: 0,
    max: 100,
  })
  budgetCapPerRequest: number;

  @Prop({
    required: true,
    default: 1.0, // $1 per day
    min: 0,
  })
  budgetCapPerDay: number;

  @Prop({
    required: true,
    default: 10.0, // $10 per month
    min: 0,
  })
  budgetCapPerMonth: number;

  // Rate limiting - Conservative defaults
  @Prop({ default: 10, min: 1, max: 1000 })
  maxRequestsPerMinute: number;

  @Prop({ default: 100, min: 1, max: 10000 })
  maxRequestsPerHour: number;

  @Prop({ default: 2, min: 1, max: 50 })
  maxConcurrentExecutions: number;

  // Sandbox - Required by default for safety
  @Prop({ default: true })
  sandboxRequired: boolean;

  @Prop({ type: SandboxConfig })
  sandboxConfig?: SandboxConfig;

  // Security
  @Prop({ type: [String] })
  ipWhitelist?: string[];

  @Prop({ default: false })
  requireMfa: boolean;

  @Prop({ type: [AllowedTimeWindow] })
  allowedTimeWindows?: AllowedTimeWindow[];

  // Audit
  @Prop({
    type: String,
    enum: ['minimal', 'standard', 'comprehensive', 'forensic'],
    default: 'comprehensive',
  })
  auditLevel: 'minimal' | 'standard' | 'comprehensive' | 'forensic';

  @Prop({ default: 2555 }) // 7 years for compliance
  retentionPeriodDays: number;

  @Prop({ default: true })
  requireReasoningCapture: boolean;

  @Prop({ type: [String] })
  requireHumanApproval: string[];

  // State
  @Prop({
    type: String,
    enum: ['active', 'suspended', 'revoked', 'expired'],
    default: 'active',
    index: true,
  })
  status: 'active' | 'suspended' | 'revoked' | 'expired';

  @Prop()
  lastUsedAt?: Date;

  @Prop({ index: { sparse: true } })
  expiresAt?: Date;

  // Usage tracking
  @Prop({ default: 0 })
  totalRequests: number;

  @Prop({ default: 0 })
  totalCost: number;

  @Prop({ default: 0 })
  totalTokens: number;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop()
  lastFailureAt?: Date;

  @Prop()
  lastFailureReason?: string;

  // Metadata
  @Prop()
  description?: string;

  @Prop({ type: [String] })
  tags?: string[];

  @Prop({ type: Object })
  customMetadata?: Record<string, any>;
}

export const AgentIdentitySchema = SchemaFactory.createForClass(AgentIdentity);

// Indexes for performance
AgentIdentitySchema.index({ userId: 1, status: 1 });
AgentIdentitySchema.index({ workspaceId: 1, status: 1 });
AgentIdentitySchema.index({ organizationId: 1, status: 1 });
AgentIdentitySchema.index({ agentType: 1, status: 1 });
AgentIdentitySchema.index({ expiresAt: 1 }, { sparse: true });
AgentIdentitySchema.index({ 'sandboxConfig.isolationLevel': 1 });

// Pre-save validation
AgentIdentitySchema.pre('save', function (next) {
  // Validate budget hierarchy
  if (this.budgetCapPerDay < this.budgetCapPerRequest) {
    next(new Error('Daily budget must be >= per-request budget'));
    return;
  }

  if (this.budgetCapPerMonth < this.budgetCapPerDay) {
    next(new Error('Monthly budget must be >= daily budget'));
    return;
  }

  // Validate rate limit hierarchy
  if (this.maxRequestsPerHour < this.maxRequestsPerMinute) {
    next(new Error('Hourly rate limit must be >= per-minute rate limit'));
    return;
  }

  // Check expiration
  if (this.expiresAt && this.expiresAt < new Date()) {
    this.status = 'expired';
  }

  next();
});

// Instance methods
AgentIdentitySchema.methods.isExpired = function (): boolean {
  return this.expiresAt ? this.expiresAt < new Date() : false;
};

AgentIdentitySchema.methods.isActive = function (): boolean {
  return this.status === 'active' && !this.isExpired();
};

AgentIdentitySchema.methods.canExecuteAction = function (
  action: string,
): boolean {
  return this.isActive() && this.allowedActions.includes(action);
};

AgentIdentitySchema.methods.canUseModel = function (model: string): boolean {
  return (
    this.isActive() &&
    (this.allowedModels.length === 0 || // Empty = all allowed (legacy)
      this.allowedModels.includes(model) ||
      this.allowedModels.includes('*')) // Wildcard
  );
};

AgentIdentitySchema.methods.canUseProvider = function (
  provider: string,
): boolean {
  return (
    this.isActive() &&
    (this.allowedProviders.length === 0 || // Empty = all allowed (legacy)
      this.allowedProviders.includes(provider) ||
      this.allowedProviders.includes('*')) // Wildcard
  );
};
