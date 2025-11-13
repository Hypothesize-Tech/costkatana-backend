import mongoose, { Schema, Document } from 'mongoose';

export interface ILogQueryAudit extends Document {
    userId: mongoose.Types.ObjectId;
    naturalLanguageQuery: string;
    generatedMongoQuery: any;
    resultsCount: number;
    executionTime: number;
    status: 'success' | 'blocked' | 'error';
    error?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
}

const LogQueryAuditSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    naturalLanguageQuery: {
        type: String,
        required: true
    },
    generatedMongoQuery: {
        type: Schema.Types.Mixed,
        required: true
    },
    resultsCount: {
        type: Number,
        default: 0
    },
    executionTime: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['success', 'blocked', 'error'],
        required: true,
        index: true
    },
    error: String,
    ipAddress: String,
    userAgent: String,
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
});

// Compound indexes for efficient queries
LogQueryAuditSchema.index({ userId: 1, timestamp: -1 });
LogQueryAuditSchema.index({ status: 1, timestamp: -1 });

// TTL index - auto-delete after 90 days
LogQueryAuditSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const LogQueryAudit = mongoose.model<ILogQueryAudit>(
    'LogQueryAudit',
    LogQueryAuditSchema
);

