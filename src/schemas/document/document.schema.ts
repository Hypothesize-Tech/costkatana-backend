import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IDocumentMetadata {
  // Existing fields
  source:
    | 'knowledge-base'
    | 'conversation'
    | 'telemetry'
    | 'user-upload'
    | 'activity';
  sourceType: string;
  userId?: string;
  projectId?: string;
  conversationId?: string;
  documentId?: string;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  fileType?: string;
  s3Key?: string;
  s3Url?: string;
  tags?: string[];
  language?: string;
  customMetadata?: Record<string, any>;

  // Semantic metadata fields for enhanced RAG retrieval
  domain?:
    | 'ai-optimization'
    | 'cost-tracking'
    | 'api-usage'
    | 'documentation'
    | 'general';
  topic?: string;
  topics?: string[];
  contentType?:
    | 'code'
    | 'explanation'
    | 'example'
    | 'configuration'
    | 'troubleshooting'
    | 'tutorial';

  // Quality and importance indicators
  importance?: 'low' | 'medium' | 'high' | 'critical';
  qualityScore?: number;

  // Technical level
  technicalLevel?: 'beginner' | 'intermediate' | 'advanced';

  // Semantic tags (auto-generated)
  semanticTags?: string[];

  // Relationship metadata
  relatedDocumentIds?: string[];
  prerequisites?: string[];

  // Freshness tracking
  version?: string;
  lastVerified?: Date;
  deprecationDate?: Date;

  // Hierarchical structure
  sectionTitle?: string;
  sectionLevel?: number;
  sectionPath?: string[];

  // Context preservation
  precedingContext?: string;
  followingContext?: string;

  // Content indicators
  containsCode?: boolean;
  containsEquations?: boolean;
  containsLinks?: string[];
  containsImages?: boolean;
}

export interface IDocumentMethods {
  markAccessed(): Promise<void>;
}

/** Document shape for inserts and type-safe access (Mongoose lean result can be single or array) */
export interface IDocument {
  _id?: string;
  content: string;
  contentHash: string;
  embedding: number[];
  metadata: IDocumentMetadata;
  chunkIndex: number;
  totalChunks: number;
  parentDocumentId?: MongooseSchema.Types.ObjectId;
  lastAccessedAt?: Date;
  ingestedAt: Date;
  status: 'active' | 'archived' | 'deleted';
  accessCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DocumentDocument = HydratedDocument<Document> & IDocumentMethods;

@Schema({ timestamps: true, collection: 'documents' })
export class Document implements IDocumentMethods {
  @Prop({ required: true, index: 'text' })
  content: string;

  @Prop({ required: true, index: true })
  contentHash: string;

  @Prop({ required: true, type: [Number] })
  embedding: number[];

  @Prop({
    type: {
      source: {
        type: String,
        enum: [
          'knowledge-base',
          'conversation',
          'telemetry',
          'user-upload',
          'activity',
        ],
        required: true,
        index: true,
      },
      sourceType: { type: String, required: true, index: true },
      userId: { type: String, index: true },
      projectId: { type: String, index: true },
      conversationId: { type: String, index: true },
      documentId: { type: String, index: true },
      fileName: String,
      filePath: String,
      fileSize: Number,
      fileType: String,
      s3Key: { type: String, index: true },
      s3Url: String,
      tags: { type: [String], index: true },
      language: String,
      customMetadata: mongoose.Schema.Types.Mixed,
      domain: {
        type: String,
        enum: [
          'ai-optimization',
          'cost-tracking',
          'api-usage',
          'documentation',
          'general',
        ],
        index: true,
      },
      topic: { type: String, index: true },
      topics: { type: [String], index: true },
      contentType: {
        type: String,
        enum: [
          'code',
          'explanation',
          'example',
          'configuration',
          'troubleshooting',
          'tutorial',
        ],
        index: true,
      },
      importance: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        index: true,
      },
      qualityScore: { type: Number, min: 0, max: 1, index: true },
      technicalLevel: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        index: true,
      },
      semanticTags: { type: [String], index: true },
      relatedDocumentIds: [String],
      prerequisites: [String],
      version: String,
      lastVerified: { type: Date, index: true },
      deprecationDate: { type: Date, index: true },
      sectionTitle: String,
      sectionLevel: Number,
      sectionPath: [String],
      precedingContext: String,
      followingContext: String,
      containsCode: Boolean,
      containsEquations: Boolean,
      containsLinks: [String],
      containsImages: Boolean,
    },
  })
  metadata: IDocumentMetadata;

  @Prop({ required: true, default: 0, index: true })
  chunkIndex: number;

  @Prop({ required: true, default: 1 })
  totalChunks: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Document', index: true })
  parentDocumentId?: MongooseSchema.Types.ObjectId;

  @Prop({ index: true })
  lastAccessedAt?: Date;

  @Prop({ required: true, default: Date.now, index: true })
  ingestedAt: Date;

  @Prop({
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active',
    index: true,
  })
  status: 'active' | 'archived' | 'deleted';

  @Prop({ default: 0 })
  accessCount: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  async markAccessed(): Promise<void> {
    this.lastAccessedAt = new Date();
    this.accessCount += 1;
    await (this as any).save();
  }
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

// Compound indexes for common queries
DocumentSchema.index({
  'metadata.userId': 1,
  'metadata.source': 1,
  createdAt: -1,
});
DocumentSchema.index({ 'metadata.userId': 1, status: 1, createdAt: -1 });
DocumentSchema.index(
  { contentHash: 1, 'metadata.userId': 1, 'metadata.documentId': 1 },
  { unique: true },
);
DocumentSchema.index({ parentDocumentId: 1, chunkIndex: 1 });
DocumentSchema.index({ status: 1, lastAccessedAt: -1 });

// Compound indexes for semantic metadata fields
DocumentSchema.index({ 'metadata.domain': 1, 'metadata.topic': 1 });
DocumentSchema.index({
  'metadata.contentType': 1,
  'metadata.technicalLevel': 1,
});
DocumentSchema.index({ 'metadata.importance': 1, 'metadata.qualityScore': -1 });
DocumentSchema.index({ 'metadata.lastVerified': -1, status: 1 });
DocumentSchema.index({ 'metadata.topics': 1, 'metadata.domain': 1 });
DocumentSchema.index({ 'metadata.semanticTags': 1, status: 1 });

// Virtual for getting all chunks of a document
DocumentSchema.virtual('chunks', {
  ref: 'Document',
  localField: '_id',
  foreignField: 'parentDocumentId',
});

// Instance methods
DocumentSchema.methods.markAccessed = async function (): Promise<void> {
  this.lastAccessedAt = new Date();
  this.accessCount += 1;
  await this.save();
};

// Static methods
DocumentSchema.statics.findByUser = function (
  userId: string,
  filters: any = {},
) {
  return this.find({
    'metadata.userId': userId,
    status: 'active',
    ...filters,
  });
};

DocumentSchema.statics.findKnowledgeBase = function (filters: any = {}) {
  return this.find({
    'metadata.source': 'knowledge-base',
    status: 'active',
    ...filters,
  });
};
