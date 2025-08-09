import { Schema, model, Document, Types } from 'mongoose';

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
    }
}, {
    timestamps: true,
    collection: 'conversations'
});

// Indexes for performance
conversationSchema.index({ userId: 1, updatedAt: -1 });
conversationSchema.index({ userId: 1, isActive: 1, updatedAt: -1 });
conversationSchema.index({ modelId: 1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema); 