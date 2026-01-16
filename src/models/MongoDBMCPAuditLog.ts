import mongoose, { Schema, Document } from 'mongoose';
import { IntegrationType, HttpMethod } from '../mcp/types/permission.types';

export interface IMongoDBMCPAuditLog extends Document {
  timestamp: Date;
  userId: mongoose.Types.ObjectId;
  integration: IntegrationType;
  toolName: string;
  httpMethod: HttpMethod;
  params: Record<string, unknown>;
  success: boolean;
  error?: string;
  latency: number;
  permissionChecked: boolean;
  dangerousOperation: boolean;
  confirmed?: boolean;
  connectionId?: mongoose.Types.ObjectId;
  ipAddress?: string;
  context: {
    userId: mongoose.Types.ObjectId;
    connectionId?: mongoose.Types.ObjectId;
  };
}

const MongoDBMCPAuditLogSchema = new Schema<IMongoDBMCPAuditLog>(
  {
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    integration: {
      type: String,
      enum: ['vercel', 'github', 'google', 'slack', 'discord', 'jira', 'linear', 'mongodb'],
      required: true,
      index: true,
    },
    toolName: {
      type: String,
      required: true,
      index: true,
    },
    httpMethod: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      required: true,
    },
    params: {
      type: Schema.Types.Mixed,
      required: true,
    },
    success: {
      type: Boolean,
      required: true,
      index: true,
    },
    error: {
      type: String,
    },
    latency: {
      type: Number,
      required: true,
    },
    permissionChecked: {
      type: Boolean,
      required: true,
    },
    dangerousOperation: {
      type: Boolean,
      required: true,
      index: true,
    },
    confirmed: {
      type: Boolean,
    },
    connectionId: {
      type: Schema.Types.ObjectId,
    },
    ipAddress: {
      type: String,
    },
    context: {
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      connectionId: {
        type: Schema.Types.ObjectId,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
MongoDBMCPAuditLogSchema.index({ userId: 1, timestamp: -1 });
MongoDBMCPAuditLogSchema.index({ integration: 1, timestamp: -1 });
MongoDBMCPAuditLogSchema.index({ toolName: 1, success: 1 });
MongoDBMCPAuditLogSchema.index({ dangerousOperation: 1, confirmed: 1 });

// TTL index - automatically delete logs older than 90 days
MongoDBMCPAuditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

export const MongoDBMCPAuditLog = mongoose.model<IMongoDBMCPAuditLog>(
  'MongoDBMCPAuditLog',
  MongoDBMCPAuditLogSchema
);
