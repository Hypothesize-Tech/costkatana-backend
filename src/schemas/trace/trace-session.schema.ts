import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true, collection: 'trace_sessions' })
export class TraceSession {
  @Prop({ required: true, unique: true })
  sessionId: string;

  @Prop()
  userId?: string;

  @Prop()
  label?: string;

  @Prop({ required: true })
  startedAt: Date;

  @Prop()
  endedAt?: Date;

  @Prop({ enum: ['active', 'completed', 'error'], default: 'active' })
  status: 'active' | 'completed' | 'error';

  @Prop({
    enum: ['telemetry', 'manual', 'unified', 'in-app', 'integration'],
    default: 'manual',
  })
  source?: 'telemetry' | 'manual' | 'unified' | 'in-app' | 'integration';

  @Prop()
  telemetryTraceId?: string;

  @Prop()
  workspaceId?: string;

  @Prop({ default: false })
  trackingEnabled?: boolean;

  @Prop({ default: false })
  sessionReplayEnabled?: boolean;

  @Prop()
  trackingEnabledAt?: Date;

  @Prop()
  duration?: number;

  @Prop({ default: false })
  hasErrors?: boolean;

  @Prop({ default: 0 })
  errorCount?: number;

  @Prop()
  integrationName?: string;

  @Prop()
  appFeature?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({
    type: {
      message: String,
      stack: String,
    },
  })
  error?: { message: string; stack?: string };

  @Prop({ type: MongooseSchema.Types.Mixed })
  summary?: {
    totalSpans: number;
    totalDuration?: number;
    totalCost?: number;
    totalTokens?: { input: number; output: number };
  };
}

export type TraceSessionDocument = HydratedDocument<TraceSession>;
export const TraceSessionSchema = SchemaFactory.createForClass(TraceSession);

TraceSessionSchema.index({ userId: 1, startedAt: -1 });
TraceSessionSchema.index({ label: 1, startedAt: -1 });
TraceSessionSchema.index({ status: 1, startedAt: -1 });
TraceSessionSchema.index({ userId: 1, source: 1, startedAt: -1 });
TraceSessionSchema.index({ userId: 1, 'summary.totalCost': 1, startedAt: -1 });
TraceSessionSchema.index({ userId: 1, 'summary.totalSpans': 1, startedAt: -1 });
