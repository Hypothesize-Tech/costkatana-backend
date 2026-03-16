import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RequestTrackingDocument = HydratedDocument<RequestTracking>;

@Schema({ collection: 'request_tracking', timestamps: true })
export class RequestTracking {
  @Prop({ required: true, index: true, unique: true })
  requestId: string;

  @Prop({ index: true })
  userId?: string;

  @Prop({ required: true })
  method: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  path: string;

  @Prop({ type: Object })
  query: Record<string, any>;

  @Prop({ type: Object })
  headers: Record<string, string>;

  @Prop()
  userAgent?: string;

  @Prop()
  ip?: string;

  @Prop()
  contentType?: string;

  @Prop()
  contentLength?: string;

  @Prop({ type: Number })
  statusCode?: number;

  @Prop({ type: Number })
  responseTime?: number;

  @Prop({ type: Number })
  responseSize?: number;

  @Prop({ type: Date })
  startedAt: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ enum: ['success', 'error', 'redirect'], default: 'success' })
  outcome?: string;

  @Prop({ type: Object })
  error?: any;

  @Prop()
  endpoint?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  // Timestamps
  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const RequestTrackingSchema =
  SchemaFactory.createForClass(RequestTracking);

// Indexes for performance
RequestTrackingSchema.index({ userId: 1, createdAt: -1 });
RequestTrackingSchema.index({ path: 1, method: 1, createdAt: -1 });
RequestTrackingSchema.index({ statusCode: 1, createdAt: -1 });
RequestTrackingSchema.index({ outcome: 1, createdAt: -1 });

// TTL index to automatically delete old tracking data after 30 days
RequestTrackingSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
