import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';
import { encryptData, decryptData } from '../../utils/encryption';

export type IntegrationType =
  | 'slack_webhook'
  | 'slack_oauth'
  | 'discord_webhook'
  | 'discord_oauth'
  | 'linear_oauth'
  | 'jira_oauth'
  | 'github_oauth'
  | 'google_oauth'
  | 'vercel_oauth'
  | 'custom_webhook';

export type IntegrationStatus =
  | 'active'
  | 'inactive'
  | 'error'
  | 'pending'
  | 'needs_reauth';

export type AlertType =
  | 'cost_threshold'
  | 'usage_spike'
  | 'optimization_available'
  | 'weekly_summary'
  | 'monthly_summary'
  | 'error_rate'
  | 'cost'
  | 'optimization'
  | 'anomaly'
  | 'system';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertRoutingRule {
  enabled: boolean;
  severities: AlertSeverity[];
  template?: string;
  customMessage?: string;
}

export interface IntegrationCredentials {
  webhookUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  botToken?: string;
  botUserId?: string;
  channelId?: string;
  channelName?: string;
  guildId?: string;
  guildName?: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  issueId?: string;
  scope?: string;
  siteUrl?: string;
  cloudId?: string;
  projectKey?: string;
  issueTypeId?: string;
  priorityId?: string;
  labels?: string[];
  components?: Array<{ id: string; name?: string }>;
  issueKey?: string;
  vercelConnectionId?: string;
}

export interface DeliveryConfig {
  retryEnabled: boolean;
  maxRetries: number;
  timeout: number;
  batchDelay?: number;
}

export interface IntegrationStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  averageResponseTime: number;
}

export interface IntegrationMethods {
  getCredentials(): IntegrationCredentials;
  setCredentials(credentials: IntegrationCredentials): void;
}

export type IntegrationDocument = HydratedDocument<Integration> &
  IntegrationMethods;

@Schema({ timestamps: true })
export class Integration implements IntegrationMethods {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'slack_webhook',
      'slack_oauth',
      'discord_webhook',
      'discord_oauth',
      'linear_oauth',
      'jira_oauth',
      'github_oauth',
      'google_oauth',
      'custom_webhook',
    ],
    required: true,
  })
  type: IntegrationType;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'error', 'pending', 'needs_reauth'],
    default: 'active',
  })
  status: IntegrationStatus;

  // Encrypted credentials
  @Prop({ required: true })
  encryptedCredentials: string;

  // Alert routing configuration
  @Prop({
    type: Map,
    of: {
      enabled: { type: Boolean, default: true },
      severities: [
        {
          type: String,
          enum: ['low', 'medium', 'high', 'critical'],
        },
      ],
      template: String,
      customMessage: String,
    },
    default: new Map(),
  })
  alertRouting: Map<AlertType, AlertRoutingRule>;

  // Delivery settings
  @Prop({
    type: {
      retryEnabled: { type: Boolean, default: true },
      maxRetries: { type: Number, default: 3, min: 0, max: 10 },
      timeout: { type: Number, default: 30000, min: 1000, max: 120000 },
      batchDelay: { type: Number, min: 0, max: 60000 },
    },
  })
  deliveryConfig: DeliveryConfig;

  // Statistics
  @Prop({
    type: {
      totalDeliveries: { type: Number, default: 0 },
      successfulDeliveries: { type: Number, default: 0 },
      failedDeliveries: { type: Number, default: 0 },
      lastDeliveryAt: Date,
      lastSuccessAt: Date,
      lastFailureAt: Date,
      averageResponseTime: { type: Number, default: 0 },
    },
  })
  stats: IntegrationStats;

  // Metadata
  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata?: Record<string, any>;

  @Prop()
  lastHealthCheck?: Date;

  @Prop({ type: String, enum: ['healthy', 'degraded', 'unhealthy'] })
  healthCheckStatus?: 'healthy' | 'degraded' | 'unhealthy';

  @Prop()
  errorMessage?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  getCredentials(): IntegrationCredentials {
    try {
      const decrypted = decryptData(this.encryptedCredentials);
      return JSON.parse(decrypted);
    } catch (error) {
      throw new Error('Failed to decrypt integration credentials');
    }
  }

  setCredentials(credentials: IntegrationCredentials): void {
    const jsonString = JSON.stringify(credentials);
    this.encryptedCredentials = encryptData(jsonString);
  }
}

export const IntegrationSchema = SchemaFactory.createForClass(Integration);

// Indexes for efficient queries
IntegrationSchema.index({ userId: 1, status: 1 });
IntegrationSchema.index({ userId: 1, type: 1 });
IntegrationSchema.index({ 'stats.lastDeliveryAt': -1 });

// Virtual methods for credential encryption/decryption
IntegrationSchema.methods.getCredentials = function (): IntegrationCredentials {
  try {
    const decrypted = decryptData(this.encryptedCredentials);
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Failed to decrypt integration credentials');
  }
};

IntegrationSchema.methods.setCredentials = function (
  credentials: IntegrationCredentials,
): void {
  const jsonString = JSON.stringify(credentials);
  this.encryptedCredentials = encryptData(jsonString);
};
