import mongoose, { Schema, Document } from 'mongoose';

export interface IDocsPageRating extends Document {
    pageId: string;
    pagePath: string;
    rating: 'up' | 'down';
    starRating?: number; // 1-5 optional
    sessionId: string;
    ipHash?: string;
    userAgent?: string;
    createdAt: Date;
}

const DocsPageRatingSchema = new Schema<IDocsPageRating>(
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
        rating: {
            type: String,
            enum: ['up', 'down'],
            required: true,
        },
        starRating: {
            type: Number,
            min: 1,
            max: 5,
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
    },
    {
        timestamps: true,
    }
);

// Compound index for preventing duplicate ratings per session
DocsPageRatingSchema.index({ pageId: 1, sessionId: 1 }, { unique: true });

export const DocsPageRating = mongoose.model<IDocsPageRating>(
    'DocsPageRating',
    DocsPageRatingSchema
);

