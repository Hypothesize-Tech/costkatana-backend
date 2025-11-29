import mongoose, { Schema, Document } from 'mongoose';

export interface IDocsUserPreference extends Document {
    sessionId: string;
    visitedPages: {
        pageId: string;
        pagePath: string;
        visitCount: number;
        totalTime: number;
        lastVisited: Date;
    }[];
    preferredTopics: string[];
    readingLevel: 'beginner' | 'intermediate' | 'advanced';
    lastActive: Date;
    createdAt: Date;
    updatedAt: Date;
}

const DocsUserPreferenceSchema = new Schema<IDocsUserPreference>(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        visitedPages: [{
            pageId: {
                type: String,
                required: true,
            },
            pagePath: {
                type: String,
                required: true,
            },
            visitCount: {
                type: Number,
                default: 1,
            },
            totalTime: {
                type: Number,
                default: 0,
            },
            lastVisited: {
                type: Date,
                default: Date.now,
            },
        }],
        preferredTopics: [{
            type: String,
        }],
        readingLevel: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced'],
            default: 'beginner',
        },
        lastActive: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

export const DocsUserPreference = mongoose.model<IDocsUserPreference>(
    'DocsUserPreference',
    DocsUserPreferenceSchema
);

