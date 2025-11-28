import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IChatMessage extends Document {
    sessionId: Types.ObjectId;
    senderId: Types.ObjectId;
    senderName: string;
    senderType: 'user' | 'support' | 'system' | 'ai';
    content: string;
    messageType: 'text' | 'code' | 'link' | 'image' | 'file';
    attachments?: {
        name: string;
        url: string;
        type: string;
        size: number;
    }[];
    isAiGenerated: boolean;
    isRead: boolean;
    readAt?: Date;
    metadata?: Record<string, unknown>;
    createdAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
    {
        sessionId: {
            type: Schema.Types.ObjectId,
            ref: 'ChatSession',
            required: true,
            index: true,
        },
        senderId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        senderName: {
            type: String,
            required: true,
        },
        senderType: {
            type: String,
            enum: ['user', 'support', 'system', 'ai'],
            required: true,
        },
        isAiGenerated: {
            type: Boolean,
            default: false,
        },
        content: {
            type: String,
            required: true,
            maxlength: 10000,
        },
        messageType: {
            type: String,
            enum: ['text', 'code', 'link', 'image', 'file'],
            default: 'text',
        },
        attachments: [{
            name: String,
            url: String,
            type: String,
            size: Number,
        }],
        isRead: {
            type: Boolean,
            default: false,
        },
        readAt: {
            type: Date,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
        collection: 'communityChatMessages', // Use a different collection to avoid conflicts
    }
);

ChatMessageSchema.index({ sessionId: 1, createdAt: 1 });

export const ChatMessage = mongoose.models.CommunityChatMessage || mongoose.model<IChatMessage>('CommunityChatMessage', ChatMessageSchema);

