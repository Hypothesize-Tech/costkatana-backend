import mongoose, { Document, Schema } from 'mongoose';

export interface ISymbolIndex extends Document {
    // Symbol information
    symbolName: string;
    symbolType: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type' | 'import';
    
    // Location information
    repoFullName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    commitSha: string;
    branch: string;
    
    // Symbol metadata
    signature?: string;
    parameters?: string[];
    returnType?: string;
    visibility?: 'public' | 'private' | 'protected';
    isExported?: boolean;
    
    // Language & context
    language: string;
    fileType: string;
    
    // User & access
    userId: string;
    organizationId?: string;
    
    // Reference to code chunk
    chunkId: mongoose.Types.ObjectId;
    
    // Status
    status: 'active' | 'deprecated' | 'deleted';
    indexedAt: Date;
    lastAccessedAt?: Date;
    
    createdAt: Date;
    updatedAt: Date;
}

const SymbolIndexSchema = new Schema<ISymbolIndex>({
    symbolName: {
        type: String,
        required: true,
        index: true
    },
    symbolType: {
        type: String,
        enum: ['function', 'class', 'method', 'variable', 'interface', 'type', 'import'],
        required: true,
        index: true
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
    signature: String,
    parameters: [String],
    returnType: String,
    visibility: {
        type: String,
        enum: ['public', 'private', 'protected']
    },
    isExported: {
        type: Boolean,
        default: false,
        index: true
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
    chunkId: {
        type: Schema.Types.ObjectId,
        ref: 'GitHubCodeChunk',
        required: true,
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
    }
}, {
    timestamps: true,
    collection: 'symbol_index'
});

// Compound indexes for common queries
SymbolIndexSchema.index({ symbolName: 1, symbolType: 1, repoFullName: 1, status: 1 });
SymbolIndexSchema.index({ repoFullName: 1, filePath: 1, status: 1 });
SymbolIndexSchema.index({ userId: 1, repoFullName: 1, status: 1 });
SymbolIndexSchema.index({ language: 1, symbolType: 1, status: 1 });
SymbolIndexSchema.index({ chunkId: 1 });
SymbolIndexSchema.index({ commitSha: 1, status: 1 });

// Method to mark as accessed
SymbolIndexSchema.methods.markAccessed = async function(this: ISymbolIndex) {
    this.lastAccessedAt = new Date();
    await this.save();
};

// Define static methods interface
interface SymbolIndexModelStatic extends mongoose.Model<ISymbolIndex> {
    findBySymbolName(symbolName: string, repoFullName?: string, symbolType?: string): mongoose.Query<ISymbolIndex[], ISymbolIndex>;
    findByFilePath(repoFullName: string, filePath: string): mongoose.Query<ISymbolIndex[], ISymbolIndex>;
}

// Static method to find symbols by name
(SymbolIndexSchema.statics as unknown as SymbolIndexModelStatic).findBySymbolName = function(
    symbolName: string,
    repoFullName?: string,
    symbolType?: string
) {
    const query: mongoose.FilterQuery<ISymbolIndex> = {
        symbolName,
        status: 'active'
    };

    if (repoFullName) {
        query.repoFullName = repoFullName;
    }

    if (symbolType) {
        query.symbolType = symbolType;
    }

    return this.find(query);
};

// Static method to find all symbols in a file
(SymbolIndexSchema.statics as unknown as SymbolIndexModelStatic).findByFilePath = function(
    repoFullName: string,
    filePath: string
) {
    return this.find({
        repoFullName,
        filePath,
        status: 'active'
    } as mongoose.FilterQuery<ISymbolIndex>);
};

export const SymbolIndexModel = mongoose.model<ISymbolIndex>('SymbolIndex', SymbolIndexSchema);

