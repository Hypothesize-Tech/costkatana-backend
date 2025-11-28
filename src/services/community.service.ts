import { Types } from 'mongoose';
import {
    DocsComment,
    IDocsComment,
    UserExample,
    IUserExample,
    Discussion,
    IDiscussion,
    IDiscussionReply,
} from '../models/community';
import { User } from '../models/User';
import { loggingService } from './logging.service';

export interface UserInfo {
    userId: string;
    userName: string;
    userAvatar?: string;
    email?: string;
    role?: 'user' | 'admin';
    isAdmin?: boolean;
}

export class CommunityService {
    private static instance: CommunityService;

    private constructor() {}

    static getInstance(): CommunityService {
        if (!CommunityService.instance) {
            CommunityService.instance = new CommunityService();
        }
        return CommunityService.instance;
    }

    // ==================== COMMENTS ====================

    async createComment(data: {
        pageId: string;
        pagePath: string;
        content: string;
        parentId?: string;
        user: UserInfo;
    }): Promise<IDocsComment> {
        const comment = await DocsComment.create({
            pageId: data.pageId,
            pagePath: data.pagePath,
            content: data.content,
            parentId: data.parentId ? new Types.ObjectId(data.parentId) : null,
            userId: new Types.ObjectId(data.user.userId),
            userName: data.user.userName,
            userAvatar: data.user.userAvatar,
        });

        // Update parent's reply count if this is a reply
        if (data.parentId) {
            await DocsComment.findByIdAndUpdate(data.parentId, {
                $inc: { replyCount: 1 },
            });
        }

        loggingService.info('Comment created', { pageId: data.pageId, commentId: String(comment._id) });
        return comment;
    }

    async getPageComments(pageId: string, options?: {
        page?: number;
        limit?: number;
        sortBy?: 'newest' | 'oldest' | 'popular';
    }): Promise<{ comments: IDocsComment[]; total: number; hasMore: boolean }> {
        const page = options?.page || 1;
        const limit = options?.limit || 20;
        const skip = (page - 1) * limit;

        let sortQuery: Record<string, 1 | -1> = { createdAt: -1 };
        if (options?.sortBy === 'oldest') sortQuery = { createdAt: 1 };
        if (options?.sortBy === 'popular') sortQuery = { upvotes: -1, createdAt: -1 };

        const [comments, total] = await Promise.all([
            DocsComment.find({ pageId, parentId: null, isDeleted: false })
                .sort(sortQuery)
                .skip(skip)
                .limit(limit)
                .lean<IDocsComment[]>(),
            DocsComment.countDocuments({ pageId, parentId: null, isDeleted: false }),
        ]);

        // Populate user roles
        const userIds = [...new Set(comments.map(c => c.userId.toString()))];
        const users = await User.find({ _id: { $in: userIds } }).select('_id role').lean();
        const userRoleMap = new Map(users.map(u => [u._id.toString(), u.role]));

        const commentsWithRoles = comments.map(comment => ({
            ...comment,
            userRole: userRoleMap.get(comment.userId.toString()) || 'user',
        }));

        return {
            comments: commentsWithRoles as unknown as IDocsComment[],
            total,
            hasMore: skip + comments.length < total,
        };
    }

    async getCommentReplies(parentId: string): Promise<IDocsComment[]> {
        const replies = await DocsComment.find({ parentId: new Types.ObjectId(parentId), isDeleted: false })
            .sort({ createdAt: 1 })
            .lean<IDocsComment[]>();

        // Populate user roles
        const userIds = [...new Set(replies.map(r => r.userId.toString()))];
        const users = await User.find({ _id: { $in: userIds } }).select('_id role').lean();
        const userRoleMap = new Map(users.map(u => [u._id.toString(), u.role]));

        return replies.map(reply => ({
            ...reply,
            userRole: userRoleMap.get(reply.userId.toString()) || 'user',
        })) as unknown as IDocsComment[];
    }

    async updateComment(commentId: string, userId: string, content: string, isAdmin = false): Promise<IDocsComment | null> {
        const query: Record<string, unknown> = { _id: commentId, isDeleted: false };
        if (!isAdmin) {
            query.userId = new Types.ObjectId(userId);
        }
        
        const comment = await DocsComment.findOneAndUpdate(
            query,
            { content, isEdited: true },
            { new: true }
        ).lean<IDocsComment | null>();
        return comment;
    }

    async deleteComment(commentId: string, userId: string, isAdmin = false): Promise<boolean> {
        const query: Record<string, unknown> = { _id: commentId };
        if (!isAdmin) {
            query.userId = new Types.ObjectId(userId);
        }
        
        const result = await DocsComment.findOneAndUpdate(
            query,
            { isDeleted: true, content: '[deleted]' },
            { new: true }
        );
        return !!result;
    }

    async voteComment(commentId: string, userId: string, voteType: 'up' | 'down'): Promise<IDocsComment | null> {
        const userObjectId = new Types.ObjectId(userId);
        const comment = await DocsComment.findById<IDocsComment>(new Types.ObjectId(commentId));
        
        if (!comment) return null;

        // Remove existing vote
        comment.upvotes = comment.upvotes.filter((id: Types.ObjectId) => !id.equals(userObjectId));
        comment.downvotes = comment.downvotes.filter((id: Types.ObjectId) => !id.equals(userObjectId));

        // Add new vote
        if (voteType === 'up') {
            comment.upvotes.push(userObjectId);
        } else {
            comment.downvotes.push(userObjectId);
        }

        await comment.save();
        return comment;
    }

    // ==================== USER EXAMPLES ====================

    async createExample(data: {
        title: string;
        description: string;
        code: string;
        language: string;
        category: string;
        tags?: string[];
        relatedPageId?: string;
        relatedPagePath?: string;
        user: UserInfo;
    }): Promise<IUserExample> {
        const example = await UserExample.create({
            title: data.title,
            description: data.description,
            code: data.code,
            language: data.language,
            category: data.category,
            tags: data.tags ?? [],
            relatedPageId: data.relatedPageId,
            relatedPagePath: data.relatedPagePath,
            userId: new Types.ObjectId(data.user.userId),
            userName: data.user.userName,
            userAvatar: data.user.userAvatar,
            status: 'pending',
        });

        loggingService.info('Example submitted', { exampleId: String(example._id), title: data.title });
        return example;
    }

    async getExamples(options?: {
        page?: number;
        limit?: number;
        category?: string;
        language?: string;
        tags?: string[];
        status?: string;
        sortBy?: 'newest' | 'popular' | 'views';
    }): Promise<{ examples: IUserExample[]; total: number; hasMore: boolean }> {
        const page = options?.page ?? 1;
        const limit = options?.limit ?? 12;
        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = { isDeleted: false, status: options?.status ?? 'approved' };
        if (options?.category) query.category = options.category;
        if (options?.language) query.language = options.language;
        if (options?.tags?.length) query.tags = { $in: options.tags };

        let sortQuery: Record<string, 1 | -1> = { createdAt: -1 };
        if (options?.sortBy === 'popular') sortQuery = { upvotes: -1, createdAt: -1 };
        if (options?.sortBy === 'views') sortQuery = { viewCount: -1, createdAt: -1 };

        const [examples, total] = await Promise.all([
            UserExample.find(query).sort(sortQuery).skip(skip).limit(limit),
            UserExample.countDocuments(query),
        ]);

        return {
            examples,
            total,
            hasMore: skip + examples.length < total,
        };
    }

    async getExampleById(exampleId: string): Promise<IUserExample | null> {
        const example = await UserExample.findByIdAndUpdate(
            exampleId,
            { $inc: { viewCount: 1 } },
            { new: true }
        );
        return example;
    }

    async updateExample(exampleId: string, userId: string, data: {
        title?: string;
        description?: string;
        code?: string;
        language?: string;
        category?: string;
        tags?: string[];
    }): Promise<IUserExample | null> {
        return UserExample.findOneAndUpdate(
            { _id: exampleId, userId: new Types.ObjectId(userId), isDeleted: false },
            { ...data, status: 'pending' }, // Reset to pending for re-review
            { new: true }
        );
    }

    async voteExample(exampleId: string, userId: string, voteType: 'up' | 'down'): Promise<IUserExample | null> {
        const userObjectId = new Types.ObjectId(userId);
        const example = await UserExample.findById<IUserExample>(exampleId);
        
        if (!example) return null;

        example.upvotes = example.upvotes.filter((id: Types.ObjectId) => !id.equals(userObjectId));
        example.downvotes = example.downvotes.filter((id: Types.ObjectId) => !id.equals(userObjectId));

        if (voteType === 'up') {
            example.upvotes.push(userObjectId);
        } else {
            example.downvotes.push(userObjectId);
        }

        await example.save();
        return example;
    }

    // ==================== DISCUSSIONS ====================

    async createDiscussion(data: {
        title: string;
        content: string;
        category: string;
        tags?: string[];
        relatedPageId?: string;
        relatedPagePath?: string;
        user: UserInfo;
    }): Promise<IDiscussion> {
        const discussion = await Discussion.create({
            title: data.title,
            content: data.content,
            category: data.category,
            tags: data.tags ?? [],
            relatedPageId: data.relatedPageId,
            relatedPagePath: data.relatedPagePath,
            userId: new Types.ObjectId(data.user.userId),
            userName: data.user.userName,
            userAvatar: data.user.userAvatar,
            lastActivityAt: new Date(),
        });

        loggingService.info('Discussion created', { discussionId: String(discussion._id), title: data.title });
        return discussion;
    }

    async getDiscussions(options?: {
        page?: number;
        limit?: number;
        category?: string;
        tags?: string[];
        sortBy?: 'newest' | 'active' | 'popular';
    }): Promise<{ discussions: IDiscussion[]; total: number; hasMore: boolean }> {
        const page = options?.page ?? 1;
        const limit = options?.limit ?? 20;
        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = { isDeleted: false };
        if (options?.category) query.category = options.category;
        if (options?.tags?.length) query.tags = { $in: options.tags };

        let sortQuery: Record<string, 1 | -1> = { isPinned: -1, lastActivityAt: -1 };
        if (options?.sortBy === 'newest') sortQuery = { isPinned: -1, createdAt: -1 };
        if (options?.sortBy === 'popular') sortQuery = { isPinned: -1, upvotes: -1, replyCount: -1 };

        const [discussions, total] = await Promise.all([
            Discussion.find(query)
                .select('-replies')
                .sort(sortQuery)
                .skip(skip)
                .limit(limit)
                .lean<IDiscussion[]>(),
            Discussion.countDocuments(query),
        ]);

        // Populate user roles
        const userIds = [...new Set(discussions.map(d => d.userId.toString()))];
        const users = await User.find({ _id: { $in: userIds } }).select('_id role').lean();
        const userRoleMap = new Map(users.map(u => [u._id.toString(), u.role]));

        const discussionsWithRoles = discussions.map(discussion => ({
            ...discussion,
            userRole: userRoleMap.get(discussion.userId.toString()) || 'user',
        }));

        return {
            discussions: discussionsWithRoles as unknown as IDiscussion[],
            total,
            hasMore: skip + discussions.length < total,
        };
    }

    async getDiscussionById(discussionId: string): Promise<IDiscussion | null> {
        const discussion = await Discussion.findByIdAndUpdate(
            discussionId,
            { $inc: { viewCount: 1 } },
            { new: true }
        ).lean<IDiscussion | null>();

        if (!discussion) return null;

        // Populate user roles for discussion author and all reply authors
        const userIds = new Set<string>();
        userIds.add(discussion.userId.toString());
        if (discussion.replies && Array.isArray(discussion.replies)) {
            discussion.replies.forEach((reply: { userId: Types.ObjectId | string }) => {
                userIds.add(reply.userId.toString());
            });
        }

        const users = await User.find({ _id: { $in: Array.from(userIds) } }).select('_id role').lean();
        const userRoleMap = new Map(users.map(u => [u._id.toString(), u.role]));

        const discussionWithRole = {
            ...discussion,
            userRole: userRoleMap.get(discussion.userId.toString()) || 'user',
            replies: discussion.replies?.map((reply: IDiscussionReply) => ({
                ...reply,
                userRole: userRoleMap.get(reply.userId.toString()) || 'user',
            })),
        };

        return discussionWithRole as unknown as IDiscussion;
    }

    async addReply(discussionId: string, data: {
        content: string;
        user: UserInfo;
    }): Promise<IDiscussion | null> {
        const discussion = await Discussion.findOneAndUpdate(
            { _id: discussionId, isDeleted: false, isLocked: false },
            {
                $push: {
                    replies: {
                        userId: new Types.ObjectId(data.user.userId),
                        userName: data.user.userName,
                        userAvatar: data.user.userAvatar,
                        content: data.content,
                        upvotes: [],
                        downvotes: [],
                        isEdited: false,
                        isDeleted: false,
                    },
                },
                $inc: { replyCount: 1 },
                $set: { lastActivityAt: new Date() },
            },
            { new: true }
        );

        return discussion;
    }

    async voteDiscussion(discussionId: string, userId: string, voteType: 'up' | 'down'): Promise<IDiscussion | null> {
        const userObjectId = new Types.ObjectId(userId);
        const discussion = await Discussion.findById<IDiscussion>(discussionId);
        
        if (!discussion) return null;

        discussion.upvotes = discussion.upvotes.filter((id: Types.ObjectId) => !id.equals(userObjectId));
        discussion.downvotes = discussion.downvotes.filter((id: Types.ObjectId) => !id.equals(userObjectId));

        if (voteType === 'up') {
            discussion.upvotes.push(userObjectId);
        } else {
            discussion.downvotes.push(userObjectId);
        }

        await discussion.save();
        return discussion;
    }

    // ==================== STATISTICS ====================

    async getCommunityStats(): Promise<{
        totalComments: number;
        totalExamples: number;
        totalDiscussions: number;
        activeUsers: number;
    }> {
        const [totalComments, totalExamples, totalDiscussions] = await Promise.all([
            DocsComment.countDocuments({ isDeleted: false }),
            UserExample.countDocuments({ isDeleted: false, status: 'approved' }),
            Discussion.countDocuments({ isDeleted: false }),
        ]);

        // Get unique active users from last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const activeUsers = await DocsComment.distinct('userId', { createdAt: { $gte: thirtyDaysAgo } });

        return {
            totalComments,
            totalExamples,
            totalDiscussions,
            activeUsers: activeUsers.length,
        };
    }
}

export const communityService = CommunityService.getInstance();

