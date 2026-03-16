import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SecurityAlertDocument = SecurityAlert & Document;

@Schema({ timestamps: true })
export class SecurityAlert {
  @Prop({ required: true, unique: true })
  alertId: string;

  @Prop({ required: true })
  timestamp: number;

  @Prop({
    required: true,
    enum: ['low', 'medium', 'high', 'critical'],
  })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @Prop({
    required: true,
    enum: ['threat', 'compliance', 'data_protection', 'system', 'ai_security'],
  })
  category:
    | 'threat'
    | 'compliance'
    | 'data_protection'
    | 'system'
    | 'ai_security';

  // Alert details
  @Prop({
    type: {
      title: { type: String, required: true },
      description: { type: String, required: true },
      source: { type: String, required: true },
      confidence: { type: Number, required: true, min: 0, max: 1 },
      urgency: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high', 'immediate'],
      },
    },
    _id: false,
  })
  alert: {
    title: string;
    description: string;
    source: string;
    confidence: number;
    urgency: 'low' | 'medium' | 'high' | 'immediate';
  };

  // Affected resources
  @Prop({
    type: {
      users: [{ type: String }],
      systems: [{ type: String }],
      data: [{ type: String }],
      services: [{ type: String }],
    },
    _id: false,
    default: { users: [], systems: [], data: [], services: [] },
  })
  affected: {
    users: string[];
    systems: string[];
    data: string[];
    services: string[];
  };

  // Threat intelligence
  @Prop({
    type: {
      type: { type: String, required: true },
      vector: { type: String, required: true },
      indicators: [{ type: String }],
      attribution: String,
      ttps: [{ type: String }],
    },
    _id: false,
  })
  threat: {
    type: string;
    vector: string;
    indicators: string[];
    attribution?: string;
    ttps?: string[];
  };

  // Response information
  @Prop({
    type: {
      status: {
        type: String,
        required: true,
        enum: [
          'new',
          'investigating',
          'contained',
          'resolved',
          'false_positive',
        ],
        default: 'new',
      },
      assigned_to: String,
      response_time: Number,
      resolution_notes: String,
    },
    _id: false,
    default: { status: 'new' },
  })
  response: {
    status:
      | 'new'
      | 'investigating'
      | 'contained'
      | 'resolved'
      | 'false_positive';
    assigned_to?: string;
    response_time?: number;
    resolution_notes?: string;
  };

  // Evidence and context
  @Prop({
    type: {
      logs: [{ type: String }],
      metrics: { type: Map, of: Number },
      traces: [{ type: String }],
      raw_data: { type: Map, of: String },
    },
    _id: false,
    default: { logs: [], metrics: new Map(), traces: [], raw_data: new Map() },
  })
  evidence: {
    logs: string[];
    metrics: Map<string, number>;
    traces: string[];
    raw_data: Map<string, string>;
  };

  // Metadata
  @Prop({
    type: {
      detection_method: String,
      detection_confidence: Number,
      false_positive_probability: Number,
      correlation_id: String,
      tags: [{ type: String }],
    },
    _id: false,
    default: {},
  })
  metadata: {
    detection_method?: string;
    detection_confidence?: number;
    false_positive_probability?: number;
    correlation_id?: string;
    tags?: string[];
  };

  // Audit trail
  @Prop({
    type: [
      {
        action: { type: String, required: true },
        timestamp: { type: Number, required: true },
        user: String,
        details: String,
      },
    ],
    default: [],
  })
  audit_trail: Array<{
    action: string;
    timestamp: number;
    user?: string;
    details?: string;
  }>;
}

export const SecurityAlertSchema = SchemaFactory.createForClass(SecurityAlert);

SecurityAlertSchema.index({ severity: 1, createdAt: -1 });
SecurityAlertSchema.index({ category: 1, createdAt: -1 });
SecurityAlertSchema.index({ 'response.status': 1, createdAt: -1 });
SecurityAlertSchema.index({ 'alert.urgency': 1, createdAt: -1 });
SecurityAlertSchema.index({ 'threat.type': 1, createdAt: -1 });
SecurityAlertSchema.index({ createdAt: -1 });

// TTL index for automatic cleanup (keep alerts for 90 days)
SecurityAlertSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
