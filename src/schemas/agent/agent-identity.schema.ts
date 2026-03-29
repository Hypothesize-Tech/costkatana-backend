import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

/** Nested document: agent capability (structured sub-schema). */
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

/** Nested document: sandbox resource limits. */
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

/** Nested document: allowed execution time window. */
@Schema({ _id: false })
export class AllowedTimeWindow {
  @Prop({ min: 0, max: 23 })
  startHour: number;

  @Prop({ min: 0, max: 23 })
  endHour: number;

  @Prop({ type: [{ type: Number, min: 0, max: 6 }] })
  daysOfWeek: number[];
}

export interface IAgentCapability {
  name: string;
  description: string;
  requiredPermissions: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ISandboxConfig {
  maxCpuCores: number;
  maxMemoryMB: number;
  maxDiskMB: number;
  maxExecutionTimeSeconds: number;
  allowedNetworkEndpoints: string[];
  allowedFilesystemPaths: string[];
  isolationLevel: 'process' | 'container' | 'vm';
}

export interface IAllowedTimeWindow {
  startHour: number;
  endHour: number;
  daysOfWeek: number[]; // 0-6, Sunday-Saturday
}

export interface IAgentIdentityMethods {
  isExpired(): boolean;
  isActive(): boolean;
  canExecuteAction(action: string): boolean;
  canUseModel(model: string): boolean;
  canUseProvider(provider: string): boolean;
}

export type AgentIdentityDocument = HydratedDocument<AgentIdentity> &
  IAgentIdentityMethods;

/** Alias for document/identity type used by AgentSandboxService and other consumers */
export type IAgentIdentity = AgentIdentityDocument;

@Schema({ timestamps: true, collection: 'agent_identities' })
export class AgentIdentity implements IAgentIdentityMethods {
  @Prop({ required: true, unique: true, index: true })
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

  // Authentication
  @Prop({ required: true, select: false }) // Never return in queries by default
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
  @Prop({
    type: [AgentCapability],
    default: [],
  })
  capabilities: IAgentCapability[];

  // Resource constraints - Conservative defaults
  @Prop({ required: true, default: 0.1, min: 0, max: 100 }) // $0.10 per request
  budgetCapPerRequest: number;

  @Prop({ required: true, default: 1.0, min: 0 }) // $1 per day
  budgetCapPerDay: number;

  @Prop({ required: true, default: 10.0, min: 0 }) // $10 per month
  budgetCapPerMonth: number;

  // Rate limiting - Conservative defaults
  @Prop({ default: 10, min: 1, max: 1000 })
  maxRequestsPerMinute: number;

  @Prop({ default: 100, min: 1, max: 10000 })
  maxRequestsPerHour: number;

  @Prop({ default: 2, min: 1, max: 50 })
  maxConcurrentExecutions: number;

  // Sandbox - Required by default for safety
  @Prop({ type: Boolean, default: true })
  sandboxRequired: boolean;

  @Prop({ type: SandboxConfig })
  sandboxConfig?: ISandboxConfig;

  // Security
  @Prop([String])
  ipWhitelist?: string[];

  @Prop({ type: Boolean, default: false })
  requireMfa: boolean;

  @Prop({ type: [AllowedTimeWindow] })
  allowedTimeWindows?: IAllowedTimeWindow[];

  // Audit
  @Prop({
    type: String,
    enum: ['minimal', 'standard', 'comprehensive', 'forensic'],
    default: 'comprehensive',
  })
  auditLevel: 'minimal' | 'standard' | 'comprehensive' | 'forensic';

  @Prop({ type: Number, default: 2555 }) // 7 years for compliance
  retentionPeriodDays: number;

  @Prop({ type: Boolean, default: true })
  requireReasoningCapture: boolean;

  @Prop([String])
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
  @Prop({ type: Number, default: 0 })
  totalRequests: number;

  @Prop({ type: Number, default: 0 })
  totalCost: number;

  @Prop({ type: Number, default: 0 })
  totalTokens: number;

  @Prop({ type: Number, default: 0 })
  failureCount: number;

  @Prop()
  lastFailureAt?: Date;

  @Prop()
  lastFailureReason?: string;

  // Metadata
  @Prop()
  description?: string;

  @Prop([String])
  tags?: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed })
  customMetadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  isExpired(): boolean {
    return this.expiresAt ? this.expiresAt < new Date() : false;
  }

  isActive(): boolean {
    return this.status === 'active' && !this.isExpired();
  }

  canExecuteAction(action: string): boolean {
    return this.isActive() && this.allowedActions.includes(action as any);
  }

  canUseModel(model: string): boolean {
    return (
      this.isActive() &&
      (this.allowedModels.length === 0 || // Empty = all allowed (legacy)
        this.allowedModels.includes(model) ||
        this.allowedModels.includes('*')) // Wildcard
    );
  }

  canUseProvider(provider: string): boolean {
    return (
      this.isActive() &&
      (this.allowedProviders.length === 0 || // Empty = all allowed (legacy)
        this.allowedProviders.includes(provider) ||
        this.allowedProviders.includes('*')) // Wildcard
    );
  }
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
