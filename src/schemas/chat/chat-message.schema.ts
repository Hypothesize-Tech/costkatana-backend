import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IAttachedDocument {
  documentId: string;
  fileName: string;
  chunksCount: number;
  fileType?: string;
}

export interface IAttachment {
  type: 'uploaded' | 'google';
  fileId: string;
  googleFileId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType: string;
  url: string;
  webViewLink?: string;
  createdTime?: string;
}

export interface IMessageMetadata {
  temperature?: number;
  maxTokens?: number;
  cost?: number;
  latency?: number;
  tokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface IMessageThinking {
  content: string;
  mode?: 'adaptive' | 'enabled';
  effort?: 'low' | 'medium' | 'high' | 'max';
  budgetTokens?: number;
  durationMs?: number;
}

export interface IToolCallSource {
  title: string;
  url: string;
  description?: string;
}

export interface IMessageCitation {
  /** Stable citation id "cit_<n>" assigned by the gateway. */
  id: string;
  /** Which assistant text block this citation belongs to. */
  textBlockIndex: number;
  /** Char offsets of the citing span inside that text block. */
  startOffset: number;
  endOffset: number;
  /** The exact text Claude copied from the source document. */
  citedText: string;
  document: {
    index: number;
    documentId?: string;
    title: string;
    url?: string;
    sourceType: 'attachment' | 'upload' | 'rag';
  };
  /** Where in the source the cited span lives (page / char / chunk). */
  location: {
    type: 'page' | 'char' | 'chunk';
    start: number;
    end: number;
  };
}

export interface IToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: {
    content: string;
    sources?: IToolCallSource[];
  };
  status?: 'success' | 'error';
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
}

export interface IFormattedResult {
  type: 'table' | 'json' | 'list' | 'text';
  data: any;
}

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

@Schema({ timestamps: true, collection: 'chatMessages' })
export class ChatMessage {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  })
  conversationId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  })
  role: 'user' | 'assistant';

  @Prop({ required: true, maxlength: 50000 })
  content: string;

  @Prop()
  modelId?: string;

  @Prop({
    type: String,
    enum: ['user', 'assistant', 'system', 'governed_plan'],
    default: 'user',
  })
  messageType?: 'user' | 'assistant' | 'system' | 'governed_plan';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'GovernedTask' })
  governedTaskId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['SCOPE', 'CLARIFY', 'PLAN', 'BUILD', 'VERIFY', 'DONE'],
  })
  planState?: 'SCOPE' | 'CLARIFY' | 'PLAN' | 'BUILD' | 'VERIFY' | 'DONE';

  @Prop({
    type: [
      {
        documentId: { type: String, required: true },
        fileName: { type: String, required: true },
        chunksCount: { type: Number, required: true },
        fileType: String,
      },
    ],
    _id: false,
  })
  attachedDocuments?: IAttachedDocument[];

  @Prop({
    type: [
      {
        type: { type: String, enum: ['uploaded', 'google'], required: true },
        fileId: { type: String, required: true },
        googleFileId: String,
        fileName: { type: String, required: true },
        fileSize: { type: Number, required: true },
        mimeType: { type: String, required: true },
        fileType: { type: String, required: true },
        url: { type: String, required: true },
        webViewLink: String,
        createdTime: String,
      },
    ],
    _id: false,
  })
  attachments?: IAttachment[];

  @Prop({
    type: {
      temperature: { type: Number, min: 0, max: 2 },
      maxTokens: { type: Number, min: 1 },
      cost: { type: Number, min: 0 },
      latency: { type: Number, min: 0 },
      tokenCount: { type: Number, min: 0 },
      inputTokens: { type: Number, min: 0 },
      outputTokens: { type: Number, min: 0 },
    },
    _id: false,
  })
  metadata?: IMessageMetadata;

  @Prop({
    type: {
      content: { type: String, maxlength: 200000 },
      mode: { type: String, enum: ['adaptive', 'enabled'] },
      effort: { type: String, enum: ['low', 'medium', 'high', 'max'] },
      budgetTokens: { type: Number, min: 0 },
      durationMs: { type: Number, min: 0 },
    },
    _id: false,
  })
  thinking?: IMessageThinking;

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        input: mongoose.Schema.Types.Mixed,
        output: {
          content: String,
          sources: [
            {
              title: String,
              url: String,
              description: String,
              _id: false,
            },
          ],
        },
        status: { type: String, enum: ['success', 'error'] },
        startedAt: Date,
        finishedAt: Date,
        durationMs: { type: Number, min: 0 },
        _id: false,
      },
    ],
  })
  toolCalls?: IToolCall[];

  @Prop({
    type: [
      {
        title: { type: String, required: true },
        url: { type: String, required: true },
        description: String,
        _id: false,
      },
    ],
  })
  sources?: IToolCallSource[];

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        textBlockIndex: { type: Number, required: true, min: 0 },
        startOffset: { type: Number, required: true, min: 0 },
        endOffset: { type: Number, required: true, min: 0 },
        citedText: { type: String, required: true },
        document: {
          index: { type: Number, required: true, min: 0 },
          documentId: String,
          title: { type: String, required: true },
          url: String,
          sourceType: {
            type: String,
            enum: ['attachment', 'upload', 'rag'],
            required: true,
          },
        },
        location: {
          type: {
            type: String,
            enum: ['page', 'char', 'chunk'],
            required: true,
          },
          start: { type: Number, required: true },
          end: { type: Number, required: true },
        },
        _id: false,
      },
    ],
  })
  citations?: IMessageCitation[];

  @Prop({
    type: String,
    enum: [
      'table',
      'json',
      'schema',
      'stats',
      'chart',
      'text',
      'error',
      'empty',
      'explain',
    ],
  })
  mongodbSelectedViewType?:
    | 'table'
    | 'json'
    | 'schema'
    | 'stats'
    | 'chart'
    | 'text'
    | 'error'
    | 'empty'
    | 'explain';

  @Prop({ type: mongoose.Schema.Types.Mixed })
  integrationSelectorData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  mongodbIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  mongodbResultData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  githubIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  vercelIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  slackIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  discordIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  jiraIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  linearIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  googleIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  awsIntegrationData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  requiresConnection?: any;

  @Prop()
  requiresSelection?: boolean;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  selection?: any;

  @Prop({
    type: { type: String, enum: ['table', 'json', 'list', 'text'] },
    data: mongoose.Schema.Types.Mixed,
    _id: false,
  })
  formattedResult?: IFormattedResult;

  @Prop([String])
  agentPath?: string[];

  @Prop([String])
  optimizationsApplied?: string[];

  @Prop()
  cacheHit?: boolean;

  @Prop()
  riskLevel?: string;

  @Prop({
    type: String,
    enum: ['positive', 'negative', 'neutral'],
  })
  feedback?: 'positive' | 'negative' | 'neutral';

  @Prop({ type: String, maxlength: 500 })
  feedbackReason?: string;

  @Prop([Number])
  semanticEmbedding?: number[]; // 1024 dimensions for selected high-value messages

  @Prop({ type: Number, min: 0, max: 1 })
  learningValue?: number; // AI-calculated importance score (0-1)

  @Prop({ type: Boolean, default: false })
  isVectorized?: boolean; // Flag to track vectorization status

  @Prop({ type: Date })
  deletedAt?: Date; // Soft delete timestamp

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

// Indexes for performance
ChatMessageSchema.index({ conversationId: 1, createdAt: 1 });
ChatMessageSchema.index({ userId: 1, createdAt: -1 });
