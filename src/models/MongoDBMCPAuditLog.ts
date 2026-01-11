import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * MongoDB MCP Audit Log Model - Immutable Hash-Chained Audit Trail
 * 
 * Security Guarantees:
 * - Hash-chained audit entries (SHA-256)
 * - Previous hash reference for tamper detection
 * - Complete traceability of all MongoDB MCP operations
 * - Compliance with data governance standards
 * - Tool execution tracking with parameters
 */

export type MongoDBMCPEventType = 
  | 'connection_verified'
  | 'tool_executed'
  | 'query_executed'
  | 'write_executed'
  | 'schema_accessed'
  | 'data_exported'
  | 'operation_denied'
  | 'rate_limit_hit'
  | 'circuit_breaker_opened'
  | 'circuit_breaker_closed'
  | 'credential_expired'
  | 'policy_violation';

export type MongoDBMCPResult = 'success' | 'failure' | 'blocked' | 'throttled';

export interface IMongoDBMCPAuditContext {
  userId: Types.ObjectId;
  connectionId: Types.ObjectId;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IMongoDBMCPAuditAction {
  toolName?: string;
  method?: string;
  collection?: string;
  database?: string;
  operation?: string;
  parameters?: Record<string, any>;
  parametersHash?: string; // SHA-256 hash of sensitive parameters
  queryPattern?: string;
  affectedRecords?: number;
}

export interface IMongoDBMCPAuditImpact {
  documentsRead?: number;
  documentsWritten?: number;
  documentsModified?: number;
  documentsDeleted?: number;
  dataSize?: number; // in bytes
  executionTime?: number; // in milliseconds
  resourceUsage?: {
    cpu?: number;
    memory?: number;
  };
}

export interface IMongoDBMCPAuditLog extends Document {
  _id: Types.ObjectId;
  
  // Chain integrity
  entryId: string;
  previousHash: string;
  entryHash: string;
  chainPosition: number;
  
  // Event identification
  eventType: MongoDBMCPEventType;
  timestamp: Date;
  
  // Context (who)
  context: IMongoDBMCPAuditContext;
  
  // Action (what)
  action: IMongoDBMCPAuditAction;
  
  // Result
  result: MongoDBMCPResult;
  error?: string;
  errorCode?: string;
  
  // Impact
  impact?: IMongoDBMCPAuditImpact;
  
  // Decision trace (why)
  decisionTrace?: {
    policyCheck?: {
      allowed: boolean;
      reason?: string;
      violatedPolicies?: string[];
    };
    rateLimit?: {
      limit: number;
      remaining: number;
      reset: Date;
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

const mongodbMcpAuditContextSchema = new Schema<IMongoDBMCPAuditContext>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  connectionId: {
    type: Schema.Types.ObjectId,
    ref: 'MongoDBConnection',
    required: true,
    index: true,
  },
  sessionId: String,
  ipAddress: String,
  userAgent: String,
}, { _id: false });

const mongodbMcpAuditActionSchema = new Schema<IMongoDBMCPAuditAction>({
  toolName: String,
  method: String,
  collection: String,
  database: String,
  operation: String,
  parameters: Schema.Types.Mixed,
  parametersHash: String,
  queryPattern: String,
  affectedRecords: Number,
}, { _id: false });

const mongodbMcpAuditImpactSchema = new Schema<IMongoDBMCPAuditImpact>({
  documentsRead: Number,
  documentsWritten: Number,
  documentsModified: Number,
  documentsDeleted: Number,
  dataSize: Number,
  executionTime: Number,
  resourceUsage: {
    cpu: Number,
    memory: Number,
  },
}, { _id: false });

const mongodbMcpAuditLogSchema = new Schema<IMongoDBMCPAuditLog>({
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
      'connection_verified',
      'tool_executed',
      'query_executed',
      'write_executed',
      'schema_accessed',
      'data_exported',
      'operation_denied',
      'rate_limit_hit',
      'circuit_breaker_opened',
      'circuit_breaker_closed',
      'credential_expired',
      'policy_violation',
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
    type: mongodbMcpAuditContextSchema,
    required: true,
  },
  
  // Action
  action: {
    type: mongodbMcpAuditActionSchema,
    default: {},
  },
  
  // Result
  result: {
    type: String,
    enum: ['success', 'failure', 'blocked', 'throttled'],
    required: true,
    index: true,
  },
  error: String,
  errorCode: String,
  
  // Impact
  impact: {
    type: mongodbMcpAuditImpactSchema,
    default: {},
  },
  
  // Decision trace
  decisionTrace: {
    policyCheck: {
      allowed: Boolean,
      reason: String,
      violatedPolicies: [String],
    },
    rateLimit: {
      limit: Number,
      remaining: Number,
      reset: Date,
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
  strict: true,
});

// Compound indexes for efficient queries
mongodbMcpAuditLogSchema.index({ 'context.userId': 1, timestamp: -1 });
mongodbMcpAuditLogSchema.index({ 'context.connectionId': 1, timestamp: -1 });
mongodbMcpAuditLogSchema.index({ eventType: 1, timestamp: -1 });
mongodbMcpAuditLogSchema.index({ result: 1, timestamp: -1 });
mongodbMcpAuditLogSchema.index({ 'action.collection': 1, timestamp: -1 });
mongodbMcpAuditLogSchema.index({ 'action.operation': 1, timestamp: -1 });

// Methods
mongodbMcpAuditLogSchema.methods.verifyIntegrity = function(this: IMongoDBMCPAuditLog): boolean {
  const calculatedHash = calculateEntryHash(this);
  return calculatedHash === this.entryHash;
};

mongodbMcpAuditLogSchema.methods.toAuditString = function(this: IMongoDBMCPAuditLog): string {
  return JSON.stringify({
    entryId: this.entryId,
    eventType: this.eventType,
    timestamp: this.timestamp,
    context: {
      userId: this.context.userId?.toString(),
      connectionId: this.context.connectionId?.toString(),
    },
    action: {
      toolName: this.action.toolName,
      method: this.action.method,
      collection: this.action.collection,
      operation: this.action.operation,
    },
    result: this.result,
    entryHash: this.entryHash,
  }, null, 2);
};

// Static methods
mongodbMcpAuditLogSchema.statics.getLatestEntry = async function() {
  return this.findOne().sort({ chainPosition: -1 }).exec();
};

mongodbMcpAuditLogSchema.statics.verifyChain = async function(
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
function calculateEntryHash(entry: Partial<IMongoDBMCPAuditLog>): string {
  const hashContent = JSON.stringify({
    entryId: entry.entryId,
    previousHash: entry.previousHash,
    chainPosition: entry.chainPosition,
    eventType: entry.eventType,
    timestamp: entry.timestamp?.toISOString(),
    context: {
      userId: entry.context?.userId?.toString(),
      connectionId: entry.context?.connectionId?.toString(),
    },
    action: {
      toolName: entry.action?.toolName,
      method: entry.action?.method,
      collection: entry.action?.collection,
      database: entry.action?.database,
      operation: entry.action?.operation,
      parametersHash: entry.action?.parametersHash,
    },
    result: entry.result,
    error: entry.error,
    errorCode: entry.errorCode,
    impact: entry.impact,
    decisionTrace: entry.decisionTrace,
  });
  
  return crypto
    .createHash('sha256')
    .update(hashContent)
    .digest('hex');
}

// Pre-save middleware to prevent modifications
mongodbMcpAuditLogSchema.pre('save', async function(next) {
  if (!this.isNew) {
    const err = new Error('MongoDB MCP audit log entries cannot be modified');
    return next(err);
  }
  
  // Generate hash chain data
  if (!this.entryId) {
    this.entryId = `mcp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
  
  // Get previous entry to maintain chain
  const previousEntry = await (this.constructor as any).getLatestEntry();
  if (previousEntry) {
    this.previousHash = previousEntry.entryHash;
    this.chainPosition = previousEntry.chainPosition + 1;
  } else {
    // Genesis entry
    this.previousHash = '0'.repeat(64);
    this.chainPosition = 0;
  }
  
  // Calculate hash for this entry
  this.entryHash = calculateEntryHash(this);
  
  next();
});

// Prevent updates
mongodbMcpAuditLogSchema.pre('updateOne', function(next) {
  const err = new Error('MongoDB MCP audit log entries cannot be modified');
  next(err);
});

mongodbMcpAuditLogSchema.pre('updateMany', function(next) {
  const err = new Error('MongoDB MCP audit log entries cannot be modified');
  next(err);
});

mongodbMcpAuditLogSchema.pre('findOneAndUpdate', function(next) {
  const err = new Error('MongoDB MCP audit log entries cannot be modified');
  next(err);
});

// Prevent deletes (except for admin cleanup of very old entries)
mongodbMcpAuditLogSchema.pre('deleteOne', function(next) {
  const err = new Error('MongoDB MCP audit log entries cannot be deleted');
  next(err);
});

mongodbMcpAuditLogSchema.pre('deleteMany', function(next) {
  const err = new Error('MongoDB MCP audit log entries cannot be deleted');
  next(err);
});

export const MongoDBMCPAuditLog = mongoose.model<IMongoDBMCPAuditLog>('MongoDBMCPAuditLog', mongodbMcpAuditLogSchema);

// Export helper for hash calculation
export const calculateMongoDBMCPAuditEntryHash = calculateEntryHash;

/**
 * Helper function to create audit log entry
 */
export async function createMongoDBMCPAuditLog(data: {
  eventType: MongoDBMCPEventType;
  context: IMongoDBMCPAuditContext;
  action?: Partial<IMongoDBMCPAuditAction>;
  result: MongoDBMCPResult;
  error?: string;
  errorCode?: string;
  impact?: Partial<IMongoDBMCPAuditImpact>;
  decisionTrace?: IMongoDBMCPAuditLog['decisionTrace'];
  metadata?: Record<string, any>;
}): Promise<IMongoDBMCPAuditLog> {
  try {
    // Hash sensitive parameters if present
    if (data.action?.parameters) {
      data.action.parametersHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(data.action.parameters))
        .digest('hex');
      
      // Remove sensitive data from stored parameters
      const sanitizedParams = { ...data.action.parameters };
      delete sanitizedParams.password;
      delete sanitizedParams.apiKey;
      delete sanitizedParams.secret;
      data.action.parameters = sanitizedParams;
    }
    
    const auditLog = new MongoDBMCPAuditLog({
      ...data,
      timestamp: new Date(),
    });
    
    await auditLog.save();
    return auditLog;
  } catch (error) {
    // Log error but don't fail the main operation
    console.error('Failed to create MongoDB MCP audit log:', error);
    throw error;
  }
}
