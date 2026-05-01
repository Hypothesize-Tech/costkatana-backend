import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentRunStepDocument = HydratedDocument<AgentRunStep>;

export type AgentRunStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'paused';

@Schema({ _id: false })
export class AgentRunStepTokens {
  @Prop({ default: 0 })
  in: number;

  @Prop({ default: 0 })
  out: number;
}

@Schema({ timestamps: true, collection: 'agent_run_steps' })
export class AgentRunStep {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  agentRunId: Types.ObjectId;

  @Prop({ required: true })
  nodeId: string;

  @Prop({ required: true, index: true })
  nodeType: string;

  @Prop({ default: 1 })
  attempt: number;

  @Prop({
    enum: ['pending', 'running', 'succeeded', 'failed', 'skipped', 'paused'],
    default: 'pending',
    index: true,
  })
  status: AgentRunStepStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  input: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  output?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed })
  error?: { message: string; stack?: string };

  @Prop({ type: AgentRunStepTokens, default: () => ({}) })
  tokens: AgentRunStepTokens;

  @Prop({ default: 0 })
  costUsd: number;

  @Prop({ default: 0 })
  latencyMs: number;

  @Prop({ required: true, default: () => new Date() })
  startedAt: Date;

  @Prop()
  endedAt?: Date;

  /** Free-form per-executor metadata (model name, citations, KB id, etc.). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  traceMeta: Record<string, unknown>;
}

export const AgentRunStepSchema = SchemaFactory.createForClass(AgentRunStep);

AgentRunStepSchema.index({ agentRunId: 1, startedAt: 1 });
