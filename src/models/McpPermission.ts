/**
 * MCP Permission Model
 * Stores granular permissions for MCP tool access
 */

import mongoose, { Schema, Document } from 'mongoose';
import {
  IntegrationType,
  ToolPermissions,
} from '../mcp/types/permission.types';

export interface IMcpPermission extends Document {
  userId: mongoose.Types.ObjectId;
  integration: IntegrationType;
  connectionId: mongoose.Types.ObjectId;
  permissions: ToolPermissions;
  grantedAt: Date;
  expiresAt?: Date;
  grantedBy: 'user' | 'admin';
  lastUsed?: Date;
  usageCount: number;
}

const ResourceRestrictionsSchema = new Schema({
  projectIds: [String],
  repoIds: [String],
  fileIds: [String],
  channelIds: [String],
  ownOnly: { type: Boolean, default: false },
}, { _id: false });

const ToolPermissionsSchema = new Schema({
  tools: [String],
  scopes: [String],
  httpMethods: [String],
  resources: ResourceRestrictionsSchema,
}, { _id: false });

const McpPermissionSchema = new Schema<IMcpPermission>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    integration: {
      type: String,
      enum: ['vercel', 'github', 'google', 'slack', 'discord', 'jira', 'linear', 'mongodb', 'aws'],
      required: true,
      index: true,
    },
    connectionId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    permissions: {
      type: ToolPermissionsSchema,
      required: true,
    },
    grantedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
    },
    grantedBy: {
      type: String,
      enum: ['user', 'admin'],
      required: true,
      default: 'user',
    },
    lastUsed: {
      type: Date,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast lookups
McpPermissionSchema.index({ userId: 1, integration: 1, connectionId: 1 });

// Auto-expire documents if expiresAt is set
McpPermissionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const McpPermission = mongoose.model<IMcpPermission>('McpPermission', McpPermissionSchema);
