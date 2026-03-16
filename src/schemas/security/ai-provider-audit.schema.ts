import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type AIProviderAuditDocument = HydratedDocument<AIProviderAudit>;

@Schema()
export class AIProviderAudit {
  @Prop({ required: true, unique: true })
  requestId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    required: true,
    enum: ['anthropic', 'openai', 'bedrock', 'custom'],
  })
  provider: 'anthropic' | 'openai' | 'bedrock' | 'custom';

  @Prop({ required: true })
  model: string;

  @Prop({ required: true })
  timestamp: number;

  @Prop({ required: true })
  endpoint: string;

  @Prop({ required: true })
  method: string;

  // Data being sent
  @Prop({ type: mongoose.Schema.Types.Mixed })
  requestData?: {
    prompt?: string;
    messages?: any[];
    systemPrompt?: string;
    context?: string;
    attachments?: string[];
    parameters: Record<string, any>;
  };

  // Metadata
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  metadata: {
    userTier: string;
    sessionId: string;
    ipAddress: string;
    userAgent: string;
    referer?: string;
    contentLength: number;
    estimatedTokens: number;
    estimatedCost: number;
  };

  // Security analysis
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  security: {
    piiDetected: string[];
    sensitivePatterns: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    complianceFlags: string[];
    dataClassification: string[];
    redactionApplied: boolean;
    redactionDetails?: {
      originalLength: number;
      redactedLength: number;
      patternsRedacted: string[];
      redactionMap: Record<string, string>;
      redactionTimestamp: number;
    };
  };

  // Transmission details
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  transmission: {
    status: 'pending' | 'sent' | 'failed' | 'blocked';
    sentAt?: number;
    responseReceived?: number;
    responseSize?: number;
    errorDetails?: string;
    blockedReason?: string;
  };

  // Compliance tracking
  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  compliance: {
    gdprApplicable: boolean;
    hipaaApplicable: boolean;
    soc2Applicable: boolean;
    consentObtained: boolean;
    legalBasis?: string;
    dataRetentionPolicy: string;
    geographicRestrictions: string[];
  };

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const AIProviderAuditSchema =
  SchemaFactory.createForClass(AIProviderAudit);

// Indexes for efficient queries
AIProviderAuditSchema.index({ userId: 1, timestamp: -1 });
AIProviderAuditSchema.index({ provider: 1, timestamp: -1 });
AIProviderAuditSchema.index({ 'security.riskLevel': 1, timestamp: -1 });
AIProviderAuditSchema.index({ 'transmission.status': 1, timestamp: -1 });
AIProviderAuditSchema.index({ timestamp: -1 });

// TTL index - auto-delete after 1 year
AIProviderAuditSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 },
);
