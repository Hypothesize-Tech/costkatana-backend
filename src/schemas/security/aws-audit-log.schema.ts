import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';
import * as crypto from 'crypto';

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
  userId: MongooseSchema.Types.ObjectId;
  connectionId?: MongooseSchema.Types.ObjectId;
  workspaceId?: MongooseSchema.Types.ObjectId;
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

export interface IPermissionCheck {
  allowed: boolean;
  reason?: string;
}

export interface IDecisionTrace {
  intent?: string;
  interpretation?: string;
  approvalStatus?: string;
  blockedReason?: string;
  permissionCheck?: IPermissionCheck;
}

export interface IAWSAuditLogMethods {
  verifyIntegrity(): boolean;
  toAuditString(): string;
}

export type AWSAuditLogDocument = HydratedDocument<
  AWSAuditLog,
  IAWSAuditLogMethods
>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
})
export class AWSAuditLog implements IAWSAuditLogMethods {
  // Chain integrity
  @Prop({ required: true, unique: true, index: true })
  entryId: string;

  @Prop({ required: true, index: true })
  previousHash: string;

  @Prop({ required: true, unique: true, index: true })
  entryHash: string;

  @Prop({ required: true, index: true })
  chainPosition: number;

  // Event identification
  @Prop({
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
  })
  eventType: AuditEventType;

  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  // Context
  @Prop({
    type: {
      userId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      connectionId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'AWSConnection',
      },
      workspaceId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'Workspace',
      },
      sessionId: String,
      ipAddress: String,
      userAgent: String,
    },
  })
  context: IAuditContext;

  // Action
  @Prop({
    type: {
      service: String,
      operation: String,
      resources: [String],
      parameters: mongoose.Schema.Types.Mixed,
      dslHash: String,
      dslVersion: String,
      planId: String,
    },
  })
  action?: IAuditAction;

  // Result
  @Prop({
    type: String,
    enum: ['success', 'failure', 'blocked', 'pending'],
    required: true,
    index: true,
  })
  result: AuditResult;

  @Prop()
  error?: string;

  // Impact
  @Prop({
    type: {
      resourceCount: Number,
      costChange: Number,
      riskLevel: String,
      awsRequestIds: [String],
      cloudTrailEventIds: [String],
    },
  })
  impact?: IAuditImpact;

  // Decision trace
  @Prop({
    type: {
      intent: String,
      interpretation: String,
      approvalStatus: String,
      blockedReason: String,
      permissionCheck: {
        allowed: Boolean,
        reason: String,
      },
    },
  })
  decisionTrace?: IDecisionTrace;

  // Metadata
  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: Record<string, any>;

  // Anchor reference
  @Prop({ index: true })
  anchorId?: string;

  @Prop()
  anchoredAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  // Methods
  verifyIntegrity(): boolean {
    const calculatedHash = calculateEntryHash(this);
    return calculatedHash === this.entryHash;
  }

  toAuditString(): string {
    return JSON.stringify(
      {
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
      },
      null,
      2,
    );
  }
}

export const AWSAuditLogSchema = SchemaFactory.createForClass(AWSAuditLog);

// Compound indexes for efficient queries
AWSAuditLogSchema.index({ 'context.userId': 1, timestamp: -1 });
AWSAuditLogSchema.index({ 'context.connectionId': 1, timestamp: -1 });
AWSAuditLogSchema.index({ eventType: 1, timestamp: -1 });
AWSAuditLogSchema.index({ result: 1, timestamp: -1 });
AWSAuditLogSchema.index({ 'action.planId': 1 });

// Helper function to calculate entry hash
function calculateEntryHash(entry: Partial<AWSAuditLog>): string {
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

  return crypto.createHash('sha256').update(hashContent).digest('hex');
}

// Pre-save middleware to prevent modifications
AWSAuditLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    const err = new Error('Audit log entries cannot be modified');
    return next(err);
  }
  next();
});

// Prevent updates
AWSAuditLogSchema.pre('updateOne', function (next) {
  const err = new Error('Audit log entries cannot be modified');
  next(err);
});

AWSAuditLogSchema.pre('updateMany', function (next) {
  const err = new Error('Audit log entries cannot be modified');
  next(err);
});

AWSAuditLogSchema.pre('findOneAndUpdate', function (next) {
  const err = new Error('Audit log entries cannot be modified');
  next(err);
});

// Prevent deletes (except for admin cleanup of very old entries)
AWSAuditLogSchema.pre('deleteOne', function (next) {
  const err = new Error('Audit log entries cannot be deleted');
  next(err);
});

AWSAuditLogSchema.pre('deleteMany', function (next) {
  const err = new Error('Audit log entries cannot be deleted');
  next(err);
});

// Export helper for hash calculation
export const calculateAuditEntryHash = calculateEntryHash;
