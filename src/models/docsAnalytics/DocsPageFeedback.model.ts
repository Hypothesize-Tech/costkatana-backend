import mongoose, { Schema, Document } from 'mongoose';

export interface IDocsPageFeedback extends Document {
    pageId: string;
    pagePath: string;
    feedbackType: 'bug' | 'improvement' | 'question' | 'other';
    message: string;
    email?: string;
    sessionId: string;
    ipHash?: string;
    userAgent?: string;
    status: 'new' | 'reviewed' | 'resolved';
    createdAt: Date;
    updatedAt: Date;
}

const DocsPageFeedbackSchema = new Schema<IDocsPageFeedback>(
    {
        pageId: {
            type: String,
            required: true,
            index: true,
        },
        pagePath: {
            type: String,
            required: true,
        },
        feedbackType: {
            type: String,
            enum: ['bug', 'improvement', 'question', 'other'],
            required: true,
        },
        message: {
            type: String,
            required: true,
            maxlength: 2000,
        },
        email: {
            type: String,
            match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        },
        sessionId: {
            type: String,
            required: true,
        },
        ipHash: {
            type: String,
        },
        userAgent: {
            type: String,
        },
        status: {
            type: String,
            enum: ['new', 'reviewed', 'resolved'],
            default: 'new',
        },
    },
    {
        timestamps: true,
    }
);

DocsPageFeedbackSchema.index({ status: 1, createdAt: -1 });

export const DocsPageFeedback = mongoose.model<IDocsPageFeedback>(
    'DocsPageFeedback',
    DocsPageFeedbackSchema
);

