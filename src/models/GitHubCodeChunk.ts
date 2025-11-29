import mongoose, { Document, Schema } from 'mongoose';

export interface IGitHubCodeChunk extends Document {
    // Content
    content: string;
    contentHash: string; // For deduplication
    
    // Embedding
    embedding: number[]; // Vector embedding
    
    // Repository & File Information
    repoFullName: string; // e.g., "owner/repo"
    filePath: string; // Relative path from repo root
    startLine: number; // Starting line number (1-indexed)
    endLine: number; // Ending line number (1-indexed)
    commitSha: string; // Git commit SHA
    branch: string; // Branch name (e.g., "main", "master")
    
    // Chunk Type & AST Metadata
    chunkType: 'function' | 'class' | 'method' | 'doc' | 'config' | 'other';
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
    
    // Language & File Info
    language: string; // Programming language (typescript, python, etc.)
    fileType: string; // File extension
    
    // User & Access Control
    userId: string; // Owner of the repository
    organizationId?: string; // Organization ID if applicable
    
    // Status & Timestamps
    status: 'active' | 'deprecated' | 'deleted';
    indexedAt: Date;
    lastAccessedAt?: Date;
    deprecatedAt?: Date; // When this chunk was superseded
    
    // Usage tracking
    accessCount: number;
    
    createdAt: Date;
    updatedAt: Date;
}

const GitHubCodeChunkSchema = new Schema<IGitHubCodeChunk>({
    content: {
        type: String,
        required: true,
        index: 'text' // Text index for keyword search
    },
    contentHash: {
        type: String,
        required: true,
        index: true
    },
    embedding: {
        type: [Number],
        required: true,
        validate: {
            validator: function(v: number[]) {
                return v.length === 1024 || v.length === 1536 || v.length === 256;
            },
            message: 'Embedding must be 256, 1024, or 1536 dimensions'
        }
    },
    repoFullName: {
        type: String,
        required: true,
        index: true
    },
    filePath: {
        type: String,
        required: true,
        index: true
    },
    startLine: {
        type: Number,
        required: true,
        min: 1
    },
    endLine: {
        type: Number,
        required: true,
        min: 1
    },
    commitSha: {
        type: String,
        required: true,
        index: true
    },
    branch: {
        type: String,
        required: true,
        default: 'main',
        index: true
    },
    chunkType: {
        type: String,
        enum: ['function', 'class', 'method', 'doc', 'config', 'other'],
        required: true,
        index: true
    },
    astMetadata: {
        functionName: String,
        className: String,
        methodName: String,
        signature: String,
        parameters: [String],
        returnType: String,
        docstring: String,
        imports: [String],
        exports: [String]
    },
    language: {
        type: String,
        required: true,
        index: true
    },
    fileType: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    organizationId: {
        type: String,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'deprecated', 'deleted'],
        default: 'active',
        index: true
    },
    indexedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    lastAccessedAt: {
        type: Date,
        index: true
    },
    deprecatedAt: {
        type: Date
    },
    accessCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    collection: 'github_code_chunks'
});

// Compound indexes for common queries
GitHubCodeChunkSchema.index({ repoFullName: 1, filePath: 1, status: 1 });
GitHubCodeChunkSchema.index({ repoFullName: 1, commitSha: 1, status: 1 });
GitHubCodeChunkSchema.index({ repoFullName: 1, chunkType: 1, status: 1 });
GitHubCodeChunkSchema.index({ userId: 1, repoFullName: 1, status: 1 });
GitHubCodeChunkSchema.index({ contentHash: 1, repoFullName: 1 }, { unique: true });
GitHubCodeChunkSchema.index({ 'astMetadata.functionName': 1, repoFullName: 1 });
GitHubCodeChunkSchema.index({ 'astMetadata.className': 1, repoFullName: 1 });
GitHubCodeChunkSchema.index({ language: 1, status: 1 });
GitHubCodeChunkSchema.index({ indexedAt: -1 });

// Method to mark as accessed
GitHubCodeChunkSchema.methods.markAccessed = async function(this: IGitHubCodeChunk) {
    this.lastAccessedAt = new Date();
    this.accessCount += 1;
    await this.save();
};

// Method to deprecate chunk (when superseded by new version)
GitHubCodeChunkSchema.methods.deprecate = async function(this: IGitHubCodeChunk) {
    this.status = 'deprecated';
    this.deprecatedAt = new Date();
    await this.save();
};

// Define static methods interface extending mongoose Model
interface GitHubCodeChunkModelStatic extends mongoose.Model<IGitHubCodeChunk> {
    findActiveChunks(repoFullName: string, filters?: Record<string, unknown>): mongoose.Query<IGitHubCodeChunk[], IGitHubCodeChunk>;
    findBySymbol(repoFullName: string, symbolName: string, symbolType?: 'function' | 'class'): mongoose.Query<IGitHubCodeChunk[], IGitHubCodeChunk>;
}

// Static method to find active chunks for a repository
(GitHubCodeChunkSchema.statics as unknown as GitHubCodeChunkModelStatic).findActiveChunks = function(
    repoFullName: string,
    filters: Record<string, unknown> = {}
) {
    return this.find({
        repoFullName,
        status: 'active',
        ...filters
    } as mongoose.FilterQuery<IGitHubCodeChunk>);
};

// Static method to find chunks by function/class name
(GitHubCodeChunkSchema.statics as unknown as GitHubCodeChunkModelStatic).findBySymbol = function(
    repoFullName: string,
    symbolName: string,
    symbolType: 'function' | 'class' = 'function'
) {
    const query: mongoose.FilterQuery<IGitHubCodeChunk> = {
        repoFullName,
        status: 'active'
    };
    
    if (symbolType === 'function') {
        query['astMetadata.functionName'] = symbolName;
    } else if (symbolType === 'class') {
        query['astMetadata.className'] = symbolName;
    }
    
    return this.find(query);
};

export const GitHubCodeChunkModel = mongoose.model<IGitHubCodeChunk>(
    'GitHubCodeChunk',
    GitHubCodeChunkSchema
);

