import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  [key: string]: any;
}

export interface ICostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheCost?: number;
  additionalFees?: number;
}

export interface IAILogMethods {
  isError(): boolean;
  getErrorSummary(): string | null;
}

export type AILogDocument = HydratedDocument<AILog> & IAILogMethods;

@Schema({ timestamps: true, collection: 'ai_logs' })
export class AILog implements IAILogMethods {
  // Core identification fields
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', index: true })
  projectId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  requestId: string; // Correlation ID for distributed tracing

  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  // Service information
  @Prop({ required: true, index: true })
  service:
    | 'aws-bedrock'
    | 'openai'
    | 'anthropic'
    | 'google-ai'
    | 'huggingface'
    | 'cohere'
    | 'cortex'
    | string;

  @Prop({ required: true, index: true })
  operation: string; // e.g., "invokeModel", "encodeToTOON", "streamResponse"

  @Prop()
  endpoint?: string; // API endpoint if applicable

  @Prop()
  method?: string; // HTTP method or SDK method

  // Model information
  @Prop({ required: true, index: true })
  aiModel: string; // Model identifier (e.g., "claude-3-sonnet", "gpt-4")

  @Prop()
  modelVersion?: string;

  // Request data
  @Prop({ required: true, min: 0, default: 0 })
  inputTokens: number;

  @Prop({ required: true, min: 0, default: 0 })
  outputTokens: number;

  @Prop({ required: true, min: 0, default: 0 })
  totalTokens: number;

  @Prop({ maxlength: 1000 }) // Truncated for privacy (first 1000 chars)
  prompt?: string;

  @Prop()
  promptHash?: string; // SHA256 hash for exact matching

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  parameters?: IParameters;

  // Response data
  @Prop({ required: true, index: true })
  statusCode: number; // HTTP status or equivalent

  @Prop({ required: true, default: true, index: true })
  success: boolean;

  @Prop({ required: true, min: 0, index: true })
  responseTime: number; // Milliseconds

  @Prop({ required: true, min: 0, default: 0, index: true })
  cost: number; // USD

  @Prop({ maxlength: 1000 })
  result?: string; // Truncated response (first 1000 chars)

  @Prop()
  resultHash?: string; // SHA256 hash

  // Error tracking
  @Prop({ index: 'text' }) // Text index for search
  errorMessage?: string;

  @Prop({
    type: String,
    enum: [
      'client_error',
      'server_error',
      'network_error',
      'auth_error',
      'rate_limit',
      'timeout',
      'validation_error',
      'throttling',
      'quota_exceeded',
    ],
    index: true,
  })
  errorType?:
    | 'client_error'
    | 'server_error'
    | 'network_error'
    | 'auth_error'
    | 'rate_limit'
    | 'timeout'
    | 'validation_error'
    | 'throttling'
    | 'quota_exceeded';

  @Prop()
  errorStack?: string; // Sanitized stack trace

  @Prop()
  errorCode?: string; // Provider-specific error code

  // Context metadata
  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ index: true })
  traceId?: string;

  @Prop()
  traceName?: string;

  @Prop()
  traceStep?: string;

  @Prop({ index: true })
  experimentId?: string;

  @Prop()
  experimentName?: string;

  @Prop()
  notebookId?: string;

  @Prop()
  sessionId?: string;

  // Optimization flags
  @Prop({ type: Boolean, default: false, index: true })
  cortexEnabled?: boolean;

  @Prop()
  cortexOptimizationApplied?: boolean;

  @Prop({ type: Boolean, default: false, index: true })
  cacheHit?: boolean;

  @Prop()
  cacheKey?: string;

  @Prop({ default: 0, min: 0 })
  retryAttempt?: number; // 0 for first attempt

  // Performance metrics
  @Prop()
  ttfb?: number; // Time to first byte

  @Prop()
  streamingLatency?: number;

  @Prop()
  queueTime?: number;

  // Cost tracking
  @Prop({
    type: {
      inputCost: Number,
      outputCost: Number,
      cacheCost: Number,
      additionalFees: Number,
    },
    _id: false,
  })
  costBreakdown?: ICostBreakdown;

  // Compliance and governance
  @Prop([{ type: String, trim: true }])
  tags?: string[];

  @Prop({
    type: String,
    enum: ['development', 'staging', 'production'],
    default:
      process.env.NODE_ENV === 'production' ? 'production' : 'development',
    index: true,
  })
  environment?: 'development' | 'staging' | 'production';

  @Prop()
  region?: string; // AWS region or provider region

  // Log metadata
  @Prop({
    type: String,
    enum: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'],
    default: 'INFO',
    index: true,
  })
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

  @Prop({ default: 'system' })
  logSource?: string; // File/service that generated the log

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  isError(): boolean {
    return !this.success || this.statusCode >= 400;
  }

  getErrorSummary(): string | null {
    if (!this.errorMessage) return null;
    return this.errorMessage.length > 200
      ? this.errorMessage.substring(0, 200) + '...'
      : this.errorMessage;
  }
}

export const AILogSchema = SchemaFactory.createForClass(AILog);

// Compound indexes for common query patterns
AILogSchema.index({ projectId: 1, timestamp: -1 }); // Project logs ordered by time
AILogSchema.index({ userId: 1, timestamp: -1 }); // User logs ordered by time
AILogSchema.index({ service: 1, aiModel: 1, timestamp: -1 }); // Service/model performance
AILogSchema.index({ success: 1, timestamp: -1 }); // Error tracking
AILogSchema.index({ requestId: 1, timestamp: 1 }); // Distributed tracing
AILogSchema.index({ traceId: 1, timestamp: 1 }); // Agent trace tracking
AILogSchema.index({ experimentId: 1, timestamp: 1 }); // Experiment tracking
AILogSchema.index({ cost: -1, timestamp: -1 }); // Expensive operations
AILogSchema.index({ responseTime: -1, timestamp: -1 }); // Slow operations

// Virtual for total cost calculation
AILogSchema.virtual('totalCost').get(function () {
  if (this.costBreakdown) {
    return (
      (this.costBreakdown.inputCost || 0) +
      (this.costBreakdown.outputCost || 0) +
      (this.costBreakdown.cacheCost || 0) +
      (this.costBreakdown.additionalFees || 0)
    );
  }
  return this.cost;
});

// Instance methods
AILogSchema.methods.isError = function (): boolean {
  return !this.success || this.statusCode >= 400;
};

AILogSchema.methods.getErrorSummary = function (): string | null {
  if (!this.errorMessage) return null;
  return this.errorMessage.length > 200
    ? this.errorMessage.substring(0, 200) + '...'
    : this.errorMessage;
};

// Static methods
AILogSchema.statics.getRequestChain = async function (requestId: string) {
  return this.find({ requestId }).sort({ timestamp: 1 }).exec();
};

AILogSchema.statics.getErrorRate = async function (
  startTime: Date,
  endTime: Date,
  filters: any = {},
) {
  const result = await this.aggregate([
    {
      $match: {
        timestamp: { $gte: startTime, $lte: endTime },
        ...filters,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        errors: {
          $sum: {
            $cond: [{ $eq: ['$success', false] }, 1, 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        total: 1,
        errors: 1,
        errorRate: {
          $cond: [
            { $eq: ['$total', 0] },
            0,
            { $divide: ['$errors', '$total'] },
          ],
        },
      },
    },
  ]);

  return result[0] || { total: 0, errors: 0, errorRate: 0 };
};

AILogSchema.statics.getCostAnalytics = async function (
  startTime: Date,
  endTime: Date,
  groupBy: 'service' | 'aiModel' | 'project' | 'user' = 'service',
) {
  const groupField = `$${groupBy === 'project' ? 'projectId' : groupBy === 'user' ? 'userId' : groupBy}`;

  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: startTime, $lte: endTime },
      },
    },
    {
      $group: {
        _id: groupField,
        totalCost: { $sum: '$cost' },
        totalTokens: { $sum: '$totalTokens' },
        totalRequests: { $sum: 1 },
        avgLatency: { $avg: '$responseTime' },
        errors: {
          $sum: {
            $cond: [{ $eq: ['$success', false] }, 1, 0],
          },
        },
      },
    },
    {
      $sort: { totalCost: -1 },
    },
  ]);
};

// Pre-save hook to calculate totalTokens and sanitize data
AILogSchema.pre('save', function (next) {
  // Calculate total tokens if not set
  if (!this.totalTokens && (this.inputTokens || this.outputTokens)) {
    this.totalTokens = (this.inputTokens || 0) + (this.outputTokens || 0);
  }

  // Set success based on status code if not explicitly set
  if (this.statusCode && this.success === undefined) {
    this.success = this.statusCode < 400;
  }

  // Truncate long strings for storage efficiency
  if (this.prompt && this.prompt.length > 1000) {
    this.prompt = this.prompt.substring(0, 1000);
  }

  if (this.result && this.result.length > 1000) {
    this.result = this.result.substring(0, 1000);
  }

  // Sanitize error stack (remove sensitive paths)
  if (this.errorStack) {
    this.errorStack = this.errorStack
      .replace(/\/Users\/[^\/]+/g, '/Users/***')
      .replace(/\/home\/[^\/]+/g, '/home/***')
      .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***');
  }

  next();
});
