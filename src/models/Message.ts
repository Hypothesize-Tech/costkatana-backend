import mongoose, { Document, Schema } from 'mongoose';

export interface IMessageAttachment {
    type: 'uploaded' | 'google';
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileType: string;
    url: string;
    extractedText?: string;
    extractedAt?: Date;
}

export interface IMessage extends Document {
    messageId: string;
    sessionId: string;
    traceId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    contentPreview: string;
    fullContentStored: boolean;
    fullContentUrl?: string;
    timestamp: Date;
    metadata?: Record<string, any>;
    attachments?: IMessageAttachment[];
    
    // Vector fields for smart sampling and semantic search
    semanticEmbedding?: number[]; // 1024 dimensions for selected high-value messages
    learningValue?: number; // AI-calculated importance score (0-1)
    isVectorized?: boolean; // Flag to track vectorization status
    vectorSelectionReason?: string; // Explanation for why this message was selected for vectorization
    
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
    {
        messageId: {
            type: String,
            required: true,
            unique: true, },
        sessionId: {
            type: String,
            required: true, },
        traceId: {
            type: String,
            required: true, },
        role: {
            type: String,
            enum: ['user', 'assistant', 'system', 'tool'],
            required: true
        },
        contentPreview: {
            type: String,
            required: true,
            maxlength: 500
        },
        fullContentStored: {
            type: Boolean,
            default: false
        },
        fullContentUrl: String,
        timestamp: {
            type: Date,
            required: true, },
        metadata: {
            type: Schema.Types.Mixed
        },
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
            extractedText: String,
            extractedAt: Date
        }],
        
        // Vector fields for smart sampling and semantic search
        semanticEmbedding: {
            type: [Number],
            validate: {
                validator: function(v: number[]) {
                    return !v || v.length === 0 || v.length === 1024;
                },
                message: 'Semantic embedding must be 1024 dimensions for Amazon Titan v2'
            }
        },
        learningValue: {
            type: Number,
            min: 0,
            max: 1,
            default: 0
        },
        isVectorized: {
            type: Boolean,
            default: false,
            index: true
        },
        vectorSelectionReason: {
            type: String,
            maxlength: 500
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes
MessageSchema.index({ sessionId: 1, timestamp: 1 });
MessageSchema.index({ traceId: 1, timestamp: 1 });



export const Message = mongoose.model<IMessage>('Message', MessageSchema);
