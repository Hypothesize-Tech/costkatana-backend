import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDiscussionReply {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    userName: string;
    userAvatar?: string;
    content: string;
    upvotes: Types.ObjectId[];
    downvotes: Types.ObjectId[];
    isEdited: boolean;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface IDiscussion extends Document {
    title: string;
    content: string;
    category: string;
    tags: string[];
    userId: Types.ObjectId;
    userName: string;
    userAvatar?: string;
    upvotes: Types.ObjectId[];
    downvotes: Types.ObjectId[];
    viewCount: number;
    replyCount: number;
    replies: IDiscussionReply[];
    isPinned: boolean;
    isLocked: boolean;
    isDeleted: boolean;
    lastActivityAt: Date;
    relatedPageId?: string;
    relatedPagePath?: string;
    createdAt: Date;
    updatedAt: Date;
}

const DiscussionReplySchema = new Schema<IDiscussionReply>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
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
            maxlength: 10000,
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
    },
    {
        timestamps: true,
    }
);

const DiscussionSchema = new Schema<IDiscussion>(
    {
        title: {
            type: String,
            required: true,
            maxlength: 300,
        },
        content: {
            type: String,
            required: true,
            maxlength: 20000,
        },
        category: {
            type: String,
            required: true,
            enum: ['general', 'help', 'feature-request', 'bug-report', 'showcase', 'tutorial'],
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
        replyCount: {
            type: Number,
            default: 0,
        },
        replies: [DiscussionReplySchema],
        isPinned: {
            type: Boolean,
            default: false,
        },
        isLocked: {
            type: Boolean,
            default: false,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        lastActivityAt: {
            type: Date,
            default: Date.now,
        },
        relatedPageId: {
            type: String,
        },
        relatedPagePath: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

DiscussionSchema.index({ category: 1, lastActivityAt: -1 });
DiscussionSchema.index({ isPinned: -1, lastActivityAt: -1 });
DiscussionSchema.index({ tags: 1 });

export const Discussion = mongoose.models.Discussion || mongoose.model<IDiscussion>('Discussion', DiscussionSchema);

