import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AgentKbChunkDocument = HydratedDocument<AgentKbChunk>;

/**
 * One chunk of one document, with its embedded vector. Stored separately
 * from `AgentKnowledgeBase` so we can look up + delete chunks without
 * pulling the whole KB document.
 *
 * The vector is stored as `number[]` (Mongo BSON double[]). At query time
 * the runtime materializes a FAISS index in-memory, keyed by `kbId`, and
 * caches it for the lifetime of the process.
 */
@Schema({ timestamps: true, collection: 'agent_kb_chunks' })
export class AgentKbChunk {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  knowledgeBaseId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  organizationId: Types.ObjectId;

  /** Synthetic document id (one per uploaded file). */
  @Prop({ required: true, index: true })
  docId: string;

  /** Filename of the source document (for citations). */
  @Prop({ required: true })
  source: string;

  /** Raw S3 key of the source object. */
  @Prop()
  s3Key?: string;

  /** Position of this chunk in the source doc (0-indexed). */
  @Prop({ required: true })
  ordinal: number;

  /** Plaintext content. */
  @Prop({ required: true })
  text: string;

  /**
   * L2-normalized embedding. Length == embeddingDimension. Stored as
   * primitive doubles so FAISS can read it without per-document parsing.
   */
  @Prop({ type: [Number], required: true })
  vector: number[];

  /** Embedding model id used (so we can detect mismatches if we re-embed). */
  @Prop({ required: true })
  embeddingModel: string;

  @Prop({ required: true })
  dimension: number;

  @Prop({ default: 0 })
  charCount: number;
}

export const AgentKbChunkSchema = SchemaFactory.createForClass(AgentKbChunk);

AgentKbChunkSchema.index({ knowledgeBaseId: 1, ordinal: 1 });
AgentKbChunkSchema.index({ knowledgeBaseId: 1, docId: 1 });
