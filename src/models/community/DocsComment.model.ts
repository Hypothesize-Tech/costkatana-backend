import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDocsComment extends Document {
    pageId: string;
    pagePath: string;
    userId: Types.ObjectId;
    userName: string;
    userAvatar?: string;
    content: string;
    parentId?: Types.ObjectId;
    upvotes: Types.ObjectId[];
    downvotes: Types.ObjectId[];
    isEdited: boolean;
    isDeleted: boolean;
    replyCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const DocsCommentSchema = new Schema<IDocsComment>(
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
        content: {
            type: String,
            required: true,
            maxlength: 5000,
        },
        parentId: {
            type: Schema.Types.ObjectId,
            ref: 'DocsComment',
            default: null,
        },
        upvotes: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
        }],
        downvotes: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
        }],
        isEdited: {
            type: Boolean,
            default: false,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        replyCount: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

DocsCommentSchema.index({ pageId: 1, createdAt: -1 });
DocsCommentSchema.index({ parentId: 1 });

export const DocsComment = mongoose.models.DocsComment || mongoose.model<IDocsComment>('DocsComment', DocsCommentSchema);

