import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface ISandboxResourceLimits {
  maxCpuCores: number;
  maxMemoryMB: number;
  maxDiskMB: number;
  maxExecutionTimeSeconds: number;
  maxNetworkBandwidthMbps?: number;
  maxFileDescriptors?: number;
}

export interface ISandboxNetworkPolicy {
  allowOutbound: boolean;
  allowInbound: boolean;
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  allowDNS: boolean;
  allowedPorts?: number[];
}

export interface ISandboxFilesystemPolicy {
  rootPath: string;
  readOnlyPaths: string[];
  writablePaths: string[];
  tempDirectory: string;
  maxFileSize: number;
  allowedFileTypes?: string[];
}

export interface IResourceUsageSnapshot {
  timestamp: Date;
  cpuUsagePercent: number;
  memoryUsageMB: number;
  diskUsageMB: number;
  networkBytesSent: number;
  networkBytesReceived: number;
  threadCount?: number;
  fileDescriptorCount?: number;
}

export interface ISecurityViolation {
  timestamp: Date;
  violationType:
    | 'unauthorized_network_access'
    | 'unauthorized_filesystem_access'
    | 'resource_limit_exceeded'
    | 'capability_violation'
    | 'malicious_behavior'
    | 'policy_violation'
    | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  actionTaken: 'logged' | 'blocked' | 'killed' | 'escalated';
  details?: Record<string, any>;
}

export interface IAgentExecutionMethods {
  isRunning(): boolean;
  isCompleted(): boolean;
  hasViolations(): boolean;
  hasCriticalViolations(): boolean;
  isHealthy(): boolean;
  getResourceUtilization(): number;
  shouldKill(): boolean;
}

export type AgentExecutionDocument = HydratedDocument<AgentExecution> &
  IAgentExecutionMethods;

/** Alias for document type used by AgentSandboxService and other consumers */
export type IAgentExecution = AgentExecutionDocument;

@Schema({ timestamps: true, collection: 'agent_executions' })
export class AgentExecution implements IAgentExecutionMethods {
  // Identity
  @Prop({ required: true, unique: true, index: true })
  executionId: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AgentIdentity',
    required: true,
    index: true,
  })
  agentIdentityId: MongooseSchema.Types.ObjectId;

  @Prop({ index: true })
  decisionId?: string;

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

  // Request
  @Prop()
  requestId?: string;

  @Prop({ index: true })
  correlationId?: string;

  @Prop({ index: true })
  parentExecutionId?: string;

  // Sandbox
  @Prop({ required: true, index: true })
  sandboxId: string;

  @Prop({
    type: String,
    enum: ['process', 'container', 'vm'],
    required: true,
  })
  isolationType: 'process' | 'container' | 'vm';

  @Prop({
    type: {
      maxCpuCores: { type: Number, required: true, min: 0.1, max: 8 },
      maxMemoryMB: { type: Number, required: true, min: 128, max: 8192 },
      maxDiskMB: { type: Number, required: true, min: 10, max: 2048 },
      maxExecutionTimeSeconds: {
        type: Number,
        required: true,
        min: 10,
        max: 3600,
      },
      maxNetworkBandwidthMbps: { type: Number, min: 1, max: 1000 },
      maxFileDescriptors: { type: Number, min: 10, max: 10000 },
    },
    _id: false,
  })
  resourceLimits: ISandboxResourceLimits;

  @Prop({
    type: {
      allowOutbound: { type: Boolean, required: true, default: true },
      allowInbound: { type: Boolean, required: true, default: false },
      allowedEndpoints: [String],
      blockedEndpoints: [String],
      allowDNS: { type: Boolean, default: true },
      allowedPorts: [Number],
    },
    _id: false,
  })
  networkPolicy: ISandboxNetworkPolicy;

  @Prop({
    type: {
      rootPath: { type: String, required: true },
      readOnlyPaths: [String],
      writablePaths: [String],
      tempDirectory: { type: String, required: true },
      maxFileSize: { type: Number, required: true },
      allowedFileTypes: [String],
    },
    _id: false,
  })
  filesystemPolicy: ISandboxFilesystemPolicy;

  // Container/Process
  @Prop()
  containerId?: string;

  @Prop()
  processId?: number;

  @Prop()
  dockerImage?: string;

  @Prop()
  hostname?: string;

  // State
  @Prop({
    type: String,
    enum: [
      'queued',
      'provisioning',
      'starting',
      'running',
      'completed',
      'failed',
      'timeout',
      'killed',
      'resource_exceeded',
      'policy_violated',
    ],
    required: true,
    default: 'queued',
    index: true,
  })
  status:
    | 'queued'
    | 'provisioning'
    | 'starting'
    | 'running'
    | 'completed'
    | 'failed'
    | 'timeout'
    | 'killed'
    | 'resource_exceeded'
    | 'policy_violated';

  // Timing
  @Prop({ type: Date, required: true, default: Date.now })
  queuedAt: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  lastHeartbeatAt?: Date;

  @Prop()
  queueTimeMs?: number;

  @Prop()
  startupTimeMs?: number;

  @Prop()
  executionTimeMs?: number;

  @Prop()
  totalTimeMs?: number;

  // Resource tracking
  @Prop({
    type: [
      {
        timestamp: { type: Date, required: true },
        cpuUsagePercent: { type: Number, required: true },
        memoryUsageMB: { type: Number, required: true },
        diskUsageMB: { type: Number, required: true },
        networkBytesSent: { type: Number, required: true },
        networkBytesReceived: { type: Number, required: true },
        threadCount: Number,
        fileDescriptorCount: Number,
      },
    ],
    _id: false,
  })
  resourceUsageSnapshots: IResourceUsageSnapshot[];

  @Prop()
  peakCpuUsagePercent?: number;

  @Prop()
  peakMemoryUsageMB?: number;

  @Prop()
  peakDiskUsageMB?: number;

  @Prop()
  totalNetworkBytesSent?: number;

  @Prop()
  totalNetworkBytesReceived?: number;

  // Budget
  @Prop({ required: true })
  estimatedCost: number;

  @Prop()
  actualCost?: number;

  @Prop()
  budgetReservationId?: string;

  // Tokens
  @Prop()
  inputTokens?: number;

  @Prop()
  outputTokens?: number;

  @Prop()
  totalTokens?: number;

  // Execution
  @Prop()
  command?: string;

  @Prop([String])
  arguments?: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed })
  environmentVariables?: Record<string, string>;

  @Prop()
  workingDirectory?: string;

  // I/O
  @Prop({ type: mongoose.Schema.Types.Mixed })
  inputData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  outputData?: any;

  // Exit
  @Prop()
  exitCode?: number;

  @Prop()
  exitSignal?: string;

  @Prop()
  errorMessage?: string;

  @Prop()
  errorStack?: string;

  // Security
  @Prop({
    type: [
      {
        timestamp: { type: Date, required: true },
        violationType: {
          type: String,
          enum: [
            'unauthorized_network_access',
            'unauthorized_filesystem_access',
            'resource_limit_exceeded',
            'capability_violation',
            'malicious_behavior',
            'policy_violation',
            'other',
          ],
          required: true,
        },
        severity: {
          type: String,
          enum: ['low', 'medium', 'high', 'critical'],
          required: true,
        },
        description: { type: String, required: true },
        actionTaken: {
          type: String,
          enum: ['logged', 'blocked', 'killed', 'escalated'],
          required: true,
        },
        details: mongoose.Schema.Types.Mixed,
      },
    ],
    _id: false,
  })
  securityViolations: ISecurityViolation[];

  @Prop([String])
  policiesViolated?: string[];

  // Kill-switch
  @Prop({ type: Boolean, default: false, index: true })
  killRequested: boolean;

  @Prop()
  killRequestedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  killRequestedBy?: MongooseSchema.Types.ObjectId;

  @Prop()
  killReason?: string;

  @Prop({ type: Boolean, default: false })
  forceKilled: boolean;

  // Health
  @Prop({
    type: String,
    enum: ['healthy', 'degraded', 'unhealthy', 'unknown'],
    default: 'unknown',
  })
  healthCheckStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

  @Prop()
  lastHealthCheckAt?: Date;

  @Prop({ type: Number, default: 0 })
  healthCheckFailures: number;

  // Observability
  @Prop()
  logStreamUrl?: string;

  @Prop()
  traceId?: string;

  @Prop()
  spanId?: string;

  // Metadata
  @Prop([String])
  tags?: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed })
  customMetadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  isRunning(): boolean {
    return ['queued', 'provisioning', 'starting', 'running'].includes(
      this.status,
    );
  }

  isCompleted(): boolean {
    return [
      'completed',
      'failed',
      'timeout',
      'killed',
      'resource_exceeded',
      'policy_violated',
    ].includes(this.status);
  }

  hasViolations(): boolean {
    return this.securityViolations.length > 0;
  }

  hasCriticalViolations(): boolean {
    return this.securityViolations.some((v) => v.severity === 'critical');
  }

  isHealthy(): boolean {
    return (
      this.healthCheckStatus === 'healthy' &&
      this.healthCheckFailures === 0 &&
      !this.killRequested
    );
  }

  getResourceUtilization(): number {
    if (!this.resourceUsageSnapshots.length) return 0;

    const latest =
      this.resourceUsageSnapshots[this.resourceUsageSnapshots.length - 1];
    const cpuUtil =
      latest.cpuUsagePercent / (this.resourceLimits.maxCpuCores * 100);
    const memUtil = latest.memoryUsageMB / this.resourceLimits.maxMemoryMB;
    const diskUtil = latest.diskUsageMB / this.resourceLimits.maxDiskMB;

    return Math.max(cpuUtil, memUtil, diskUtil);
  }

  shouldKill(): boolean {
    // Kill if explicitly requested
    if (this.killRequested) return true;

    // Kill if critical violations
    if (this.hasCriticalViolations()) return true;

    // Kill if execution time exceeded
    if (this.startedAt) {
      const elapsedSeconds = (Date.now() - this.startedAt.getTime()) / 1000;
      if (elapsedSeconds > this.resourceLimits.maxExecutionTimeSeconds)
        return true;
    }

    // Kill if health checks failing
    if (this.healthCheckFailures >= 3) return true;

    return false;
  }
}

export const AgentExecutionSchema =
  SchemaFactory.createForClass(AgentExecution);

// Indexes for common queries
AgentExecutionSchema.index({ agentId: 1, status: 1, queuedAt: -1 });
AgentExecutionSchema.index({ userId: 1, queuedAt: -1 });
AgentExecutionSchema.index({ status: 1, queuedAt: -1 });
AgentExecutionSchema.index({ containerId: 1 }, { sparse: true });
AgentExecutionSchema.index({ 'securityViolations.severity': 1 });
AgentExecutionSchema.index({ killRequested: 1, status: 1 });

// TTL index for cleanup of old executions
AgentExecutionSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: 7776000, sparse: true },
);

// Instance methods
AgentExecutionSchema.methods.isRunning = function (): boolean {
  return ['queued', 'provisioning', 'starting', 'running'].includes(
    this.status,
  );
};

AgentExecutionSchema.methods.isCompleted = function (): boolean {
  return [
    'completed',
    'failed',
    'timeout',
    'killed',
    'resource_exceeded',
    'policy_violated',
  ].includes(this.status);
};

AgentExecutionSchema.methods.hasViolations = function (): boolean {
  return this.securityViolations.length > 0;
};

AgentExecutionSchema.methods.hasCriticalViolations = function (): boolean {
  return this.securityViolations.some(
    (v: ISecurityViolation) => v.severity === 'critical',
  );
};

AgentExecutionSchema.methods.isHealthy = function (): boolean {
  return (
    this.healthCheckStatus === 'healthy' &&
    this.healthCheckFailures === 0 &&
    !this.killRequested
  );
};

AgentExecutionSchema.methods.getResourceUtilization = function (): number {
  if (!this.resourceUsageSnapshots.length) return 0;

  const latest =
    this.resourceUsageSnapshots[this.resourceUsageSnapshots.length - 1];
  const cpuUtil =
    latest.cpuUsagePercent / (this.resourceLimits.maxCpuCores * 100);
  const memUtil = latest.memoryUsageMB / this.resourceLimits.maxMemoryMB;
  const diskUtil = latest.diskUsageMB / this.resourceLimits.maxDiskMB;

  return Math.max(cpuUtil, memUtil, diskUtil);
};

AgentExecutionSchema.methods.shouldKill = function (): boolean {
  // Kill if explicitly requested
  if (this.killRequested) return true;

  // Kill if critical violations
  if (this.hasCriticalViolations()) return true;

  // Kill if execution time exceeded
  if (this.startedAt) {
    const elapsedSeconds = (Date.now() - this.startedAt.getTime()) / 1000;
    if (elapsedSeconds > this.resourceLimits.maxExecutionTimeSeconds)
      return true;
  }

  // Kill if health checks failing
  if (this.healthCheckFailures >= 3) return true;

  return false;
};
