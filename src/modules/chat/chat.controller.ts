import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ValidationPipe,
  ParseIntPipe,
  DefaultValuePipe,
  Res,
  Req,
  Logger,
  HttpException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectModel } from '@nestjs/mongoose';
import { Response, Request } from 'express';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ChatMentionsInterceptor } from './interceptors/chat-mentions.interceptor';
import { ControllerHelper } from '../../common/services/controller-helper.service';
import { ChatService } from './services/chat.service';
import { ChatSSEService } from './services/chat-sse.service';
import { StorageService } from '../storage/storage.service';
import { WebSearchService } from './services/web-search.service';
import { ChatSecurityHandlerService } from '../analytics/services/chat-security-handler.service';
import { LinkMetadataEnricher } from './utils/link-metadata-enricher';
import {
  SendMessageDto,
  CreateConversationDto,
  RenameConversationDto,
  ArchiveConversationDto,
  PinConversationDto,
  UpdateGitHubContextDto,
  UpdateVercelContextDto,
  UpdateMongoDBContextDto,
  UpdateConversationModelDto,
  UpdateMessageViewTypeDto,
  UpdateMessageFeedbackDto,
  ResolveMessageTemplateDto,
  UpdateMessageDto,
  ModifyPlanDto,
  AskAboutPlanDto,
  RequestCodeChangesDto,
  WebSearchQuotaDto,
} from './dto';
import {
  ChatTaskLink,
  ChatTaskLinkDocument,
} from '../../schemas/chat/chat-task-link.schema';
import {
  GovernedTask,
  GovernedTaskDocument,
} from '../../schemas/agent/governed-task.schema';

interface AuthenticatedUser {
  id: string;
  _id?: string;
  email?: string;
}

@ApiTags('Chat')
@Controller('api/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatSSEService: ChatSSEService,
    private readonly webSearchService: WebSearchService,
    private readonly chatSecurityHandler: ChatSecurityHandlerService,
    private readonly linkMetadataEnricher: LinkMetadataEnricher,
    private readonly controllerHelper: ControllerHelper,
    private readonly storageService: StorageService,
    @InjectModel(ChatTaskLink.name)
    private readonly chatTaskLinkModel: Model<ChatTaskLinkDocument>,
    @InjectModel(GovernedTask.name)
    private readonly governedTaskModel: Model<GovernedTaskDocument>,
  ) {}

  /**
   * Get available chat models (public endpoint)
   * GET /chat/models
   * Returns Express-compatible format: { success, data }
   */
  @ApiOperation({
    summary: 'Get available AI models',
    description:
      'Retrieve list of all supported AI models and their capabilities',
  })
  @ApiResponse({ status: 200, description: 'Models retrieved successfully' })
  @Get('models')
  @Public()
  async getAvailableModels() {
    const models = await this.chatService.getAvailableModels();
    return { success: true, data: models };
  }

  /**
   * Send a message and get AI response
   * POST /chat/message
   * Returns Express-compatible format: { success: true, data: { response, messageId, conversationId, ... } }
   */
  @ApiOperation({
    summary: 'Send message to AI',
    description:
      'Send a message to AI and receive a response. Supports streaming, file attachments, and various integrations.',
  })
  @ApiResponse({ status: 200, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: SendMessageDto })
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests per minute
  @Post('message')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(ChatMentionsInterceptor)
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: SendMessageDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const parsedMentions = (request as any).mentions;

    // Store original message for database storage
    const originalMessage = dto.message || '';

    // SECURITY CHECK: Comprehensive threat detection before processing message (single check)
    let enrichedMessage = dto.message;
    if (dto.message) {
      const securityResult =
        await this.chatSecurityHandler.checkMessageSecurity(
          dto.message,
          user.id,
          request,
          dto.maxTokens || 8000,
        );

      // If threat detected, block the request
      if (securityResult.isBlocked) {
        throw new HttpException(
          {
            success: false,
            message:
              securityResult.reason || 'Message blocked by security system',
            error: 'SECURITY_BLOCK',
            threatCategory: securityResult.threatCategory,
            confidence: securityResult.confidence,
            stage: securityResult.stage,
          },
          HttpStatus.FORBIDDEN,
        );
      }

      // AUTO-DETECT AND EXTRACT METADATA FOR LINKS IN MESSAGE (non-blocking)
      const enrichmentResult = await this.linkMetadataEnricher.enrichMessage(
        dto.message,
      );
      enrichedMessage = enrichmentResult.enrichedMessage;
    }

    // Handle streaming response (token-level streaming - future enhancement)
    if (dto.stream) {
      // Update dto with enriched message
      const enrichedDto = { ...dto, message: enrichedMessage };

      await this.chatSSEService.streamAIResponse(
        user.id,
        enrichedDto,
        parsedMentions,
        request,
        response,
      );
      return;
    }

    // Update dto with enriched message and original message
    const enrichedDto = { ...dto, message: enrichedMessage, originalMessage };

    // Regular non-streaming response
    const result = await this.chatService.sendMessage(
      user.id,
      enrichedDto,
      parsedMentions,
      request,
    );

    // Log business event (matching Express pattern)
    this.controllerHelper.logBusinessEvent(
      'chat_message_sent',
      'chat',
      user.id,
      undefined,
      {
        conversationId: result.conversationId,
        messageId: result.id,
        modelId: result.modelId,
        hasAttachments: enrichedDto.attachments?.length || 0,
        agentPath: result.agentPath,
        optimizationsApplied: result.optimizationsApplied,
      },
    );

    const data = {
      ...result,
      response: result.content,
      messageId: result.id,
      mongodbIntegrationData:
        (result as any).mongodbIntegrationData ?? undefined,
      formattedResult: (result as any).formattedResult ?? undefined,
    };

    response.json({ success: true, data });
  }

  /**
   * Create a new conversation
   * POST /chat/conversations
   */
  @ApiOperation({
    summary: 'Create conversation',
    description:
      'Create a new chat conversation with specified model and title',
  })
  @ApiResponse({
    status: 201,
    description: 'Conversation created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: CreateConversationDto })
  @Post('conversations')
  async createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateConversationDto,
  ) {
    const conversation = await this.chatService.createConversation(
      user.id,
      dto,
    );
    return {
      success: true,
      data: {
        conversationId: conversation._id.toString(),
        title: conversation.title,
        modelId: conversation.modelId,
      },
      message: 'Conversation created successfully',
    };
  }

  /**
   * Get user's conversations with pagination
   * GET /chat/conversations
   * Returns Express-compatible format: { success, data: { conversations, total } }
   */
  @Get('conversations')
  async getUserConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const result = await this.chatService.getUserConversations(
      user.id,
      limit,
      offset,
      includeArchived === 'true',
    );
    return {
      success: true,
      data: {
        conversations: result.conversations,
        total: result.pagination.total,
      },
    };
  }

  /**
   * Get conversation history
   * GET /chat/conversations/:conversationId/history
   */
  @Get('conversations/:conversationId/history')
  async getConversationHistory(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const result = await this.chatService.getConversationHistory(
      conversationId,
      user.id,
      limit,
      offset,
    );
    return { success: true, data: result };
  }

  /**
   * Update GitHub context for a conversation
   * PATCH /chat/conversations/:conversationId/github-context
   */
  @Patch('conversations/:conversationId/github-context')
  async updateGitHubContext(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateGitHubContextDto,
  ) {
    await this.chatService.updateGitHubContext(conversationId, user.id, dto);
    return {
      success: true,
      message: 'GitHub context updated successfully',
    };
  }

  /**
   * Update Vercel context for a conversation
   * PATCH /chat/conversations/:conversationId/vercel-context
   */
  @Patch('conversations/:conversationId/vercel-context')
  async updateVercelContext(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateVercelContextDto,
  ) {
    await this.chatService.updateVercelContext(conversationId, user.id, dto);
    return {
      success: true,
      message: 'Vercel context updated successfully',
    };
  }

  /**
   * Update MongoDB context for a conversation
   * PATCH /chat/conversations/:conversationId/mongodb-context
   */
  @Patch('conversations/:conversationId/mongodb-context')
  async updateMongoDBContext(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateMongoDBContextDto,
  ) {
    await this.chatService.updateMongoDBContext(conversationId, user.id, dto);
    return {
      success: true,
      message: 'MongoDB context updated successfully',
    };
  }

  /**
   * Update conversation model
   * PATCH /chat/conversations/:conversationId/model
   */
  @Patch('conversations/:conversationId/model')
  async updateConversationModel(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true }))
    dto: UpdateConversationModelDto,
  ) {
    await this.chatService.updateConversationModel(
      conversationId,
      user.id,
      dto.modelId,
    );
    return {
      success: true,
      message: 'Conversation model updated successfully',
    };
  }

  /**
   * Delete a conversation (soft delete)
   * DELETE /chat/conversations/:conversationId
   */
  @Delete('conversations/:conversationId')
  async deleteConversation(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.chatService.deleteConversation(conversationId, user.id);
    return {
      success: true,
      message: 'Conversation deleted successfully',
    };
  }

  /**
   * Rename a conversation
   * PUT /chat/conversations/:id/rename
   */
  @Put('conversations/:id/rename')
  async renameConversation(
    @Param('id') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: RenameConversationDto,
  ) {
    const updatedConversation = await this.chatService.renameConversation(
      conversationId,
      user.id,
      dto.title,
    );
    return {
      success: true,
      data: updatedConversation,
    };
  }

  /**
   * Archive/unarchive a conversation
   * PUT /chat/conversations/:id/archive
   */
  @Put('conversations/:id/archive')
  async archiveConversation(
    @Param('id') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: ArchiveConversationDto,
  ) {
    const updatedConversation = await this.chatService.archiveConversation(
      conversationId,
      user.id,
      dto.archived,
    );
    return {
      success: true,
      data: updatedConversation,
    };
  }

  /**
   * Pin/unpin a conversation
   * PUT /chat/conversations/:id/pin
   */
  @Put('conversations/:id/pin')
  async pinConversation(
    @Param('id') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: PinConversationDto,
  ) {
    const updatedConversation = await this.chatService.pinConversation(
      conversationId,
      user.id,
      dto.pinned,
    );
    return {
      success: true,
      data: updatedConversation,
    };
  }

  /**
   * Modify a governed plan
   * POST /chat/:chatId/plan/modify
   */
  @Post(':chatId/plan/modify')
  async modifyPlan(
    @Param('chatId') chatId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: ModifyPlanDto,
  ) {
    const updatedTask = await this.chatService.modifyPlan(
      chatId,
      dto.taskId,
      user.id,
      dto.modifications,
    );
    return {
      success: true,
      data: updatedTask,
    };
  }

  /**
   * Ask a question about a governed plan
   * POST /chat/:chatId/plan/question
   */
  @Post(':chatId/plan/question')
  async askAboutPlan(
    @Param('chatId') chatId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: AskAboutPlanDto,
  ) {
    const answer = await this.chatService.askAboutPlan(
      chatId,
      dto.taskId,
      user.id,
      { question: dto.question },
    );
    return {
      success: true,
      data: {
        question: dto.question,
        answer,
      },
    };
  }

  /**
   * Request code changes for a completed task
   * POST /chat/:chatId/plan/:taskId/redeploy
   */
  @Post(':chatId/plan/:taskId/redeploy')
  async requestCodeChanges(
    @Param('chatId') chatId: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: RequestCodeChangesDto,
  ) {
    const newTask = await this.chatService.requestCodeChanges(
      chatId,
      taskId,
      user.id,
      dto,
    );
    return {
      success: true,
      data: newTask,
      message: 'Code changes requested successfully',
    };
  }

  /**
   * Get all plans in a chat
   * GET /chat/:chatId/plans
   */
  @Get(':chatId/plans')
  async getChatPlans(
    @Param('chatId') chatId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const plans = await this.chatService.getChatPlans(chatId, user.id);
    return {
      success: true,
      data: { plans },
      message: `Found ${plans.length} plans in this chat`,
    };
  }

  /**
   * Stream chat updates via SSE
   * GET /chat/:chatId/stream
   */
  @Get(':chatId/stream')
  async streamChatUpdates(
    @Param('chatId') chatId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    await this.chatSSEService.streamChatUpdates(chatId, user.id, res);
  }

  /**
   * Get a specific conversation
   * GET /api/chat/conversations/:conversationId
   */
  @Get('conversations/:conversationId')
  async getConversation(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.chatService.getConversation(
      conversationId,
      user.id,
    );
    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * Clear conversation context
   * DELETE /api/chat/conversations/:conversationId/context
   */
  @Delete('conversations/:conversationId/context')
  async clearConversationContext(
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.chatService.clearConversationContext(conversationId, user.id);
    return {
      success: true,
      message: 'Conversation context cleared successfully',
    };
  }

  /**
   * Resolve message with template
   * POST /api/chat/message/resolve-template
   */
  @Post('message/resolve-template')
  async resolveMessageWithTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true }))
    dto: ResolveMessageTemplateDto,
  ) {
    const result = await this.chatService.resolveMessageWithTemplate(
      user.id,
      dto.templateId,
      dto.variables,
      dto.context,
    );
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Get user preferences
   * GET /api/chat/preferences
   */
  @Get('preferences')
  async getUserPreferences(@CurrentUser() user: AuthenticatedUser) {
    const preferences = await this.chatService.getUserPreferences(user.id);
    return {
      success: true,
      data: preferences,
    };
  }

  /**
   * Update message view type for MongoDB results
   * PATCH /api/chat/message/:messageId/viewType
   */
  @Patch('message/:messageId/viewType')
  async updateMessageViewType(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true }))
    dto: UpdateMessageViewTypeDto,
  ) {
    await this.chatService.updateMessageViewType(messageId, user.id, dto);
    return {
      success: true,
      message: 'Message view type updated successfully',
    };
  }

  /**
   * Update message feedback (thumbs up/down)
   * PATCH /api/chat/message/:messageId/feedback
   */
  @Patch('message/:messageId/feedback')
  async updateMessageFeedback(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true }))
    dto: UpdateMessageFeedbackDto,
  ) {
    await this.chatService.updateMessageFeedback(messageId, user.id, dto);
    return {
      success: true,
      message: 'Message feedback updated successfully',
    };
  }

  /**
   * Get web search quota status
   * GET /api/chat/web-search/quota
   */
  @ApiOperation({
    summary: 'Get web search quota status',
    description: 'Retrieve current web search usage and daily limit',
  })
  @ApiResponse({
    status: 200,
    description: 'Quota status retrieved successfully',
    type: WebSearchQuotaDto,
  })
  @Get('web-search/quota')
  async getWebSearchQuota(): Promise<{
    success: boolean;
    data: WebSearchQuotaDto;
  }> {
    const quota = await this.webSearchService.getQuotaStatus();
    const remaining = quota.limit - quota.count;

    return {
      success: true,
      data: {
        ...quota,
        remaining: Math.max(0, remaining),
      },
    };
  }

  /**
   * Get a single message by ID
   * GET /api/chat/messages/:messageId
   */
  @Get('messages/:messageId')
  async getMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const message = await this.chatService.getMessage(messageId, user.id);

    if (!message) {
      throw new HttpException(
        {
          success: false,
          message: 'Message not found',
          error: 'MESSAGE_NOT_FOUND',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      success: true,
      data: {
        message: {
          id: message._id.toString(),
          conversationId: message.conversationId.toString(),
          role: message.role,
          content: message.content,
          modelId: message.modelId,
          timestamp: message.createdAt,
          attachments: message.attachments,
          metadata: message.metadata,
          agentPath: message.agentPath,
          optimizationsApplied: message.optimizationsApplied,
          cacheHit: message.cacheHit,
          riskLevel: message.riskLevel,
          // Include integration data fields
          mongodbIntegrationData: message.mongodbIntegrationData,
          githubIntegrationData: message.githubIntegrationData,
          vercelIntegrationData: message.vercelIntegrationData,
          slackIntegrationData: message.slackIntegrationData,
          discordIntegrationData: message.discordIntegrationData,
          jiraIntegrationData: message.jiraIntegrationData,
          linearIntegrationData: message.linearIntegrationData,
          googleIntegrationData: message.googleIntegrationData,
          awsIntegrationData: message.awsIntegrationData,
          formattedResult: message.formattedResult,
        },
      },
    };
  }

  /**
   * Update/edit a message
   * PUT /api/chat/messages/:messageId
   */
  @Put('messages/:messageId')
  async updateMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateMessageDto,
  ) {
    const message = await this.chatService.updateMessage(
      messageId,
      user.id,
      dto,
    );

    if (!message) {
      throw new HttpException(
        {
          success: false,
          message: 'Message not found or cannot be edited',
          error: 'MESSAGE_NOT_EDITABLE',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      success: true,
      data: {
        message: {
          id: message._id.toString(),
          conversationId: message.conversationId.toString(),
          role: message.role,
          content: message.content,
          timestamp: message.createdAt,
          attachments: message.attachments,
          metadata: message.metadata,
        },
      },
      message: 'Message updated successfully',
    };
  }

  /**
   * Delete a message (soft delete)
   * DELETE /api/chat/messages/:messageId
   */
  @Delete('messages/:messageId')
  async deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const deleted = await this.chatService.deleteMessage(messageId, user.id);

    if (!deleted) {
      throw new HttpException(
        {
          success: false,
          message: 'Message not found or cannot be deleted',
          error: 'MESSAGE_NOT_DELETABLE',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      success: true,
      message: 'Message deleted successfully',
    };
  }

  /**
   * Upload file for chat attachments
   * POST /api/chat/upload
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new HttpException(
        {
          success: false,
          message: 'No file provided',
          error: 'FILE_REQUIRED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.storageService.uploadChatFile(
        user.id,
        file.originalname,
        file.buffer,
        file.mimetype,
      );

      return {
        success: true,
        data: {
          fileId: result.s3Key,
          url: result.presignedUrl,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        },
        message: 'File uploaded successfully',
      };
    } catch (error) {
      this.logger.error('File upload failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        fileName: file.originalname,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to upload file',
          error: 'UPLOAD_FAILED',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
