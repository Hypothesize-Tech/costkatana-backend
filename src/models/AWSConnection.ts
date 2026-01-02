import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * AWS Connection Model - Enterprise Grade Security
 * 
 * Security Guarantees:
 * - No long-term credentials stored (only role ARN and external ID)
 * - External ID is encrypted at rest
 * - Unique external ID per customer (confused deputy prevention)
 * - Per-environment role tracking (prod/staging/dev)
 * - Session duration limits (15-60 min)
 */

export type PermissionMode = 'read-only' | 'read-write' | 'custom';
export type ExecutionMode = 'simulation' | 'live';
export type ConnectionStatus = 'active' | 'inactive' | 'error' | 'pending_verification';
export type Environment = 'production' | 'staging' | 'development';

export interface IAllowedService {
  service: string;
  actions: string[];
  regions: string[];
}

export interface ISessionConfig {
  maxDurationSeconds: number;  // 15-60 min (900-3600 seconds)
  autoRenew: boolean;
  idleTimeoutSeconds: number;
}

export interface ISimulationConfig {
  enabled: boolean;
  periodDays: number;  // Days before live execution allowed
  startedAt?: Date;
  promotedToLiveAt?: Date;
}

export interface IConnectionHealth {
  lastChecked: Date;
  lastSuccessful?: Date;
  consecutiveFailures: number;
  lastError?: string;
  assumeRoleLatencyMs?: number;
}

export interface IAWSConnection extends Document {
  _id: Types.ObjectId;
  
  // Ownership
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
  
  // Connection Identity
  connectionName: string;
  description?: string;
  environment: Environment;
  
  // AWS Role Configuration (NO ACCESS KEYS)
  roleArn: string;  // arn:aws:iam::123456789012:role/CostKatanaRole
  externalId: string;  // Encrypted, unique per customer
  externalIdHash: string;  // SHA-256 for audit proof
  awsAccountId: string;  // Extracted from role ARN
  
  // Permission Configuration
  permissionMode: PermissionMode;
  allowedServices: IAllowedService[];
  allowedRegions: string[];
  deniedActions: string[];  // Explicit deny list
  
  // Session Configuration
  sessionConfig: ISessionConfig;
  
  // Execution Mode (Simulation Support)
  executionMode: ExecutionMode;
  simulationConfig: ISimulationConfig;
  
  // Connection Health
  status: ConnectionStatus;
  health: IConnectionHealth;
  
  // Usage Tracking
  lastUsed?: Date;
  totalExecutions: number;
  totalApiCalls: number;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: Types.ObjectId;
  lastModifiedBy?: Types.ObjectId;
  
  // Methods
  isHealthy(): boolean;
  canExecuteLive(): boolean;
  getDecryptedExternalId(): string;
  updateHealth(success: boolean, error?: string, latencyMs?: number): Promise<void>;
}

// Encryption key from environment (should be in secrets manager in production)
const ENCRYPTION_KEY = process.env.AWS_CONNECTION_ENCRYPTION_KEY ?? 'costkatana-default-key-change-in-prod';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

const allowedServiceSchema = new Schema<IAllowedService>({
  service: {
    type: String,
    required: true,
    trim: true,
  },
  actions: [{
    type: String,
    trim: true,
  }],
  regions: [{
    type: String,
    trim: true,
  }],
}, { _id: false });

const sessionConfigSchema = new Schema<ISessionConfig>({
  maxDurationSeconds: {
    type: Number,
    default: 900,  // 15 minutes
    min: 900,      // Minimum 15 minutes (AWS STS minimum)
    max: 3600,     // Maximum 1 hour
  },
  autoRenew: {
    type: Boolean,
    default: false,
  },
  idleTimeoutSeconds: {
    type: Number,
    default: 300,  // 5 minutes idle timeout
  },
}, { _id: false });

const simulationConfigSchema = new Schema<ISimulationConfig>({
  enabled: {
    type: Boolean,
    default: true,  // Default to simulation mode for safety
  },
  periodDays: {
    type: Number,
    default: 7,  // 7 days simulation before live
    min: 0,
    max: 90,
  },
  startedAt: Date,
  promotedToLiveAt: Date,
}, { _id: false });

const connectionHealthSchema = new Schema<IConnectionHealth>({
  lastChecked: {
    type: Date,
    default: Date.now,
  },
  lastSuccessful: Date,
  consecutiveFailures: {
    type: Number,
    default: 0,
  },
  lastError: String,
  assumeRoleLatencyMs: Number,
}, { _id: false });

const awsConnectionSchema = new Schema<IAWSConnection>({
  // Ownership
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
    index: true,
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    index: true,
  },
  
  // Connection Identity
  connectionName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  environment: {
    type: String,
    enum: ['production', 'staging', 'development'],
    default: 'development',
    index: true,
  },
  
  // AWS Role Configuration
  roleArn: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: (v: string) => /^arn:aws:iam::\d{12}:role\/[\w+=,.@-]+$/.test(v),
      message: 'Invalid IAM role ARN format',
    },
  },
  externalId: {
    type: String,
    required: true,
    // Encrypted value stored here
  },
  externalIdHash: {
    type: String,
    required: true,
    unique: true,  // Ensure uniqueness across all customers
    index: true,
  },
  awsAccountId: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => /^\d{12}$/.test(v),
      message: 'AWS Account ID must be 12 digits',
    },
    index: true,
  },
  
  // Permission Configuration
  permissionMode: {
    type: String,
    enum: ['read-only', 'read-write', 'custom'],
    default: 'read-only',
  },
  allowedServices: {
    type: [allowedServiceSchema],
    default: [],
  },
  allowedRegions: {
    type: [String],
    default: ['us-east-1'],
  },
  deniedActions: {
    type: [String],
    default: [
      // Always denied - critical security
      'iam:*',
      'organizations:*',
      'account:*',
      'billing:*',
      'aws-portal:*',
      'support:*',
      // Destructive operations
      'ec2:TerminateInstances',
      'ec2:DeleteVolume',
      'ec2:DeleteSnapshot',
      's3:DeleteBucket',
      's3:DeleteObject',
      'rds:DeleteDBInstance',
      'rds:DeleteDBCluster',
      'lambda:DeleteFunction',
      'dynamodb:DeleteTable',
    ],
  },
  
  // Session Configuration
  sessionConfig: {
    type: sessionConfigSchema,
    default: () => ({}),
  },
  
  // Execution Mode
  executionMode: {
    type: String,
    enum: ['simulation', 'live'],
    default: 'simulation',
  },
  simulationConfig: {
    type: simulationConfigSchema,
    default: () => ({}),
  },
  
  // Connection Health
  status: {
    type: String,
    enum: ['active', 'inactive', 'error', 'pending_verification'],
    default: 'pending_verification',
    index: true,
  },
  health: {
    type: connectionHealthSchema,
    default: () => ({}),
  },
  
  // Usage Tracking
  lastUsed: Date,
  totalExecutions: {
    type: Number,
    default: 0,
  },
  totalApiCalls: {
    type: Number,
    default: 0,
  },
  
  // Audit
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
awsConnectionSchema.index({ userId: 1, environment: 1 });
awsConnectionSchema.index({ workspaceId: 1, status: 1 });
awsConnectionSchema.index({ awsAccountId: 1, environment: 1 }, { unique: true });
awsConnectionSchema.index({ externalIdHash: 1 }, { unique: true });

// Pre-save middleware to extract AWS account ID from role ARN
awsConnectionSchema.pre('save', function(next) {
  if (this.isModified('roleArn')) {
    const match = this.roleArn.match(/arn:aws:iam::(\d{12}):role\//);
    if (match) {
      this.awsAccountId = match[1];
    }
  }
  next();
});

// Methods
awsConnectionSchema.methods.isHealthy = function(this: IAWSConnection): boolean {
  return this.status === 'active' && 
         this.health.consecutiveFailures < 3 &&
         (!this.health.lastChecked || 
          (Date.now() - this.health.lastChecked.getTime()) < 3600000); // 1 hour
};

awsConnectionSchema.methods.canExecuteLive = function(this: IAWSConnection): boolean {
  if (this.executionMode === 'live') {
    return true;
  }
  
  if (!this.simulationConfig.enabled) {
    return true;
  }
  
  if (!this.simulationConfig.startedAt) {
    return false;
  }
  
  const daysSinceStart = (Date.now() - this.simulationConfig.startedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceStart >= this.simulationConfig.periodDays;
};

awsConnectionSchema.methods.getDecryptedExternalId = function(this: IAWSConnection): string {
  return decrypt(this.externalId);
};

awsConnectionSchema.methods.updateHealth = async function(
  this: IAWSConnection,
  success: boolean, 
  error?: string, 
  latencyMs?: number
): Promise<void> {
  this.health.lastChecked = new Date();
  
  if (success) {
    this.health.lastSuccessful = new Date();
    this.health.consecutiveFailures = 0;
    this.health.lastError = undefined;
    this.status = 'active';
  } else {
    this.health.consecutiveFailures += 1;
    this.health.lastError = error;
    
    if (this.health.consecutiveFailures >= 3) {
      this.status = 'error';
    }
  }
  
  if (latencyMs !== undefined) {
    this.health.assumeRoleLatencyMs = latencyMs;
  }
  
  await this.save();
};

// Static methods
awsConnectionSchema.statics.findByExternalIdHash = function(hash: string) {
  return this.findOne({ externalIdHash: hash });
};

awsConnectionSchema.statics.findActiveByUser = function(userId: Types.ObjectId) {
  return this.find({ userId, status: 'active' });
};

awsConnectionSchema.statics.findByAwsAccount = function(accountId: string) {
  return this.find({ awsAccountId: accountId });
};

// Export encryption utilities for use in services
export const encryptExternalId = encrypt;
export const decryptExternalId = decrypt;

export const AWSConnection = mongoose.model<IAWSConnection>('AWSConnection', awsConnectionSchema);
