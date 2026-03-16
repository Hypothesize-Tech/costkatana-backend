import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type InternalAuditDocument = HydratedDocument<InternalAudit>;

export type AuditAction =
  | 'operator_login'
  | 'operator_logout'
  | 'dual_approval_request'
  | 'dual_approval_grant'
  | 'dual_approval_deny'
  | 'operator_action'
  | 'security_incident'
  | 'system_maintenance'
  | 'config_change';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

@Schema()
export class InternalAudit {
  @Prop({ type: Number, required: true })
  timestamp: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  operatorId: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, required: true })
  operatorEmail: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'operator_login',
      'operator_logout',
      'dual_approval_request',
      'dual_approval_grant',
      'dual_approval_deny',
      'operator_action',
      'security_incident',
      'system_maintenance',
      'config_change',
    ],
  })
  action: AuditAction;

  @Prop({
    type: String,
    required: true,
    enum: ['info', 'warning', 'error', 'critical'],
  })
  severity: AuditSeverity;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  details?: {
    resource?: string;
    resourceType?: string;
    changes?: any;
    reason?: string;
    approvalId?: string;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  };

  @Prop({ type: mongoose.Schema.Types.Mixed })
  securityContext?: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    requiresApproval: boolean;
    approvedBy?: string;
    approvalTimestamp?: number;
  };

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const InternalAuditSchema = SchemaFactory.createForClass(InternalAudit);

// Indexes for efficient queries
InternalAuditSchema.index({ operatorId: 1, timestamp: -1 });
InternalAuditSchema.index({ action: 1, timestamp: -1 });
InternalAuditSchema.index({ severity: 1, timestamp: -1 });
InternalAuditSchema.index({
  'securityContext.requiresApproval': 1,
  timestamp: -1,
});
InternalAuditSchema.index({ timestamp: -1 });

// TTL index - auto-delete after 2 years
InternalAuditSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 2 * 365 * 24 * 60 * 60 },
);
