import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentKnowledgeBaseDocument = HydratedDocument<AgentKnowledgeBase>;

export type AgentKnowledgeBaseStatus =
  | 'pending'
  | 'creating'
  | 'ready'
  | 'failed';

@Schema({ timestamps: true, collection: 'agent_knowledge_bases' })
export class AgentKnowledgeBase {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  /** Bedrock-side KnowledgeBase id (set after CreateKnowledgeBaseCommand). */
  @Prop()
  bedrockKbId?: string;

  /** Bedrock-side DataSource id (set after CreateDataSourceCommand). */
  @Prop()
  dataSourceId?: string;

  @Prop({ required: true })
  s3Bucket: string;

  /** S3 prefix root for this org's documents, e.g. `{orgId}/{kbId}/`. */
  @Prop({ required: true })
  s3PrefixRoot: string;

  @Prop({ default: 'amazon.titan-embed-text-v2:0' })
  embeddingModel: string;

  @Prop({
    enum: ['pending', 'creating', 'ready', 'failed'],
    default: 'pending',
    index: true,
  })
  status: AgentKnowledgeBaseStatus;

  @Prop({ default: 0 })
  documentCount: number;

  @Prop()
  lastIngestionJobId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  lastError?: { message: string; at: Date };

  @Prop({ type: MongooseSchema.Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const AgentKnowledgeBaseSchema =
  SchemaFactory.createForClass(AgentKnowledgeBase);

AgentKnowledgeBaseSchema.index({ organizationId: 1 }, { unique: true });
AgentKnowledgeBaseSchema.index({ bedrockKbId: 1 }, { sparse: true });
