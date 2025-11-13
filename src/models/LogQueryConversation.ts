import mongoose, { Schema, Document } from 'mongoose';

export interface ILogQueryMessage {
    role: 'user' | 'assistant';
    content: string;
    query?: string;
    mongoQuery?: any;
    resultsCount?: number;
    visualization?: {
        type: 'stat-card' | 'line' | 'bar' | 'pie' | 'area' | 'table';
        metric: string;
        title: string;
        size: 'small' | 'medium' | 'large' | 'full';
        data?: any;
        chartConfig?: any;
    };
    timestamp: Date;
}

export interface ILogQueryConversation extends Document {
    conversationId: string;
    userId: mongoose.Types.ObjectId;
    messages: ILogQueryMessage[];
    createdAt: Date;
    updatedAt: Date;
}

const LogQueryMessageSchema = new Schema({
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    query: String,
    mongoQuery: Schema.Types.Mixed,
    resultsCount: Number,
    visualization: {
        type: {
            type: String,
            enum: ['stat-card', 'line', 'bar', 'pie', 'area', 'table']
        },
        metric: String,
        title: String,
        size: {
            type: String,
            enum: ['small', 'medium', 'large', 'full']
        },
        data: Schema.Types.Mixed,
        chartConfig: Schema.Types.Mixed
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const LogQueryConversationSchema = new Schema({
    conversationId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    messages: [LogQueryMessageSchema]
}, {
    timestamps: true
});

// Compound index for efficient queries
LogQueryConversationSchema.index({ userId: 1, createdAt: -1 });

// TTL index - auto-delete after 30 days
LogQueryConversationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const LogQueryConversation = mongoose.model<ILogQueryConversation>(
    'LogQueryConversation',
    LogQueryConversationSchema
);

