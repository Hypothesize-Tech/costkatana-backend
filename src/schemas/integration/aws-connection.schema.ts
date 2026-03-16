import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PermissionMode = 'read-only' | 'read-write' | 'custom';
export type ExecutionMode = 'simulation' | 'live';
export type ConnectionStatus =
  | 'active'
  | 'inactive'
  | 'error'
  | 'pending_verification';
export type Environment = 'production' | 'staging' | 'development';

export interface IAllowedService {
  service: string;
  actions: string[];
  regions: string[];
}

export interface ISessionConfig {
  maxDurationSeconds: number;
  autoRenew: boolean;
  idleTimeoutSeconds: number;
}

export interface ISimulationConfig {
  enabled: boolean;
  periodDays: number;
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

export type AWSConnectionDocument = HydratedDocument<AWSConnection>;

@Schema({ timestamps: true, collection: 'aws_connections' })
export class AWSConnection {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  roleArn: string;

  @Prop({ required: true })
  encryptedExternalId: string;

  @Prop({ required: true })
  externalIdHash: string;

  @Prop({
    type: String,
    enum: ['production', 'staging', 'development'],
    required: true,
  })
  environment: Environment;

  @Prop({
    type: String,
    enum: ['read-only', 'read-write', 'custom'],
    default: 'read-only',
  })
  permissionMode: PermissionMode;

  @Prop({ type: String, enum: ['simulation', 'live'], default: 'simulation' })
  executionMode: ExecutionMode;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'error', 'pending_verification'],
    default: 'pending_verification',
  })
  status: ConnectionStatus;

  @Prop({
    type: [
      {
        service: { type: String, required: true },
        actions: [{ type: String }],
        regions: [{ type: String }],
      },
    ],
    _id: false,
  })
  allowedServices: IAllowedService[];

  @Prop({
    type: {
      maxDurationSeconds: {
        type: Number,
        required: true,
        min: 900,
        max: 3600,
        default: 1800,
      },
      autoRenew: { type: Boolean, default: false },
      idleTimeoutSeconds: { type: Number, default: 1800 },
    },
    _id: false,
  })
  sessionConfig: ISessionConfig;

  @Prop({
    type: {
      enabled: { type: Boolean, default: true },
      periodDays: { type: Number, default: 7 },
      startedAt: Date,
      promotedToLiveAt: Date,
    },
    _id: false,
  })
  simulationConfig: ISimulationConfig;

  @Prop({
    type: {
      lastChecked: { type: Date, default: Date.now },
      lastSuccessful: Date,
      consecutiveFailures: { type: Number, default: 0 },
      lastError: String,
      assumeRoleLatencyMs: Number,
    },
    _id: false,
  })
  health: IConnectionHealth;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  // Additional properties for service compatibility
  @Prop()
  awsAccountId?: string;

  @Prop([String])
  allowedRegions?: string[];

  @Prop({ type: Date })
  lastUsedAt?: Date;

  @Prop([String])
  deniedActions?: string[];

  /** Default S3 bucket name for document uploads when bucketName not provided */
  @Prop()
  s3BucketName?: string;
}

export const AWSConnectionSchema = SchemaFactory.createForClass(AWSConnection);

// Indexes
AWSConnectionSchema.index({ userId: 1, environment: 1 });
AWSConnectionSchema.index({ roleArn: 1 });
AWSConnectionSchema.index({ status: 1 });
