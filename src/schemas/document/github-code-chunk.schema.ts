import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface IGitHubCodeChunk {
  chunkId: string;
  repositoryId: string;
  repoFullName: string;
  filePath: string;
  commitSha: string;
  branch: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  fileType: string;
  embedding: number[];
  contentHash: string;
  status: 'active' | 'deprecated';
  chunkType: 'function' | 'class' | 'method' | 'doc' | 'config' | 'other';
  userId: string;
  organizationId?: string;
  metadata: {
    functionName?: string;
    className?: string;
    methodName?: string;
    signature?: string;
    parameters?: string[];
    returnType?: string;
    docstring?: string;
    imports?: string[];
    exports?: string[];
    complexity?: number;
    dependencies?: string[];
    testCoverage?: number;
    documentation?: string;
  };
  astMetadata?: {
    functionName?: string;
    className?: string;
    methodName?: string;
    signature?: string;
    parameters?: string[];
    returnType?: string;
    docstring?: string;
    imports?: string[];
    exports?: string[];
  };
  semanticTags: string[];
  accessCount: number;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type GitHubCodeChunkDocument = HydratedDocument<GitHubCodeChunk>;

@Schema({ timestamps: true, collection: 'github_code_chunks' })
export class GitHubCodeChunk {
  @Prop({ required: true, unique: true })
  chunkId: string;

  @Prop({ required: true })
  repositoryId: string;

  @Prop({ required: true })
  repoFullName: string;

  @Prop({ required: true })
  filePath: string;

  @Prop({ required: true })
  commitSha: string;

  @Prop({ required: true })
  branch: string;

  @Prop({ required: true })
  startLine: number;

  @Prop({ required: true })
  endLine: number;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true })
  language: string;

  @Prop({ required: true })
  fileType: string;

  @Prop({ required: true, type: [Number] })
  embedding: number[];

  @Prop({ required: true })
  contentHash: string;

  @Prop({ required: true, enum: ['active', 'deprecated'], default: 'active' })
  status: 'active' | 'deprecated';

  @Prop({
    required: true,
    enum: ['function', 'class', 'method', 'doc', 'config', 'other'],
  })
  chunkType: 'function' | 'class' | 'method' | 'doc' | 'config' | 'other';

  @Prop({ required: true })
  userId: string;

  @Prop()
  organizationId?: string;

  @Prop({
    type: {
      functionName: String,
      className: String,
      methodName: String,
      signature: String,
      parameters: [String],
      returnType: String,
      docstring: String,
      imports: [String],
      exports: [String],
      complexity: Number,
      dependencies: [String],
      testCoverage: Number,
      documentation: String,
    },
  })
  metadata: {
    functionName?: string;
    className?: string;
    methodName?: string;
    signature?: string;
    parameters?: string[];
    returnType?: string;
    docstring?: string;
    imports?: string[];
    exports?: string[];
    complexity?: number;
    dependencies?: string[];
    testCoverage?: number;
    documentation?: string;
  };

  @Prop({
    type: {
      functionName: String,
      className: String,
      methodName: String,
      signature: String,
      parameters: [String],
      returnType: String,
      docstring: String,
      imports: [String],
      exports: [String],
    },
  })
  astMetadata?: {
    functionName?: string;
    className?: string;
    methodName?: string;
    signature?: string;
    parameters?: string[];
    returnType?: string;
    docstring?: string;
    imports?: string[];
    exports?: string[];
  };

  @Prop([String])
  semanticTags: string[];

  @Prop({ type: Number, default: 0 })
  accessCount: number;

  @Prop({ type: Date })
  lastAccessedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GitHubCodeChunkSchema =
  SchemaFactory.createForClass(GitHubCodeChunk);

// Indexes for performance
GitHubCodeChunkSchema.index({ repositoryId: 1, filePath: 1 });
GitHubCodeChunkSchema.index({ repoFullName: 1, filePath: 1, commitSha: 1 }); // For version control lookups
GitHubCodeChunkSchema.index({ language: 1 });
GitHubCodeChunkSchema.index({ fileType: 1 });
GitHubCodeChunkSchema.index({ userId: 1 });
GitHubCodeChunkSchema.index({ status: 1 });
GitHubCodeChunkSchema.index({ chunkType: 1 });
GitHubCodeChunkSchema.index({ semanticTags: 1 });
GitHubCodeChunkSchema.index({ contentHash: 1 }); // For deduplication
GitHubCodeChunkSchema.index({ lastAccessedAt: 1 }); // For cleanup operations

// Methods
GitHubCodeChunkSchema.methods.markAccessed = function () {
  this.accessCount += 1;
  this.lastAccessedAt = new Date();
  return this.save();
};

GitHubCodeChunkSchema.methods.deprecate = function () {
  this.status = 'deprecated';
  return this.save();
};

// Static methods
GitHubCodeChunkSchema.statics.findActiveChunks = function (
  repoFullName: string,
  commitSha?: string,
) {
  const query: any = { repoFullName, status: 'active' };
  if (commitSha) {
    query.commitSha = commitSha;
  }
  return this.find(query);
};

GitHubCodeChunkSchema.statics.findBySymbol = function (
  symbolName: string,
  repoFullName?: string,
) {
  const query: any = {
    status: 'active',
    $or: [
      { 'metadata.functionName': symbolName },
      { 'metadata.className': symbolName },
      { 'metadata.methodName': symbolName },
      { semanticTags: symbolName },
    ],
  };
  if (repoFullName) {
    query.repoFullName = repoFullName;
  }
  return this.find(query);
};
