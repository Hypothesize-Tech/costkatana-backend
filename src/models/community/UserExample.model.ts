import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUserExample extends Document {
    title: string;
    description: string;
    code: string;
    language: string;
    category: string;
    tags: string[];
    userId: Types.ObjectId;
    userName: string;
    userAvatar?: string;
    upvotes: Types.ObjectId[];
    downvotes: Types.ObjectId[];
    viewCount: number;
    status: 'pending' | 'approved' | 'rejected';
    relatedPageId?: string;
    relatedPagePath?: string;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const UserExampleSchema = new Schema<IUserExample>(
    {
        title: {
            type: String,
            required: true,
            maxlength: 200,
        },
        description: {
            type: String,
            required: true,
            maxlength: 2000,
        },
        code: {
            type: String,
            required: true,
            maxlength: 50000,
        },
        language: {
            type: String,
            required: true,
            enum: ['typescript', 'javascript', 'python', 'bash', 'json', 'yaml', 'other'],
        },
        category: {
            type: String,
            required: true,
            enum: ['getting-started', 'integration', 'optimization', 'analytics', 'gateway', 'workflows', 'other'],
        },
        tags: [{
            type: String,
            maxlength: 50,
        }],
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
        userAvatar: {
            type: String,
        },
        upvotes: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
        }],
        downvotes: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
        }],
        viewCount: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
        },
        relatedPageId: {
            type: String,
        },
        relatedPagePath: {
            type: String,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

UserExampleSchema.index({ status: 1, createdAt: -1 });
UserExampleSchema.index({ category: 1 });
UserExampleSchema.index({ tags: 1 });
UserExampleSchema.index({ language: 1 });

export const UserExample = mongoose.models.UserExample || mongoose.model<IUserExample>('UserExample', UserExampleSchema);

