import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentKnowledgeBaseDocument = HydratedDocument<AgentKnowledgeBase>;

export type AgentKnowledgeBaseStatus = 'pending' | 'ready' | 'failed';

/**
 * Per-organization knowledge base. The actual chunks live in
 * `agent_kb_chunks`; this row is just the metadata wrapper.
 *
 * v1: vectors are embedded with Bedrock Titan v2 and stored in Mongo, then
 * indexed in-memory by `KbIndexService` (FAISS, with a JS cosine fallback).
 * No Bedrock Knowledge Base resource, no OpenSearch Serverless collection,
 * no extra IAM provisioning beyond the existing AWS_S3_BUCKET access.
 */
@Schema({ timestamps: true, collection: 'agent_knowledge_bases' })
export class AgentKnowledgeBase {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  organizationId: Types.ObjectId;

  /**
   * S3 bucket holding original document blobs. Defaults to the
   * platform-shared `costkatana-media` (`AWS_S3_BUCKET`); per-tenant
   * isolation is enforced via `s3PrefixRoot`.
   */
  @Prop({
    required: true,
    default: () => process.env.AWS_S3_BUCKET || 'costkatana-media',
  })
  s3Bucket: string;

  /**
   * S3 prefix inside the shared bucket, e.g.
   * `agent-platform/kb/{orgId}/{kbId}/`. Always namespaced under
   * `agent-platform/kb/` so it doesn't collide with other modules' uploads.
   */
  @Prop({ required: true })
  s3PrefixRoot: string;

  @Prop({ default: 'amazon.titan-embed-text-v2:0' })
  embeddingModel: string;

  @Prop({
    enum: ['pending', 'ready', 'failed'],
    default: 'pending',
    index: true,
  })
  status: AgentKnowledgeBaseStatus;

  @Prop({ default: 0 })
  documentCount: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  lastError?: { message: string; at: Date };

  @Prop({ type: MongooseSchema.Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const AgentKnowledgeBaseSchema =
  SchemaFactory.createForClass(AgentKnowledgeBase);

AgentKnowledgeBaseSchema.index({ organizationId: 1 }, { unique: true });
