import mongoose, { Document, Schema } from 'mongoose';

export interface IDocument extends Document {
    // Content fields
    content: string;
    contentHash: string; // For deduplication
    
    // Embedding
    embedding: number[]; // 1536-dim array for Titan Embed v2
    
    // Metadata
    metadata: {
        source: 'knowledge-base' | 'conversation' | 'telemetry' | 'user-upload' | 'activity';
        sourceType: string; // file type: md, pdf, txt, json, etc.
        userId?: string; // For user-scoped documents
        projectId?: string; // Associated project
        conversationId?: string; // Associated conversation
        documentId?: string; // Unique document identifier for grouping chunks
        fileName?: string; // Original file name
        filePath?: string; // Original file path (local)
        fileSize?: number; // File size in bytes
        fileType?: string; // File extension or MIME type
        s3Key?: string; // S3 object key
        s3Url?: string; // S3 URL (s3://bucket/key)
        tags?: string[]; // Custom tags
        language?: string; // Programming language for code files
        customMetadata?: Record<string, any>; // Flexible additional metadata
    };
    
    // Chunking info
    chunkIndex: number; // Position in the original document
    totalChunks: number; // Total number of chunks from source
    parentDocumentId?: mongoose.Types.ObjectId; // Reference to parent if this is a chunk
    
    // Timestamps
    lastAccessedAt?: Date;
    ingestedAt: Date;
    
    // Status
    status: 'active' | 'archived' | 'deleted';
    
    // Usage tracking
    accessCount: number;
    
    createdAt: Date;
    updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>({
    content: {
        type: String,
        required: true,
        index: 'text' // Text index for keyword search
    },
    contentHash: {
        type: String,
        required: true,
        index: true // For deduplication
    },
    embedding: {
        type: [Number],
        required: true,
        // Note: Vector search index must be created in MongoDB Atlas
        validate: {
            validator: function(v: number[]) {
                // Titan Embed v2 uses 1024 dimensions (default)
                // Titan Embed v1 uses 1536 dimensions
                // OpenAI uses 1536 dimensions
                return v.length === 1024 || v.length === 1536 || v.length === 256;
            },
            message: 'Embedding must be 256, 1024, or 1536 dimensions'
        }
    },
    metadata: {
        source: {
            type: String,
            enum: ['knowledge-base', 'conversation', 'telemetry', 'user-upload', 'activity'],
            required: true,
            index: true
        },
        sourceType: {
            type: String,
            required: true,
            index: true
        },
        userId: {
            type: String,
            index: true // Critical for user isolation
        },
        projectId: {
            type: String,
            index: true
        },
        conversationId: {
            type: String,
            index: true
        },
        documentId: {
            type: String,
            index: true // For grouping chunks by document
        },
        fileName: String,
        filePath: String,
        fileSize: Number,
        fileType: String, // File extension or MIME type
        s3Key: {
            type: String,
            index: true // For S3 document retrieval
        },
        s3Url: String,
        tags: {
            type: [String],
            index: true
        },
        language: String,
        customMetadata: Schema.Types.Mixed
    },
    chunkIndex: {
        type: Number,
        required: true,
        default: 0,
        index: true
    },
    totalChunks: {
        type: Number,
        required: true,
        default: 1
    },
    parentDocumentId: {
        type: Schema.Types.ObjectId,
        ref: 'Document',
        index: true
    },
    lastAccessedAt: {
        type: Date,
        index: true
    },
    ingestedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    status: {
        type: String,
        enum: ['active', 'archived', 'deleted'],
        default: 'active',
        index: true
    },
    accessCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    collection: 'documents'
});

// Compound indexes for common queries
DocumentSchema.index({ 'metadata.userId': 1, 'metadata.source': 1, createdAt: -1 });
DocumentSchema.index({ 'metadata.userId': 1, status: 1, createdAt: -1 });
DocumentSchema.index({ contentHash: 1, 'metadata.userId': 1 }, { unique: true }); // Prevent duplicate content per user
DocumentSchema.index({ parentDocumentId: 1, chunkIndex: 1 });
DocumentSchema.index({ status: 1, lastAccessedAt: -1 }); // For cleanup jobs

// TTL index - archive old inactive documents (optional, configurable)
// DocumentSchema.index({ lastAccessedAt: 1 }, { 
//     expireAfterSeconds: 90 * 24 * 60 * 60, // 90 days
//     partialFilterExpression: { status: 'active', 'metadata.source': 'user-upload' }
// });

// Virtual for getting all chunks of a document
DocumentSchema.virtual('chunks', {
    ref: 'Document',
    localField: '_id',
    foreignField: 'parentDocumentId'
});

// Method to update last accessed timestamp
DocumentSchema.methods.markAccessed = async function() {
    this.lastAccessedAt = new Date();
    this.accessCount += 1;
    await this.save();
};

// Static method to find documents with user isolation
DocumentSchema.statics.findByUser = function(userId: string, filters: any = {}) {
    return this.find({
        'metadata.userId': userId,
        status: 'active',
        ...filters
    });
};

// Static method to find public knowledge base documents
DocumentSchema.statics.findKnowledgeBase = function(filters: any = {}) {
    return this.find({
        'metadata.source': 'knowledge-base',
        status: 'active',
        ...filters
    });
};

export const DocumentModel = mongoose.model<IDocument>('Document', DocumentSchema);

