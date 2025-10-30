import { Schema, model, Document, Types } from 'mongoose';

// Interface for commit data
export interface IGitHubCommit {
    sha: string;
    message: string;
    timestamp: Date;
    author?: string;
}

// Interface for AI suggestions
export interface IAISuggestion {
    description: string;
    type: 'optimization' | 'refactoring' | 'best-practice' | 'cost-reduction';
    priority: 'low' | 'medium' | 'high';
    applied: boolean;
    appliedAt?: Date;
    codeSnippet?: string;
    file?: string;
    line?: number;
}

// Interface for feature configuration
export interface IFeatureConfig {
    name: string;
    enabled: boolean;
    config?: Record<string, any>;
}

// Main GitHub integration interface
export interface IGitHubIntegration extends Document {
    _id: Types.ObjectId;
    userId: string;
    connectionId: Types.ObjectId;
    repositoryId: number;
    repositoryName: string;
    repositoryFullName: string;
    branchName: string; // Feature branch name
    prNumber?: number;
    prUrl?: string;
    prTitle?: string;
    prDescription?: string;
    status: 'initializing' | 'analyzing' | 'generating' | 'draft' | 'open' | 'updating' | 'merged' | 'closed' | 'failed' | 'permission_error';
    integrationType: 'npm' | 'cli' | 'python'; // Package type
    selectedFeatures: IFeatureConfig[];
    conversationId?: Types.ObjectId; // Link to chat conversation
    commits: IGitHubCommit[];
    aiSuggestions: IAISuggestion[];
    analysisResults?: {
        language: string;
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
    };
    errorMessage?: string;
    errorStack?: string;
    lastActivityAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const commitSchema = new Schema<IGitHubCommit>({
    sha: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    author: {
        type: String
    }
}, { _id: false });

const aiSuggestionSchema = new Schema<IAISuggestion>({
    description: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['optimization', 'refactoring', 'best-practice', 'cost-reduction'],
        default: 'optimization'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    applied: {
        type: Boolean,
        default: false
    },
    appliedAt: {
        type: Date
    },
    codeSnippet: {
        type: String
    },
    file: {
        type: String
    },
    line: {
        type: Number
    }
}, { _id: false });

const featureConfigSchema = new Schema<IFeatureConfig>({
    name: {
        type: String,
        required: true
    },
    enabled: {
        type: Boolean,
        default: true
    },
    config: {
        type: Schema.Types.Mixed
    }
}, { _id: false });

const githubIntegrationSchema = new Schema<IGitHubIntegration>({
    userId: {
        type: String,
        required: true,
        index: true
    },
    connectionId: {
        type: Schema.Types.ObjectId,
        ref: 'GitHubConnection',
        required: true
    },
    repositoryId: {
        type: Number,
        required: true
    },
    repositoryName: {
        type: String,
        required: true
    },
    repositoryFullName: {
        type: String,
        required: true
    },
    branchName: {
        type: String,
        required: true
    },
    prNumber: {
        type: Number
    },
    prUrl: {
        type: String
    },
    prTitle: {
        type: String
    },
    prDescription: {
        type: String
    },
    status: {
        type: String,
        enum: ['initializing', 'analyzing', 'generating', 'draft', 'open', 'updating', 'merged', 'closed', 'failed', 'permission_error'],
        default: 'initializing',
        index: true
    },
    integrationType: {
        type: String,
        enum: ['npm', 'cli', 'python'],
        required: true
    },
    selectedFeatures: {
        type: [featureConfigSchema],
        default: []
    },
    conversationId: {
        type: Schema.Types.ObjectId,
        ref: 'Conversation'
    },
    commits: {
        type: [commitSchema],
        default: []
    },
    aiSuggestions: {
        type: [aiSuggestionSchema],
        default: []
    },
    analysisResults: {
        type: {
            language: String,
            framework: String,
            entryPoints: [String],
            existingAIIntegrations: [String],
            projectType: String,
            dependencies: Schema.Types.Mixed,
            detectedPatterns: [String],
            packageManager: String,
            hasTests: Boolean,
            hasCI: Boolean,
            hasDocs: Boolean
        }
    },
    errorMessage: {
        type: String
    },
    errorStack: {
        type: String
    },
    lastActivityAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'github_integrations'
});

// Indexes for performance
githubIntegrationSchema.index({ userId: 1, status: 1 });
githubIntegrationSchema.index({ repositoryId: 1 });
githubIntegrationSchema.index({ conversationId: 1 });
githubIntegrationSchema.index({ createdAt: -1 });
githubIntegrationSchema.index({ userId: 1, createdAt: -1 });

// Update lastActivityAt on save
githubIntegrationSchema.pre('save', function(next) {
    this.lastActivityAt = new Date();
    next();
});

export const GitHubIntegration = model<IGitHubIntegration>('GitHubIntegration', githubIntegrationSchema);



