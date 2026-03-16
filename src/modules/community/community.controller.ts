import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CommunityService, UserInfo } from './community.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  // Helper to extract user info from authenticated request
  private getUserInfo(user: any): UserInfo {
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get userId - auth middleware sets req.user.id as string
    const userId = user.id || (user._id ? String(user._id) : null);
    if (!userId) {
      throw new ForbiddenException('User ID not found in request');
    }

    return {
      userId: String(userId),
      userName: user.name || user.email?.split('@')[0] || 'Anonymous',
      userAvatar: user.avatar,
      email: user.email,
      role: user.role || 'user',
      isAdmin: user.role === 'admin',
    };
  }

  // ==================== COMMENTS ====================

  /**
   * POST /community/comments
   * Add a comment to a documentation page
   */
  @Post('comments')
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @Body()
    body: {
      pageId: string;
      pagePath: string;
      content: string;
      parentId?: string;
    },
    @CurrentUser() user: any,
  ) {
    const { pageId, pagePath, content, parentId } = body;

    if (!pageId || !pagePath || !content) {
      throw new BadRequestException(
        'Missing required fields: pageId, pagePath, content',
      );
    }

    if (content.length > 5000) {
      throw new BadRequestException('Comment too long (max 5000 characters)');
    }

    const userInfo = this.getUserInfo(user);
    const comment = await this.communityService.createComment({
      pageId,
      pagePath,
      content,
      parentId,
      user: userInfo,
    });

    return { success: true, data: comment };
  }

  /**
   * GET /community/comments/:pageId
   * Get comments for a page
   */
  @Get('comments/:pageId')
  async getPageComments(
    @Param('pageId') pageId: string,
    @Query()
    query: {
      page?: string;
      limit?: string;
      sortBy?: 'newest' | 'oldest' | 'popular';
    },
  ) {
    const { page, limit, sortBy } = query;

    const result = await this.communityService.getPageComments(pageId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
    });

    return { success: true, data: result };
  }

  /**
   * GET /community/comments/:commentId/replies
   * Get replies for a comment
   */
  @Get('comments/:commentId/replies')
  async getCommentReplies(@Param('commentId') commentId: string) {
    const replies = await this.communityService.getCommentReplies(commentId);
    return { success: true, data: replies };
  }

  /**
   * PUT /community/comments/:id
   * Edit a comment
   */
  @Put('comments/:id')
  async updateComment(
    @Param('id') id: string,
    @Body() body: { content: string },
    @CurrentUser() user: any,
  ) {
    const { content } = body;
    const userInfo = this.getUserInfo(user);

    if (!content || content.length > 5000) {
      throw new BadRequestException('Invalid content');
    }

    const comment = await this.communityService.updateComment(
      id,
      userInfo.userId,
      content,
      userInfo.isAdmin,
    );

    if (!comment) {
      throw new NotFoundException('Comment not found or unauthorized');
    }

    return { success: true, data: comment };
  }

  /**
   * DELETE /community/comments/:id
   * Delete a comment
   */
  @Delete('comments/:id')
  async deleteComment(@Param('id') id: string, @CurrentUser() user: any) {
    const userInfo = this.getUserInfo(user);

    const success = await this.communityService.deleteComment(
      id,
      userInfo.userId,
      userInfo.isAdmin,
    );

    if (!success) {
      throw new NotFoundException('Comment not found or unauthorized');
    }

    return { success: true };
  }

  /**
   * POST /community/comments/:id/vote
   * Vote on a comment
   */
  @Post('comments/:id/vote')
  async voteComment(
    @Param('id') id: string,
    @Body() body: { voteType: 'up' | 'down' },
    @CurrentUser() user: any,
  ) {
    const { voteType } = body;
    const userInfo = this.getUserInfo(user);

    if (!['up', 'down'].includes(voteType)) {
      throw new BadRequestException('Invalid vote type');
    }

    const comment = await this.communityService.voteComment(
      id,
      userInfo.userId,
      voteType,
    );

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return { success: true, data: comment };
  }

  // ==================== USER EXAMPLES ====================

  /**
   * POST /community/examples
   * Submit a new example
   */
  @Post('examples')
  @HttpCode(HttpStatus.CREATED)
  async createExample(
    @Body()
    body: {
      title: string;
      description: string;
      code: string;
      language: string;
      category: string;
      tags?: string[];
      relatedPageId?: string;
      relatedPagePath?: string;
    },
    @CurrentUser() user: any,
  ) {
    const {
      title,
      description,
      code,
      language,
      category,
      tags,
      relatedPageId,
      relatedPagePath,
    } = body;

    if (!title || !description || !code || !language || !category) {
      throw new BadRequestException('Missing required fields');
    }

    const userInfo = this.getUserInfo(user);
    const example = await this.communityService.createExample({
      title,
      description,
      code,
      language,
      category,
      tags,
      relatedPageId,
      relatedPagePath,
      user: userInfo,
    });

    return { success: true, data: example };
  }

  /**
   * GET /community/examples
   * List examples with filters
   */
  @Get('examples')
  async getExamples(
    @Query()
    query: {
      page?: string;
      limit?: string;
      category?: string;
      language?: string;
      tags?: string;
      sortBy?: 'newest' | 'popular' | 'views';
    },
  ) {
    const { page, limit, category, language, tags, sortBy } = query;

    const result = await this.communityService.getExamples({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      category,
      language,
      tags: tags ? tags.split(',') : undefined,
      sortBy: sortBy as 'newest' | 'popular' | 'views',
    });

    return { success: true, data: result };
  }

  /**
   * GET /community/examples/:id
   * Get example details
   */
  @Get('examples/:id')
  async getExampleById(@Param('id') id: string) {
    const example = await this.communityService.getExampleById(id);

    if (!example) {
      throw new NotFoundException('Example not found');
    }

    return { success: true, data: example };
  }

  /**
   * PUT /community/examples/:id
   * Update an example
   */
  @Put('examples/:id')
  async updateExample(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      code?: string;
      language?: string;
      category?: string;
      tags?: string[];
    },
    @CurrentUser() user: any,
  ) {
    const userInfo = this.getUserInfo(user);
    const example = await this.communityService.updateExample(
      id,
      userInfo.userId,
      body,
    );

    if (!example) {
      throw new NotFoundException('Example not found or unauthorized');
    }

    return { success: true, data: example };
  }

  /**
   * POST /community/examples/:id/vote
   * Vote on an example
   */
  @Post('examples/:id/vote')
  async voteExample(
    @Param('id') id: string,
    @Body() body: { voteType: 'up' | 'down' },
    @CurrentUser() user: any,
  ) {
    const { voteType } = body;
    const userInfo = this.getUserInfo(user);

    if (!['up', 'down'].includes(voteType)) {
      throw new BadRequestException('Invalid vote type');
    }

    const example = await this.communityService.voteExample(
      id,
      userInfo.userId,
      voteType,
    );

    if (!example) {
      throw new NotFoundException('Example not found');
    }

    return { success: true, data: example };
  }

  // ==================== DISCUSSIONS ====================

  /**
   * POST /community/discussions
   * Create a new discussion
   */
  @Post('discussions')
  @HttpCode(HttpStatus.CREATED)
  async createDiscussion(
    @Body()
    body: {
      title: string;
      content: string;
      category: string;
      tags?: string[];
      relatedPageId?: string;
      relatedPagePath?: string;
    },
    @CurrentUser() user: any,
  ) {
    const { title, content, category, tags, relatedPageId, relatedPagePath } =
      body;

    if (!title || !content || !category) {
      throw new BadRequestException('Missing required fields');
    }

    const userInfo = this.getUserInfo(user);
    const discussion = await this.communityService.createDiscussion({
      title,
      content,
      category,
      tags,
      relatedPageId,
      relatedPagePath,
      user: userInfo,
    });

    return { success: true, data: discussion };
  }

  /**
   * GET /community/discussions
   * List discussions
   */
  @Get('discussions')
  async getDiscussions(
    @Query()
    query: {
      page?: string;
      limit?: string;
      category?: string;
      tags?: string;
      sortBy?: 'newest' | 'active' | 'popular';
    },
  ) {
    const { page, limit, category, tags, sortBy } = query;

    const result = await this.communityService.getDiscussions({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      category,
      tags: tags ? tags.split(',') : undefined,
      sortBy: sortBy as 'newest' | 'active' | 'popular',
    });

    return { success: true, data: result };
  }

  /**
   * GET /community/discussions/:id
   * Get discussion with replies
   */
  @Get('discussions/:id')
  async getDiscussionById(@Param('id') id: string) {
    const discussion = await this.communityService.getDiscussionById(id);

    if (!discussion) {
      throw new NotFoundException('Discussion not found');
    }

    return { success: true, data: discussion };
  }

  /**
   * POST /community/discussions/:id/replies
   * Add reply to discussion
   */
  @Post('discussions/:id/replies')
  @HttpCode(HttpStatus.CREATED)
  async addReply(
    @Param('id') id: string,
    @Body() body: { content: string },
    @CurrentUser() user: any,
  ) {
    const { content } = body;

    if (!content || content.length > 10000) {
      throw new BadRequestException('Invalid content');
    }

    const userInfo = this.getUserInfo(user);
    const discussion = await this.communityService.addReply(id, {
      content,
      user: userInfo,
    });

    if (!discussion) {
      throw new NotFoundException('Discussion not found or locked');
    }

    return { success: true, data: discussion };
  }

  /**
   * POST /community/discussions/:id/vote
   * Vote on a discussion
   */
  @Post('discussions/:id/vote')
  async voteDiscussion(
    @Param('id') id: string,
    @Body() body: { voteType: 'up' | 'down' },
    @CurrentUser() user: any,
  ) {
    const { voteType } = body;
    const userInfo = this.getUserInfo(user);

    if (!['up', 'down'].includes(voteType)) {
      throw new BadRequestException('Invalid vote type');
    }

    const discussion = await this.communityService.voteDiscussion(
      id,
      userInfo.userId,
      voteType,
    );

    if (!discussion) {
      throw new NotFoundException('Discussion not found');
    }

    return { success: true, data: discussion };
  }

  // ==================== STATISTICS ====================

  /**
   * GET /community/stats
   * Get community statistics
   */
  @Get('stats')
  async getCommunityStats() {
    const stats = await this.communityService.getCommunityStats();
    return { success: true, data: stats };
  }
}
