import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type AuditEventType =
  | 'data_access'
  | 'data_modification'
  | 'data_deletion'
  | 'data_transmission'
  | 'user_authentication'
  | 'user_authorization'
  | 'permission_change'
  | 'system_configuration'
  | 'security_event'
  | 'compliance_check'
  | 'ai_processing'
  | 'api_call'
  | 'file_upload'
  | 'report_generation'
  | 'backup_creation'
  | 'backup_restoration'
  | 'system_maintenance';

export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ComprehensiveAuditDocument = HydratedDocument<ComprehensiveAudit>;

@Schema()
export class ComprehensiveAudit {
  @Prop({ required: true, unique: true })
  eventId: string;

  @Prop({ required: true })
  timestamp: number;

  @Prop({
    type: String,
    required: true,
    enum: [
      'data_access',
      'data_modification',
      'data_deletion',
      'data_transmission',
      'user_authentication',
      'user_authorization',
      'permission_change',
      'system_configuration',
      'security_event',
      'compliance_check',
      'ai_processing',
      'api_call',
      'file_upload',
      'report_generation',
      'backup_creation',
      'backup_restoration',
      'system_maintenance',
    ],
  })
  eventType: AuditEventType;

  @Prop({
    type: String,
    required: true,
    enum: ['info', 'low', 'medium', 'high', 'critical'],
  })
  severity: AuditSeverity;

  // Event details
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  event: {
    action: string;
    description: string;
    outcome: 'success' | 'failure' | 'partial' | 'blocked';
    category: string;
    subcategory?: string;
  };

  // Actor information
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  actor: {
    type: 'user' | 'system' | 'api' | 'service' | 'admin';
    id: string;
    name?: string;
    role?: string;
    permissions?: string[];
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    location?: {
      country: string;
      region: string;
      city: string;
    };
  };

  // Target/Resource information
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  target: {
    type: 'user' | 'data' | 'file' | 'system' | 'service' | 'configuration';
    id: string;
    name?: string;
    classification?: string;
    sensitivity?: string;
    owner?: string;
    metadata?: Record<string, any>;
  };

  // Context information
  @Prop({ type: mongoose.Schema.Types.Mixed })
  context?: {
    requestId?: string;
    correlationId?: string;
    parentEventId?: string;
    businessContext?: string;
    technicalContext?: string;
    complianceFramework?: string[];
    dataLineage?: {
      sourceId: string;
      sourceName: string;
      sourceType: string;
      transformations: Array<{
        step: number;
        operation: string;
        timestamp: number;
        component: string;
        inputHash: string;
        outputHash: string;
      }>;
      destinations: Array<{
        destinationId: string;
        destinationType: string;
        timestamp: number;
        purpose: string;
      }>;
      retentionPolicy: {
        period: number;
        autoDelete: boolean;
        deleteAfter: number;
      };
    };
  };

  // Security analysis
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  security: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    securityImplications: string[];
    complianceImplications: string[];
    privacyImplications: string[];
    anomalyScore: number;
    threatIndicators: string[];
  };

  // Technical details
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  technical: {
    sourceSystem: string;
    sourceComponent: string;
    protocol?: string;
    method?: string;
    endpoint?: string;
    responseCode?: number;
    duration?: number;
    dataSize?: number;
    errorDetails?: string;
  };

  // Evidence and artifacts
  @Prop({ type: mongoose.Schema.Types.Mixed })
  evidence?: {
    beforeState?: string;
    afterState?: string;
    artifacts?: Array<{
      type: string;
      location: string;
      hash?: string;
    }>;
    logs?: string[];
  };

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const ComprehensiveAuditSchema =
  SchemaFactory.createForClass(ComprehensiveAudit);

ComprehensiveAuditSchema.index({ timestamp: -1 });
ComprehensiveAuditSchema.index({ eventType: 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ severity: 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ 'actor.id': 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ 'actor.type': 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ 'target.id': 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ 'target.type': 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ 'security.riskLevel': 1, timestamp: -1 });
ComprehensiveAuditSchema.index({ 'security.anomalyScore': -1 });
ComprehensiveAuditSchema.index({ 'context.requestId': 1 });
ComprehensiveAuditSchema.index({ 'context.correlationId': 1 });

// TTL index - auto-delete after 1 year
ComprehensiveAuditSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 },
);
