import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type McpSecurityEventLogDocument = HydratedDocument<McpSecurityEventLog>;

export type McpSecurityEventType = 'confirmation' | 'permission_denial';

const INTEGRATION_TYPES = [
  'vercel',
  'github',
  'google',
  'slack',
  'discord',
  'jira',
  'linear',
  'mongodb',
  'aws',
] as const;

@Schema({ timestamps: true, collection: 'mcp_security_event_logs' })
export class McpSecurityEventLog {
  @Prop({
    type: String,
    required: true,
    enum: ['confirmation', 'permission_denial'],
    index: true,
  })
  eventType: McpSecurityEventType;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  timestamp: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: INTEGRATION_TYPES,
    index: true,
  })
  integration: (typeof INTEGRATION_TYPES)[number];

  @Prop({ type: String, required: true, index: true })
  toolName: string;

  /** For confirmation: resource being acted upon */
  @Prop()
  resource?: string;

  /** For confirmation: action being confirmed */
  @Prop()
  action?: string;

  /** For confirmation: whether user confirmed */
  @Prop()
  confirmed?: boolean;

  /** For confirmation: whether request timed out */
  @Prop()
  timedOut?: boolean;

  /** For permission denial: reason for denial */
  @Prop()
  reason?: string;

  /** For permission denial: missing scope if applicable */
  @Prop()
  missingScope?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const McpSecurityEventLogSchema =
  SchemaFactory.createForClass(McpSecurityEventLog);

McpSecurityEventLogSchema.index({ userId: 1, timestamp: -1 });
McpSecurityEventLogSchema.index({ integration: 1, timestamp: -1 });
McpSecurityEventLogSchema.index({ eventType: 1, timestamp: -1 });
McpSecurityEventLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
