import { Schema, model, Document, Types } from 'mongoose';

export interface IChatMessage extends Document {
    _id: Types.ObjectId;
    conversationId: Types.ObjectId;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
    messageType?: 'user' | 'assistant' | 'system' | 'governed_plan';
    governedTaskId?: Types.ObjectId;
    planState?: 'SCOPE' | 'CLARIFY' | 'PLAN' | 'BUILD' | 'VERIFY' | 'DONE';
    attachedDocuments?: Array<{
        documentId: string;
        fileName: string;
        chunksCount: number;
        fileType?: string;
    }>;
    attachments?: Array<{
        type: 'uploaded' | 'google';
        fileId: string;
        googleFileId?: string; // For Google Drive files
        fileName: string;
        fileSize: number;
        mimeType: string;
        fileType: string;
        url: string;
        webViewLink?: string; // For Google Drive files
        createdTime?: string; // For Google Drive files
    }>;
    metadata?: {
        temperature?: number;
        maxTokens?: number;
        cost?: number;
        latency?: number;
        tokenCount?: number;
        inputTokens?: number;
    outputTokens?: number;
};
mongodbSelectedViewType?: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'text' | 'error' | 'empty' | 'explain';
    integrationSelectorData?: any; // To store the full IntegrationSelector data
    mongodbIntegrationData?: any; // To store structured MongoDB operation details (action, collection, etc.)
    mongodbResultData?: any; // To store the actual MongoDB query result data (formattedResult.data)
    createdAt: Date;
    updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
    conversationId: {
        type: Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true,
        maxlength: 50000 // Allow for long AI responses
    },
    modelId: {
        type: String
    },
    messageType: {
        type: String,
        enum: ['user', 'assistant', 'system', 'governed_plan'],
        default: 'user'
    },
    governedTaskId: {
        type: Schema.Types.ObjectId,
        ref: 'GovernedTask',
        required: false
    },
    planState: {
        type: String,
        enum: ['SCOPE', 'CLARIFY', 'PLAN', 'BUILD', 'VERIFY', 'DONE'],
        required: false
    },
    attachedDocuments: [{
        documentId: {
            type: String,
            required: true
        },
        fileName: {
            type: String,
            required: true
        },
        chunksCount: {
            type: Number,
            required: true
        },
        fileType: String
    }],
    attachments: [{
        type: {
            type: String,
            enum: ['uploaded', 'google'],
            required: true
        },
        fileId: {
            type: String,
            required: true
        },
        googleFileId: String,
        fileName: {
            type: String,
            required: true
        },
        fileSize: {
            type: Number,
            required: true
        },
        mimeType: {
            type: String,
            required: true
        },
        fileType: {
            type: String,
            required: true
        },
        url: {
            type: String,
            required: true
        },
        webViewLink: String,
        createdTime: String
    }],
    metadata: {
        temperature: {
            type: Number,
            min: 0,
            max: 2
        },
        maxTokens: {
            type: Number,
            min: 1
        },
        cost: {
            type: Number,
            min: 0
        },
        latency: {
            type: Number,
            min: 0
        },
        tokenCount: {
            type: Number,
            min: 0
        },
        inputTokens: {
            type: Number,
            min: 0
        },
        outputTokens: {
            type: Number,
            min: 0
        }
    },
    mongodbSelectedViewType: {
        type: String,
        enum: ['table', 'json', 'schema', 'stats', 'chart', 'text', 'error', 'empty', 'explain']
    },
    integrationSelectorData: {
        type: Schema.Types.Mixed // Use Mixed type to store any object
    },
    mongodbIntegrationData: {
        type: Schema.Types.Mixed // Use Mixed type to store structured MongoDB operation details
    },
    mongodbResultData: {
        type: Schema.Types.Mixed // Use Mixed type to store the actual MongoDB query result data
    }
}, {
    timestamps: true,
    collection: 'chatMessages'
});

// Indexes for performance
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });
chatMessageSchema.index({ userId: 1, createdAt: -1 });

export const ChatMessage = model<IChatMessage>('ChatMessage', chatMessageSchema); 