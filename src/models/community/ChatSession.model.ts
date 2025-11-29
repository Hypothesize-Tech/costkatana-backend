import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IChatSession extends Document {
    userId: Types.ObjectId;
    userName: string;
    userEmail: string;
    subject: string;
    status: 'active' | 'waiting' | 'resolved' | 'closed';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    assignedTo?: Types.ObjectId;
    assignedToName?: string;
    assignedAdminId?: Types.ObjectId;
    adminJoinedAt?: Date;
    aiEnabled: boolean;
    lastAiResponseAt?: Date;
    messageCount: number;
    lastMessageAt: Date;
    resolvedAt?: Date;
    closedAt?: Date;
    rating?: number;
    feedback?: string;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const ChatSessionSchema = new Schema<IChatSession>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        userName: {
            type: String,
            required: true,
        },
        userEmail: {
            type: String,
            required: true,
        },
        subject: {
            type: String,
            required: true,
            maxlength: 200,
        },
        status: {
            type: String,
            enum: ['active', 'waiting', 'resolved', 'closed'],
            default: 'waiting',
        },
        priority: {
            type: String,
            enum: ['low', 'normal', 'high', 'urgent'],
            default: 'normal',
        },
        assignedTo: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        assignedToName: {
            type: String,
        },
        assignedAdminId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        adminJoinedAt: {
            type: Date,
        },
        aiEnabled: {
            type: Boolean,
            default: true,
        },
        lastAiResponseAt: {
            type: Date,
        },
        messageCount: {
            type: Number,
            default: 0,
        },
        lastMessageAt: {
            type: Date,
            default: Date.now,
        },
        resolvedAt: {
            type: Date,
        },
        closedAt: {
            type: Date,
        },
        rating: {
            type: Number,
            min: 1,
            max: 5,
        },
        feedback: {
            type: String,
            maxlength: 1000,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

ChatSessionSchema.index({ status: 1, lastMessageAt: -1 });
ChatSessionSchema.index({ assignedTo: 1, status: 1 });

export const ChatSession = mongoose.models.ChatSession || mongoose.model<IChatSession>('ChatSession', ChatSessionSchema);

