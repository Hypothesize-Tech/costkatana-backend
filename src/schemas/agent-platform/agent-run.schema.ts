import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentRunDocument = HydratedDocument<AgentRun>;

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'paused_checkpoint'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

@Schema({ _id: false })
export class AgentRunTokenUsage {
  @Prop({ default: 0 })
  in: number;

  @Prop({ default: 0 })
  out: number;
}

@Schema({ timestamps: true, collection: 'agent_runs' })
export class AgentRun {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  agentDefinitionId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  agentVersionId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true })
  deploymentId?: Types.ObjectId;

  @Prop({ index: true })
  widgetSessionId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true })
  userId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'queued',
      'running',
      'paused_checkpoint',
      'succeeded',
      'failed',
      'cancelled',
    ],
    default: 'queued',
    index: true,
  })
  status: AgentRunStatus;

  @Prop({ type: String, enum: ['test', 'live'], required: true, default: 'test' })
  mode: 'test' | 'live';

  @Prop({ type: MongooseSchema.Types.Mixed })
  input: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  output?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  error?: { message: string; nodeId?: string; stack?: string };

  @Prop({ type: AgentRunTokenUsage, default: () => ({}) })
  tokens: AgentRunTokenUsage;

  @Prop({ default: 0 })
  costUsd: number;

  @Prop({ required: true, default: () => new Date() })
  startedAt: Date;

  @Prop()
  endedAt?: Date;

  @Prop()
  pausedAt?: Date;

  @Prop()
  currentNodeId?: string;

  @Prop()
  bullJobId?: string;
}

export const AgentRunSchema = SchemaFactory.createForClass(AgentRun);

// 30-day TTL on completed runs (only kicks in once endedAt is set)
AgentRunSchema.index(
  { endedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30, sparse: true },
);
AgentRunSchema.index({ agentDefinitionId: 1, startedAt: -1 });
AgentRunSchema.index({ status: 1, startedAt: -1 });
