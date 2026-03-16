import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import type { IntegrationType } from '../../modules/mcp/types/mcp.types';

export type McpPermissionAuditLogDocument = McpPermissionAuditLog & Document;

@Schema({ timestamps: true, collection: 'mcp_permission_audit_logs' })
export class McpPermissionAuditLog {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['request', 'denial', 'approval'],
  })
  action: 'request' | 'denial' | 'approval';

  @Prop({
    type: String,
    required: true,
    enum: [
      'vercel',
      'github',
      'google',
      'slack',
      'discord',
      'jira',
      'linear',
      'mongodb',
      'aws',
    ],
  })
  integration: IntegrationType;

  @Prop({ type: String, required: true })
  resourceId: string;

  @Prop({
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  })
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  @Prop({ type: String, required: true })
  endpoint: string;

  @Prop({ type: Object })
  requestBody?: Record<string, any>;

  @Prop({ type: Object })
  responseBody?: Record<string, any>;

  @Prop()
  errorMessage?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const McpPermissionAuditLogSchema = SchemaFactory.createForClass(
  McpPermissionAuditLog,
);

// Add indexes for efficient querying
McpPermissionAuditLogSchema.index({ userId: 1, createdAt: -1 });
McpPermissionAuditLogSchema.index({ integration: 1, createdAt: -1 });
McpPermissionAuditLogSchema.index({ action: 1, createdAt: -1 });
McpPermissionAuditLogSchema.index({ userId: 1, integration: 1, resourceId: 1 });
