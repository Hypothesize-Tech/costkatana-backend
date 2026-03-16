import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';
import * as crypto from 'crypto';

export interface IOAuth2Credentials {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scope?: string;
}

export interface IWebhookCredentials {
  username?: string;
  password?: string;
  token?: string;
  headerName?: string;
  headerValue?: string;
  oauth2?: IOAuth2Credentials;
}

export interface IWebhookAuth {
  type: 'none' | 'basic' | 'bearer' | 'custom_header' | 'oauth2';
  credentials?: IWebhookCredentials;
}

export interface IWebhookFilters {
  severity?: string[];
  tags?: string[];
  projects?: MongooseSchema.Types.ObjectId[];
  models?: string[];
  minCost?: number;
  customQuery?: Record<string, any>;
}

export interface IRetryConfig {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelay: number;
}

export interface IWebhookStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  averageResponseTime?: number;
}

export type WebhookDocument = HydratedDocument<Webhook>;

@Schema({ timestamps: true })
export class Webhook {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({
    required: true,
    validate: {
      validator: function (v: string) {
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Invalid URL format',
    },
  })
  url: string;

  @Prop({ default: true, index: true })
  active: boolean;

  @Prop({ default: '1.0.0' })
  version: string;

  @Prop({
    type: {
      type: String,
      enum: ['none', 'basic', 'bearer', 'custom_header', 'oauth2'],
      default: 'none',
      credentials: {
        username: String,
        password: String,
        token: String,
        headerName: String,
        headerValue: String,
        oauth2: {
          clientId: String,
          clientSecret: String,
          tokenUrl: String,
          scope: String,
        },
      },
    },
    _id: false,
  })
  auth?: IWebhookAuth;

  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: function (v: string[]) {
        return v && v.length > 0;
      },
      message: 'At least one event must be selected',
    },
  })
  events: string[];

  @Prop({
    type: {
      severity: [String],
      tags: [String],
      projects: [
        {
          type: MongooseSchema.Types.ObjectId,
          ref: 'Project',
        },
      ],
      models: [String],
      minCost: Number,
      customQuery: mongoose.Schema.Types.Mixed,
    },
    _id: false,
  })
  filters?: IWebhookFilters;

  @Prop({ type: Map, of: String })
  headers?: Record<string, string>;

  @Prop({
    validate: {
      validator: function (v: string) {
        if (!v) return true;
        try {
          // Basic JSON validation
          JSON.parse(v.replace(/\{\{[^}]+\}\}/g, '"placeholder"'));
          return true;
        } catch {
          return false;
        }
      },
      message: 'Invalid JSON template',
    },
  })
  payloadTemplate?: string;

  @Prop({ default: true })
  useDefaultPayload: boolean;

  @Prop({
    required: true,
    default: function () {
      return crypto.randomBytes(32).toString('hex');
    },
  })
  secret: string;

  @Prop()
  maskedSecret?: string;

  @Prop({ default: 30000, min: 5000, max: 120000 })
  timeout: number;

  @Prop({
    type: {
      maxRetries: { type: Number, default: 3, min: 0, max: 10 },
      backoffMultiplier: { type: Number, default: 2, min: 1, max: 5 },
      initialDelay: { type: Number, default: 5000, min: 1000, max: 60000 },
    },
    _id: false,
  })
  retryConfig: IRetryConfig;

  @Prop({
    type: {
      totalDeliveries: { type: Number, default: 0 },
      successfulDeliveries: { type: Number, default: 0 },
      failedDeliveries: { type: Number, default: 0 },
      lastDeliveryAt: Date,
      lastSuccessAt: Date,
      lastFailureAt: Date,
      averageResponseTime: Number,
    },
    _id: false,
  })
  stats: IWebhookStats;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const WebhookSchema = SchemaFactory.createForClass(Webhook);

// Indexes for efficient queries
WebhookSchema.index({ userId: 1, active: 1 });
WebhookSchema.index({ userId: 1, events: 1 });
WebhookSchema.index({ 'stats.lastDeliveryAt': -1 });

// Pre-save hook to mask secret
WebhookSchema.pre('save', function (next) {
  if (this.isModified('secret')) {
    this.maskedSecret = '****' + this.secret.slice(-4);
  }
  next();
});
