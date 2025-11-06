import { Schema, model, Document, Types } from 'mongoose';

/**
 * Repository metadata for multi-repo index
 */
export interface RepoMetadata {
    fullName: string;
    owner: string;
    name: string;
    language?: string;
    framework?: string;
    packageManager?: string;
    lastIndexedAt: Date;
    commitSha?: string;
    branch?: string;
}

/**
 * Shared utility reference across repositories
 */
export interface SharedUtilityReference {
    name: string;
    filePath: string;
    repoFullName: string;
    type: 'function' | 'class' | 'module' | 'utility';
    signature?: string;
    usedInRepos: string[]; // Other repos using this utility
    similarityScore?: number; // For duplicate detection
}

/**
 * Cross-repository dependency
 */
export interface CrossRepoDependency {
    fromRepo: string;
    toRepo: string;
    type: 'package' | 'module' | 'shared-code' | 'monorepo';
    dependencyName?: string;
    version?: string;
}

/**
 * Multi-repository index interface
 */
export interface IMultiRepoIndex extends Document {
    _id: Types.ObjectId;
    userId: string;
    repositories: RepoMetadata[];
    sharedUtilities: SharedUtilityReference[];
    crossRepoDependencies: CrossRepoDependency[];
    lastSyncedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const repoMetadataSchema = new Schema<RepoMetadata>({
    fullName: {
        type: String,
        required: true
    },
    owner: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    language: {
        type: String
    },
    framework: {
        type: String
    },
    packageManager: {
        type: String
    },
    lastIndexedAt: {
        type: Date,
        default: Date.now
    },
    commitSha: {
        type: String
    },
    branch: {
        type: String,
        default: 'main'
    }
}, { _id: false });

const sharedUtilitySchema = new Schema<SharedUtilityReference>({
    name: {
        type: String,
        required: true
    },
    filePath: {
        type: String,
        required: true
    },
    repoFullName: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['function', 'class', 'module', 'utility'],
        required: true
    },
    signature: {
        type: String
    },
    usedInRepos: {
        type: [String],
        default: []
    },
    similarityScore: {
        type: Number,
        min: 0,
        max: 1
    }
}, { _id: false });

const crossRepoDependencySchema = new Schema<CrossRepoDependency>({
    fromRepo: {
        type: String,
        required: true
    },
    toRepo: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['package', 'module', 'shared-code', 'monorepo'],
        required: true
    },
    dependencyName: {
        type: String
    },
    version: {
        type: String
    }
}, { _id: false });

const multiRepoIndexSchema = new Schema<IMultiRepoIndex>({
    userId: {
        type: String,
        required: true,
        index: true,
        unique: true
    },
    repositories: {
        type: [repoMetadataSchema],
        default: []
    },
    sharedUtilities: {
        type: [sharedUtilitySchema],
        default: []
    },
    crossRepoDependencies: {
        type: [crossRepoDependencySchema],
        default: []
    },
    lastSyncedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'multi_repo_indexes'
});

// Indexes for performance
multiRepoIndexSchema.index({ userId: 1 });
multiRepoIndexSchema.index({ 'repositories.fullName': 1 });
multiRepoIndexSchema.index({ 'sharedUtilities.name': 1 });
multiRepoIndexSchema.index({ 'sharedUtilities.repoFullName': 1 });
multiRepoIndexSchema.index({ 'crossRepoDependencies.fromRepo': 1 });
multiRepoIndexSchema.index({ 'crossRepoDependencies.toRepo': 1 });
multiRepoIndexSchema.index({ lastSyncedAt: -1 });

export const MultiRepoIndex = model<IMultiRepoIndex>('MultiRepoIndex', multiRepoIndexSchema);

