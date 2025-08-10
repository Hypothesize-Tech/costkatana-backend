import mongoose, { Document, Schema } from 'mongoose';

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
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
    {
        messageId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        sessionId: {
            type: String,
            required: true,
            index: true
        },
        traceId: {
            type: String,
            required: true,
            index: true
        },
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
            required: true,
            index: true
        },
        metadata: {
            type: Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes
MessageSchema.index({ sessionId: 1, timestamp: 1 });
MessageSchema.index({ traceId: 1, timestamp: 1 });

// TTL index if enabled
if (process.env.TRACE_TTL_DAYS) {
    const ttlDays = parseInt(process.env.TRACE_TTL_DAYS);
    MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });
}

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
