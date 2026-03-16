import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * Session document for session replay feature.
 * Uses separate "session_replays" collection to avoid collision with Session model.
 */
export type SessionReplayDocument = HydratedDocument<SessionReplay>;

@Schema({ timestamps: true, collection: 'session_replays' })
export class SessionReplay {
  @Prop({ required: true, unique: true, index: true })
  sessionId: string;

  @Prop({ type: String, index: true })
  userId?: string;

  @Prop({ index: true })
  label?: string;

  @Prop({ required: true, index: true })
  startedAt: Date;

  @Prop()
  endedAt?: Date;

  @Prop({
    type: String,
    enum: ['active', 'completed', 'error'],
    default: 'active',
    index: true,
  })
  status: 'active' | 'completed' | 'error';

  @Prop({
    type: String,
    enum: ['telemetry', 'manual', 'unified', 'in-app', 'integration'],
    default: 'manual',
    index: true,
  })
  source?: string;

  @Prop({ index: true })
  telemetryTraceId?: string;

  @Prop({ index: true })
  workspaceId?: string;

  @Prop({ default: false })
  trackingEnabled?: boolean;

  @Prop({ default: false })
  sessionReplayEnabled?: boolean;

  @Prop()
  trackingEnabledAt?: Date;

  @Prop()
  duration?: number;

  @Prop({ default: false, index: true })
  hasErrors?: boolean;

  @Prop({ default: 0 })
  errorCount?: number;

  @Prop()
  appFeature?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  trackingHistory?: unknown[];

  @Prop({ type: MongooseSchema.Types.Mixed })
  replayData?: {
    codeContext?: Array<{
      filePath: string;
      content: string;
      language?: string;
      timestamp: Date;
    }>;
    aiInteractions?: Array<{
      timestamp: Date;
      model: string;
      prompt: string;
      response: string;
      parameters?: Record<string, unknown>;
      tokens?: { input: number; output: number };
      cost?: number;
      latency?: number;
      provider?: string;
      requestMetadata?: Record<string, unknown>;
      responseMetadata?: Record<string, unknown>;
    }>;
    userActions?: Array<{
      timestamp: Date;
      action: string;
      details?: unknown;
    }>;
    systemMetrics?: Array<{
      timestamp: Date;
      cpu?: number;
      memory?: number;
      cpuUsage?: number;
      memoryUsage?: number;
      network?: { sent: number; received: number };
    }>;
  };

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  summary?: {
    totalSpans?: number;
    totalDuration?: number;
    totalCost?: number;
    totalTokens?: { input: number; output: number };
  };

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const SessionReplaySchema = SchemaFactory.createForClass(SessionReplay);

SessionReplaySchema.index({ userId: 1, startedAt: -1 });
SessionReplaySchema.index({ userId: 1, workspaceId: 1, updatedAt: -1 });
SessionReplaySchema.index({ status: 1, startedAt: -1 });
SessionReplaySchema.index({ userId: 1, source: 1, startedAt: -1 });
SessionReplaySchema.index({ userId: 1, hasErrors: 1, startedAt: -1 });
SessionReplaySchema.index({ userId: 1, 'summary.totalCost': 1, startedAt: -1 });
SessionReplaySchema.index({ appFeature: 1, userId: 1, startedAt: -1 });
