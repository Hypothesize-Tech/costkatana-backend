import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IFeatureConfig {
  name: string;
  config?: Record<string, any>;
}

export interface ICommit {
  sha: string;
  message: string;
  timestamp: Date;
}

export interface IAnalysisResult {
  language: string;
  languageConfidence: number;
  isTypeScriptPrimary?: boolean;
  framework?: string;
  entryPoints: string[];
  existingAIIntegrations: string[];
  projectType?: string;
  dependencies?: Record<string, string>;
  detectedPatterns?: string[];
  packageManager?: string;
  hasTests?: boolean;
  hasCI?: boolean;
  hasDocs?: boolean;
}

export type GitHubIntegrationDocument = HydratedDocument<GitHubIntegration>;

@Schema({ timestamps: true, collection: 'github_integrations' })
export class GitHubIntegration {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'GitHubConnection',
    required: true,
  })
  connectionId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  repositoryId: number;

  @Prop({ required: true })
  repositoryName: string;

  @Prop({ required: true })
  repositoryFullName: string;

  @Prop({ required: true })
  branchName: string;

  @Prop({
    type: String,
    enum: [
      'initializing',
      'analyzing',
      'generating',
      'draft',
      'open',
      'updating',
      'merged',
      'closed',
      'failed',
      'permission_error',
    ],
    default: 'initializing',
  })
  status: string;

  @Prop({
    type: String,
    enum: ['npm', 'cli', 'python', 'http-headers'],
    required: true,
  })
  integrationType: 'npm' | 'cli' | 'python' | 'http-headers';

  @Prop([
    {
      name: { type: String, required: true },
      config: { type: MongooseSchema.Types.Mixed },
    },
  ])
  selectedFeatures: IFeatureConfig[];

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Conversation',
  })
  conversationId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed })
  analysisResults?: IAnalysisResult;

  @Prop([
    {
      sha: { type: String, required: true },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ])
  commits: ICommit[];

  @Prop()
  prNumber?: number;

  @Prop()
  prUrl?: string;

  @Prop()
  prTitle?: string;

  @Prop()
  prDescription?: string;

  @Prop()
  errorMessage?: string;

  @Prop()
  errorStack?: string;

  @Prop()
  lastActivityAt?: Date;

  @Prop([MongooseSchema.Types.Mixed])
  aiSuggestions?: any[];

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GitHubIntegrationSchema =
  SchemaFactory.createForClass(GitHubIntegration);

// Indexes for performance
GitHubIntegrationSchema.index({ userId: 1, createdAt: -1 });
GitHubIntegrationSchema.index({ connectionId: 1 });
GitHubIntegrationSchema.index({ repositoryFullName: 1 });
GitHubIntegrationSchema.index({ status: 1 });
GitHubIntegrationSchema.index({ prNumber: 1 }, { sparse: true });
GitHubIntegrationSchema.index({ lastActivityAt: 1 });
