import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IWebhookRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timestamp: Date;
}

export interface IWebhookResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
  timestamp: Date;
}

export interface IDeliveryError {
  type: string;
  message: string;
  code?: string;
  details?: any;
}

export type WebhookDeliveryDocument = HydratedDocument<WebhookDelivery>;

@Schema({ timestamps: true })
export class WebhookDelivery {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Webhook',
    required: true,
    index: true,
  })
  webhookId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  eventId: string;

  @Prop({ required: true, index: true })
  eventType: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  eventData: any;

  @Prop({ default: 1, min: 1 })
  attempt: number;

  @Prop({
    type: String,
    enum: ['pending', 'success', 'failed', 'timeout', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: 'pending' | 'success' | 'failed' | 'timeout' | 'cancelled';

  @Prop({
    type: {
      url: { type: String, required: true },
      method: { type: String, default: 'POST' },
      headers: { type: Map, of: String },
      body: { type: String, required: true },
      timestamp: { type: Date, required: true },
    },
    _id: false,
  })
  request: IWebhookRequest;

  @Prop({
    type: {
      statusCode: Number,
      headers: { type: Map, of: String },
      body: String,
      responseTime: Number,
      timestamp: Date,
    },
    _id: false,
  })
  response?: IWebhookResponse;

  @Prop({
    type: {
      type: { type: String },
      message: String,
      code: String,
      details: mongoose.Schema.Types.Mixed,
    },
    _id: false,
  })
  error?: IDeliveryError;

  @Prop({ index: true })
  nextRetryAt?: Date;

  @Prop({ default: 0 })
  retriesLeft: number;

  @Prop()
  signature?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const WebhookDeliverySchema =
  SchemaFactory.createForClass(WebhookDelivery);

// Indexes for efficient queries
WebhookDeliverySchema.index({ webhookId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ userId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });
WebhookDeliverySchema.index({ webhookId: 1, eventId: 1 });

// TTL index to automatically remove old delivery records after 30 days
WebhookDeliverySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
