import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * AWS Audit Log Model - Immutable Hash-Chained Audit Trail
 * 
 * Security Guarantees:
 * - Hash-chained audit entries (SHA-256)
 * - Previous hash reference for tamper detection
 * - Complete traceability: who, what, when, why, which permission
 * - Decision traces for blocked actions
 * - AWS request IDs for CloudTrail correlation
 * - Periodic hash anchoring to external store
 */

export type AuditEventType = 
  | 'connection_created'
  | 'connection_updated'
  | 'connection_deleted'
  | 'intent_parsed'
  | 'plan_generated'
  | 'plan_approved'
  | 'plan_rejected'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'execution_cancelled'
  | 'rollback_executed'
  | 'kill_switch_activated'
  | 'kill_switch_deactivated'
  | 'permission_denied'
  | 'rate_limit_exceeded'
  | 'cost_anomaly_detected'
  | 'simulation_executed'
  | 'credentials_issued'
  | 'credentials_expired'
  | 'ec2_instances_listed'
  | 'ec2_instances_stopped'
  | 'ec2_instances_started'
  | 's3_buckets_listed'
  | 'rds_instances_listed'
  | 'lambda_functions_listed'
  | 'costs_retrieved'
  | 'cost_breakdown_retrieved'
  | 'cost_forecast_retrieved'
  | 'cost_anomalies_retrieved'
  | 'optimization_recommendations_retrieved';

export type AuditResult = 'success' | 'failure' | 'blocked' | 'pending';

export interface IAuditContext {
  userId: Types.ObjectId;
  connectionId?: Types.ObjectId;
  workspaceId?: Types.ObjectId;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IAuditAction {
  service?: string;
  operation?: string;
  resources?: string[];
  parameters?: Record<string, any>;
  dslHash?: string;
  dslVersion?: string;
  planId?: string;
}

export interface IAuditImpact {
  resourceCount?: number;
  costChange?: number;
  riskLevel?: string;
  awsRequestIds?: string[];
  cloudTrailEventIds?: string[];
}

export interface IAWSAuditLog extends Document {
  _id: Types.ObjectId;
  
  // Chain integrity
  entryId: string;           // Unique entry ID
  previousHash: string;       // Hash of previous entry
  entryHash: string;          // Hash of this entry
  chainPosition: number;      // Position in chain
  
  // Event identification
  eventType: AuditEventType;
  timestamp: Date;
  
  // Context (who)
  context: IAuditContext;
  
  // Action (what)
  action: IAuditAction;
  
  // Result
  result: AuditResult;
  error?: string;
  
  // Impact
  impact?: IAuditImpact;
  
  // Decision trace (why)
  decisionTrace?: {
    intent?: string;
    interpretation?: string;
    approvalStatus?: string;
    blockedReason?: string;
    permissionCheck?: {
      allowed: boolean;
      reason?: string;
    };
  };
  
  // Metadata
  metadata?: Record<string, any>;
  
  // Anchor reference (for external verification)
  anchorId?: string;
  anchoredAt?: Date;
  
  // Timestamps
  createdAt: Date;
  
  // Methods
  verifyIntegrity(): boolean;
  toAuditString(): string;
}

const auditContextSchema = new Schema<IAuditContext>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  connectionId: {
    type: Schema.Types.ObjectId,
    ref: 'AWSConnection',
  },
  workspaceId: {
    type: Schema.Types.ObjectId,
    ref: 'Workspace',
  },
  sessionId: String,
  ipAddress: String,
  userAgent: String,
}, { _id: false });

const auditActionSchema = new Schema<IAuditAction>({
  service: String,
  operation: String,
  resources: [String],
  parameters: Schema.Types.Mixed,
  dslHash: String,
  dslVersion: String,
  planId: String,
}, { _id: false });

const auditImpactSchema = new Schema<IAuditImpact>({
  resourceCount: Number,
  costChange: Number,
  riskLevel: String,
  awsRequestIds: [String],
  cloudTrailEventIds: [String],
}, { _id: false });

const awsAuditLogSchema = new Schema<IAWSAuditLog>({
  // Chain integrity
  entryId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  previousHash: {
    type: String,
    required: true,
    index: true,
  },
  entryHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  chainPosition: {
    type: Number,
    required: true,
    index: true,
  },
  
  // Event identification
  eventType: {
    type: String,
    enum: [
      'connection_created',
      'connection_updated',
      'connection_deleted',
      'intent_parsed',
      'plan_generated',
      'plan_approved',
      'plan_rejected',
      'execution_started',
      'execution_completed',
      'execution_failed',
      'execution_cancelled',
      'rollback_executed',
      'kill_switch_activated',
      'kill_switch_deactivated',
      'permission_denied',
      'rate_limit_exceeded',
      'cost_anomaly_detected',
      'simulation_executed',
      'credentials_issued',
      'credentials_expired',
    ],
    required: true,
    index: true,
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  
  // Context
  context: {
    type: auditContextSchema,
    required: true,
  },
  
  // Action
  action: {
    type: auditActionSchema,
    default: {},
  },
  
  // Result
  result: {
    type: String,
    enum: ['success', 'failure', 'blocked', 'pending'],
    required: true,
    index: true,
  },
  error: String,
  
  // Impact
  impact: {
    type: auditImpactSchema,
    default: {},
  },
  
  // Decision trace
  decisionTrace: {
    intent: String,
    interpretation: String,
    approvalStatus: String,
    blockedReason: String,
    permissionCheck: {
      allowed: Boolean,
      reason: String,
    },
  },
  
  // Metadata
  metadata: Schema.Types.Mixed,
  
  // Anchor reference
  anchorId: {
    type: String,
    index: true,
  },
  anchoredAt: Date,
}, {
  timestamps: { createdAt: true, updatedAt: false },
  // Prevent updates to audit logs
  strict: true,
});

// Compound indexes for efficient queries
awsAuditLogSchema.index({ 'context.userId': 1, timestamp: -1 });
awsAuditLogSchema.index({ 'context.connectionId': 1, timestamp: -1 });
awsAuditLogSchema.index({ eventType: 1, timestamp: -1 });
awsAuditLogSchema.index({ result: 1, timestamp: -1 });
awsAuditLogSchema.index({ 'action.planId': 1 });

// Methods
awsAuditLogSchema.methods.verifyIntegrity = function(this: IAWSAuditLog): boolean {
  const calculatedHash = calculateEntryHash(this);
  return calculatedHash === this.entryHash;
};

awsAuditLogSchema.methods.toAuditString = function(this: IAWSAuditLog): string {
  return JSON.stringify({
    entryId: this.entryId,
    eventType: this.eventType,
    timestamp: this.timestamp,
    context: {
      userId: this.context.userId?.toString(),
      connectionId: this.context.connectionId?.toString(),
    },
    action: this.action,
    result: this.result,
    entryHash: this.entryHash,
  }, null, 2);
};

// Static methods
awsAuditLogSchema.statics.getLatestEntry = async function() {
  return this.findOne().sort({ chainPosition: -1 }).exec();
};

awsAuditLogSchema.statics.verifyChain = async function(
  startPosition: number,
  endPosition: number
): Promise<{ valid: boolean; brokenAt?: number }> {
  const entries = await this.find({
    chainPosition: { $gte: startPosition, $lte: endPosition },
  }).sort({ chainPosition: 1 }).exec();
  
  for (let i = 1; i < entries.length; i++) {
    const current = entries[i];
    const previous = entries[i - 1];
    
    // Verify hash chain
    if (current.previousHash !== previous.entryHash) {
      return { valid: false, brokenAt: current.chainPosition };
    }
    
    // Verify entry integrity
    if (!current.verifyIntegrity()) {
      return { valid: false, brokenAt: current.chainPosition };
    }
  }
  
  return { valid: true };
};

// Helper function to calculate entry hash
function calculateEntryHash(entry: Partial<IAWSAuditLog>): string {
  const hashContent = JSON.stringify({
    entryId: entry.entryId,
    previousHash: entry.previousHash,
    chainPosition: entry.chainPosition,
    eventType: entry.eventType,
    timestamp: entry.timestamp?.toISOString(),
    context: {
      userId: entry.context?.userId?.toString(),
      connectionId: entry.context?.connectionId?.toString(),
      workspaceId: entry.context?.workspaceId?.toString(),
    },
    action: entry.action,
    result: entry.result,
    error: entry.error,
    impact: entry.impact,
    decisionTrace: entry.decisionTrace,
  });
  
  return crypto
    .createHash('sha256')
    .update(hashContent)
    .digest('hex');
}

// Pre-save middleware to prevent modifications
awsAuditLogSchema.pre('save', function(next) {
  if (!this.isNew) {
    const err = new Error('Audit log entries cannot be modified');
    return next(err);
  }
  next();
});

// Prevent updates
awsAuditLogSchema.pre('updateOne', function(next) {
  const err = new Error('Audit log entries cannot be modified');
  next(err);
});

awsAuditLogSchema.pre('updateMany', function(next) {
  const err = new Error('Audit log entries cannot be modified');
  next(err);
});

awsAuditLogSchema.pre('findOneAndUpdate', function(next) {
  const err = new Error('Audit log entries cannot be modified');
  next(err);
});

// Prevent deletes (except for admin cleanup of very old entries)
awsAuditLogSchema.pre('deleteOne', function(next) {
  const err = new Error('Audit log entries cannot be deleted');
  next(err);
});

awsAuditLogSchema.pre('deleteMany', function(next) {
  const err = new Error('Audit log entries cannot be deleted');
  next(err);
});

export const AWSAuditLog = mongoose.model<IAWSAuditLog>('AWSAuditLog', awsAuditLogSchema);

// Export helper for hash calculation
export const calculateAuditEntryHash = calculateEntryHash;
