import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  HydratedDocument,
  Schema as MongooseSchema,
  Types as MongooseTypes,
} from 'mongoose';
import mongoose from 'mongoose';

// Fix: Use MongooseTypes for consistency, fix possible export errors, clarify missing types

export interface IVariablesResolved {
  variableName: string;
  value: string;
  confidence: number;
  source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
  reasoning?: string;
}

export interface ITemplateUsage {
  templateId: MongooseTypes.ObjectId;
  templateName: string;
  templateCategory: string;
  variablesResolved: IVariablesResolved[];
  context:
    | 'chat'
    | 'optimization'
    | 'visual-compliance'
    | 'agent_trace'
    | 'api';
  templateVersion?: number;
}

export interface IClientInfo {
  ip: string;
  port?: number;
  forwardedIPs: string[];
  userAgent: string;
  geoLocation?: {
    country: string;
    region: string;
    city: string;
  };
  sdkVersion?: string;
  environment?: string;
}

export interface IHeaders {
  request: Record<string, string>;
  response: Record<string, string>;
}

export interface INetworking {
  serverEndpoint: string;
  serverFullUrl?: string;
  clientOrigin?: string;
  serverIP: string;
  serverPort: number;
  routePattern: string;
  protocol: string;
  secure: boolean;
  dnsLookupTime?: number;
  tcpConnectTime?: number;
  tlsHandshakeTime?: number;
}

export interface IPayload {
  requestSize: number;
  responseSize: number;
  contentType: string;
  encoding?: string;
  compressionRatio?: number;
}

export interface IPerformance {
  clientSideTime?: number;
  networkTime: number;
  serverProcessingTime: number;
  totalRoundTripTime: number;
  dataTransferEfficiency: number;
}

export interface IRequestTracking {
  clientInfo: IClientInfo;
  headers: IHeaders;
  networking: INetworking;
  payload: IPayload;
  performance: IPerformance;
}

export interface ICostOptimization {
  potentialSavings: number;
  recommendedModel?: string;
  reasonCode:
    | 'model_downgrade'
    | 'prompt_optimization'
    | 'caching'
    | 'batch_processing';
  confidence: number;
  estimatedImpact: string;
}

export interface IPerformanceOptimization {
  currentPerformanceScore: number;
  bottleneckIdentified:
    | 'network'
    | 'processing'
    | 'payload_size'
    | 'model_complexity';
  recommendation: string;
  estimatedImprovement: string;
}

export interface IDataEfficiency {
  compressionRecommendation?: boolean;
  payloadOptimization?: string;
  headerOptimization?: string;
}

export interface IOptimizationOpportunities {
  costOptimization: ICostOptimization;
  performanceOptimization: IPerformanceOptimization;
  dataEfficiency: IDataEfficiency;
}

export interface IAnthropicBreakpoints {
  position: number;
  tokenCount: number;
  contentType: string;
}

export interface IPromptCaching {
  enabled: boolean;
  type: 'automatic' | 'explicit' | 'none';
  provider: 'anthropic' | 'openai' | 'google' | 'auto';
  model: string;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  regularTokens: number;
  totalTokens: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  savingsFromCaching: number;
  estimatedSavings: number;
  cacheKey?: string;
  cacheTTL: number;
  breakpointsUsed: number;
  prefixRatio: number;
  cacheLookupTime: number;
  cacheProcessingTime: number;
  anthropicBreakpoints?: IAnthropicBreakpoints[];
  openaiPrefixLength?: number;
  geminiCacheName?: string;
}

export interface IMetadata {
  requestId?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  promptTemplateId?: MongooseTypes.ObjectId;
  [key: string]: any;
}

export interface ICostAllocation {
  department?: string;
  team?: string;
  purpose?: string;
  client?: string;
  [key: string]: any;
}

export interface IErrorDetails {
  code?: string;
  type?: string;
  statusText?: string;
  requestId?: string;
  timestamp?: Date;
  endpoint?: string;
  method?: string;
  userAgent?: string;
  clientVersion?: string;
  [key: string]: any;
}

export interface IUsageMethods {
  costPerToken(): number;
}

export type UsageDocument = HydratedDocument<Usage> & IUsageMethods;

@Schema({ timestamps: true })
export class Usage implements IUsageMethods {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project' })
  projectId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Subscription' })
  subscriptionId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'openai',
      'aws-bedrock',
      'google-ai',
      'google', // alias for google-ai (analytics compatibility)
      'anthropic',
      'huggingface',
      'cohere',
      'dashboard-analytics',
      'other', // analytics compatibility
    ],
    required: true,
  })
  service:
    | 'openai'
    | 'aws-bedrock'
    | 'google-ai'
    | 'google'
    | 'anthropic'
    | 'huggingface'
    | 'cohere'
    | 'dashboard-analytics'
    | 'other'
    | string;

  @Prop({ required: true })
  model: string;

  @Prop({ default: '' })
  prompt: string;

  @Prop()
  completion?: string;

  @Prop({ required: true, min: 0 })
  promptTokens: number;

  @Prop({ required: true, min: 0 })
  completionTokens: number;

  @Prop({ required: true, min: 0 })
  totalTokens: number;

  @Prop({ required: true, min: 0, default: 0 })
  cost: number;

  @Prop({ min: 0 })
  estimatedCost?: number;

  @Prop({ required: true, min: 0, default: 0 })
  responseTime: number;

  @Prop({ type: Date })
  recordedAt?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: IMetadata;

  @Prop([{ type: String, trim: true }])
  tags: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  costAllocation: ICostAllocation;

  @Prop({ type: Boolean, default: false })
  optimizationApplied: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Optimization' })
  optimizationId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  errorOccurred: boolean;

  @Prop()
  errorMessage?: string;

  @Prop({ min: 100, max: 599 })
  httpStatusCode?: number;

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
      'integration_error',
    ],
  })
  errorType?:
    | 'client_error'
    | 'server_error'
    | 'network_error'
    | 'auth_error'
    | 'rate_limit'
    | 'timeout'
    | 'validation_error'
    | 'integration_error';

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  errorDetails: IErrorDetails;

  @Prop({ type: Boolean, default: false })
  isClientError?: boolean;

  @Prop({ type: Boolean, default: false })
  isServerError?: boolean;

  @Prop({ trim: true, lowercase: true, sparse: true })
  userEmail?: string;

  @Prop({ trim: true, lowercase: true, sparse: true })
  customerEmail?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  traceId?: string;

  @Prop()
  traceName?: string;

  @Prop()
  traceStep?: string;

  @Prop({ min: 0 })
  traceSequence?: number;

  @Prop()
  workflowId?: string;

  @Prop()
  workflowName?: string;

  @Prop()
  workflowStep?: string;

  @Prop({ min: 0 })
  workflowSequence?: number;

  @Prop({ type: String, enum: ['zapier', 'make', 'n8n'] })
  automationPlatform?: 'zapier' | 'make' | 'n8n';

  @Prop({ ref: 'AutomationConnection' })
  automationConnectionId?: string;

  @Prop({ min: 0, default: 0 })
  orchestrationCost?: number;

  @Prop({ min: 0, max: 100 })
  orchestrationOverheadPercentage?: number;

  @Prop({
    type: {
      templateId: {
        type: MongooseSchema.Types.ObjectId,
        ref: 'PromptTemplate',
      },
      templateName: String,
      templateCategory: {
        type: String,
        enum: [
          'general',
          'coding',
          'writing',
          'analysis',
          'creative',
          'business',
          'custom',
          'visual-compliance',
        ],
      },
      variablesResolved: [
        {
          variableName: String,
          value: String,
          confidence: Number,
          source: {
            type: String,
            enum: ['user_provided', 'context_inferred', 'default', 'missing'],
          },
          reasoning: String,
        },
      ],
      context: {
        type: String,
        enum: [
          'chat',
          'optimization',
          'visual-compliance',
          'agent_trace',
          'api',
        ],
      },
      templateVersion: Number,
    },
  })
  templateUsage?: ITemplateUsage;

  @Prop({
    type: {
      clientInfo: {
        ip: String,
        port: Number,
        forwardedIPs: [String],
        userAgent: String,
        geoLocation: {
          country: String,
          region: String,
          city: String,
        },
        sdkVersion: String,
        environment: String,
      },
      headers: {
        request: { type: mongoose.Schema.Types.Mixed, default: {} },
        response: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
      networking: {
        serverEndpoint: String,
        serverFullUrl: String,
        clientOrigin: String,
        serverIP: String,
        serverPort: Number,
        routePattern: String,
        protocol: String,
        secure: Boolean,
        dnsLookupTime: Number,
        tcpConnectTime: Number,
        tlsHandshakeTime: Number,
      },
      payload: {
        requestSize: { type: Number, min: 0, default: 0 },
        responseSize: { type: Number, min: 0, default: 0 },
        contentType: String,
        encoding: String,
        compressionRatio: Number,
      },
      performance: {
        clientSideTime: Number,
        networkTime: { type: Number, min: 0, default: 0 },
        serverProcessingTime: { type: Number, min: 0, default: 0 },
        totalRoundTripTime: { type: Number, min: 0, default: 0 },
        dataTransferEfficiency: { type: Number, min: 0, default: 0 },
      },
    },
  })
  requestTracking?: IRequestTracking;

  @Prop({
    type: {
      costOptimization: {
        potentialSavings: { type: Number, min: 0, default: 0 },
        recommendedModel: String,
        reasonCode: {
          type: String,
          enum: [
            'model_downgrade',
            'prompt_optimization',
            'caching',
            'batch_processing',
          ],
        },
        confidence: { type: Number, min: 0, max: 1, default: 0 },
        estimatedImpact: String,
      },
      performanceOptimization: {
        currentPerformanceScore: { type: Number, min: 0, max: 100, default: 0 },
        bottleneckIdentified: {
          type: String,
          enum: ['network', 'processing', 'payload_size', 'model_complexity'],
        },
        recommendation: String,
        estimatedImprovement: String,
      },
      dataEfficiency: {
        compressionRecommendation: Boolean,
        payloadOptimization: String,
        headerOptimization: String,
      },
    },
  })
  optimizationOpportunities?: IOptimizationOpportunities;

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      type: {
        type: String,
        enum: ['automatic', 'explicit', 'none'],
        default: 'none',
      },
      provider: {
        type: String,
        enum: ['anthropic', 'openai', 'google', 'auto'],
      },
      model: String,
      cacheCreationTokens: { type: Number, default: 0, min: 0 },
      cacheReadTokens: { type: Number, default: 0, min: 0 },
      regularTokens: { type: Number, default: 0, min: 0 },
      totalTokens: { type: Number, default: 0, min: 0 },
      cacheHits: { type: Number, default: 0, min: 0 },
      cacheMisses: { type: Number, default: 0, min: 0 },
      hitRate: { type: Number, default: 0, min: 0, max: 1 },
      savingsFromCaching: { type: Number, default: 0, min: 0 },
      estimatedSavings: { type: Number, default: 0, min: 0 },
      cacheKey: String,
      cacheTTL: { type: Number, default: 300, min: 0 },
      breakpointsUsed: { type: Number, default: 0, min: 0 },
      prefixRatio: { type: Number, default: 0, min: 0, max: 1 },
      cacheLookupTime: { type: Number, default: 0, min: 0 },
      cacheProcessingTime: { type: Number, default: 0, min: 0 },
      anthropicBreakpoints: [
        {
          position: Number,
          tokenCount: Number,
          contentType: String,
        },
      ],
      openaiPrefixLength: Number,
      geminiCacheName: String,
    },
  })
  promptCaching?: IPromptCaching;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  costPerToken(): number {
    return this.totalTokens > 0 ? this.cost / this.totalTokens : 0;
  }
}

export const UsageSchema = SchemaFactory.createForClass(Usage);

// Virtual: provider alias for service (analytics compatibility when reading)
UsageSchema.virtual('provider').get(function (this: Usage) {
  const stored = (this as any).get?.('provider');
  return stored != null ? stored : this.service;
});

// Instance methods
UsageSchema.methods.costPerToken = function (): number {
  return this.totalTokens > 0 ? this.cost / this.totalTokens : 0;
};

// Static methods
UsageSchema.statics.getUserSummary = async function (
  userId: string,
  startDate?: Date,
  endDate?: Date,
) {
  const match: any = { userId: new MongooseSchema.Types.ObjectId(userId) };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$cost' },
        totalTokens: { $sum: '$totalTokens' },
        totalCalls: { $sum: 1 },
        avgCost: { $avg: '$cost' },
        avgTokens: { $avg: '$totalTokens' },
        avgResponseTime: { $avg: '$responseTime' },
      },
    },
  ]);
};

UsageSchema.statics.getEnhancedUserSummary = async function (
  userId: string,
  startDate?: Date,
  endDate?: Date,
) {
  const match: any = { userId: new MongooseSchema.Types.ObjectId(userId) };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$cost' },
        totalTokens: { $sum: '$totalTokens' },
        totalCalls: { $sum: 1 },
        avgCost: { $avg: '$cost' },
        avgTokens: { $avg: '$totalTokens' },
        avgResponseTime: { $avg: '$responseTime' },
        avgNetworkTime: { $avg: '$requestTracking.performance.networkTime' },
        avgServerProcessingTime: {
          $avg: '$requestTracking.performance.serverProcessingTime',
        },
        avgTotalRoundTripTime: {
          $avg: '$requestTracking.performance.totalRoundTripTime',
        },
        totalRequestSize: { $sum: '$requestTracking.payload.requestSize' },
        totalResponseSize: { $sum: '$requestTracking.payload.responseSize' },
        avgDataTransferEfficiency: {
          $avg: '$requestTracking.performance.dataTransferEfficiency',
        },
        totalPotentialSavings: {
          $sum: '$optimizationOpportunities.costOptimization.potentialSavings',
        },
        avgPerformanceScore: {
          $avg: '$optimizationOpportunities.performanceOptimization.currentPerformanceScore',
        },
        optimizationOpportunityCount: {
          $sum: {
            $cond: [
              {
                $gt: [
                  '$optimizationOpportunities.costOptimization.potentialSavings',
                  0,
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
};

// Indexes
UsageSchema.index({ userId: 1, createdAt: -1 });
UsageSchema.index({ userId: 1, recordedAt: -1 });
UsageSchema.index({ subscriptionId: 1 });
UsageSchema.index({ recordedAt: -1 });
UsageSchema.index({ createdAt: -1 });
UsageSchema.index({ workflowId: 1 });
UsageSchema.index({ service: 1, createdAt: -1 });
UsageSchema.index({ cost: -1 });
UsageSchema.index({ errorOccurred: 1, createdAt: -1 });
UsageSchema.index({ prompt: 'text', completion: 'text' });
UsageSchema.index({ 'templateUsage.templateId': 1, createdAt: -1 });
UsageSchema.index({ 'templateUsage.context': 1, createdAt: -1 });
UsageSchema.index({ userId: 1, 'templateUsage.templateId': 1, createdAt: -1 });
UsageSchema.index({ automationPlatform: 1, createdAt: -1 });
UsageSchema.index({ automationConnectionId: 1, createdAt: -1 });
UsageSchema.index({ userId: 1, automationPlatform: 1, createdAt: -1 });
UsageSchema.index({ traceId: 1, automationPlatform: 1, createdAt: -1 });
UsageSchema.index({ 'requestTracking.clientInfo.ip': 1, createdAt: -1 });
UsageSchema.index({
  'requestTracking.networking.serverEndpoint': 1,
  createdAt: -1,
});
UsageSchema.index({ 'requestTracking.performance.serverProcessingTime': -1 });
UsageSchema.index({ 'requestTracking.performance.totalRoundTripTime': -1 });
UsageSchema.index({
  'optimizationOpportunities.costOptimization.potentialSavings': -1,
});
UsageSchema.index({
  'optimizationOpportunities.performanceOptimization.currentPerformanceScore': 1,
});
