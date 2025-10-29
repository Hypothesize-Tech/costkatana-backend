import { Schema, model, Document, Types } from 'mongoose';

export interface IChatMessage extends Document {
    _id: Types.ObjectId;
    conversationId: Types.ObjectId;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
    attachedDocuments?: Array<{
        documentId: string;
        fileName: string;
        chunksCount: number;
        fileType?: string;
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
    }
}, {
    timestamps: true,
    collection: 'chatMessages'
});

// Indexes for performance
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });
chatMessageSchema.index({ userId: 1, createdAt: -1 });

export const ChatMessage = model<IChatMessage>('ChatMessage', chatMessageSchema); 