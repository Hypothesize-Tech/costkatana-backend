import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DocsComment,
  DocsCommentDocument,
} from '../../schemas/community/docs-comment.schema';
import {
  UserExample,
  UserExampleDocument,
} from '../../schemas/community/user-example.schema';
import {
  Discussion,
  DiscussionDocument,
  DiscussionReply,
} from '../../schemas/community/discussion.schema';

export interface UserInfo {
  userId: string;
  userName: string;
  userAvatar?: string;
  email?: string;
  role?: 'user' | 'admin';
  isAdmin?: boolean;
}

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    @InjectModel(DocsComment.name)
    private docsCommentModel: Model<DocsCommentDocument>,
    @InjectModel(UserExample.name)
    private userExampleModel: Model<UserExampleDocument>,
    @InjectModel(Discussion.name)
    private discussionModel: Model<DiscussionDocument>,
  ) {}

  // ==================== COMMENTS ====================

  async createComment(data: {
    pageId: string;
    pagePath: string;
    content: string;
    parentId?: string;
    user: UserInfo;
  }): Promise<DocsComment> {
    const comment = new this.docsCommentModel({
      pageId: data.pageId,
      pagePath: data.pagePath,
      content: data.content,
      parentId: data.parentId ? new Types.ObjectId(data.parentId) : null,
      userId: new Types.ObjectId(data.user.userId),
      userName: data.user.userName,
      userAvatar: data.user.userAvatar,
    });

    const savedComment = await comment.save();

    // Update parent's reply count if this is a reply
    if (data.parentId) {
      await this.docsCommentModel.findByIdAndUpdate(data.parentId, {
        $inc: { replyCount: 1 },
      });
    }

    this.logger.log(`Comment created for page ${data.pageId}`);
    return savedComment;
  }

  async getPageComments(
    pageId: string,
    options?: {
      page?: number;
      limit?: number;
      sortBy?: 'newest' | 'oldest' | 'popular';
    },
  ): Promise<{ comments: DocsComment[]; total: number; hasMore: boolean }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;

    let sortQuery: Record<string, 1 | -1> = { createdAt: -1 };
    if (options?.sortBy === 'oldest') sortQuery = { createdAt: 1 };
    if (options?.sortBy === 'popular')
      sortQuery = { upvotes: -1, createdAt: -1 };

    const [comments, total] = await Promise.all([
      this.docsCommentModel
        .find({ pageId, parentId: null, isDeleted: false })
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .lean(),
      this.docsCommentModel.countDocuments({
        pageId,
        parentId: null,
        isDeleted: false,
      }),
    ]);

    // Populate user roles
    const commentsWithRoles = await this.populateUserRoles(comments, 'userId');

    return {
      comments: commentsWithRoles,
      total,
      hasMore: skip + comments.length < total,
    };
  }

  async getCommentReplies(parentId: string): Promise<DocsComment[]> {
    const replies = await this.docsCommentModel
      .find({ parentId: new Types.ObjectId(parentId), isDeleted: false })
      .sort({ createdAt: 1 })
      .lean();

    return this.populateUserRoles(replies, 'userId');
  }

  async updateComment(
    commentId: string,
    userId: string,
    content: string,
    isAdmin = false,
  ): Promise<DocsComment | null> {
    const query: Record<string, unknown> = { _id: commentId, isDeleted: false };
    if (!isAdmin) {
      query.userId = new Types.ObjectId(userId);
    }

    const comment = await this.docsCommentModel
      .findOneAndUpdate(query, { content, isEdited: true }, { new: true })
      .lean();

    return comment;
  }

  async deleteComment(
    commentId: string,
    userId: string,
    isAdmin = false,
  ): Promise<boolean> {
    const query: Record<string, unknown> = { _id: commentId };
    if (!isAdmin) {
      query.userId = new Types.ObjectId(userId);
    }

    const result = await this.docsCommentModel.findOneAndUpdate(
      query,
      { isDeleted: true, content: '[deleted]' },
      { new: true },
    );

    return !!result;
  }

  async voteComment(
    commentId: string,
    userId: string,
    voteType: 'up' | 'down',
  ): Promise<DocsComment | null> {
    const userObjectId = new Types.ObjectId(userId);
    const comment = await this.docsCommentModel.findById(commentId);

    if (!comment) return null;

    // Remove existing vote
    comment.upvotes = comment.upvotes.filter(
      (id: Types.ObjectId) => !id.equals(userObjectId),
    );
    comment.downvotes = comment.downvotes.filter(
      (id: Types.ObjectId) => !id.equals(userObjectId),
    );

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
  }): Promise<UserExample> {
    const example = new this.userExampleModel({
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

    const savedExample = await example.save();

    this.logger.log(`Example submitted: ${data.title}`);
    return savedExample;
  }

  async getExamples(options?: {
    page?: number;
    limit?: number;
    category?: string;
    language?: string;
    tags?: string[];
    status?: string;
    sortBy?: 'newest' | 'popular' | 'views';
  }): Promise<{ examples: UserExample[]; total: number; hasMore: boolean }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 12;
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {
      isDeleted: false,
      status: options?.status ?? 'approved',
    };
    if (options?.category) query.category = options.category;
    if (options?.language) query.language = options.language;
    if (options?.tags?.length) query.tags = { $in: options.tags };

    let sortQuery: Record<string, 1 | -1> = { createdAt: -1 };
    if (options?.sortBy === 'popular')
      sortQuery = { upvotes: -1, createdAt: -1 };
    if (options?.sortBy === 'views')
      sortQuery = { viewCount: -1, createdAt: -1 };

    const [examples, total] = await Promise.all([
      this.userExampleModel.find(query).sort(sortQuery).skip(skip).limit(limit),
      this.userExampleModel.countDocuments(query),
    ]);

    const examplesWithRoles = await this.populateUserRoles(examples, 'userId');

    return {
      examples: examplesWithRoles,
      total,
      hasMore: skip + examples.length < total,
    };
  }

  async getExampleById(exampleId: string): Promise<UserExample | null> {
    const example = await this.userExampleModel.findByIdAndUpdate(
      exampleId,
      { $inc: { viewCount: 1 } },
      { new: true },
    );

    if (example) {
      const examplesWithRoles = await this.populateUserRoles(
        [example],
        'userId',
      );
      return examplesWithRoles[0];
    }

    return null;
  }

  async updateExample(
    exampleId: string,
    userId: string,
    data: {
      title?: string;
      description?: string;
      code?: string;
      language?: string;
      category?: string;
      tags?: string[];
    },
  ): Promise<UserExample | null> {
    return this.userExampleModel.findOneAndUpdate(
      { _id: exampleId, userId: new Types.ObjectId(userId), isDeleted: false },
      { ...data, status: 'pending' }, // Reset to pending for re-review
      { new: true },
    );
  }

  async voteExample(
    exampleId: string,
    userId: string,
    voteType: 'up' | 'down',
  ): Promise<UserExample | null> {
    const userObjectId = new Types.ObjectId(userId);
    const example = await this.userExampleModel.findById(exampleId);

    if (!example) return null;

    example.upvotes = example.upvotes.filter(
      (id: Types.ObjectId) => !id.equals(userObjectId),
    );
    example.downvotes = example.downvotes.filter(
      (id: Types.ObjectId) => !id.equals(userObjectId),
    );

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
  }): Promise<Discussion> {
    const discussion = new this.discussionModel({
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

    const savedDiscussion = await discussion.save();

    this.logger.log(`Discussion created: ${data.title}`);
    return savedDiscussion;
  }

  async getDiscussions(options?: {
    page?: number;
    limit?: number;
    category?: string;
    tags?: string[];
    sortBy?: 'newest' | 'active' | 'popular';
  }): Promise<{ discussions: Discussion[]; total: number; hasMore: boolean }> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 20;
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = { isDeleted: false };
    if (options?.category) query.category = options.category;
    if (options?.tags?.length) query.tags = { $in: options.tags };

    let sortQuery: Record<string, 1 | -1> = {
      isPinned: -1,
      lastActivityAt: -1,
    };
    if (options?.sortBy === 'newest')
      sortQuery = { isPinned: -1, createdAt: -1 };
    if (options?.sortBy === 'popular')
      sortQuery = { isPinned: -1, upvotes: -1, replyCount: -1 };

    const [discussions, total] = await Promise.all([
      this.discussionModel
        .find(query)
        .select('-replies')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .lean(),
      this.discussionModel.countDocuments(query),
    ]);

    const discussionsWithRoles = await this.populateUserRoles(
      discussions,
      'userId',
    );

    return {
      discussions: discussionsWithRoles,
      total,
      hasMore: skip + discussions.length < total,
    };
  }

  async getDiscussionById(discussionId: string): Promise<Discussion | null> {
    const discussion = await this.discussionModel
      .findByIdAndUpdate(
        discussionId,
        { $inc: { viewCount: 1 } },
        { new: true },
      )
      .lean();

    if (!discussion) return null;

    // Populate user roles for discussion author and all reply authors
    const userIds = new Set<string>();
    userIds.add(discussion.userId.toString());
    if (discussion.replies && Array.isArray(discussion.replies)) {
      discussion.replies.forEach((reply: DiscussionReply) => {
        userIds.add(reply.userId.toString());
      });
    }

    const discussionsWithRoles = await this.populateUserRoles(
      [discussion],
      'userId',
      userIds,
    );

    // Also populate roles for replies
    const result = discussionsWithRoles[0];
    if (result && result.replies) {
      result.replies = await Promise.all(
        result.replies.map(async (reply) => ({
          ...reply,
          userRole: await this.getUserRole(reply.userId.toString()),
        })),
      );
    }

    return result;
  }

  async addReply(
    discussionId: string,
    data: {
      content: string;
      user: UserInfo;
    },
  ): Promise<Discussion | null> {
    const discussion = await this.discussionModel.findOneAndUpdate(
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
      { new: true },
    );

    return discussion;
  }

  async voteDiscussion(
    discussionId: string,
    userId: string,
    voteType: 'up' | 'down',
  ): Promise<Discussion | null> {
    const userObjectId = new Types.ObjectId(userId);
    const discussion = await this.discussionModel.findById(discussionId);

    if (!discussion) return null;

    discussion.upvotes = discussion.upvotes.filter(
      (id: Types.ObjectId) => !id.equals(userObjectId),
    );
    discussion.downvotes = discussion.downvotes.filter(
      (id: Types.ObjectId) => !id.equals(userObjectId),
    );

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
      this.docsCommentModel.countDocuments({ isDeleted: false }),
      this.userExampleModel.countDocuments({
        isDeleted: false,
        status: 'approved',
      }),
      this.discussionModel.countDocuments({ isDeleted: false }),
    ]);

    // Get unique active users from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeUsers = await this.docsCommentModel.distinct('userId', {
      createdAt: { $gte: thirtyDaysAgo },
    });

    return {
      totalComments,
      totalExamples,
      totalDiscussions,
      activeUsers: activeUsers.length,
    };
  }

  // ==================== HELPERS ====================

  private async populateUserRoles<T extends Record<string, any>>(
    items: T[],
    userIdField: string,
    userRoleMap?: Set<string>,
  ): Promise<T[]> {
    // Extract user IDs
    const userIds =
      userRoleMap || new Set(items.map((item) => item[userIdField].toString()));

    // Get user roles from database
    const users = await this.discussionModel.db
      .collection('users')
      .find(
        {
          _id: { $in: Array.from(userIds).map((id) => new Types.ObjectId(id)) },
        },
        { projection: { _id: 1, role: 1 } },
      )
      .toArray();

    const roleMap = new Map(
      users.map((user) => [user._id.toString(), user.role || 'user']),
    );

    // Add userRole to each item
    return items.map((item) => ({
      ...item,
      userRole: roleMap.get(item[userIdField].toString()) || 'user',
    }));
  }

  private async getUserRole(userId: string): Promise<string> {
    try {
      // Query user role from database
      const user = await this.discussionModel.db
        .collection('users')
        .findOne(
          { _id: new Types.ObjectId(userId) },
          { projection: { role: 1 } },
        );

      return user?.role || 'user';
    } catch (error) {
      this.logger.warn(`Failed to get user role for ${userId}`, { error });
      return 'user'; // Default fallback
    }
  }
}
