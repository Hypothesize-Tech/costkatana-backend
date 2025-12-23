import { Schema, model, Document, Types } from 'mongoose';

export interface IGitHubContext {
    connectionId?: Types.ObjectId;
    repositoryId?: number;
    repositoryName?: string;
    repositoryFullName?: string;
    integrationId?: Types.ObjectId;
    branchName?: string;
}

export interface IConversation extends Document {
    _id: Types.ObjectId;
    userId: string;
    title: string;
    modelId: string;
    messageCount: number;
    totalCost: number;
    lastMessage?: string;
    lastMessageAt?: Date;
    isActive: boolean;
    isPinned: boolean;
    isArchived: boolean;
    deletedAt?: Date;
    githubContext?: IGitHubContext;
    createdAt: Date;
    updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>({
    userId: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true,
        maxlength: 200
    },
    modelId: {
        type: String,
        required: true
    },
    messageCount: {
        type: Number,
        default: 0,
        min: 0
    },
    totalCost: {
        type: Number,
        default: 0,
        min: 0
    },
    lastMessage: {
        type: String,
        maxlength: 500
    },
    lastMessageAt: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isPinned: {
        type: Boolean,
        default: false
    },
    isArchived: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        required: false
    },
    githubContext: {
        type: {
            connectionId: Schema.Types.ObjectId,
            repositoryId: Number,
            repositoryName: String,
            repositoryFullName: String,
            integrationId: Schema.Types.ObjectId,
            branchName: String
        },
        required: false
    }
}, {
    timestamps: true,
    collection: 'conversations'
});

// Indexes for performance
conversationSchema.index({ userId: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, isActive: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, isPinned: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, isArchived: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, isActive: 1, isArchived: 1, isPinned: 1, updatedAt: -1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema); 