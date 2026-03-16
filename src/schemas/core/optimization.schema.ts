import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IVisualComplianceData {
  referenceImageUrl?: string;
  evidenceImageUrl?: string;
  complianceScore: number;
  passFail: boolean;
  feedbackMessage: string;
  industry: string;
  complianceCriteria: string[];
}

export interface IOptimizationSuggestion {
  type: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  implemented: boolean;
}

export interface IOptimizationMetadata {
  analysisTime?: number;
  confidence?: number;
  alternatives?: Array<{
    prompt: string;
    tokens: number;
    cost: number;
  }>;
  [key: string]: any;
}

export interface ITokenReduction {
  withoutCortex: number;
  withCortex: number;
  absoluteSavings: number;
  percentageSavings: number;
}

export interface IQualityMetrics {
  clarityScore: number;
  completenessScore: number;
  relevanceScore: number;
  ambiguityReduction: number;
  redundancyRemoval: number;
}

export interface IPerformanceMetrics {
  processingTime: number;
  responseLatency: number;
  compressionRatio: number;
}

export interface ICostImpact {
  estimatedCostWithoutCortex: number;
  actualCostWithCortex: number;
  costSavings: number;
  savingsPercentage: number;
  isAdjusted?: boolean;
  minimalFee?: number;
}

export interface IJustification {
  optimizationTechniques: string[];
  keyImprovements: string[];
  confidenceScore: number;
}

export interface ICortexImpactMetrics {
  tokenReduction: ITokenReduction;
  qualityMetrics: IQualityMetrics;
  performanceMetrics: IPerformanceMetrics;
  costImpact: ICostImpact;
  justification: IJustification;
}

export interface IOptimizationFeedback {
  helpful: boolean;
  rating?: number;
  comment?: string;
  submittedAt?: Date;
}

export interface IClientInfo {
  ip: string;
  port?: number;
  forwardedIPs: string[];
  userAgent: string;
  geoLocation?: { country: string; region: string; city: string };
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
  requestBody?: any;
  responseBody?: any;
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

export type OptimizationDocument = HydratedDocument<Optimization>;

@Schema({ timestamps: true })
export class Optimization {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  userQuery: string;

  @Prop({ required: true })
  generatedAnswer: string;

  @Prop([String])
  optimizationTechniques: string[];

  @Prop({ required: true, min: 0 })
  originalTokens: number;

  @Prop({ required: true, min: 0 })
  optimizedTokens: number;

  @Prop({ required: true, min: 0 })
  tokensSaved: number;

  @Prop({ required: true, min: 0 })
  originalCost: number;

  @Prop({ required: true, min: 0 })
  optimizedCost: number;

  @Prop({ required: true, min: 0 })
  costSaved: number;

  @Prop({ required: true, min: 0, max: 100 })
  improvementPercentage: number;

  @Prop({ required: true })
  service: string;

  @Prop({ required: true })
  model: string;

  @Prop({
    type: String,
    enum: [
      'prompt_reduction',
      'context_optimization',
      'response_formatting',
      'batch_processing',
      'model_selection',
    ],
    required: true,
  })
  category:
    | 'prompt_reduction'
    | 'context_optimization'
    | 'response_formatting'
    | 'batch_processing'
    | 'model_selection';

  @Prop({
    type: String,
    enum: ['text', 'visual_compliance', 'visual_compliance_standard'],
    default: 'text',
    required: true,
  })
  optimizationType: 'text' | 'visual_compliance' | 'visual_compliance_standard';

  @Prop({
    type: {
      referenceImageUrl: String,
      evidenceImageUrl: String,
      complianceScore: Number,
      passFail: Boolean,
      feedbackMessage: String,
      industry: String,
      complianceCriteria: [String],
    },
  })
  visualComplianceData?: IVisualComplianceData;

  @Prop([
    {
      type: { type: String, required: true },
      description: { type: String, required: true },
      impact: { type: String, enum: ['low', 'medium', 'high'], required: true },
      implemented: { type: Boolean, default: false },
    },
  ])
  suggestions: IOptimizationSuggestion[];

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: IOptimizationMetadata;

  @Prop({
    type: {
      tokenReduction: {
        withoutCortex: Number,
        withCortex: Number,
        absoluteSavings: Number,
        percentageSavings: Number,
      },
      qualityMetrics: {
        clarityScore: Number,
        completenessScore: Number,
        relevanceScore: Number,
        ambiguityReduction: Number,
        redundancyRemoval: Number,
      },
      performanceMetrics: {
        processingTime: Number,
        responseLatency: Number,
        compressionRatio: Number,
      },
      costImpact: {
        estimatedCostWithoutCortex: Number,
        actualCostWithCortex: Number,
        costSavings: Number,
        savingsPercentage: Number,
        isAdjusted: Boolean,
        minimalFee: Number,
      },
      justification: {
        optimizationTechniques: [String],
        keyImprovements: [String],
        confidenceScore: Number,
      },
    },
  })
  cortexImpactMetrics?: ICortexImpactMetrics;

  @Prop({
    type: {
      helpful: Boolean,
      rating: { type: Number, min: 1, max: 5 },
      comment: String,
      submittedAt: Date,
    },
  })
  feedback?: IOptimizationFeedback;

  @Prop([{ type: String, trim: true }])
  tags: string[];

  @Prop({ type: mongoose.Schema.Types.Mixed, default: undefined })
  requestTracking?: IRequestTracking;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const OptimizationSchema = SchemaFactory.createForClass(Optimization);

// Indexes
OptimizationSchema.index({ userId: 1, createdAt: -1 });
OptimizationSchema.index({ costSaved: -1 });
OptimizationSchema.index({ improvementPercentage: -1 });
OptimizationSchema.index({ category: 1 });
OptimizationSchema.index({ createdAt: -1 });

// Text index for searching prompts
OptimizationSchema.index({ userQuery: 'text', generatedAnswer: 'text' });
