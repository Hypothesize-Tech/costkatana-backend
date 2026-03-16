import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import * as mongoose from 'mongoose';

export interface IQueryFilters {
  serviceName?: string;
  environment?: string;
  tags?: Record<string, string>;
}

export type UserTelemetryConfigDocument = HydratedDocument<UserTelemetryConfig>;

@Schema({ timestamps: true, collection: 'user_telemetry_configs' })
export class UserTelemetryConfig {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ index: true })
  projectId?: string;

  // Telemetry endpoint type
  @Prop({
    type: String,
    enum: ['otlp-http', 'otlp-grpc', 'tempo', 'jaeger', 'prometheus', 'custom'],
    required: true,
  })
  endpointType:
    | 'otlp-http'
    | 'otlp-grpc'
    | 'tempo'
    | 'jaeger'
    | 'prometheus'
    | 'custom';

  // Endpoint details
  @Prop({ required: true })
  endpoint: string; // e.g., http://user-otel-collector:4318

  @Prop()
  tracesEndpoint?: string; // Specific traces endpoint

  @Prop()
  metricsEndpoint?: string; // Specific metrics endpoint

  // Authentication (if required)
  @Prop({
    type: String,
    enum: ['none', 'bearer', 'basic', 'api-key', 'custom-header'],
    default: 'none',
  })
  authType?: 'none' | 'bearer' | 'basic' | 'api-key' | 'custom-header';

  @Prop({ select: false }) // Don't return by default for security
  authToken?: string; // Encrypted

  @Prop()
  authHeader?: string; // e.g., "Authorization", "X-API-Key"

  @Prop({ select: false }) // Don't return by default for security
  username?: string;

  @Prop({ select: false }) // Don't return by default for security
  password?: string; // Encrypted

  // TLS/SSL
  @Prop({ type: Boolean, default: false })
  useTLS: boolean;

  @Prop()
  tlsCertificate?: string; // Base64 encoded certificate

  @Prop({ type: Boolean, default: false })
  skipTLSVerify?: boolean;

  // Sync configuration
  @Prop({ type: Boolean, default: true })
  syncEnabled: boolean;

  @Prop({ type: Number, default: 5, min: 1, max: 1440 })
  syncIntervalMinutes: number; // How often to pull data

  @Prop()
  lastSyncAt?: Date;

  @Prop({
    type: String,
    enum: ['success', 'error', 'partial'],
  })
  lastSyncStatus?: 'success' | 'error' | 'partial';

  @Prop()
  lastSyncError?: string;

  // Query configuration
  @Prop({ type: Number, default: 10, min: 1, max: 1440 })
  queryTimeRangeMinutes: number; // How far back to query each time

  @Prop({
    type: {
      serviceName: String,
      environment: String,
      tags: mongoose.Schema.Types.Mixed,
    },
  })
  queryFilters?: IQueryFilters;

  // Status
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: true })
  healthCheckEnabled: boolean;

  @Prop()
  lastHealthCheckAt?: Date;

  @Prop({
    type: String,
    enum: ['healthy', 'unhealthy', 'unknown'],
  })
  lastHealthCheckStatus?: 'healthy' | 'unhealthy' | 'unknown';

  // Stats
  @Prop({ type: Number, default: 0 })
  totalRecordsSynced: number;

  @Prop({ type: Number, default: 0 })
  totalSyncErrors: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UserTelemetryConfigSchema =
  SchemaFactory.createForClass(UserTelemetryConfig);

// Indexes
UserTelemetryConfigSchema.index({ userId: 1, projectId: 1 });
UserTelemetryConfigSchema.index({ isActive: 1, syncEnabled: 1 });
UserTelemetryConfigSchema.index({ lastSyncAt: 1 });
