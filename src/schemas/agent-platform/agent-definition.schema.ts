import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentDefinitionDocument = HydratedDocument<AgentDefinition>;

@Schema({ _id: false })
export class AgentCostEstimate {
  @Prop({ default: 0 })
  perRunUsd: number;

  @Prop()
  lastEstimatedAt?: Date;
}

@Schema({ timestamps: true, collection: 'agent_definitions' })
export class AgentDefinition {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true })
  teamId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true })
  projectId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true })
  slug: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  currentVersionId?: Types.ObjectId;

  @Prop({
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
    index: true,
  })
  status: 'draft' | 'published' | 'archived';

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String })
  templateSourceSlug?: string;

  @Prop({ type: AgentCostEstimate, default: () => ({}) })
  costEstimate: AgentCostEstimate;
}

export const AgentDefinitionSchema =
  SchemaFactory.createForClass(AgentDefinition);

AgentDefinitionSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
AgentDefinitionSchema.index({ teamId: 1, status: 1 });
AgentDefinitionSchema.index({ projectId: 1, updatedAt: -1 });
