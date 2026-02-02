import mongoose, { Document, Schema } from 'mongoose';

/**
 * Agent Capability - Defines specific capabilities an agent can perform
 */
export interface IAgentCapability {
  name: string;
  description: string;
  requiredPermissions: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Agent Identity - Core identity and RBAC for autonomous agents
 * Implements Principle of Least Privilege and Zero Trust
 */
export interface IAgentIdentity extends Document {
  agentId: string;
  agentName: string;
  agentType: 'recommendation' | 'github' | 'multiagent' | 'custom' | 'agent_trace' | 'automation';
  
  // Ownership and hierarchy
  userId: mongoose.Types.ObjectId;
  workspaceId?: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  
  // Authentication
  tokenHash: string; // Hashed agent token for service account style auth
  tokenPrefix: string; // e.g., "ck-agent-" for display
  
  // Authorization - Deny by default
  allowedModels: string[]; // Specific model IDs allowed
  allowedProviders: string[]; // e.g., ['anthropic', 'openai', 'bedrock']
  allowedActions: ('read' | 'write' | 'delete' | 'execute' | 'admin')[]; // Explicit action permissions
  
  // Capabilities - Opt-in capabilities
  capabilities: IAgentCapability[];
  
  // Resource constraints - Defense in depth
  budgetCapPerRequest: number; // Max cost per single request in USD
  budgetCapPerDay: number; // Max daily budget in USD
  budgetCapPerMonth: number; // Max monthly budget in USD
  
  // Rate limiting
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
  maxConcurrentExecutions: number;
  
  // Sandbox requirements
  sandboxRequired: boolean; // If true, must execute in isolated sandbox
  sandboxConfig?: {
    maxCpuCores: number;
    maxMemoryMB: number;
    maxDiskMB: number;
    maxExecutionTimeSeconds: number;
    allowedNetworkEndpoints: string[];
    allowedFilesystemPaths: string[];
    isolationLevel: 'process' | 'container' | 'vm';
  };
  
  // Security settings
  ipWhitelist?: string[]; // Allowed IP addresses for agent requests
  requireMfa: boolean; // If true, requires user MFA for sensitive actions
  allowedTimeWindows?: Array<{
    startHour: number;
    endHour: number;
    daysOfWeek: number[]; // 0-6, Sunday-Saturday
  }>;
  
  // Audit and compliance
  auditLevel: 'minimal' | 'standard' | 'comprehensive' | 'forensic';
  retentionPeriodDays: number;
  requireReasoningCapture: boolean; // Capture decision reasoning
  requireHumanApproval: string[]; // Actions requiring human approval
  
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
}

const AgentCapabilitySchema = new Schema<IAgentCapability>({
  name: { type: String, required: true },
  description: { type: String, required: true },
  requiredPermissions: [{ type: String }],
  riskLevel: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'critical'], 
    required: true,
    default: 'medium'
  }
}, { _id: false });

const AgentIdentitySchema = new Schema<IAgentIdentity>({
  agentId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  agentName: { 
    type: String, 
    required: true 
  },
  agentType: { 
    type: String, 
    enum: ['recommendation', 'github', 'multiagent', 'custom', 'agent_trace', 'automation'],
    required: true,
    index: true
  },
  
  // Ownership
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
  
  // Authentication
  tokenHash: { 
    type: String, 
    required: true,
    select: false // Never return in queries by default
  },
  tokenPrefix: { 
    type: String, 
    required: true 
  },
  
  // Authorization - Default to empty (deny all)
  allowedModels: { 
    type: [String], 
    default: [] 
  },
  allowedProviders: { 
    type: [String], 
    default: [] 
  },
  allowedActions: { 
    type: [String], 
    enum: ['read', 'write', 'delete', 'execute', 'admin'],
    default: ['read'] // Read-only by default
  },
  
  // Capabilities
  capabilities: { 
    type: [AgentCapabilitySchema], 
    default: [] 
  },
  
  // Resource constraints - Conservative defaults
  budgetCapPerRequest: { 
    type: Number, 
    required: true,
    default: 0.10, // $0.10 per request
    min: 0,
    max: 100
  },
  budgetCapPerDay: { 
    type: Number, 
    required: true,
    default: 1.00, // $1 per day
    min: 0
  },
  budgetCapPerMonth: { 
    type: Number, 
    required: true,
    default: 10.00, // $10 per month
    min: 0
  },
  
  // Rate limiting - Conservative defaults
  maxRequestsPerMinute: { 
    type: Number, 
    default: 10,
    min: 1,
    max: 1000
  },
  maxRequestsPerHour: { 
    type: Number, 
    default: 100,
    min: 1,
    max: 10000
  },
  maxConcurrentExecutions: { 
    type: Number, 
    default: 2,
    min: 1,
    max: 50
  },
  
  // Sandbox - Required by default for safety
  sandboxRequired: { 
    type: Boolean, 
    default: true 
  },
  sandboxConfig: {
    maxCpuCores: { 
      type: Number, 
      default: 0.5,
      min: 0.1,
      max: 4
    },
    maxMemoryMB: { 
      type: Number, 
      default: 512,
      min: 128,
      max: 4096
    },
    maxDiskMB: { 
      type: Number, 
      default: 100,
      min: 10,
      max: 1024
    },
    maxExecutionTimeSeconds: { 
      type: Number, 
      default: 300, // 5 minutes
      min: 10,
      max: 3600
    },
    allowedNetworkEndpoints: [String],
    allowedFilesystemPaths: [String],
    isolationLevel: { 
      type: String, 
      enum: ['process', 'container', 'vm'],
      default: 'container'
    }
  },
  
  // Security
  ipWhitelist: [String],
  requireMfa: { 
    type: Boolean, 
    default: false 
  },
  allowedTimeWindows: [{
    startHour: { type: Number, min: 0, max: 23 },
    endHour: { type: Number, min: 0, max: 23 },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }]
  }],
  
  // Audit
  auditLevel: { 
    type: String, 
    enum: ['minimal', 'standard', 'comprehensive', 'forensic'],
    default: 'comprehensive'
  },
  retentionPeriodDays: { 
    type: Number, 
    default: 2555 // 7 years for compliance
  },
  requireReasoningCapture: { 
    type: Boolean, 
    default: true 
  },
  requireHumanApproval: [String],
  
  // State
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'revoked', 'expired'],
    default: 'active',
    index: true
  },
  lastUsedAt: Date,
  expiresAt: Date,
  
  // Usage tracking
  totalRequests: { 
    type: Number, 
    default: 0 
  },
  totalCost: { 
    type: Number, 
    default: 0 
  },
  totalTokens: { 
    type: Number, 
    default: 0 
  },
  failureCount: { 
    type: Number, 
    default: 0 
  },
  lastFailureAt: Date,
  lastFailureReason: String,
  
  // Metadata
  description: String,
  tags: [String],
  customMetadata: Schema.Types.Mixed
}, {
  timestamps: true,
  collection: 'agent_identities'
});

// Indexes for performance
AgentIdentitySchema.index({ userId: 1, status: 1 });
AgentIdentitySchema.index({ workspaceId: 1, status: 1 });
AgentIdentitySchema.index({ organizationId: 1, status: 1 });
AgentIdentitySchema.index({ agentType: 1, status: 1 });
AgentIdentitySchema.index({ expiresAt: 1 }, { sparse: true });
AgentIdentitySchema.index({ 'sandboxConfig.isolationLevel': 1 });

// Pre-save validation
AgentIdentitySchema.pre('save', function(next) {
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
AgentIdentitySchema.methods.isExpired = function(): boolean {
  return this.expiresAt ? this.expiresAt < new Date() : false;
};

AgentIdentitySchema.methods.isActive = function(): boolean {
  return this.status === 'active' && !this.isExpired();
};

AgentIdentitySchema.methods.canExecuteAction = function(action: string): boolean {
  return this.isActive() && this.allowedActions.includes(action);
};

AgentIdentitySchema.methods.canUseModel = function(model: string): boolean {
  return this.isActive() && (
    this.allowedModels.length === 0 || // Empty = all allowed (legacy)
    this.allowedModels.includes(model) ||
    this.allowedModels.includes('*') // Wildcard
  );
};

AgentIdentitySchema.methods.canUseProvider = function(provider: string): boolean {
  return this.isActive() && (
    this.allowedProviders.length === 0 || // Empty = all allowed (legacy)
    this.allowedProviders.includes(provider) ||
    this.allowedProviders.includes('*') // Wildcard
  );
};

export const AgentIdentity = mongoose.model<IAgentIdentity>('AgentIdentity', AgentIdentitySchema);

