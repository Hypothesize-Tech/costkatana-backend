import mongoose, { Document, Schema } from 'mongoose';

/**
 * Sandbox Resource Limits
 */
export interface ISandboxResourceLimits {
  maxCpuCores: number;
  maxMemoryMB: number;
  maxDiskMB: number;
  maxExecutionTimeSeconds: number;
  maxNetworkBandwidthMbps?: number;
  maxFileDescriptors?: number;
}

/**
 * Sandbox Network Policy
 */
export interface ISandboxNetworkPolicy {
  allowOutbound: boolean;
  allowInbound: boolean;
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  allowDNS: boolean;
  allowedPorts?: number[];
}

/**
 * Sandbox Filesystem Policy
 */
export interface ISandboxFilesystemPolicy {
  rootPath: string;
  readOnlyPaths: string[];
  writablePaths: string[];
  tempDirectory: string;
  maxFileSize: number;
  allowedFileTypes?: string[];
}

/**
 * Resource Usage Snapshot
 */
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

/**
 * Security Violation
 */
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

/**
 * Agent Execution - Tracks sandbox execution state and lifecycle
 * Critical for process isolation, resource control, and kill-switch
 */
export interface IAgentExecution extends Document {
  // Identity
  executionId: string;
  agentId: string;
  agentIdentityId: mongoose.Types.ObjectId;
  decisionId?: string; // Link to decision audit
  
  // Context
  userId: mongoose.Types.ObjectId;
  workspaceId?: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  
  // Request context
  requestId?: string;
  correlationId?: string;
  parentExecutionId?: string; // For nested executions
  
  // Sandbox configuration
  sandboxId: string;
  isolationType: 'process' | 'container' | 'vm';
  
  resourceLimits: ISandboxResourceLimits;
  networkPolicy: ISandboxNetworkPolicy;
  filesystemPolicy: ISandboxFilesystemPolicy;
  
  // Container/Process details
  containerId?: string;
  processId?: number;
  dockerImage?: string;
  hostname?: string;
  
  // Execution state
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
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastHeartbeatAt?: Date;
  
  queueTimeMs?: number;
  startupTimeMs?: number;
  executionTimeMs?: number;
  totalTimeMs?: number;
  
  // Resource usage tracking
  resourceUsageSnapshots: IResourceUsageSnapshot[];
  
  peakCpuUsagePercent?: number;
  peakMemoryUsageMB?: number;
  peakDiskUsageMB?: number;
  totalNetworkBytesSent?: number;
  totalNetworkBytesReceived?: number;
  
  // Budget tracking
  estimatedCost: number;
  actualCost?: number;
  budgetReservationId?: string;
  
  // Token tracking
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  
  // Execution details
  command?: string;
  arguments?: string[];
  environmentVariables?: Record<string, string>;
  workingDirectory?: string;
  
  // Input/Output
  inputData?: any;
  outputData?: any;
  
  // Exit information
  exitCode?: number;
  exitSignal?: string;
  errorMessage?: string;
  errorStack?: string;
  
  // Security and violations
  securityViolations: ISecurityViolation[];
  policiesViolated?: string[];
  
  // Kill-switch
  killRequested: boolean;
  killRequestedAt?: Date;
  killRequestedBy?: mongoose.Types.ObjectId;
  killReason?: string;
  forceKilled: boolean;
  
  // Health monitoring
  healthCheckStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastHealthCheckAt?: Date;
  healthCheckFailures: number;
  
  // Logs and traces
  logStreamUrl?: string;
  traceId?: string;
  spanId?: string;
  
  // Metadata
  tags?: string[];
  customMetadata?: Record<string, any>;
}

const SandboxResourceLimitsSchema = new Schema<ISandboxResourceLimits>({
  maxCpuCores: { type: Number, required: true, min: 0.1, max: 8 },
  maxMemoryMB: { type: Number, required: true, min: 128, max: 8192 },
  maxDiskMB: { type: Number, required: true, min: 10, max: 2048 },
  maxExecutionTimeSeconds: { type: Number, required: true, min: 10, max: 3600 },
  maxNetworkBandwidthMbps: { type: Number, min: 1, max: 1000 },
  maxFileDescriptors: { type: Number, min: 10, max: 10000 }
}, { _id: false });

const SandboxNetworkPolicySchema = new Schema<ISandboxNetworkPolicy>({
  allowOutbound: { type: Boolean, required: true, default: true },
  allowInbound: { type: Boolean, required: true, default: false },
  allowedEndpoints: [String],
  blockedEndpoints: [String],
  allowDNS: { type: Boolean, default: true },
  allowedPorts: [Number]
}, { _id: false });

const SandboxFilesystemPolicySchema = new Schema<ISandboxFilesystemPolicy>({
  rootPath: { type: String, required: true },
  readOnlyPaths: [String],
  writablePaths: [String],
  tempDirectory: { type: String, required: true },
  maxFileSize: { type: Number, required: true },
  allowedFileTypes: [String]
}, { _id: false });

const ResourceUsageSnapshotSchema = new Schema<IResourceUsageSnapshot>({
  timestamp: { type: Date, required: true },
  cpuUsagePercent: { type: Number, required: true },
  memoryUsageMB: { type: Number, required: true },
  diskUsageMB: { type: Number, required: true },
  networkBytesSent: { type: Number, required: true },
  networkBytesReceived: { type: Number, required: true },
  threadCount: Number,
  fileDescriptorCount: Number
}, { _id: false });

const SecurityViolationSchema = new Schema<ISecurityViolation>({
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
      'other'
    ],
    required: true
  },
  severity: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'],
    required: true
  },
  description: { type: String, required: true },
  actionTaken: { 
    type: String, 
    enum: ['logged', 'blocked', 'killed', 'escalated'],
    required: true
  },
  details: Schema.Types.Mixed
}, { _id: false });

const AgentExecutionSchema = new Schema<IAgentExecution>({
  // Identity
  executionId: { 
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
  decisionId: { 
    type: String,
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
  
  // Request
  requestId: String,
  correlationId: { 
    type: String,
    index: true 
  },
  parentExecutionId: { 
    type: String,
    index: true 
  },
  
  // Sandbox
  sandboxId: { 
    type: String, 
    required: true,
    index: true 
  },
  isolationType: { 
    type: String, 
    enum: ['process', 'container', 'vm'],
    required: true
  },
  
  resourceLimits: { 
    type: SandboxResourceLimitsSchema, 
    required: true 
  },
  networkPolicy: { 
    type: SandboxNetworkPolicySchema, 
    required: true 
  },
  filesystemPolicy: { 
    type: SandboxFilesystemPolicySchema, 
    required: true 
  },
  
  // Container/Process
  containerId: String,
  processId: Number,
  dockerImage: String,
  hostname: String,
  
  // State
  status: { 
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
      'policy_violated'
    ],
    required: true,
    default: 'queued',
    index: true
  },
  
  // Timing
  queuedAt: { type: Date, required: true, default: Date.now },
  startedAt: Date,
  completedAt: Date,
  lastHeartbeatAt: Date,
  
  queueTimeMs: Number,
  startupTimeMs: Number,
  executionTimeMs: Number,
  totalTimeMs: Number,
  
  // Resource tracking
  resourceUsageSnapshots: [ResourceUsageSnapshotSchema],
  
  peakCpuUsagePercent: Number,
  peakMemoryUsageMB: Number,
  peakDiskUsageMB: Number,
  totalNetworkBytesSent: Number,
  totalNetworkBytesReceived: Number,
  
  // Budget
  estimatedCost: { type: Number, required: true },
  actualCost: Number,
  budgetReservationId: String,
  
  // Tokens
  inputTokens: Number,
  outputTokens: Number,
  totalTokens: Number,
  
  // Execution
  command: String,
  arguments: [String],
  environmentVariables: Schema.Types.Mixed,
  workingDirectory: String,
  
  // I/O
  inputData: Schema.Types.Mixed,
  outputData: Schema.Types.Mixed,
  
  // Exit
  exitCode: Number,
  exitSignal: String,
  errorMessage: String,
  errorStack: String,
  
  // Security
  securityViolations: { 
    type: [SecurityViolationSchema], 
    default: [] 
  },
  policiesViolated: [String],
  
  // Kill-switch
  killRequested: { type: Boolean, default: false, index: true },
  killRequestedAt: Date,
  killRequestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  killReason: String,
  forceKilled: { type: Boolean, default: false },
  
  // Health
  healthCheckStatus: { 
    type: String, 
    enum: ['healthy', 'degraded', 'unhealthy', 'unknown'],
    default: 'unknown'
  },
  lastHealthCheckAt: Date,
  healthCheckFailures: { type: Number, default: 0 },
  
  // Observability
  logStreamUrl: String,
  traceId: String,
  spanId: String,
  
  // Metadata
  tags: [String],
  customMetadata: Schema.Types.Mixed
}, {
  timestamps: true,
  collection: 'agent_executions'
});

// Indexes for common queries
AgentExecutionSchema.index({ agentId: 1, status: 1, queuedAt: -1 });
AgentExecutionSchema.index({ userId: 1, queuedAt: -1 });
AgentExecutionSchema.index({ status: 1, queuedAt: -1 });
AgentExecutionSchema.index({ sandboxId: 1 });
AgentExecutionSchema.index({ containerId: 1 }, { sparse: true });
AgentExecutionSchema.index({ 'securityViolations.severity': 1 });
AgentExecutionSchema.index({ killRequested: 1, status: 1 });

// TTL index for cleanup of old executions (90 days)
AgentExecutionSchema.index({ completedAt: 1 }, { expireAfterSeconds: 7776000, sparse: true });

// Instance methods
AgentExecutionSchema.methods.isRunning = function(): boolean {
  return ['queued', 'provisioning', 'starting', 'running'].includes(this.status);
};

AgentExecutionSchema.methods.isCompleted = function(): boolean {
  return ['completed', 'failed', 'timeout', 'killed', 'resource_exceeded', 'policy_violated'].includes(this.status);
};

AgentExecutionSchema.methods.hasViolations = function(): boolean {
  return this.securityViolations.length > 0;
};

AgentExecutionSchema.methods.hasCriticalViolations = function(): boolean {
  return this.securityViolations.some((v: ISecurityViolation) => v.severity === 'critical');
};

AgentExecutionSchema.methods.isHealthy = function(): boolean {
  return this.healthCheckStatus === 'healthy' && 
         this.healthCheckFailures === 0 &&
         !this.killRequested;
};

AgentExecutionSchema.methods.getResourceUtilization = function(): number {
  if (!this.resourceUsageSnapshots.length) return 0;
  
  const latest = this.resourceUsageSnapshots[this.resourceUsageSnapshots.length - 1];
  const cpuUtil = latest.cpuUsagePercent / (this.resourceLimits.maxCpuCores * 100);
  const memUtil = latest.memoryUsageMB / this.resourceLimits.maxMemoryMB;
  const diskUtil = latest.diskUsageMB / this.resourceLimits.maxDiskMB;
  
  return Math.max(cpuUtil, memUtil, diskUtil);
};

AgentExecutionSchema.methods.shouldKill = function(): boolean {
  // Kill if explicitly requested
  if (this.killRequested) return true;
  
  // Kill if critical violations
  if (this.hasCriticalViolations()) return true;
  
  // Kill if execution time exceeded
  if (this.startedAt) {
    const elapsedSeconds = (Date.now() - this.startedAt.getTime()) / 1000;
    if (elapsedSeconds > this.resourceLimits.maxExecutionTimeSeconds) return true;
  }
  
  // Kill if health checks failing
  if (this.healthCheckFailures >= 3) return true;
  
  return false;
};

export const AgentExecution = mongoose.model<IAgentExecution>('AgentExecution', AgentExecutionSchema);

