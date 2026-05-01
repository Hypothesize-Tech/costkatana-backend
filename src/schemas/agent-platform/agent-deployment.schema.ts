import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentDeploymentDocument = HydratedDocument<AgentDeployment>;

export type AgentDeploymentChannel =
  | 'embed-widget'
  | 'api'
  | 'webhook'
  | 'slack'
  | 'discord'
  | 'whatsapp'
  | 'voice';

@Schema({ _id: false })
export class AgentDeploymentRateLimit {
  @Prop({ default: 30 })
  perMinPerIp: number;

  @Prop({ default: 10 })
  perMinPerSession: number;
}

@Schema({ _id: false })
export class AgentDeploymentTheme {
  @Prop({ default: '#A8FF60' })
  primary: string;

  @Prop({ default: '#0A0A0F' })
  surface: string;

  @Prop({ default: 'bottom-right' })
  position: string;

  @Prop()
  logoUrl?: string;
}

@Schema({ timestamps: true, collection: 'agent_deployments' })
export class AgentDeployment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  agentDefinitionId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  agentVersionId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({
    enum: ['embed-widget', 'api', 'webhook', 'slack', 'discord', 'whatsapp', 'voice'],
    required: true,
    index: true,
  })
  channel: AgentDeploymentChannel;

  @Prop({ enum: ['active', 'paused'], default: 'active' })
  status: 'active' | 'paused';

  /** URL-safe public id used in widget script tags + embed routes. */
  @Prop({ required: true })
  publicId: string;

  /** Origins allowed to embed this deployment. Empty = block all. */
  @Prop({ type: [String], default: [] })
  originAllowlist: string[];

  @Prop({ type: AgentDeploymentRateLimit, default: () => ({}) })
  rateLimit: AgentDeploymentRateLimit;

  @Prop({ type: AgentDeploymentTheme, default: () => ({}) })
  theme: AgentDeploymentTheme;

  @Prop({ default: 'Hi — how can I help?' })
  welcomeMessage: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: () => new Date() })
  lastDeployedAt: Date;
}

export const AgentDeploymentSchema =
  SchemaFactory.createForClass(AgentDeployment);

AgentDeploymentSchema.index({ publicId: 1 }, { unique: true });
AgentDeploymentSchema.index({ agentDefinitionId: 1, channel: 1 });
