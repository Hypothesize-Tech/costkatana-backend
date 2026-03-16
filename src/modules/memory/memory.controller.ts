import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { LoggerService } from '../../common/logger/logger.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { MemoryService } from './services/memory.service';
import { UserPreferenceService } from './services/user-preference.service';
import { MemoryDatabaseService } from './services/memory-database.service';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { ConversationIdParamDto } from './dto/conversation-id-param.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { ConversationHistoryQueryDto } from './dto/conversation-history-query.dto';
import { SimilarConversationsQueryDto } from './dto/similar-conversations-query.dto';
import { RecommendationsQueryDto } from './dto/recommendations-query.dto';
import { ArchiveConversationDto } from './dto/archive-conversation.dto';
import { DeleteConversationDto } from './dto/delete-conversation.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller('api/memory')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly userPreferenceService: UserPreferenceService,
    private readonly memoryDatabaseService: MemoryDatabaseService,
    private readonly loggerService: LoggerService,
    private readonly businessEventLoggingService: BusinessEventLoggingService,
  ) {}

  /**
   * GET /api/memory/:userId/insights
   * Get user memory insights
   */
  @Get(':userId/insights')
  async getMemoryInsights(
    @Param() params: UserIdParamDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Memory insights retrieval initiated', {
      userId,
      requestId,
    });

    try {
      const insights = await this.memoryService.getUserMemoryInsights(userId);
      const duration = Date.now() - startTime;

      this.loggerService.info('Memory insights retrieved successfully', {
        userId,
        duration,
        insightsCount: insights.length,
        hasInsights: !!insights && insights.length > 0,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'memory_insights_retrieved',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          insightsCount: insights.length,
          hasInsights: !!insights && insights.length > 0,
        },
      });

      return {
        success: true,
        data: {
          insights,
          totalInsights: insights.length,
          lastUpdated: new Date(),
        },
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Memory insights retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('Memory insights retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to retrieve memory insights',
      );
    }
  }

  /**
   * GET /api/memory/:userId/preferences
   * Get user preferences with parallel data fetching
   */
  @Get(':userId/preferences')
  async getUserPreferences(
    @Param() params: UserIdParamDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('User preferences retrieval initiated', {
      userId,
      requestId,
    });

    try {
      // Parallel data fetching for better performance
      const [preferences, preferenceSummary] = await Promise.all([
        this.userPreferenceService.getUserPreferences(userId),
        this.userPreferenceService.getPreferenceSummary(userId),
      ]);

      const duration = Date.now() - startTime;

      this.loggerService.info('User preferences retrieved successfully', {
        userId,
        duration,
        hasPreferences: !!preferences,
        hasPreferenceSummary: !!preferenceSummary,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'user_preferences_retrieved',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          hasPreferences: !!preferences,
          hasPreferenceSummary: !!preferenceSummary,
        },
      });

      return {
        success: true,
        data: {
          preferences: preferences || {},
          summary: preferenceSummary,
          hasPreferences: !!preferences,
        },
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('User preferences retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('User preferences retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to retrieve user preferences',
      );
    }
  }

  /**
   * PUT /api/memory/:userId/preferences
   * Update user preferences
   */
  @Put(':userId/preferences')
  async updateUserPreferences(
    @Param() params: UserIdParamDto,
    @Body() updates: UpdatePreferencesDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('User preferences update initiated', {
      userId,
      requestId,
    });

    try {
      await this.userPreferenceService.updatePreferences(userId, updates);
      const updatedPreferences =
        await this.userPreferenceService.getUserPreferences(userId);

      const duration = Date.now() - startTime;

      this.loggerService.info('User preferences updated successfully', {
        userId,
        duration,
        hasUpdates: !!updates,
        updateKeys: updates ? Object.keys(updates) : [],
        hasUpdatedPreferences: !!updatedPreferences,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'user_preferences_updated',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          hasUpdates: !!updates,
          updateKeys: updates ? Object.keys(updates) : [],
          hasUpdatedPreferences: !!updatedPreferences,
        },
      });

      return {
        success: true,
        message: 'Preferences updated successfully',
        data: updatedPreferences,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('User preferences update failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('User preferences update failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to update user preferences',
      );
    }
  }

  /**
   * GET /api/memory/:userId/conversations
   * Get conversation history with memory context
   */
  @Get(':userId/conversations')
  async getConversationHistory(
    @Param() params: UserIdParamDto,
    @Query() query: ConversationHistoryQueryDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { userId } = params;
    const { limit = 20, page = 1, includeArchived = false } = query;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Conversation history retrieval initiated', {
      userId,
      limit,
      page,
      includeArchived,
      requestId,
    });

    try {
      const skip = (Number(page) - 1) * Number(limit);
      const queryFilter: any = { userId };

      if (!includeArchived) {
        queryFilter.isArchived = false;
      }

      const [conversations, totalCount] = await Promise.all([
        this.memoryDatabaseService
          .findConversations(queryFilter)
          .then((convs) => convs.slice(0, Number(limit)).slice(skip)),
        this.memoryDatabaseService.countConversations(queryFilter),
      ]);

      const duration = Date.now() - startTime;

      this.loggerService.info('Conversation history retrieved successfully', {
        userId,
        duration,
        limit: Number(limit),
        page: Number(page),
        includeArchived: Boolean(includeArchived),
        conversationsCount: conversations.length,
        totalCount,
        hasConversations: !!conversations && conversations.length > 0,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'conversation_history_retrieved',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          limit: Number(limit),
          page: Number(page),
          includeArchived: Boolean(includeArchived),
          conversationsCount: conversations.length,
          totalCount,
          hasConversations: !!conversations && conversations.length > 0,
        },
      });

      return {
        success: true,
        data: {
          conversations,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: totalCount,
            totalPages: Math.ceil(totalCount / Number(limit)),
          },
        },
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Conversation history retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('Conversation history retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to retrieve conversation history',
      );
    }
  }

  /**
   * GET /api/memory/:userId/similar
   * Get similar conversations
   */
  @Get(':userId/similar')
  async getSimilarConversations(
    @Param() params: UserIdParamDto,
    @Query() query: SimilarConversationsQueryDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { userId } = params;
    const { query: searchQuery, limit = 5 } = query;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Similar conversations retrieval initiated', {
      userId,
      query: searchQuery,
      limit,
      requestId,
    });

    try {
      const similarConversations =
        await this.memoryService.getSimilarConversations(
          userId,
          searchQuery,
          Number(limit),
        );

      const duration = Date.now() - startTime;

      this.loggerService.info('Similar conversations retrieved successfully', {
        userId,
        duration,
        query: searchQuery,
        limit: Number(limit),
        similarConversationsCount: similarConversations.length,
        hasSimilarConversations:
          !!similarConversations && similarConversations.length > 0,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'similar_conversations_retrieved',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          query: searchQuery,
          limit: Number(limit),
          similarConversationsCount: similarConversations.length,
          hasSimilarConversations:
            !!similarConversations && similarConversations.length > 0,
        },
      });

      return {
        success: true,
        data: {
          similarConversations,
          query: searchQuery,
          totalFound: similarConversations.length,
        },
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Similar conversations retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('Similar conversations retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to retrieve similar conversations',
      );
    }
  }

  /**
   * GET /api/memory/:userId/recommendations
   * Get personalized recommendations
   */
  @Get(':userId/recommendations')
  async getPersonalizedRecommendations(
    @Param() params: UserIdParamDto,
    @Query() query: RecommendationsQueryDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { userId } = params;
    const { query: searchQuery } = query;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info(
      'Personalized recommendations retrieval initiated',
      {
        userId,
        query: searchQuery,
        requestId,
      },
    );

    try {
      const recommendations =
        await this.memoryService.getPersonalizedRecommendations(
          userId,
          searchQuery,
        );

      const duration = Date.now() - startTime;

      this.loggerService.info(
        'Personalized recommendations retrieved successfully',
        {
          userId,
          duration,
          query: searchQuery,
          recommendationsCount: recommendations.length,
          hasRecommendations: !!recommendations && recommendations.length > 0,
          requestId,
        },
      );

      this.businessEventLoggingService.logBusiness({
        event: 'personalized_recommendations_retrieved',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          query: searchQuery,
          recommendationsCount: recommendations.length,
          hasRecommendations: !!recommendations && recommendations.length > 0,
        },
      });

      return {
        success: true,
        data: {
          recommendations,
          query: searchQuery,
          totalRecommendations: recommendations.length,
        },
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Personalized recommendations retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error(
        'Personalized recommendations retrieval failed',
        {
          error: err.message,
          userId,
          duration,
          requestId,
        },
      );

      throw new InternalServerErrorException(
        'Failed to retrieve personalized recommendations',
      );
    }
  }

  /**
   * PUT /api/memory/conversations/:conversationId/archive
   * Archive a conversation
   */
  @Put('conversations/:conversationId/archive')
  async archiveConversation(
    @Param() params: ConversationIdParamDto,
    @Body() body: ArchiveConversationDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { conversationId } = params;
    const { userId } = body;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Conversation archive initiated', {
      conversationId,
      userId,
      requestId,
    });

    try {
      const conversation =
        await this.memoryDatabaseService.findOneAndUpdateConversation(
          { _id: conversationId, userId },
          { isArchived: true, updatedAt: new Date() },
          { new: true },
        );

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const duration = Date.now() - startTime;

      this.loggerService.info('Conversation archived successfully', {
        conversationId,
        userId,
        duration,
        hasConversation: !!conversation,
        isArchived: (conversation as any).isArchived,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'conversation_archived',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          conversationId,
          hasConversation: !!conversation,
          isArchived: (conversation as any).isArchived,
        },
      });

      return {
        success: true,
        message: 'Conversation archived successfully',
        data: conversation,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Conversation archive failed', {
        error: err.message,
        conversationId,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('Conversation archive failed', {
        error: err.message,
        conversationId,
        userId,
        duration,
        requestId,
      });

      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to archive conversation');
    }
  }

  /**
   * DELETE /api/memory/conversations/:conversationId
   * Delete a conversation
   */
  @Delete('conversations/:conversationId')
  async deleteConversation(
    @Param() params: ConversationIdParamDto,
    @Body() body: DeleteConversationDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { conversationId } = params;
    const { userId } = body;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Conversation deletion initiated', {
      conversationId,
      userId,
      requestId,
    });

    try {
      const conversation =
        await this.memoryDatabaseService.findOneAndDeleteConversation({
          _id: conversationId,
          userId,
        });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      // Also remove from vector storage
      await this.memoryService.clearUserMemory(userId); // This will also clear vector storage

      const duration = Date.now() - startTime;

      this.loggerService.info('Conversation deleted successfully', {
        conversationId,
        userId,
        duration,
        hasConversation: !!conversation,
        vectorStorageCleared: true,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'conversation_deleted',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          conversationId,
          hasConversation: !!conversation,
          vectorStorageCleared: true,
        },
      });

      return {
        success: true,
        message: 'Conversation deleted successfully',
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Conversation deletion failed', {
        error: err.message,
        conversationId,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('Conversation deletion failed', {
        error: err.message,
        conversationId,
        userId,
        duration,
        requestId,
      });

      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete conversation');
    }
  }

  /**
   * DELETE /api/memory/:userId/preferences
   * Reset user preferences
   */
  @Delete(':userId/preferences')
  async resetPreferences(@Param() params: UserIdParamDto, @Req() req: Request) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('User preferences reset initiated', {
      userId,
      requestId,
    });

    try {
      await this.userPreferenceService.resetPreferences(userId);

      const duration = Date.now() - startTime;

      this.loggerService.info('User preferences reset successfully', {
        userId,
        duration,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'user_preferences_reset',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
        },
      });

      return {
        success: true,
        message: 'User preferences reset successfully',
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('User preferences reset failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('User preferences reset failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to reset user preferences',
      );
    }
  }

  /**
   * DELETE /api/memory/:userId/clear
   * Clear all user memory (GDPR compliance)
   */
  @Delete(':userId/clear')
  async clearUserMemory(@Param() params: UserIdParamDto, @Req() req: Request) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('User memory clear initiated', {
      userId,
      requestId,
    });

    try {
      await this.memoryService.clearUserMemory(userId);

      const duration = Date.now() - startTime;

      this.loggerService.info('User memory cleared successfully', {
        userId,
        duration,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'user_memory_cleared',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
        },
      });

      return {
        success: true,
        message: 'All user memory cleared successfully',
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('User memory clear failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('User memory clear failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException('Failed to clear user memory');
    }
  }

  /**
   * GET /api/memory/:userId/export
   * Export user memory data (GDPR compliance)
   */
  @Get(':userId/export')
  async exportUserData(@Param() params: UserIdParamDto, @Req() req: Request) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('User data export initiated', {
      userId,
      requestId,
    });

    try {
      // Use streaming approach for large datasets and parallel fetching
      const [preferences, insights] = await Promise.all([
        this.userPreferenceService.exportPreferences(userId),
        this.memoryService.getUserMemoryInsights(userId),
      ]);

      // Stream conversations and memories to avoid memory issues
      const [conversations, memories] = await Promise.all([
        this.memoryDatabaseService
          .findConversations({ userId })
          .then((convs) => convs.slice(0, 1000)), // Limit for performance
        this.memoryDatabaseService.findUserMemories({ userId }),
      ]);

      const exportData = {
        userId,
        exportDate: new Date(),
        preferences,
        conversations,
        memories,
        insights,
        dataLimits: {
          conversationsIncluded: Math.min(conversations.length, 1000),
          memoriesIncluded: Math.min(memories.length, 1000),
          note:
            conversations.length >= 1000 || memories.length >= 1000
              ? 'Large datasets limited for performance. Contact support for full export.'
              : 'Complete dataset included',
        },
      };

      const duration = Date.now() - startTime;

      this.loggerService.info('User data exported successfully', {
        userId,
        duration,
        hasPreferences: !!preferences,
        conversationsCount: conversations.length,
        memoriesCount: memories.length,
        insightsCount: insights.length,
        requestId,
      });

      this.businessEventLoggingService.logBusiness({
        event: 'user_data_exported',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          hasPreferences: !!preferences,
          conversationsCount: conversations.length,
          memoriesCount: memories.length,
          insightsCount: insights.length,
        },
      });

      return {
        success: true,
        data: exportData,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('User data export failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('User data export failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException('Failed to export user data');
    }
  }

  /**
   * GET /api/memory/:userId/stats
   * Get memory storage statistics
   */
  @Get(':userId/stats')
  async getStorageStats(@Param() params: UserIdParamDto, @Req() req: Request) {
    const startTime = Date.now();
    const { userId } = params;
    const requestId = (req.headers['x-request-id'] as string) ?? undefined;

    this.loggerService.info('Memory storage statistics retrieval initiated', {
      userId,
      requestId,
    });

    try {
      // Use aggregation for better performance and parallel execution
      const [storageStats] = await Promise.all([
        // Single aggregation query to get all counts
        Promise.all([
          this.memoryDatabaseService.aggregateConversations([
            { $match: { userId } },
            {
              $group: {
                _id: null,
                conversationCount: { $sum: 1 },
                conversationSize: { $sum: { $strLenCP: '$query' } },
              },
            },
          ]),
          this.memoryDatabaseService.aggregateUserMemories([
            { $match: { userId } },
            {
              $group: {
                _id: null,
                memoryCount: { $sum: 1 },
                memorySize: { $sum: { $strLenCP: '$content' } },
              },
            },
          ]),
          this.memoryDatabaseService.existsUserPreference({ userId }),
        ]),
      ]);

      const [conversationStats, memoryStats, preferenceExists] = storageStats;
      const conversationCount = conversationStats[0]?.conversationCount || 0;
      const memoryCount = memoryStats[0]?.memoryCount || 0;
      const conversationSize = conversationStats[0]?.conversationSize || 0;
      const memorySize = memoryStats[0]?.memorySize || 0;

      const duration = Date.now() - startTime;

      this.loggerService.info(
        'Memory storage statistics retrieved successfully',
        {
          userId,
          duration,
          conversationCount,
          memoryCount,
          hasPreferences: !!preferenceExists,
          requestId,
        },
      );

      this.businessEventLoggingService.logBusiness({
        event: 'memory_storage_statistics_retrieved',
        category: 'memory_operations',
        value: duration,
        metadata: {
          userId,
          conversationCount,
          memoryCount,
          hasPreferences: !!preferenceExists,
        },
      });

      return {
        success: true,
        data: {
          userId,
          conversationCount,
          memoryCount,
          hasPreferences: !!preferenceExists,
          storageSize: {
            conversations: `${(conversationSize / 1024).toFixed(2)} KB`,
            memories: `${(memorySize / 1024).toFixed(2)} KB`,
            total: `${((conversationSize + memorySize) / 1024).toFixed(2)} KB`,
          },
          lastUpdated: new Date(),
        },
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error('Memory storage statistics retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });
      this.loggerService.error('Memory storage statistics retrieval failed', {
        error: err.message,
        userId,
        duration,
        requestId,
      });

      throw new InternalServerErrorException(
        'Failed to retrieve memory storage statistics',
      );
    }
  }
}
