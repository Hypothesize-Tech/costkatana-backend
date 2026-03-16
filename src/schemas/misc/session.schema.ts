import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

// Shared Session Schema for session sharing functionality
@Schema({ timestamps: true })
export class SharedSession {
  @Prop({ required: true, unique: true })
  shareId: string;

  @Prop({ required: true })
  sessionId: string;

  @Prop({ required: true })
  userId: string;

  @Prop()
  workspaceId?: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  password?: string; // Optional password protection

  @Prop({ type: Object })
  accessControl: {
    allowDownload: boolean;
    allowRawData: boolean;
    restrictToDomain?: string[];
  };

  @Prop({ default: 0 })
  accessCount: number;

  @Prop()
  lastAccessedAt?: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export type SharedSessionDocument = HydratedDocument<SharedSession>;
export const SharedSessionSchema = SchemaFactory.createForClass(SharedSession);

SharedSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * AI Interaction data structure for session replay
 */
export interface IAIInteraction {
  model: string;
  prompt: string;
  response: string;
  parameters: Record<string, any>;
  tokens: {
    input: number;
    output: number;
  };
  cost: number;
  timestamp: Date;
}

/**
 * System metrics captured during session
 */
export interface ISystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  networkLatency: number;
  timestamp: Date;
}

/**
 * File context information
 */
export interface IFileContext {
  path: string;
  language: string;
  size: number;
  lastModified: Date;
}

/**
 * Workspace context
 */
export interface IWorkspaceContext {
  id: string;
  name: string;
  rootPath: string;
  files: IFileContext[];
}

/**
 * Request context for tracking history
 */
export interface IRequestContext {
  model: string;
  tokens: number;
  cost: number;
  context: {
    files: IFileContext[];
    workspace: IWorkspaceContext;
  };
}

/**
 * Tracking history entry
 */
export interface ITrackingHistory {
  enabled: boolean;
  sessionReplayEnabled: boolean;
  timestamp: Date;
  request: IRequestContext;
}

/**
 * Session replay data structure
 */
export interface ISessionReplayData {
  aiInteractions: IAIInteraction[];
  userActions: Array<{
    type: string;
    data: Record<string, any>;
    timestamp: Date;
  }>;
  systemMetrics: ISystemMetrics[];
  metadata: Record<string, any>;
}

/**
 * Integration types supported for session replay
 */
export type IntegrationType =
  | 'chatgpt'
  | 'cursor'
  | 'npmjs'
  | 'pypi'
  | 'jetbrains'
  | 'vscode'
  | 'terminal'
  | 'api'
  | 'web'
  | 'mobile';

/**
 * App features being tracked
 */
export type AppFeature =
  | 'ai-chat'
  | 'code-completion'
  | 'code-review'
  | 'debugging'
  | 'testing'
  | 'documentation'
  | 'deployment'
  | 'monitoring';

/**
 * Session status
 */
export type SessionStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'expired'
  | 'failed';

@Schema({ timestamps: true })
export class Session {
  @Prop({ required: true, unique: true })
  sessionId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Workspace' })
  workspaceId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['active', 'paused', 'completed', 'expired', 'failed'],
    default: 'active',
  })
  status: SessionStatus;

  @Prop({
    type: String,
    enum: [
      'chatgpt',
      'cursor',
      'npmjs',
      'pypi',
      'jetbrains',
      'vscode',
      'terminal',
      'api',
      'web',
      'mobile',
    ],
    required: true,
  })
  source: IntegrationType;

  @Prop({
    type: String,
    enum: [
      'ai-chat',
      'code-completion',
      'code-review',
      'debugging',
      'testing',
      'documentation',
      'deployment',
      'monitoring',
    ],
  })
  appFeature?: AppFeature;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  replayData: ISessionReplayData;

  @Prop({ default: 0 })
  totalInteractions: number;

  @Prop({ default: 0 })
  totalCost: number;

  @Prop({ default: 0 })
  totalTokens: number;

  @Prop({ type: Date, default: Date.now })
  startedAt: Date;

  @Prop()
  endedAt?: Date;

  @Prop({ default: Date.now })
  lastActivityAt: Date;

  @Prop({ type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) }) // 30 minutes
  expiresAt: Date;

  @Prop({ default: 30 * 60 * 1000 }) // 30 minutes in ms
  timeoutMs: number;

  @Prop({ type: Boolean, default: false })
  trackingEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  sessionReplayEnabled: boolean;

  @Prop()
  trackingEnabledAt?: Date;

  @Prop()
  traceId?: string;

  @Prop()
  traceName?: string;

  @Prop({ default: 0 })
  traceStep?: number;

  @Prop()
  traceSequence?: string;

  @Prop({ default: 0 })
  durationMs?: number;

  @Prop({
    type: [
      {
        enabled: Boolean,
        sessionReplayEnabled: Boolean,
        timestamp: Date,
        request: {
          model: String,
          tokens: Number,
          cost: Number,
          context: {
            files: [
              {
                path: String,
                language: String,
                size: Number,
                lastModified: Date,
              },
            ],
            workspace: {
              id: String,
              name: String,
              rootPath: String,
              files: [
                {
                  path: String,
                  language: String,
                  size: Number,
                  lastModified: Date,
                },
              ],
            },
          },
        },
      },
    ],
    default: [],
  })
  trackingHistory: ITrackingHistory[];

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: {} })
  summary: {
    totalInteractions?: number;
    totalCost?: number;
    totalTokens?: number;
    averageResponseTime?: number;
    mostUsedModel?: string;
    topFeatures?: string[];
    errorCount?: number;
    successRate?: number;
  };

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);

// Indexes for performance (sessionId unique index created by @Prop)
SessionSchema.index({ userId: 1, startedAt: -1 });
SessionSchema.index({ userId: 1, status: 1 });
SessionSchema.index({ status: 1, expiresAt: 1 });
SessionSchema.index({ source: 1, appFeature: 1 });
SessionSchema.index({ workspaceId: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Virtual for checking if session is expired
SessionSchema.virtual('isExpired').get(function () {
  return new Date() > this.expiresAt;
});

// Instance methods
SessionSchema.methods.isActive = function (): boolean {
  return this.status === 'active' && !this.isExpired;
};

SessionSchema.methods.markActivity = function (): void {
  this.lastActivityAt = new Date();
  if (this.status === 'paused') {
    this.status = 'active';
  }
};

SessionSchema.methods.endSession = function (reason?: string): void {
  this.status = 'completed';
  this.endedAt = new Date();
  if (reason) {
    this.metadata.endReason = reason;
  }
};

SessionSchema.methods.pauseSession = function (): void {
  this.status = 'paused';
};

SessionSchema.methods.failSession = function (error?: string): void {
  this.status = 'failed';
  this.endedAt = new Date();
  if (error) {
    this.metadata.failureReason = error;
  }
};

SessionSchema.methods.extendTimeout = function (
  additionalMs: number = 30 * 60 * 1000,
): void {
  this.expiresAt = new Date(this.expiresAt.getTime() + additionalMs);
};

SessionSchema.methods.addInteraction = function (
  interaction: Partial<IAIInteraction>,
  systemMetrics?: ISystemMetrics,
): void {
  if (!this.replayData.aiInteractions) {
    this.replayData.aiInteractions = [];
  }

  const fullInteraction: IAIInteraction = {
    model: interaction.model || '',
    prompt: interaction.prompt || '',
    response: interaction.response || '',
    parameters: interaction.parameters || {},
    tokens: interaction.tokens || { input: 0, output: 0 },
    cost: interaction.cost || 0,
    timestamp: new Date(),
  };

  this.replayData.aiInteractions.push(fullInteraction);
  this.totalInteractions += 1;
  this.totalCost += fullInteraction.cost;
  this.totalTokens +=
    fullInteraction.tokens.input + fullInteraction.tokens.output;
  this.lastActivityAt = new Date();

  // Add system metrics if provided
  if (systemMetrics && !this.replayData.systemMetrics) {
    this.replayData.systemMetrics = [];
  }
  if (systemMetrics) {
    this.replayData.systemMetrics!.push(systemMetrics);
  }
};

SessionSchema.methods.addUserAction = function (
  type: string,
  data: Record<string, any>,
): void {
  if (!this.replayData.userActions) {
    this.replayData.userActions = [];
  }

  this.replayData.userActions.push({
    type,
    data,
    timestamp: new Date(),
  });

  this.lastActivityAt = new Date();
};

SessionSchema.methods.getSummary = function () {
  const interactions = this.replayData.aiInteractions || [];
  const userActions = this.replayData.userActions || [];

  const modelUsage = interactions.reduce(
    (acc: Record<string, number>, interaction: any) => {
      acc[interaction.model] = (acc[interaction.model] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const mostUsedModel =
    Object.entries(modelUsage).sort(
      ([, a]: [string, number], [, b]: [string, number]) => b - a,
    )[0]?.[0] || '';

  const averageResponseTime =
    interactions.length > 0
      ? interactions.reduce(
          (sum: number, i: any) => sum + (i.parameters?.responseTime || 0),
          0,
        ) / interactions.length
      : 0;

  const errorCount = interactions.filter(
    (i: any) =>
      i.parameters?.errorOccurred ||
      i.response?.includes('error') ||
      i.response?.includes('Error'),
  ).length;

  const successRate =
    interactions.length > 0
      ? ((interactions.length - errorCount) / interactions.length) * 100
      : 0;

  return {
    totalInteractions: interactions.length,
    totalUserActions: userActions.length,
    totalCost: this.totalCost,
    totalTokens: this.totalTokens,
    averageResponseTime,
    mostUsedModel,
    errorCount,
    successRate,
    durationMs: this.durationMs,
    isActive: this.isActive(),
  };
};

// Static methods
SessionSchema.statics.findActiveByUserId = function (userId: string) {
  return this.find({
    userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  }).sort({ lastActivityAt: -1 });
};

SessionSchema.statics.findBySessionId = function (sessionId: string) {
  return this.findOne({ sessionId });
};

SessionSchema.statics.cleanupExpiredSessions = function () {
  const now = new Date();
  return this.updateMany(
    {
      status: 'active',
      expiresAt: { $lt: now },
    },
    {
      status: 'expired',
      endedAt: now,
    },
  );
};

SessionSchema.statics.getUserSessionStats = function (
  userId: string,
  days: number = 30,
) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        startedAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        activeSessions: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
        },
        totalDuration: {
          $sum: {
            $subtract: [{ $ifNull: ['$endedAt', new Date()] }, '$startedAt'],
          },
        },
        totalCost: { $sum: '$totalCost' },
        totalTokens: { $sum: '$totalTokens' },
        avgSessionDuration: {
          $avg: { $subtract: ['$lastActivityAt', '$startedAt'] },
        },
      },
    },
  ]);
};
