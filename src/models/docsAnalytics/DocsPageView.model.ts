import mongoose, { Schema, Document } from 'mongoose';

export interface IDocsPageView extends Document {
    pageId: string;
    pagePath: string;
    sessionId: string;
    ipHash?: string;
    userAgent?: string;
    referrer?: string;
    timeOnPage?: number; // seconds
    scrollDepth?: number; // percentage 0-100
    sectionsViewed?: string[];
    deviceType?: 'desktop' | 'tablet' | 'mobile';
    createdAt: Date;
    updatedAt: Date;
}

const DocsPageViewSchema = new Schema<IDocsPageView>(
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
        sessionId: {
            type: String,
            required: true,
            index: true,
        },
        ipHash: {
            type: String,
        },
        userAgent: {
            type: String,
        },
        referrer: {
            type: String,
        },
        timeOnPage: {
            type: Number,
            default: 0,
        },
        scrollDepth: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        sectionsViewed: [{
            type: String,
        }],
        deviceType: {
            type: String,
            enum: ['desktop', 'tablet', 'mobile'],
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for session-based page views
DocsPageViewSchema.index({ pageId: 1, sessionId: 1 });
DocsPageViewSchema.index({ createdAt: -1 });

export const DocsPageView = mongoose.model<IDocsPageView>(
    'DocsPageView',
    DocsPageViewSchema
);

