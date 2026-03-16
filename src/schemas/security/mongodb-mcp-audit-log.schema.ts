import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type IntegrationType =
  | 'vercel'
  | 'github'
  | 'google'
  | 'slack'
  | 'discord'
  | 'jira'
  | 'linear'
  | 'mongodb';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface IAuditContext {
  userId: MongooseSchema.Types.ObjectId;
  connectionId?: MongooseSchema.Types.ObjectId;
}

export type MongodbMcpAuditLogDocument = HydratedDocument<MongodbMcpAuditLog>;

@Schema({ timestamps: true })
export class MongodbMcpAuditLog {
  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

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
      'vercel',
      'github',
      'google',
      'slack',
      'discord',
      'jira',
      'linear',
      'mongodb',
    ],
    required: true,
    index: true,
  })
  integration: IntegrationType;

  @Prop({ required: true, index: true })
  toolName: string;

  @Prop({
    type: String,
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    required: true,
  })
  httpMethod: HttpMethod;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  params: Record<string, unknown>;

  @Prop({ required: true, index: true })
  success: boolean;

  @Prop()
  error?: string;

  @Prop({ required: true })
  latency: number;

  @Prop({ required: true })
  permissionChecked: boolean;

  @Prop({ required: true, index: true })
  dangerousOperation: boolean;

  @Prop()
  confirmed?: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  connectionId?: MongooseSchema.Types.ObjectId;

  @Prop()
  ipAddress?: string;

  @Prop({
    type: {
      userId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      connectionId: {
        type: MongooseSchema.Types.ObjectId,
      },
    },
  })
  context: IAuditContext;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const MongodbMcpAuditLogSchema =
  SchemaFactory.createForClass(MongodbMcpAuditLog);

// Compound indexes for common queries
MongodbMcpAuditLogSchema.index({ userId: 1, timestamp: -1 });
MongodbMcpAuditLogSchema.index({ integration: 1, timestamp: -1 });
MongodbMcpAuditLogSchema.index({ toolName: 1, success: 1 });
MongodbMcpAuditLogSchema.index({ dangerousOperation: 1, confirmed: 1 });

// TTL index - automatically delete logs older than 90 days
MongodbMcpAuditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
