import {
  Injectable,
  Inject,
  forwardRef,
  Optional,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../schemas/chat/chat-message.schema';
import { ChatConversationDocument } from '../../../schemas/chat/conversation.schema';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';
import {
  GovernedTask,
  GovernedTaskDocument,
} from '../../../schemas/governed-agent/governed-task.schema';
import {
  ChatTaskLink,
  ChatTaskLinkDocument,
} from '../../../schemas/chat/chat-task-link.schema';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import {
  Document,
  DocumentDocument,
} from '../../../schemas/document/document.schema';
import { LoggerService } from '../../../common/logger/logger.service';
import { SendMessageDto } from '../dto';
import { AIRouterService } from '../../../modules/cortex/services/ai-router.service';
import { AICostTrackingService } from '../../../modules/admin-ai-cost-monitoring/ai-cost-tracking.service';
import { AgentService } from './agent.service';
import { MultiAgentFlowService } from './multi-agent-flow.service';
import { IntegrationChatService } from './integration-chat.service';
import { IntegrationAgentService } from './integration-agent.service';
import { MongoDBChatAgentService } from './mongodb-chat-agent.service';
import { McpIntegrationHandlerService } from './mcp-integration-handler.service';
import { WebSearchService } from './web-search.service';
import { GovernedAgentService } from '../../governed-agent/services/governed-agent.service';
import { AutonomousDetector } from '../utils/autonomous-detector';
import { GovernedPlanMessageCreator } from '../utils/governed-plan-message-creator';
import { ContextManager } from '../context/context.manager';
import { ResponseSanitizerService } from '../utils/response-sanitizer';
import { RouteDecider } from '../utils/route-decider';
import { ContextOptimizer } from '../utils/context-optimizer';
import { LangchainHelpers } from '../utils/langchain-helpers';
import { BedrockService } from '../../../services/bedrock.service';
import { ChatEventsFactoryService } from './chat-events-factory.service';
import { ChatEventsRedisService } from './chat-events-redis.service';
import Redis from 'ioredis';
import { IChatEventsService } from './chat-events.interface';
import { ConversationContext } from '../context';
import {
  AttachmentProcessor,
  AttachmentInput,
} from '../utils/attachment-processor';
import { ModelRegistry } from '../utils/model-registry';
import { PromptTemplateService } from '../../prompt-template/services/prompt-template.service';
import type { MCPHandler } from '../handlers/mcp.handler';
import { WebScraperHandler } from '../handlers/web-scraper.handler';
import { KnowledgeBaseHandler } from '../handlers/knowledge-base.handler';
import { ChatSecurityHandlerService } from '../../analytics/services/chat-security-handler.service';
import { LinkMetadataEnricher } from '../utils/link-metadata-enricher';
import { GithubChatAgentService } from './github-chat-agent.service';
import { VercelChatAgentService } from './vercel-chat-agent.service';
import { AWSChatAgentService } from './aws-chat-agent.service';
import { FallbackHandler } from '../handlers/fallback.handler';
import { UserPreferenceService } from '../../shared-preferences/user-preference.service';
import { HandlerRequest, HandlerResult } from '../handlers/types/handler.types';
import { CostEstimator } from '../utils/cost-estimator';
import { IntegrationDetector } from '../utils/integration-detector';
import { ConnectionChecker } from '../utils/connection-checker';
import { ParsedMention } from '../interceptors/chat-mentions.interceptor';
import { ProcessingContext } from '../handlers/types/handler.types';
import type { LangchainOrchestratorService } from '../langchain/langchain-orchestrator.service';
import { CortexStreamingOrchestratorService } from './cortex-streaming-orchestrator.service';

export interface ChatMessageResponse {
  id: string;
  messageId?: string; // Alias for id to match Express API
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  response?: string; // Alias for content to match Express API
  modelId?: string;
  model?: string; // Alias for modelId to match Express API
  messageType?: 'user' | 'assistant' | 'system' | 'governed_plan';
  governedTaskId?: string;
  planState?: 'SCOPE' | 'CLARIFY' | 'PLAN' | 'BUILD' | 'VERIFY' | 'DONE';
  attachedDocuments?: Array<{
    documentId: string;
    fileName: string;
    chunksCount: number;
    fileType?: string;
  }>;
  attachments?: Array<{
    type: 'uploaded' | 'google';
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileType: string;
    url: string;
  }>;
  timestamp: Date;
  metadata?: {
    temperature?: number;
    maxTokens?: number;
    cost?: number;
    latency?: number;
    tokenCount?: number;
    modelId?: string;
  };
  agentPath?: string[];
  optimizationsApplied?: string[];
  cacheHit?: boolean;
  riskLevel?: string;
  // Express API compatibility fields
  thinking?: string;
  templateUsed?: any;
  webSearchUsed?: boolean;
  aiWebSearchDecision?: string;
  requiresIntegrationSelector?: boolean;
  integrationSelectorData?: any;
  // Integration data fields (persisted on ChatMessage)
  mongodbIntegrationData?: any;
  formattedResult?: any;
  githubIntegrationData?: any;
  vercelIntegrationData?: any;
  slackIntegrationData?: any;
  discordIntegrationData?: any;
  jiraIntegrationData?: any;
  linearIntegrationData?: any;
  googleIntegrationData?: any;
  awsIntegrationData?: any;
  requiresConnection?: any;
  requiresSelection?: boolean;
  selection?: {
    parameterName: string;
    question: string;
    options: Array<{
      id: string;
      label: string;
      value: string;
      description?: string;
      icon?: string;
    }>;
    allowCustom: boolean;
    customPlaceholder?: string;
    integration: string;
    pendingAction: string;
    collectedParams?: Record<string, any>;
    sessionId?: string;
  };
}

export interface ConversationResponse {
  id: string;
  userId: string;
  title: string;
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  lastMessage?: string;
  totalCost?: number;
  isPinned?: boolean;
  isArchived?: boolean;
  githubContext?: {
    connectionId?: string;
    repositoryId?: number;
    repositoryName?: string;
    repositoryFullName?: string;
    integrationId?: string;
    branchName?: string;
  };
  vercelContext?: {
    connectionId?: string;
    projectId?: string;
    projectName?: string;
  };
}

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel('ChatConversation')
    private conversationModel: Model<ChatConversationDocument>,
    @InjectModel(ChatTaskLink.name)
    private chatTaskLinkModel: Model<ChatTaskLinkDocument>,
    @InjectModel(Document.name)
    private documentModel: Model<DocumentDocument>,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @InjectModel(GitHubConnection.name)
    private githubConnectionModel: Model<GitHubConnectionDocument>,
    private readonly logger: LoggerService,
    private readonly agentService: AgentService,
    private readonly multiAgentFlowService: MultiAgentFlowService,
    private readonly integrationChatService: IntegrationChatService,
    private readonly integrationAgentService: IntegrationAgentService,
    private readonly mongodbChatAgentService: MongoDBChatAgentService,
    private readonly mcpIntegrationHandler: McpIntegrationHandlerService,
    private readonly webSearchService: WebSearchService,
    @Inject(forwardRef(() => GovernedAgentService))
    private readonly governedAgentService: GovernedAgentService,
    private readonly autonomousDetector: AutonomousDetector,
    private readonly governedPlanMessageCreator: GovernedPlanMessageCreator,
    private readonly contextManager: ContextManager,
    private readonly routeDecider: RouteDecider,
    private readonly contextOptimizer: ContextOptimizer,
    private readonly langchainHelpers: LangchainHelpers,
    private readonly attachmentProcessor: AttachmentProcessor,
    private readonly modelRegistry: ModelRegistry,
    private readonly chatEventsFactory: ChatEventsFactoryService,
    @Inject(forwardRef(() => require('../handlers/mcp.handler').MCPHandler))
    private readonly mcpHandler: MCPHandler,
    private readonly chatSecurityHandler: ChatSecurityHandlerService,
    private readonly linkMetadataEnricher: LinkMetadataEnricher,
    private readonly githubChatAgent: GithubChatAgentService,
    private readonly vercelChatAgent: VercelChatAgentService,
    private readonly awsChatAgent: AWSChatAgentService,
    private readonly bedrockService: BedrockService,
    private readonly userPreferenceService: UserPreferenceService,
    private readonly webScraperHandler: WebScraperHandler,
    private readonly knowledgeBaseHandler: KnowledgeBaseHandler,
    private readonly fallbackHandler: FallbackHandler,
    private readonly costEstimator: CostEstimator,
    private readonly connectionChecker: ConnectionChecker,
    private readonly responseSanitizer: ResponseSanitizerService,
    private readonly integrationDetector: IntegrationDetector,
    @Inject(forwardRef(() => require('../langchain/langchain-orchestrator.service').LangchainOrchestratorService))
    private readonly langchainOrchestrator: LangchainOrchestratorService,
    private readonly cortexStreamingOrchestrator: CortexStreamingOrchestratorService,
    @InjectModel(GovernedTask.name)
    private readonly governedTaskModel: Model<GovernedTaskDocument>,
    @Optional() private readonly chatEventsRedis?: ChatEventsRedisService,
    @Optional()
    private readonly aiRouterService?: AIRouterService | null,
    @Optional()
    private readonly aiCostTrackingService?: AICostTrackingService | null,
    @Optional()
    private readonly promptTemplateService?: PromptTemplateService | null,
  ) {
    // Session cleanup handled by Redis TTL (30 minutes)
  }

  // Get chat events service from factory
  private get chatEventsService(): IChatEventsService {
    return this.chatEventsFactory.getService();
  }

  /**
   * Ensures content is always a string for ChatMessage. Handles objects from
   * integration results (e.g. { message, viewLinks, metadata }) and other edge cases.
   */
  private ensureStringContent(value: unknown, fallback = 'Operation completed'): string {
    if (value == null) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'message' in value) {
      const msg = (value as { message?: unknown }).message;
      return typeof msg === 'string' ? msg : msg != null ? String(msg) : fallback;
    }
    return String(value);
  }

  // Get Redis client for session storage (30-minute TTL)
  private get redisClient() {
    if (!this.chatEventsRedis) {
      throw new Error('Redis not available for session storage');
    }
    // Access the publisher from the Redis service
    return (this.chatEventsRedis as any).publisher as Redis;
  }

  // Strategy formation session management
  // Session storage now uses Redis instead of in-memory Maps

  /**
   * Store user input session in Redis (30-minute TTL)
   */
  private async storeUserInputSession(sessionId: string, session: any): Promise<void> {
    if (!this.chatEventsRedis) {
      this.logger.warn('Redis not available, skipping session storage');
      return;
    }

    try {
      const key = `chat:user_input_session:${sessionId}`;
      await this.redisClient.setex(key, 1800, JSON.stringify({
        ...session,
        timestamp: new Date(),
      }));
    } catch (error) {
      this.logger.error('Failed to store user input session in Redis', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
    }
  }

  /**
   * Get user input session from Redis
   */
  private async getUserInputSession(sessionId: string): Promise<any | null> {
    if (!this.chatEventsRedis) {
      this.logger.warn('Redis not available for session retrieval');
      return null;
    }

    try {
      const key = `chat:user_input_session:${sessionId}`;
      const data = await this.redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.logger.error('Failed to get user input session from Redis', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      return null;
    }
  }

  /**
   * Delete user input session from Redis
   */
  private async deleteUserInputSession(sessionId: string): Promise<void> {
    if (!this.chatEventsRedis) return;

    try {
      const key = `chat:user_input_session:${sessionId}`;
      await this.redisClient.del(key);
    } catch (error) {
      this.logger.error('Failed to delete user input session from Redis', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
    }
  }

  /**
   * Store strategy formation session in Redis (30-minute TTL)
   */
  private async storeStrategyFormationSession(sessionId: string, session: any): Promise<void> {
    if (!this.chatEventsRedis) {
      this.logger.warn('Redis not available, skipping session storage');
      return;
    }

    try {
      const key = `chat:strategy_formation_session:${sessionId}`;
      await this.redisClient.setex(key, 1800, JSON.stringify({
        ...session,
        timestamp: new Date(),
      }));
    } catch (error) {
      this.logger.error('Failed to store strategy formation session in Redis', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
    }
  }

  /**
   * Get strategy formation session from Redis
   */
  private async getStrategyFormationSession(sessionId: string): Promise<any | null> {
    if (!this.chatEventsRedis) {
      this.logger.warn('Redis not available for session retrieval');
      return null;
    }

    try {
      const key = `chat:strategy_formation_session:${sessionId}`;
      const data = await this.redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.logger.error('Failed to get strategy formation session from Redis', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      return null;
    }
  }

  /**
   * Send a message and get AI response
   */
  async sendMessage(
    userId: string,
    dto: SendMessageDto,
    parsedMentions?: ParsedMention[],
    req?: Request,
    onChunk?: (chunk: string, done: boolean) => Promise<void> | void,
  ): Promise<ChatMessageResponse> {
    const startTime = Date.now();

    this.logger.log('Processing chat message', {
      userId,
      conversationId: dto.conversationId,
      messageLength: dto.message?.length || 0,
      hasAttachments: dto.attachments?.length || 0,
      hasDocuments: dto.documentIds?.length || 0,
    });

    // Input validation: require at least one of message, templateId, or attachments
    const hasMessage = dto.message && dto.message.trim().length > 0;
    const hasTemplateId = dto.templateId && dto.templateId.length > 0;
    const hasAttachments = dto.attachments && dto.attachments.length > 0;

    if (!hasMessage && !hasTemplateId && !hasAttachments) {
      throw new Error(
        'At least one of message, templateId, or attachments is required',
      );
    }

    // Message has already been preprocessed by the controller
    // Security check and link enrichment are handled in ChatController.sendMessage
    const enrichedMessage = dto.message || '';
    const originalMessage = dto.originalMessage || enrichedMessage;

    try {
      // Get or create conversation
      const conversation = await this.getOrCreateConversation(userId, dto);

      // Load recent messages for context (needed for template resolution)
      const recentMessages = await this.contextOptimizer.fetchOptimalContext(
        conversation._id.toString(),
        (dto.message ?? '').length,
      );
      const recentForTemplateResolution = recentMessages.map((m) => ({
        role: m.role as string,
        content: m.content || '',
      }));

      // Check for GitHub/Vercel/MongoDB context (used by dedicated agents and MCP)
      const githubContext = conversation.githubContext
        ? {
            connectionId: conversation.githubContext.connectionId?.toString(),
            repositoryId: conversation.githubContext.repositoryId,
            repositoryName: conversation.githubContext.repositoryName,
            repositoryFullName: conversation.githubContext.repositoryFullName,
            integrationId: conversation.githubContext.integrationId?.toString(),
            branchName: conversation.githubContext.branchName,
          }
        : undefined;
      const vercelContext = conversation.vercelContext
        ? {
            connectionId: conversation.vercelContext.connectionId?.toString(),
            projectId: conversation.vercelContext.projectId,
            projectName: conversation.vercelContext.projectName,
          }
        : undefined;
      const mongodbContext = conversation.mongodbContext
        ? {
            connectionId: conversation.mongodbContext.connectionId?.toString(),
            activeDatabase: conversation.mongodbContext.activeDatabase,
            activeCollection: conversation.mongodbContext.activeCollection,
          }
        : undefined;

      // Fetch document metadata if documentIds provided (before user message creation)
      let attachedDocuments: any[] = [];
      if (dto.documentIds && dto.documentIds.length > 0) {
        try {
          attachedDocuments = await this.fetchDocumentMetadata(
            dto.documentIds,
            userId,
          );
          this.logger.debug('Fetched document metadata', {
            documentIds: dto.documentIds,
            foundDocuments: attachedDocuments.length,
          });
        } catch (docError) {
          this.logger.warn('Failed to fetch document metadata', {
            documentIds: dto.documentIds,
            error:
              docError instanceof Error ? docError.message : String(docError),
          });
          // Continue without document metadata - not a critical failure
        }
      }

      // Process attachments EARLY (before user message creation, like Express)
      let processedAttachments: any[] = [];
      let attachmentContext = '';
      if (dto.attachments && dto.attachments.length > 0) {
        const attachmentInputs = this.mapAttachmentsToInput(dto.attachments);
        const attachmentResult =
          await this.attachmentProcessor.processAttachments(
            attachmentInputs,
            userId,
          );
        processedAttachments = attachmentResult.processedAttachments;
        attachmentContext = attachmentResult.contextString;
      }

      // SAVE USER MESSAGE FIRST (before template resolution, like Express)
      // Now includes processed attachments (like Express)
      const session = await this.chatMessageModel.startSession();
      let userMessage: any;

      await session.withTransaction(async () => {
        userMessage = await this.chatMessageModel.create(
          [
            {
              conversationId: conversation._id,
              userId,
              role: 'user',
              content: originalMessage, // Save original message, will update if template resolved
              attachments: processedAttachments, // Store processed attachments (like Express)
              attachedDocuments,
              metadata: {
                temperature: dto.temperature,
                maxTokens: dto.maxTokens,
              },
            },
          ],
          { session },
        );

        // Emit user message event for real-time streaming
        this.chatEventsService.emitMessage(
          conversation._id.toString(),
          userId,
          {
            id: userMessage[0]._id.toString(),
            conversationId: conversation._id.toString(),
            role: 'user',
            content: originalMessage, // Emit original message for real-time updates
            timestamp: userMessage[0].createdAt,
            attachments: processedAttachments, // Emit processed attachments
            attachedDocuments,
            metadata: userMessage[0].metadata,
          },
        );
      });

      await session.endSession();
      userMessage = userMessage[0]; // Extract from array

      // Resolve template if templateId provided (overrides or supplements message)
      let effectiveMessage = enrichedMessage;
      let templateMetadata: any = null;
      if (dto.templateId && this.promptTemplateService) {
        try {
          const resolved = await this.resolveMessageWithTemplate(
            dto.templateId,
            userId,
            dto.templateVariables as Record<string, unknown> | undefined,
            recentForTemplateResolution, // Pass conversation context for context-aware resolution
          );
          effectiveMessage = resolved.content;
          templateMetadata = resolved.templateMetadata;
          this.logger.debug('Template resolved for chat message', {
            templateId: dto.templateId,
            userId,
            resolvedLength: effectiveMessage.length,
            hasTemplateMetadata: !!templateMetadata,
          });

          // CREATE SECOND USER MESSAGE WITH RESOLVED TEMPLATE CONTENT (match Express behavior)
          const templateMessage = await this.chatMessageModel.create({
            conversationId: conversation._id,
            userId,
            role: 'user',
            content: effectiveMessage, // Resolved template content
            modelId: dto.modelId,
            metadata: {
              templateId: dto.templateId,
              templateName: templateMetadata?.name,
              variablesResolved: templateMetadata?.variablesResolved,
              originalMessageId: userMessage._id, // Reference to original message
            },
          });
          this.logger.debug('Created separate template message', {
            originalMessageId: userMessage._id,
            templateMessageId: templateMessage._id,
          });
        } catch (templateError) {
          this.logger.warn(
            'Template resolution failed, using original message',
            {
              templateId: dto.templateId,
              error:
                templateError instanceof Error
                  ? templateError.message
                  : String(templateError),
            },
          );
        }
      }

      // Update conversation title after template resolution if this is the first message
      if (
        dto.templateId &&
        conversation.messageCount === 0 &&
        effectiveMessage
      ) {
        const newTitle = this.generateSimpleTitle(
          effectiveMessage,
          dto.modelId,
        );
        if (newTitle && newTitle !== conversation.title) {
          conversation.title = newTitle;
          await conversation.save();
          this.logger.debug(
            'Updated conversation title after template resolution',
            {
              conversationId: conversation._id.toString(),
              newTitle,
            },
          );
        }
      }

      // Refetch recent messages with effective message length so context window is sized for final content (e.g. after template expansion)
      const recentMessagesForRouting =
        await this.contextOptimizer.fetchOptimalContext(
          conversation._id.toString(),
          effectiveMessage.length,
        );
      const recentForContext = recentMessagesForRouting.map((m) => ({
        role: m.role as string,
        content: m.content || '',
      }));

      // Build conversation context
      const context = this.contextManager.buildContext(
        conversation._id.toString(),
        effectiveMessage,
        recentForContext,
      );

      // Resolve coreferences in the message
      const coreferenceResult = await this.contextManager.resolveCoreference(
        effectiveMessage,
        context,
        recentForContext,
      );

      if (coreferenceResult.substitutions.length > 0) {
        this.logger.debug('Coreference resolved', {
          originalMessage: effectiveMessage,
          resolvedMessage: coreferenceResult.resolvedMessage,
          substitutionsCount: coreferenceResult.substitutions.length,
        });
        // Update the effective message with resolved coreferences for better AI processing
        effectiveMessage = coreferenceResult.resolvedMessage;
      }

      // Get user preferences for personalized responses
      const userPreferences = await this.getUserPreferences(userId);

      // Build context preamble for AI handlers
      const contextPreamble = this.contextOptimizer.buildPreamble(
        context,
        recentForContext,
      );

      // Handle strategy formation responses (multi-turn flow) - BEFORE integration detection
      if (
        dto.selectionResponse &&
        dto.selectionResponse.integration === 'strategy'
      ) {
        return await this.handleStrategyFormationResponse(
          userId,
          dto,
          conversation,
          effectiveMessage,
          startTime,
        );
      }

      // EARLY MCP ROUTING CHECK: If integration detected with high confidence, route to MCP handler
      const integrationIntent = await this.integrationDetector.detect(
        effectiveMessage,
        userId,
      );
      if (
        integrationIntent.needsIntegration &&
        integrationIntent.confidence > 0.6
      ) {
        this.logger.debug('Early MCP routing triggered', {
          integrations: integrationIntent.integrations,
          confidence: integrationIntent.confidence,
        });

        const mcpResult = await this.processMCPRoute(
          {
            userId,
            message: effectiveMessage,
            conversationId: conversation._id.toString(),
            githubContext,
            vercelContext,
            mongodbContext,
          },
          context,
          recentForContext,
        );

        // Create assistant message and update conversation
        const assistantMessage = await this.chatMessageModel.create({
          conversationId: conversation._id,
          userId,
          role: 'assistant',
          content: this.ensureStringContent(mcpResult.response, 'MCP integration completed'),
          modelId: dto.modelId,
          agentPath: mcpResult.agentPath,
          optimizationsApplied: mcpResult.optimizationsApplied,
          cacheHit: mcpResult.cacheHit,
          riskLevel: mcpResult.riskLevel,
          // Save ALL integration data fields (matching Express)
          mongodbIntegrationData: mcpResult.mongodbIntegrationData,
          githubIntegrationData: mcpResult.githubIntegrationData,
          vercelIntegrationData: mcpResult.vercelIntegrationData,
          slackIntegrationData: mcpResult.slackIntegrationData,
          discordIntegrationData: mcpResult.discordIntegrationData,
          jiraIntegrationData: mcpResult.jiraIntegrationData,
          linearIntegrationData: mcpResult.linearIntegrationData,
          googleIntegrationData: mcpResult.googleIntegrationData,
          awsIntegrationData: mcpResult.awsIntegrationData,
          formattedResult: mcpResult.formattedResult,
          metadata: {
            temperature: dto.temperature,
            maxTokens: dto.maxTokens,
            latency: Date.now() - startTime,
          },
        });

        await this.updateConversationAfterMessage(
          conversation,
          assistantMessage,
        );

        const result: ChatMessageResponse = {
          id: assistantMessage._id.toString(),
          messageId: assistantMessage._id.toString(), // Express API compatibility
          conversationId: conversation._id.toString(),
          role: 'assistant',
          content: assistantMessage.content,
          modelId: dto.modelId,
          timestamp: assistantMessage.createdAt,
          agentPath: mcpResult.agentPath,
          optimizationsApplied: [
            ...(mcpResult.optimizationsApplied || []),
            'main_mcp_route',
          ],
          cacheHit: mcpResult.cacheHit,
          riskLevel: mcpResult.riskLevel,
          // Include ALL integration data fields (matching Express)
          mongodbIntegrationData: mcpResult.mongodbIntegrationData,
          githubIntegrationData: mcpResult.githubIntegrationData,
          vercelIntegrationData: mcpResult.vercelIntegrationData,
          slackIntegrationData: mcpResult.slackIntegrationData,
          discordIntegrationData: mcpResult.discordIntegrationData,
          jiraIntegrationData: mcpResult.jiraIntegrationData,
          linearIntegrationData: mcpResult.linearIntegrationData,
          googleIntegrationData: mcpResult.googleIntegrationData,
          awsIntegrationData: mcpResult.awsIntegrationData,
          formattedResult: mcpResult.formattedResult,
          requiresSelection: mcpResult.requiresSelection,
          selection: mcpResult.selection,
          requiresConnection: mcpResult.requiresConnection,
          metadata: assistantMessage.metadata,
        };

        // Emit assistant message event
        this.chatEventsService.emitMessage(
          conversation._id.toString(),
          userId,
          result,
        );

        this.logger.log('Early MCP routing completed', {
          userId,
          conversationId: conversation._id.toString(),
          messageId: assistantMessage._id.toString(),
          integrations: integrationIntent.integrations,
          executionTime: Date.now() - startTime,
        });

        return result;
      }

      // INTEGRATION AGENT EARLY EXIT: Check for @mentions and route to integration agents
      if (parsedMentions && parsedMentions.length > 0) {
        // Filter out MongoDB mentions as they have dedicated handling below
        const nonMongoMentions = parsedMentions.filter(
          (mention) => mention.integration !== 'mongodb',
        );

        if (nonMongoMentions.length > 0) {
          this.logger.debug('Integration agent routing triggered by mentions', {
            mentions: nonMongoMentions.map(
              (m) => `${m.integration}:${m.command ?? ''}`,
            ),
          });

          try {
            // Try integration agent first
            const integrationResult =
              await this.integrationAgentService.processIntegrationCommand({
                userId,
                integration: nonMongoMentions[0]?.integration ?? 'general',
                message: effectiveMessage,
                mentions: nonMongoMentions,
                conversationId: conversation._id.toString(),
              });

            // Format integration result for display (like Express)
            const formattedResult =
              this.responseSanitizer.formatIntegrationResultForDisplay(
                integrationResult.result,
              );

            // Create assistant message and update conversation
            const assistantMessage = await this.chatMessageModel.create({
              conversationId: conversation._id,
              userId,
              role: 'assistant',
              content: this.ensureStringContent(formattedResult, 'Integration command completed'),
              modelId: dto.modelId,
              agentPath: integrationResult.agentPath || ['integration_agent'],
              optimizationsApplied: integrationResult.optimizationsApplied,
              metadata: {
                temperature: dto.temperature,
                maxTokens: dto.maxTokens,
                latency: Date.now() - startTime,
              },
            });

            await this.updateConversationAfterMessage(
              conversation,
              assistantMessage,
            );

            const result: ChatMessageResponse = {
              id: assistantMessage._id.toString(),
              conversationId: conversation._id.toString(),
              role: 'assistant',
              content: assistantMessage.content,
              modelId: dto.modelId,
              timestamp: assistantMessage.createdAt,
              agentPath: integrationResult.agentPath || ['integration_agent'],
              optimizationsApplied: integrationResult.optimizationsApplied,
              requiresSelection: integrationResult.requiresSelection,
              selection: integrationResult.selection,
              ...(typeof formattedResult === 'object' &&
              (formattedResult.viewLinks || formattedResult.metadata)
                ? {
                    formattedResult: {
                      viewLinks: formattedResult.viewLinks,
                      metadata: formattedResult.metadata,
                    },
                  }
                : {}),
              metadata: assistantMessage.metadata,
            };

            this.chatEventsService.emitMessage(
              conversation._id.toString(),
              userId,
              result,
            );

            this.logger.log('Integration agent processing completed', {
              userId,
              conversationId: conversation._id.toString(),
              messageId: assistantMessage._id.toString(),
              mentions: nonMongoMentions.length,
              executionTime: Date.now() - startTime,
            });

            return result;
          } catch (integrationError) {
            this.logger.warn('Integration agent failed, falling back to MCP', {
              error:
                integrationError instanceof Error
                  ? integrationError.message
                  : String(integrationError),
              mentions: nonMongoMentions.map(
                (m) => `${m.integration}:${m.command ?? ''}`,
              ),
            });

            // Fall back to MCP integration handler
            try {
              const firstMention = nonMongoMentions[0];
              const mcpResult =
                await this.mcpIntegrationHandler.handleIntegrationOperation({
                  userId,
                  command: {
                    type: 'get',
                    entity: firstMention?.entityType ?? 'default',
                    mention: firstMention,
                    params: { message: effectiveMessage },
                    naturalLanguage: effectiveMessage,
                  },
                  mentions: nonMongoMentions,
                  context: {
                    conversationId: conversation._id.toString(),
                    message: effectiveMessage,
                  },
                });

              // Format MCP integration result for display (like Express)
              const formattedMCPResult =
                this.responseSanitizer.formatIntegrationResultForDisplay(
                  mcpResult.result,
                );

              const assistantMessage = await this.chatMessageModel.create({
                conversationId: conversation._id,
                userId,
                role: 'assistant',
                content: this.ensureStringContent(formattedMCPResult, 'Integration command completed'),
                modelId: dto.modelId,
                agentPath: mcpResult.agentPath || ['mcp_integration'],
                optimizationsApplied: mcpResult.optimizationsApplied,
                metadata: {
                  temperature: dto.temperature,
                  maxTokens: dto.maxTokens,
                  latency: Date.now() - startTime,
                },
              });

              await this.updateConversationAfterMessage(
                conversation,
                assistantMessage,
              );

              const result: ChatMessageResponse = {
                id: assistantMessage._id.toString(),
                conversationId: conversation._id.toString(),
                role: 'assistant',
                content: assistantMessage.content,
                modelId: dto.modelId,
                timestamp: assistantMessage.createdAt,
                agentPath: mcpResult.agentPath || ['mcp_integration'],
                optimizationsApplied: mcpResult.optimizationsApplied,
                ...(typeof formattedMCPResult === 'object' &&
                (formattedMCPResult.viewLinks || formattedMCPResult.metadata)
                  ? {
                      formattedResult: {
                        viewLinks: formattedMCPResult.viewLinks,
                        metadata: formattedMCPResult.metadata,
                      },
                    }
                  : {}),
                metadata: assistantMessage.metadata,
              };

              this.chatEventsService.emitMessage(
                conversation._id.toString(),
                userId,
                result,
              );

              this.logger.log('MCP integration fallback completed', {
                userId,
                conversationId: conversation._id.toString(),
                messageId: assistantMessage._id.toString(),
                mentions: nonMongoMentions.length,
                executionTime: Date.now() - startTime,
              });

              return result;
            } catch (mcpError) {
              this.logger.warn(
                'MCP integration fallback also failed, creating error message',
                {
                  error:
                    mcpError instanceof Error
                      ? mcpError.message
                      : String(mcpError),
                  mentions: nonMongoMentions.map(
                    (m) => `${m.integration}:${m.command ?? ''}`,
                  ),
                },
              );

              // Create error message for failed integration attempts
              const errorMessage = `❌ ${mcpError instanceof Error ? mcpError.message : String(mcpError)}`;
              const assistantMessage = await this.chatMessageModel.create({
                conversationId: conversation._id,
                userId,
                role: 'assistant',
                content: errorMessage,
                modelId: dto.modelId,
                agentPath: ['integration_error'],
                metadata: {
                  temperature: dto.temperature,
                  maxTokens: dto.maxTokens,
                  latency: Date.now() - startTime,
                  integrationError: true,
                  originalError:
                    mcpError instanceof Error
                      ? mcpError.message
                      : String(mcpError),
                },
              });

              await this.updateConversationAfterMessage(
                conversation,
                assistantMessage,
              );

              const result: ChatMessageResponse = {
                id: assistantMessage._id.toString(),
                conversationId: conversation._id.toString(),
                role: 'assistant',
                content: assistantMessage.content,
                modelId: dto.modelId,
                timestamp: assistantMessage.createdAt,
                agentPath: ['integration_error'],
                metadata: assistantMessage.metadata,
              };

              this.chatEventsService.emitMessage(
                conversation._id.toString(),
                userId,
                result,
              );

              return result;
            }
          }
        }
      }

      // DEDICATED CONTEXT-SPECIFIC AGENTS: Check for specific contexts and route to dedicated agents
      if (vercelContext) {
        this.logger.debug(
          'Vercel context detected, routing to Vercel chat agent',
        );

        // Verify Vercel connection is active
        if (vercelContext.connectionId) {
          const vercelStatus = await this.connectionChecker.check(
            userId,
            'vercel',
          );
          if (!vercelStatus.isConnected) {
            this.logger.warn('Vercel connection not found or inactive', {
              connectionId: vercelContext.connectionId,
              userId,
            });
            throw new Error(
              'Vercel connection is not active. Please reconnect your Vercel account.',
            );
          }
          this.logger.debug('Vercel connection verified', {
            connectionId: vercelContext.connectionId,
            connectionName: vercelStatus.connectionName,
          });
        }

        const vercelResult = await this.vercelChatAgent.handleVercelQuery(
          userId,
          effectiveMessage,
        );

        // Create assistant message and update conversation
        const assistantMessage = await this.chatMessageModel.create({
          conversationId: conversation._id,
          userId,
          role: 'assistant',
          content: this.ensureStringContent(vercelResult.response, 'Vercel operation completed'),
          modelId: dto.modelId,
          agentPath: ['vercel_agent'],
          optimizationsApplied: ['vercel_integration'],
          metadata: {
            temperature: dto.temperature,
            maxTokens: dto.maxTokens,
            latency: Date.now() - startTime,
          },
        });

        await this.updateConversationAfterMessage(
          conversation,
          assistantMessage,
        );

        const result: ChatMessageResponse = {
          id: assistantMessage._id.toString(),
          messageId: assistantMessage._id.toString(), // Express API compatibility
          conversationId: conversation._id.toString(),
          role: 'assistant',
          content: assistantMessage.content,
          modelId: dto.modelId,
          timestamp: assistantMessage.createdAt,
          agentPath: ['vercel_agent'],
          optimizationsApplied: ['vercel_integration'],
          metadata: assistantMessage.metadata,
        };

        this.chatEventsService.emitMessage(
          conversation._id.toString(),
          userId,
          result,
        );

        this.logger.log('Vercel agent processing completed', {
          userId,
          conversationId: conversation._id.toString(),
          messageId: assistantMessage._id.toString(),
          executionTime: Date.now() - startTime,
        });

        return result;
      }

      if (mongodbContext) {
        this.logger.debug(
          'MongoDB context detected, routing to MongoDB chat agent',
        );
        try {
          const connectionId =
            mongodbContext.connectionId != null
              ? String(mongodbContext.connectionId)
              : '';
          if (!connectionId) {
            this.logger.warn('MongoDB context missing connectionId');
          }
          const mongodbResult =
            await this.mongodbChatAgentService.processMessage(
              userId,
              connectionId,
              effectiveMessage,
              {
                conversationId: conversation._id.toString(),
                connectionId,
                userId,
                activeDatabase: mongodbContext.activeDatabase,
                activeCollection: mongodbContext.activeCollection,
              },
            );

          // Create assistant message and update conversation
          const assistantMessage = await this.chatMessageModel.create({
            conversationId: conversation._id,
            userId,
            role: 'assistant',
            content: this.ensureStringContent(mongodbResult.message, 'MongoDB query completed'),
            modelId: dto.modelId,
            agentPath: ['mongodb_agent'],
            optimizationsApplied: ['mongodb_integration'],
            metadata: {
              temperature: dto.temperature,
              maxTokens: dto.maxTokens,
              cost: 0, // MongoDB queries don't have token costs
              latency: Date.now() - startTime,
            },
            // Store MongoDB-specific integration data
            mongodbIntegrationData: mongodbResult.data,
            mongodbSelectedViewType: mongodbResult.mongodbSelectedViewType,
            mongodbResultData: mongodbResult.mongodbResultData,
          });

          await this.updateConversationAfterMessage(
            conversation,
            assistantMessage,
          );

          const result: ChatMessageResponse = {
            id: assistantMessage._id.toString(),
            messageId: assistantMessage._id.toString(), // Express API compatibility
            conversationId: conversation._id.toString(),
            role: 'assistant',
            content: assistantMessage.content,
            modelId: dto.modelId,
            timestamp: assistantMessage.createdAt,
            agentPath: ['mongodb_agent'],
            optimizationsApplied: ['mongodb_integration'],
            metadata: assistantMessage.metadata,
            // Include MongoDB integration data in response
            mongodbIntegrationData: mongodbResult.data,
          };

          this.chatEventsService.emitMessage(
            conversation._id.toString(),
            userId,
            result,
          );

          this.logger.log('MongoDB agent processing completed', {
            userId,
            conversationId: conversation._id.toString(),
            messageId: assistantMessage._id.toString(),
            executionTime: Date.now() - startTime,
          });

          return result;
        } catch (mongodbError) {
          this.logger.warn(
            'MongoDB agent failed, falling through to normal processing',
            {
              error:
                mongodbError instanceof Error
                  ? mongodbError.message
                  : String(mongodbError),
              userId,
              conversationId: conversation._id.toString(),
            },
          );
          // Fall through to normal processing instead of throwing
        }
      }

      if (githubContext) {
        this.logger.debug(
          'GitHub context detected, routing to GitHub chat agent',
        );

        try {
          // Verify GitHub connection is active
          if (githubContext.connectionId) {
            const githubStatus = await this.connectionChecker.check(
              userId,
              'github',
            );
            if (!githubStatus.isConnected) {
              this.logger.warn('GitHub connection not found or inactive', {
                connectionId: githubContext.connectionId,
                userId,
              });
              throw new Error(
                'GitHub connection is not active. Please reconnect your GitHub account.',
              );
            }
            this.logger.debug('GitHub connection verified', {
              connectionId: githubContext.connectionId,
              connectionName: githubStatus.connectionName,
            });
          }

          const githubResult = await this.githubChatAgent.handleGithubQuery(
            userId,
            effectiveMessage,
          );

          // Calculate cost for GitHub agent response
          const githubCost = CostEstimator.estimateCost(
            dto.modelId,
            Math.ceil(effectiveMessage.length / 4),
            Math.ceil(githubResult.response.length / 4),
          );

          // Create assistant message and update conversation
          const assistantMessage = await this.chatMessageModel.create({
            conversationId: conversation._id,
            userId,
            role: 'assistant',
            content: this.ensureStringContent(githubResult.response, 'GitHub operation completed'),
            modelId: dto.modelId,
            agentPath: ['github_agent'],
            optimizationsApplied: ['github_integration'],
            metadata: {
              temperature: dto.temperature,
              maxTokens: dto.maxTokens,
              cost: githubCost,
              latency: Date.now() - startTime,
            },
          });

          await this.updateConversationAfterMessage(
            conversation,
            assistantMessage,
          );

          const result: ChatMessageResponse = {
            id: assistantMessage._id.toString(),
            messageId: assistantMessage._id.toString(), // Express API compatibility
            conversationId: conversation._id.toString(),
            role: 'assistant',
            content: assistantMessage.content,
            modelId: dto.modelId,
            timestamp: assistantMessage.createdAt,
            agentPath: ['github_agent'],
            optimizationsApplied: ['github_integration'],
            metadata: assistantMessage.metadata,
          };

          this.chatEventsService.emitMessage(
            conversation._id.toString(),
            userId,
            result,
          );

          this.logger.log('GitHub agent processing completed', {
            userId,
            conversationId: conversation._id.toString(),
            messageId: assistantMessage._id.toString(),
            executionTime: Date.now() - startTime,
          });

          return result;
        } catch (githubError) {
          this.logger.warn(
            'GitHub agent failed, falling through to normal processing',
            {
              error:
                githubError instanceof Error
                  ? githubError.message
                  : String(githubError),
              userId,
              conversationId: conversation._id.toString(),
            },
          );
          // Fall through to normal processing instead of throwing
        }
      }

      // PERSIST REQUEST-LEVEL CONTEXT ON CONVERSATION (like Express)
      if (dto.githubContext) {
        conversation.githubContext = {
          connectionId: dto.githubContext.connectionId,
          repositoryId: dto.githubContext.repositoryId,
          repositoryName: dto.githubContext.repositoryName,
          repositoryFullName: dto.githubContext.repositoryFullName,
          integrationId: dto.githubContext.integrationId,
          branchName: dto.githubContext.branchName,
        };
        await conversation.save();
        this.logger.debug(
          'Updated conversation with request-level GitHub context',
        );
      }

      if (dto.vercelContext) {
        conversation.vercelContext = {
          connectionId: dto.vercelContext.connectionId,
          projectId: dto.vercelContext.projectId,
          projectName: dto.vercelContext.projectName,
        };
        await conversation.save();
        this.logger.debug(
          'Updated conversation with request-level Vercel context',
        );
      }

      if (dto.mongodbContext) {
        conversation.mongodbContext = {
          connectionId: dto.mongodbContext.connectionId,
          activeDatabase: dto.mongodbContext.activeDatabase,
          activeCollection: dto.mongodbContext.activeCollection,
        };
        await conversation.save();
        this.logger.debug(
          'Updated conversation with request-level MongoDB context',
        );
      }

      // Check for autonomous agent requirements (after context-specific agents, like Express)
      // Skip autonomous detection when useMultiAgent is explicitly true
      const requiresAutonomous =
        !dto.useMultiAgent &&
        (await this.autonomousDetector.detect(effectiveMessage));

      if (requiresAutonomous) {
        // Route to governed agent (pass effective message for template-resolved content)
        return await this.handleAutonomousRequest(
          userId,
          { ...dto, message: effectiveMessage },
          conversation,
          context,
        );
      }

      // Attachment context already processed earlier, combine with effective message (like Express)
      const finalMessage = attachmentContext
        ? effectiveMessage + attachmentContext
        : effectiveMessage;

      // Decide routing strategy (decide() returns RouteType string)
      const route = await this.routeDecider.decide(
        context,
        finalMessage,
        userId,
        dto.useWebSearch === true,
        dto.documentIds,
      );

      // Check if Cortex streaming is requested (higher priority than other routing)
      if (dto.useCortexStreaming && onChunk) {
        const cortexResult =
          await this.cortexStreamingOrchestrator.executeStreamingWorkflow(
            conversation._id.toString(),
            userId,
            finalMessage,
            { budgetLimit: dto.maxTokens },
            onChunk,
          );

        // Persist the cortex result as an assistant message
        const startTime = Date.now();
        const tokenCount = Math.ceil(cortexResult.length / 4); // Rough approximation
        const cost = CostEstimator.estimateCost(
          dto.modelId,
          tokenCount,
          tokenCount, // Rough estimate for output tokens
        );

        const assistantSession = await this.chatMessageModel.startSession();
        let assistantMessage: ChatMessageDocument[] | undefined;

        await assistantSession.withTransaction(async () => {
          assistantMessage = await this.chatMessageModel.create(
            [
              {
                conversationId: conversation._id,
                userId,
                role: 'assistant',
                content: this.ensureStringContent(cortexResult, 'Streaming completed'),
                modelId: dto.modelId,
                agentPath: ['cortex-streaming'],
                optimizationsApplied: ['cortex-multi-stage'],
                metadata: {
                  temperature: dto.temperature,
                  maxTokens: dto.maxTokens,
                  cost,
                  latency: Date.now() - startTime,
                  tokenCount,
                },
              },
            ],
            { session: assistantSession },
          );

          // Update conversation
          await this.updateConversationAfterMessage(
            conversation,
            assistantMessage[0],
            assistantSession,
          );
        });

        await assistantSession.endSession();
        const messageDoc = assistantMessage?.[0];

        if (!messageDoc) {
          throw new Error('Failed to create assistant message');
        }

        return {
          id: messageDoc._id.toString(),
          messageId: messageDoc._id.toString(),
          conversationId: conversation._id.toString(),
          role: 'assistant',
          content: cortexResult,
          timestamp: messageDoc.createdAt,
          modelId: dto.modelId,
          metadata: messageDoc.metadata,
          agentPath: ['cortex-streaming'],
          optimizationsApplied: ['cortex-multi-stage'],
        };
      }

      // Check if multi-agent processing is requested
      if (dto.useMultiAgent) {
        let multiAgentResult;
        try {
          // Use LangchainOrchestratorService StateGraph (like Express processWithLangchainMultiAgent)
          this.logger.debug(
            'Using LangchainOrchestratorService StateGraph for multi-agent processing',
          );

          if (!this.langchainOrchestrator.isInitialized()) {
            throw new Error('Langchain orchestrator not initialized');
          }

          const graph = this.langchainOrchestrator.getGraph();
          if (!graph) {
            throw new Error('Langchain graph not available');
          }

          // Prepare input state for the StateGraph
          const inputState = {
            messages: recentForContext.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
            userId,
            userMessage: finalMessage,
            userIntent: finalMessage, // Use message as initial intent
            contextData: {
              conversationId: conversation._id.toString(),
              message: finalMessage,
              modelId: dto.modelId,
              temperature: dto.temperature,
              maxTokens: dto.maxTokens,
              githubContext,
              vercelContext,
              mongodbContext,
              attachments: dto.attachments,
              documentIds: dto.documentIds,
              userPreferences,
              parsedMentions,
              selectionResponse: dto.selectionResponse,
              userId,
            },
            integrationContext: {
              github: githubContext ? { active: true } : undefined,
              vercel: vercelContext ? { active: true } : undefined,
              mongodb: mongodbContext ? { active: true } : undefined,
            },
            conversationDepth: recentForContext.length,
          };

          const startTime = Date.now();
          const langchainResult = await graph.invoke(inputState);
          const executionTime = Date.now() - startTime;

          // Extract final response from the StateGraph result
          const finalMessages =
            langchainResult?.messages ?? langchainResult?.finalResponse;
          let responseText: string;

          if (typeof finalMessages === 'string') {
            responseText = finalMessages;
          } else if (Array.isArray(finalMessages) && finalMessages.length > 0) {
            const lastMessage = finalMessages[finalMessages.length - 1];
            responseText = lastMessage?.content ?? String(lastMessage);
          } else {
            responseText =
              (langchainResult as any)?.finalResponse ??
              'No response generated';
          }

          // Extract agent path and other metadata from the result
          const autonomousDecisions =
            langchainResult?.autonomousDecisions || [];
          const proactiveInsights = langchainResult?.proactiveInsights || [];

          multiAgentResult = {
            response: responseText,
            agentPath: [
              'langchain_state_graph',
              langchainResult?.currentAgent || 'unknown',
            ],
            optimizationsApplied:
              autonomousDecisions.length > 0 ? ['autonomous_decisions'] : [],
            metadata: {
              executionTime,
              autonomousDecisions,
              proactiveInsights,
              currentAgent: langchainResult?.currentAgent,
              worldClassFeatures: langchainResult?.worldClassFeatures,
            },
            executionTime,
            costSavings: 0,
          };
          this.logger.debug(
            'LangchainOrchestratorService multi-agent processing successful',
          );
        } catch (langchainError) {
          this.logger.warn(
            'LangchainOrchestratorService failed, falling back to AgentService',
            {
              error:
                langchainError instanceof Error
                  ? langchainError.message
                  : String(langchainError),
            },
          );

          // Fallback to AgentService
          try {
            const queryData = {
              userId,
              query: finalMessage,
              context: {
                conversationId: conversation._id.toString(),
                previousMessages: recentForContext,
                parsedMentions,
                githubContext,
                vercelContext,
                mongodbContext,
                userPreferences,
              },
            };
            const agentResponse = await this.agentService.executeWithRouting(
              queryData,
              'conversational_flow',
              queryData.context,
            );

            // Convert AgentService response to multi-agent format
            const meta = agentResponse.metadata as
              | Record<string, any>
              | undefined;
            multiAgentResult = {
              response: agentResponse.response || 'No response generated',
              agentPath: ['agent_service', ...(meta?.agentPath ?? [])],
              optimizationsApplied: meta?.optimizationsApplied ?? [],
              metadata: agentResponse.metadata,
              executionTime: meta?.executionTime ?? 0,
              costSavings: 0,
            };
            this.logger.debug('AgentService fallback successful');
          } catch (agentError) {
            this.logger.warn(
              'AgentService failed, falling back to multiAgentFlowService',
              {
                error:
                  agentError instanceof Error
                    ? agentError.message
                    : String(agentError),
              },
            );

            // Final fallback to multiAgentFlowService (like Express)
            multiAgentResult =
              await this.multiAgentFlowService.executeMultiAgentFlow({
                userId,
                query: finalMessage,
                context: {
                  conversationId: conversation._id.toString(),
                  costBudget: 0.1,
                  chatMode:
                    (dto.chatMode as 'fastest' | 'cheapest' | 'balanced') ||
                    'balanced',
                  metadata: {
                    previousMessages: recentForContext,
                    selectionResponse: dto.selectionResponse,
                    parsedMentions,
                    githubContext,
                    vercelContext,
                    mongodbContext,
                    userPreferences,
                  },
                },
              });
          }
        }

        const response = {
          content: multiAgentResult.response || 'No response generated',
          agentPath: multiAgentResult.agentPath,
          optimizationsApplied: multiAgentResult.optimizationsApplied,
          cacheHit: multiAgentResult.metadata?.fromCache || false,
          riskLevel: multiAgentResult.agentPath?.includes('multi_agent')
            ? 'medium'
            : 'low',
          metadata: multiAgentResult.metadata,
          webSearchUsed: multiAgentResult.metadata?.webSearchUsed || false,
          aiWebSearchDecision: multiAgentResult.metadata?.aiWebSearchDecision,
          quotaUsed: (multiAgentResult.metadata as Record<string, any>)
            ?.quotaUsed,
          requiresIntegrationSelector:
            (multiAgentResult.metadata as Record<string, any>)
              ?.requiresIntegrationSelector || false,
          integrationSelectorData: (
            multiAgentResult.metadata as Record<string, any>
          )?.integrationSelectorData,
        };

        // Continue with the rest of the flow using the multi-agent response
        const tokenCount = multiAgentResult.executionTime || 0;
        const cost =
          multiAgentResult.costSavings ||
          CostEstimator.estimateCost(
            dto.modelId,
            Math.ceil(finalMessage.length / 4),
            tokenCount,
          );

        // Create assistant message and update conversation in transaction
        const assistantSession = await this.chatMessageModel.startSession();
        let multiAgentAssistantMessage!: ChatMessageDocument;

        try {
          await assistantSession.withTransaction(async () => {
            // Create assistant message
            const assistantMessage = new this.chatMessageModel({
              conversationId: conversation._id,
              userId,
              role: 'assistant',
              content: response.content,
              originalContent: response.content,
              metadata: {
                temperature: dto.temperature,
                maxTokens: dto.maxTokens,
                cost,
                tokenCount,
                modelId: dto.modelId,
                agentPath: response.agentPath,
                optimizationsApplied: response.optimizationsApplied,
                cacheHit: response.cacheHit,
                riskLevel: response.riskLevel,
                webSearchUsed: response.webSearchUsed,
                aiWebSearchDecision: response.aiWebSearchDecision,
                quotaUsed: response.quotaUsed,
                requiresIntegrationSelector:
                  response.requiresIntegrationSelector,
                integrationSelectorData: response.integrationSelectorData,
                multiAgentUsed: true,
                executionTime: multiAgentResult.executionTime,
                costSavings: multiAgentResult.costSavings,
              },
              timestamp: new Date(),
            });

            await assistantMessage.save({ session: assistantSession });
            multiAgentAssistantMessage =
              assistantMessage as ChatMessageDocument;

            // Update conversation
            await this.conversationModel.updateOne(
              { _id: conversation._id },
              {
                $inc: { messageCount: 1 },
                $set: {
                  lastMessageAt: new Date(),
                  lastMessage: response.content.substring(0, 500),
                },
                $push: {
                  messages: assistantMessage._id,
                },
              },
              { session: assistantSession },
            );
          });

          // Emit real-time update
          this.chatEventsService.emitMessage(
            conversation._id.toString(),
            userId,
            {
              id: multiAgentAssistantMessage._id.toString(),
              role: 'assistant',
              content: response.content,
              timestamp:
                (multiAgentAssistantMessage as any).timestamp ??
                multiAgentAssistantMessage.createdAt,
              metadata: multiAgentAssistantMessage.metadata,
            },
          );

          // Track usage
          await this.trackUsage({
            userId,
            conversationId: conversation._id.toString(),
            modelId: dto.modelId,
            inputTokens: Math.ceil(finalMessage.length / 4),
            outputTokens: tokenCount,
            cost,
            prompt: finalMessage,
            completion: response.content,
            service: 'multi_agent',
            responseTime: Date.now() - startTime,
            errorOccurred: false,
            metadata: {
              agentPath: response.agentPath,
              optimizationsApplied: response.optimizationsApplied,
              cacheHit: response.cacheHit,
              riskLevel: response.riskLevel,
              webSearchUsed: response.webSearchUsed,
              aiWebSearchDecision: response.aiWebSearchDecision,
              multiAgentUsed: true,
              executionTime: multiAgentResult.executionTime,
              costSavings: multiAgentResult.costSavings,
            },
          });

          // Track template usage for multi-agent flow if template was used
          if (templateMetadata && this.usageModel) {
            try {
              const truncateValue = (
                value: string,
                maxLength: number = 100,
              ): string => {
                if (!value) return '';
                return value.length > maxLength
                  ? value.substring(0, maxLength) + '...'
                  : value;
              };

              await this.usageModel.create([
                {
                  userId,
                  type: 'chat_message',
                  modelId: dto.modelId,
                  inputTokens: Math.ceil(effectiveMessage.length / 4),
                  outputTokens: tokenCount,
                  cost,
                  tags: ['chat', 'template', 'multi-agent'],
                  templateUsage: {
                    templateId: templateMetadata.id,
                    templateName: templateMetadata.name,
                    templateCategory: templateMetadata.category,
                    variablesResolved: templateMetadata.variablesResolved?.map(
                      (v: any) => ({
                        variableName: v.variableName,
                        value: truncateValue(v.value),
                        confidence: v.confidence,
                        source: v.source,
                        reasoning: v.reasoning,
                      }),
                    ),
                    context: 'chat',
                    templateVersion: 1,
                  },
                  metadata: {
                    source: 'chat',
                    conversationId: conversation._id.toString(),
                    temperature: dto.temperature,
                    maxTokens: dto.maxTokens,
                    agentPath: response.agentPath,
                    optimizationsApplied: response.optimizationsApplied,
                    multiAgentUsed: true,
                    executionTime: multiAgentResult.executionTime,
                    costSavings: multiAgentResult.costSavings,
                  },
                },
              ]);
            } catch (usageError) {
              this.logger.warn(
                'Failed to track template usage for multi-agent',
                {
                  error:
                    usageError instanceof Error
                      ? usageError.message
                      : String(usageError),
                  templateId: dto.templateId,
                },
              );
            }
          }

          // Return response (ChatMessageResponse shape)
          return {
            id: multiAgentAssistantMessage._id.toString(),
            conversationId: conversation._id.toString(),
            role: 'assistant',
            content: response.content,
            response: response.content,
            modelId: dto.modelId,
            model: dto.modelId, // Alias for backward compatibility
            timestamp:
              (multiAgentAssistantMessage as any).timestamp ??
              multiAgentAssistantMessage.createdAt,
            attachedDocuments: [],
            agentPath: response.agentPath,
            optimizationsApplied: response.optimizationsApplied,
            cacheHit: response.cacheHit,
            riskLevel: response.riskLevel,
            webSearchUsed: response.webSearchUsed,
            aiWebSearchDecision: response.aiWebSearchDecision,
            thinking:
              (response as Record<string, any>).agentThinking ??
              (response as Record<string, any>).thinking,
            requiresIntegrationSelector: response.requiresIntegrationSelector,
            integrationSelectorData: response.integrationSelectorData,
            metadata: {
              cost,
              tokenCount,
              latency: Date.now() - startTime, // Add latency
              modelId: dto.modelId,
              agentPath: response.agentPath,
              optimizationsApplied: response.optimizationsApplied,
              cacheHit: response.cacheHit,
              riskLevel: response.riskLevel,
              webSearchUsed: response.webSearchUsed,
              aiWebSearchDecision: response.aiWebSearchDecision,
              quotaUsed: response.quotaUsed,
              requiresIntegrationSelector: response.requiresIntegrationSelector,
              integrationSelectorData: response.integrationSelectorData,
            },
          } as ChatMessageResponse;
        } catch (error) {
          // Do NOT call abortTransaction - withTransaction auto-aborts on callback throw
          throw error;
        } finally {
          assistantSession.endSession();
        }
      }

      // Process with fallback and circuit breaker (default flow)
      const response = await this.processWithFallback(
        {
          userId,
          message: finalMessage,
          modelId: dto.modelId,
          temperature: dto.temperature,
          maxTokens: dto.maxTokens,
        },
        startTime,
        {
          recentMessages: recentForContext,
          context,
          route,
          contextPreamble,
          attachments: processedAttachments, // Use processed attachments
          documentIds: dto.documentIds,
          attachmentContext: '', // Attachment context already included in finalMessage
          conversationId: conversation._id.toString(),
          githubContext,
          vercelContext,
          mongodbContext,
          userPreferences,
          selectionResponse: dto.selectionResponse,
          parsedMentions,
        },
      );

      // Get predictive analytics for risk assessment (only for multi-agent)
      if (response.agentPath?.includes('multi_agent')) {
        try {
          const analytics =
            await this.multiAgentFlowService.getPredictiveCostAnalytics(userId);
          response.riskLevel = analytics.riskLevel;
          this.logger.debug('Updated risk level from predictive analytics', {
            originalRiskLevel: response.riskLevel,
            newRiskLevel: analytics.riskLevel,
            agentPath: response.agentPath,
          });
        } catch (error) {
          this.logger.warn(
            'Could not get predictive analytics for risk assessment',
            {
              error: error instanceof Error ? error.message : String(error),
              agentPath: response.agentPath,
            },
          );
        }
      }

      // Calculate cost if not already provided
      const tokenCount = response.metadata?.tokenCount || 0;
      const cost =
        response.metadata?.cost ||
        CostEstimator.estimateCost(
          dto.modelId,
          Math.ceil(effectiveMessage.length / 4),
          tokenCount,
        );

      // Create assistant message and update conversation in transaction
      const assistantSession = await this.chatMessageModel.startSession();
      let assistantMessage: any;

      await assistantSession.withTransaction(async () => {
        // Track usage for analytics
        if (this.usageModel) {
          await this.usageModel.create(
            [
              {
                userId,
                type: 'chat_message',
                modelId: dto.modelId,
                inputTokens: effectiveMessage.length,
                outputTokens: tokenCount,
                cost,
                metadata: {
                  agentPath: response.agentPath,
                  optimizationsApplied: response.optimizationsApplied,
                  conversationId: conversation._id.toString(),
                },
              },
            ],
            { session: assistantSession },
          );
        }

        // Track template usage for analytics if template was used
        if (templateMetadata && this.usageModel) {
          try {
            // Helper function to truncate sensitive variable values
            const truncateValue = (
              value: string,
              maxLength: number = 100,
            ): string => {
              if (!value) return '';
              return value.length > maxLength
                ? value.substring(0, maxLength) + '...'
                : value;
            };

            await this.usageModel.create(
              [
                {
                  userId,
                  type: 'chat_message',
                  modelId: dto.modelId,
                  inputTokens: effectiveMessage.length,
                  outputTokens: tokenCount,
                  cost,
                  tags: ['chat', 'template'],
                  templateUsage: {
                    templateId: templateMetadata.id,
                    templateName: templateMetadata.name,
                    templateCategory: templateMetadata.category,
                    variablesResolved: templateMetadata.variablesResolved?.map(
                      (v: any) => ({
                        variableName: v.variableName,
                        value: truncateValue(v.value),
                        confidence: v.confidence,
                        source: v.source,
                        reasoning: v.reasoning,
                      }),
                    ),
                    context: 'chat',
                    templateVersion: 1,
                  },
                  metadata: {
                    source: 'chat',
                    conversationId: conversation._id.toString(),
                    temperature: dto.temperature,
                    maxTokens: dto.maxTokens,
                    agentPath: response.agentPath,
                    optimizationsApplied: response.optimizationsApplied,
                  },
                },
              ],
              { session: assistantSession },
            );
          } catch (usageError) {
            this.logger.warn('Failed to track template usage', {
              error:
                usageError instanceof Error
                  ? usageError.message
                  : String(usageError),
              templateId: dto.templateId,
            });
          }
        }

        // Create assistant response message
        assistantMessage = await this.chatMessageModel.create(
          [
            {
              conversationId: conversation._id,
              userId,
              role: 'assistant',
              content: this.ensureStringContent(response.content, 'Response completed'),
              modelId: dto.modelId,
              agentPath: response.agentPath,
              optimizationsApplied: response.optimizationsApplied,
              cacheHit: response.cacheHit,
              riskLevel: response.riskLevel,
              // Persist integration data on the message
              mongodbIntegrationData: (response as any).mongodbIntegrationData,
              formattedResult: (response as any).formattedResult,
              githubIntegrationData: (response as any).githubIntegrationData,
              vercelIntegrationData: (response as any).vercelIntegrationData,
              slackIntegrationData: (response as any).slackIntegrationData,
              discordIntegrationData: (response as any).discordIntegrationData,
              jiraIntegrationData: (response as any).jiraIntegrationData,
              linearIntegrationData: (response as any).linearIntegrationData,
              googleIntegrationData: (response as any).googleIntegrationData,
              awsIntegrationData: (response as any).awsIntegrationData,
              requiresConnection: (response as any).requiresConnection,
              requiresSelection: (response as any).requiresSelection,
              selection: (response as any).selection,
              metadata: {
                temperature: dto.temperature,
                maxTokens: dto.maxTokens,
                cost,
                latency: Date.now() - startTime,
                tokenCount,
              },
            },
          ],
          { session: assistantSession },
        );

        // Update conversation
        await this.updateConversationAfterMessage(
          conversation,
          assistantMessage[0],
          assistantSession,
        );
      });

      await assistantSession.endSession();
      assistantMessage = assistantMessage[0]; // Extract from array

      const result: ChatMessageResponse = {
        id: assistantMessage._id.toString(),
        conversationId: conversation._id.toString(),
        role: 'assistant',
        content: assistantMessage.content,
        response: assistantMessage.content, // Express API compatibility
        modelId: dto.modelId,
        timestamp: assistantMessage.createdAt,
        attachedDocuments,
        agentPath: response.agentPath,
        optimizationsApplied: response.optimizationsApplied,
        cacheHit: response.cacheHit,
        riskLevel: response.riskLevel,
        // Web search metadata
        webSearchUsed: (response as any).webSearchUsed,
        aiWebSearchDecision: (response as any).aiWebSearchDecision,
        // Integration selector metadata
        requiresIntegrationSelector: (response as any)
          .requiresIntegrationSelector,
        integrationSelectorData: (response as any).integrationSelectorData,
        metadata: assistantMessage.metadata,
        // Include integration data from handler response
        mongodbIntegrationData: (response as any).mongodbIntegrationData,
        formattedResult: (response as any).formattedResult,
        githubIntegrationData: (response as any).githubIntegrationData,
        vercelIntegrationData: (response as any).vercelIntegrationData,
        slackIntegrationData: (response as any).slackIntegrationData,
        discordIntegrationData: (response as any).discordIntegrationData,
        jiraIntegrationData: (response as any).jiraIntegrationData,
        linearIntegrationData: (response as any).linearIntegrationData,
        googleIntegrationData: (response as any).googleIntegrationData,
        awsIntegrationData: (response as any).awsIntegrationData,
        requiresConnection: (response as any).requiresConnection,
        requiresSelection: (response as any).requiresSelection,
        selection: (response as any).selection,
        thinking: (response as any).agentThinking,
        // Template usage metadata (matching Express)
        templateUsed: templateMetadata
          ? {
              id: dto.templateId,
              name: templateMetadata.name,
              variablesResolved: templateMetadata.variablesResolved,
              usageCount: templateMetadata.usageCount,
            }
          : undefined,
      };

      this.logger.log('Chat message processed successfully', {
        userId,
        conversationId: conversation._id.toString(),
        messageId: assistantMessage._id.toString(),
        route,
        executionTime: Date.now() - startTime,
        tokensUsed: result.metadata?.tokenCount,
      });

      // If streaming callback is provided, stream the final response
      if (onChunk) {
        await onChunk(assistantMessage.content, true);
      }

      // Emit real-time chat event
      this.chatEventsService.emitMessage(
        conversation._id.toString(),
        userId,
        result,
      );

      return result;
    } catch (error) {
      this.logger.error('Failed to process chat message', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        conversationId: dto.conversationId,
        executionTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Process message with circuit breaker and fallback handling
   */
  private async processWithFallback(
    request: {
      userId: string;
      message: string;
      modelId: string;
      temperature?: number;
      maxTokens?: number;
    },
    startTime: number,
    context: {
      recentMessages: Array<{ role: string; content: string }>;
      context: any;
      route: string;
      contextPreamble?: string;
      attachments?: any[];
      documentIds?: string[];
      attachmentContext?: string;
      conversationId: string;
      githubContext?: any;
      vercelContext?: any;
      mongodbContext?: any;
      userPreferences?: any;
      selectionResponse?: any;
      parsedMentions?: ParsedMention[];
    },
  ): Promise<{
    content: string;
    response?: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    riskLevel?: string;
    agentThinking?: any;
    thinking?: any;
    webSearchUsed?: boolean;
    aiWebSearchDecision?: string;
    quotaUsed?: number;
    requiresIntegrationSelector?: boolean;
    integrationSelectorData?: any;
    metadata?: { cost?: number; tokenCount?: number; latency?: number };
  }> {
    const processingContext: ProcessingContext = {
      recentMessages: context.recentMessages,
      userId: request.userId,
      messageLength: request.message?.length ?? 0,
    };

    // Try enhanced processing with Langchain multi-agent system first (equivalent to Express tryEnhancedProcessing)
    if (!context.route || context.route === 'conversational_flow') {
      try {
        this.logger.debug('Attempting Langchain multi-agent processing', {
          userId: request.userId,
          messageLength: request.message?.length,
        });

        if (this.langchainOrchestrator.isInitialized()) {
          const graph = this.langchainOrchestrator.getGraph();
          if (graph) {
            const inputState = {
              messages: context.recentMessages.map((msg) => ({
                role: msg.role,
                content: msg.content,
              })),
              userId: request.userId,
              conversationId: context.conversationId,
              context: {
                message: request.message,
                modelId: request.modelId,
                temperature: request.temperature,
                maxTokens: request.maxTokens,
                githubContext: context.githubContext,
                vercelContext: context.vercelContext,
                mongodbContext: context.mongodbContext,
                attachments: context.attachments,
                documentIds: context.documentIds,
                userPreferences: context.userPreferences,
                parsedMentions: context.parsedMentions,
              },
            };

            const langchainResult = await graph.invoke(inputState);
            const finalMessages =
              langchainResult?.messages ?? langchainResult?.finalResponse;

            let responseText: string;
            if (typeof finalMessages === 'string') {
              responseText = finalMessages;
            } else if (
              Array.isArray(finalMessages) &&
              finalMessages.length > 0
            ) {
              const lastMessage = finalMessages[finalMessages.length - 1];
              responseText = lastMessage?.content ?? String(lastMessage);
            } else {
              responseText = (langchainResult as any)?.finalResponse ?? '';
            }

            if (responseText && responseText.trim()) {
              this.logger.debug('Langchain multi-agent processing succeeded', {
                userId: request.userId,
                responseLength: responseText.length,
              });

              return {
                content: responseText,
                agentPath: ['langchain_multi_agent'],
                optimizationsApplied: ['langchain_orchestration'],
                cacheHit: false,
                riskLevel: 'low',
                agentThinking: (langchainResult as any)?.thinking,
                metadata: {
                  cost: 0.01, // Estimate for multi-agent processing
                  tokenCount: Math.ceil(responseText.length / 4),
                },
              };
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          'Langchain multi-agent processing failed, falling back to route handlers',
          {
            userId: request.userId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        // Continue to route-based fallback below
      }
    }

    const result = await this.fallbackHandler.handleWithCircuitBreaker(
      {
        userId: request.userId,
        message: request.message,
        modelId: request.modelId,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      },
      processingContext,
      async (): Promise<HandlerResult> => {
        const r = await this.routeMessage(startTime, context.route, {
          userId: request.userId,
          message: request.message,
          modelId: request.modelId,
          context: context.context,
          contextPreamble: context.contextPreamble,
          attachments: context.attachments,
          documentIds: context.documentIds,
          attachmentContext: context.attachmentContext,
          conversationId: context.conversationId,
          githubContext: context.githubContext,
          vercelContext: context.vercelContext,
          mongodbContext: context.mongodbContext,
          userPreferences: context.userPreferences,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          previousMessages: context.recentMessages,
          selectionResponse: context.selectionResponse,
          parsedMentions: context.parsedMentions,
        });
        return {
          response: r.content,
          agentPath: r.agentPath ?? [],
          optimizationsApplied: r.optimizationsApplied ?? [],
          cacheHit: r.cacheHit ?? false,
          riskLevel: r.riskLevel ?? 'low',
          agentThinking: r.agentThinking,
          metadata: r.metadata,
        };
      },
    );

    return {
      content: result.response ?? '',
      response: result.response ?? '', // Alias for backward compatibility
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      webSearchUsed: (result as any).webSearchUsed,
      aiWebSearchDecision: (result as any).aiWebSearchDecision,
      quotaUsed: (result as any).quotaUsed,
      thinking: (result as any).agentThinking, // Propagate thinking from all route handlers
      requiresIntegrationSelector: (result as any).requiresIntegrationSelector,
      integrationSelectorData: (result as any).integrationSelectorData,
      metadata: {
        ...result.metadata,
        latency: Date.now() - startTime, // Add latency
        tokenCount:
          result.metadata?.tokenCount ??
          Math.ceil((result.response ?? '').length / 4), // Add tokenCount
      },
    };
  }

  /**
   * Handle autonomous agent requests: initiate governed task and create plan message
   */
  private async handleAutonomousRequest(
    userId: string,
    dto: SendMessageDto,
    conversation: ChatConversationDocument,
    context: any,
  ): Promise<ChatMessageResponse> {
    // Log autonomous request with context information
    this.logger.debug('Handling autonomous agent request', {
      userId,
      conversationId: conversation._id.toString(),
      contextSubject: context?.currentSubject,
      contextIntent: context?.currentIntent,
      hasPreferences: !!context?.userPreferences,
    });

    // Create user message with context information
    const userMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      userId,
      role: 'user',
      content: dto.message || '',
      attachments: dto.attachments,
      metadata: {
        autonomousRequest: true,
        contextSubject: context?.currentSubject,
        contextIntent: context?.currentIntent,
      },
    });

    const chatId = conversation._id.toString();

    // Initiate governed task (same flow as ChatGovernedAgentController)
    const task = await this.governedAgentService.initiateTask(
      dto.message || '',
      userId,
      chatId,
      userMessage._id.toString(),
    );

    const taskId = task.id;

    // Create governed plan message and link task to chat
    const planMessage = await this.governedPlanMessageCreator.createPlanMessage(
      chatId,
      taskId,
      userId,
    );

    return {
      id: planMessage._id.toString(),
      conversationId: chatId,
      role: 'assistant',
      content: planMessage.content,
      messageType: 'governed_plan',
      governedTaskId: taskId,
      planState: planMessage.planState,
      timestamp: planMessage.createdAt,
    };
  }

  /**
   * Map SendMessageDto attachments to AttachmentInput for AttachmentProcessor
   */
  private mapAttachmentsToInput(
    attachments: SendMessageDto['attachments'],
  ): AttachmentInput[] {
    if (!attachments || attachments.length === 0) return [];

    return attachments.map((a) => {
      const type = a.type === 'google' ? 'google' : 'uploaded';
      const url = a.url || '';
      const fileId =
        url ||
        (a as any).fileId ||
        `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      return {
        type,
        fileId,
        fileName: a.name,
        fileSize: a.size ?? 0,
        mimeType: a.mimeType ?? 'application/octet-stream',
        fileType: a.mimeType?.split('/')[0] ?? 'file',
        url,
        ...(type === 'google' &&
          (a as any).googleFileId && { googleFileId: (a as any).googleFileId }),
        ...(type === 'google' &&
          (a as any).connectionId && { connectionId: (a as any).connectionId }),
      };
    });
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(
    startTime: number,
    route: string,
    params: {
      userId: string;
      message: string;
      modelId: string;
      context: any;
      contextPreamble?: string;
      attachments?: any[];
      documentIds?: string[];
      attachmentContext?: string;
      conversationId: string;
      githubContext?: any;
      vercelContext?: any;
      mongodbContext?: any;
      userPreferences?: any;
      temperature?: number;
      maxTokens?: number;
      previousMessages?: Array<{ role: string; content: string }>;
      selectionResponse?: any;
      parsedMentions?: ParsedMention[];
    },
  ): Promise<{
    content: string;
    response?: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    riskLevel?: string;
    agentThinking?: any;
    webSearchUsed?: boolean;
    aiWebSearchDecision?: string;
    quotaUsed?: number;
    requiresIntegrationSelector?: boolean;
    integrationSelectorData?: any;
    metadata?: { cost?: number; tokenCount?: number; latency?: number };
  }> {
    switch (route) {
      case 'knowledge_base':
        // Create handler request
        const kbHandlerRequest = {
          userId: params.userId,
          message: params.message,
          modelId: params.modelId,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          chatMode: params.userPreferences?.chatMode || 'balanced',
          useMultiAgent: false, // Can be extended later
          useWebSearch: false, // Can be extended later
          documentIds: params.documentIds,
          attachments: params.attachments,
          githubContext: params.githubContext,
          vercelContext: params.vercelContext,
          mongodbContext: params.mongodbContext,
          selectionResponse: params.selectionResponse,
        };

        // Create processing context
        const kbProcessingContext: ProcessingContext = {
          recentMessages: params.previousMessages || [],
          userId: params.userId,
          conversation: {
            _id: params.conversationId as any,
            userId: params.userId,
            title: '',
            modelId: params.modelId || '',
          } as any,
        };

        // Call KnowledgeBaseHandler directly
        const kbResult = await this.knowledgeBaseHandler.handle(
          kbHandlerRequest,
          kbProcessingContext,
          params.contextPreamble,
        );

        return {
          content: kbResult.response,
          agentPath: kbResult.agentPath,
          optimizationsApplied: kbResult.optimizationsApplied,
          cacheHit: kbResult.cacheHit,
          riskLevel: kbResult.riskLevel,
          agentThinking: kbResult.agentThinking,
          metadata: kbResult.metadata,
        };

      case 'web_scraper':
        return await this.handleWebScraper(params);

      case 'multi_agent':
        return await this.handleMultiAgent(params);

      case 'mcp':
        return await this.handleMCP(params);

      case 'conversational_flow':
      default:
        return await this.handleConversationalFlow(params, startTime);
    }
  }

  /**
   * Handle web scraper requests – use WebScraperHandler directly for proper metadata
   */
  private async handleWebScraper(params: {
    userId: string;
    message: string;
    modelId: string;
    context: any;
    attachmentContext?: string;
    conversationId: string;
    githubContext?: any;
    userPreferences?: any;
    previousMessages?: Array<{ role: string; content: string }>;
    contextPreamble?: string;
  }): Promise<{
    content: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    riskLevel?: string;
    agentThinking?: any;
    webSearchUsed?: boolean;
    aiWebSearchDecision?: string;
    quotaUsed?: number;
    metadata?: { cost?: number; tokenCount?: number; latency?: number };
  }> {
    // Create handler request
    const handlerRequest = {
      userId: params.userId,
      message: params.message,
      modelId: params.modelId,
      useWebSearch: true, // Always use web search for web_scraper route
    };

    // Create conversation context
    const conversationContext: ConversationContext = {
      conversationId: params.conversationId,
      currentSubject: params.context?.currentSubject,
      currentIntent: params.context?.currentIntent,
      languageFramework: params.context?.languageFramework,
      lastReferencedEntities: params.context?.lastReferencedEntities || [],
      timestamp: new Date(),
    };

    // Call WebScraperHandler directly
    const result = await this.webScraperHandler.handle(
      handlerRequest,
      conversationContext,
      params.contextPreamble || '',
      params.previousMessages || [],
    );

    return {
      content: result.response ?? '',
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      agentThinking: result.agentThinking,
      webSearchUsed: result.webSearchUsed,
      aiWebSearchDecision: result.aiWebSearchDecision,
      quotaUsed: result.quotaUsed,
      metadata: result.metadata,
    };
  }

  /**
   * Handle multi-agent requests
   */
  private async handleMultiAgent(params: {
    userId: string;
    message: string;
    modelId: string;
    context: any;
    attachmentContext?: string;
    conversationId: string;
    githubContext?: any;
    userPreferences?: any;
    contextPreamble?: string;
  }): Promise<{
    content: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    agentThinking?: any;
    riskLevel?: string;
  }> {
    const result = await this.multiAgentFlowService.executeMultiAgentFlow({
      userId: params.userId,
      query: params.message,
      context: {
        ...params.context,
        preamble: params.contextPreamble,
        githubContext: params.githubContext,
        userPreferences: params.userPreferences,
        selectedModel: params.modelId,
      },
    });

    return {
      content: result.response || 'Multi-agent processing completed',
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      agentThinking: this.extractThinkingFromMultiAgentResult(result),
      riskLevel: 'medium',
    };
  }

  /**
   * Handle MCP integration requests
   */
  private async handleMCP(params: {
    userId: string;
    message: string;
    modelId: string;
    context: any;
    attachmentContext?: string;
    conversationId: string;
    githubContext?: any;
    vercelContext?: any;
    mongodbContext?: any;
    userPreferences?: any;
    previousMessages?: Array<{ role: string; content: string }>;
    selectionResponse?: any;
    contextPreamble?: string;
  }): Promise<{
    content: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    riskLevel?: string;
    agentThinking?: any;
    mongodbIntegrationData?: any;
    formattedResult?: any;
    githubIntegrationData?: any;
    vercelIntegrationData?: any;
    slackIntegrationData?: any;
    discordIntegrationData?: any;
    jiraIntegrationData?: any;
    linearIntegrationData?: any;
    googleIntegrationData?: any;
    awsIntegrationData?: any;
    requiresConnection?: any;
    requiresSelection?: boolean;
    selection?: any;
  }> {
    // Create HandlerRequest for MCPHandler
    const handlerRequest = {
      userId: params.userId,
      message: params.message,
      modelId: params.modelId,
      githubContext: params.githubContext,
      vercelContext: params.vercelContext,
      mongodbContext: params.mongodbContext,
      selectionResponse: params.selectionResponse,
    };

    // Create ConversationContext
    const conversationContext: ConversationContext = {
      ...params.context,
      conversationId: params.conversationId,
      currentSubject: params.context?.currentSubject,
      currentIntent: params.context?.currentIntent,
      languageFramework: params.context?.languageFramework,
      lastReferencedEntities: params.context?.lastReferencedEntities || [],
      timestamp: new Date(),
    };

    const result = await this.mcpHandler.handle(
      handlerRequest,
      conversationContext,
      params.previousMessages || [],
      params.contextPreamble,
    );

    return {
      content: result.response ?? '',
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      agentThinking: result.agentThinking,
      mongodbIntegrationData: result.mongodbIntegrationData,
      formattedResult: result.formattedResult,
      githubIntegrationData: result.githubIntegrationData,
      vercelIntegrationData: result.vercelIntegrationData,
      slackIntegrationData: result.slackIntegrationData,
      discordIntegrationData: result.discordIntegrationData,
      jiraIntegrationData: result.jiraIntegrationData,
      linearIntegrationData: result.linearIntegrationData,
      googleIntegrationData: result.googleIntegrationData,
      awsIntegrationData: result.awsIntegrationData,
      requiresConnection: result.requiresConnection,
      requiresSelection: result.requiresSelection,
      selection: result.selection,
    };
  }

  /**
   * Handle conversational flow (default)
   */
  private async handleConversationalFlow(
    params: {
      userId: string;
      message: string;
      modelId: string;
      context: any;
      attachmentContext?: string;
      conversationId: string;
      githubContext?: any;
      userPreferences?: any;
      temperature?: number;
      maxTokens?: number;
      previousMessages?: Array<{ role: string; content: string }>;
      selectionResponse?: any;
      parsedMentions?: ParsedMention[];
      contextPreamble?: string;
    },
    startTime: number,
  ): Promise<{
    content: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    riskLevel?: string;
    agentThinking?: any;
    thinking?: any;
    metadata?: { cost?: number; tokenCount?: number; latency?: number };
    response?: string;
  }> {
    // Check for integration commands first
    const mentions =
      params.parsedMentions ?? (await this.detectMentions(params.message));
    if (mentions.length > 0) {
      return await this.handleIntegrationCommands(
        params.userId,
        params.message,
        mentions,
        params.githubContext,
        params.userPreferences,
        params.contextPreamble,
      );
    }

    // Direct Bedrock path — inject real user stats into the system prompt
    const selectedModel = params.modelId;

    const tryBedrock = async (model: string) => {
      const previousMessages = params.previousMessages ?? [];
      const userStats = await this.getUserStats(params.userId);
      const prompt = this.buildConversationalPrompt(
        params.message,
        previousMessages,
        userStats,
      );
      const result = await BedrockService.invokeModel(prompt, model, {
        recentMessages: previousMessages,
        useSystemPrompt: true,
      });
      const responseText =
        typeof result === 'string' ? result : (result?.response ?? '');
      return responseText?.trim() || null;
    };

    if (selectedModel && selectedModel.trim()) {
      try {
        const responseText = await tryBedrock(selectedModel);
        if (responseText) {
          this.logger.log('Conversational response from direct Bedrock', {
            model: selectedModel,
            promptLength: params.message.length,
            responseLength: responseText.length,
          });
          return {
            content: responseText,
            agentPath: ['conversational_flow', 'direct_bedrock'],
            optimizationsApplied: ['direct_bedrock'],
            riskLevel: 'low',
            metadata: {
              latency: Date.now() - startTime,
              tokenCount: Math.ceil(responseText.length / 4),
            },
          };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn('Direct Bedrock failed, falling back to agent', {
          model: selectedModel,
          error: errMsg,
        });
      }
    }

    // EXISTING: Fallback to agentService.executeWithRouting (keep as-is)
    const result = await this.agentService.executeWithRouting(
      {
        userId: params.userId,
        query: params.message,
        context: {
          ...params.context,
          preamble: params.contextPreamble,
          previousMessages: params.previousMessages ?? [],
          githubContext: params.githubContext,
          userPreferences: params.userPreferences,
          selectedModel: params.modelId,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
        },
      },
      'conversational_flow',
      params.context,
    );

    const responseContent =
      result.response ??
      `I understand you said: "${params.message}". How can I help you with that?`;

    return {
      content: responseContent,
      response: responseContent, // Alias for backward compatibility
      agentPath: ['conversational_flow'],
      optimizationsApplied: ['agent_service'],
      riskLevel: 'low',
      thinking: result.thinking, // Propagate thinking
      metadata: {
        ...(result.metadata
          ? { cost: undefined, tokenCount: result.metadata.tokensUsed }
          : {}),
        latency: Date.now() - startTime, // Add latency
      },
    };
  }

  /**
   * Handle integration commands - uses AI-powered IntegrationAgentService as primary
   */
  private async handleIntegrationCommands(
    userId: string,
    message: string,
    mentions: ParsedMention[],
    githubContext?: any,
    userPreferences?: any,
    contextPreamble?: string,
  ): Promise<any> {
    // Log context preamble for debugging if provided
    if (contextPreamble) {
      this.logger.debug('Processing integration command with AI agent', {
        userId,
        messageLength: message.length,
        mentionsCount: mentions.length,
        contextPreambleLength: contextPreamble.length,
      });
    }

    // Get the primary integration from mentions
    const primaryIntegration =
      mentions.length > 0 ? mentions[0].integration : 'unknown';

    // Try AI-powered IntegrationAgentService first
    try {
      const agentResult =
        await this.integrationAgentService.processIntegrationCommand({
          userId,
          integration: primaryIntegration,
          message,
        });

      if (agentResult.success) {
        // Successful execution
        return {
          content: agentResult.result || agentResult.message,
          agentPath: ['integration_agent', 'ai_powered'],
          optimizationsApplied: [
            'ai_parameter_extraction',
            'response_sanitization',
          ],
          metadata: agentResult.metadata,
        };
      } else if (agentResult.requiresSelection) {
        // Return selection UI
        return {
          content: agentResult.message,
          requiresIntegrationSelector: true,
          integrationSelectorData: agentResult.selection,
          agentPath: ['integration_agent', 'selection_required'],
          optimizationsApplied: ['ai_parameter_extraction'],
          metadata: agentResult.metadata,
        };
      } else {
        // Agent failed, fall back to basic parsing
        this.logger.debug(
          'IntegrationAgentService failed, falling back to basic parsing',
          {
            error: agentResult.error,
          },
        );
      }
    } catch (error) {
      this.logger.warn(
        'IntegrationAgentService error, falling back to basic parsing',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    // Fallback: Use the original integration parsing logic
    const command = await this.integrationChatService.parseCommand(
      message,
      mentions,
    );
    if (!command) {
      return {
        content:
          'I could not understand the integration command. Please try rephrasing.',
        agentPath: ['integration_failed'],
      };
    }

    // Build context with all available parameters for relevant integration processing
    const integrationContext: Record<string, any> = {};

    // Add GitHub context for repository-aware processing
    if (githubContext) {
      integrationContext.github = {
        connectionId: githubContext.connectionId,
        repositoryId: githubContext.repositoryId,
        repositoryName: githubContext.repositoryName,
        repositoryFullName: githubContext.repositoryFullName,
        branchName: githubContext.branchName,
      };
    }

    // Add user preferences for personalized processing
    if (userPreferences) {
      integrationContext.userPreferences = userPreferences;
    }

    // Add context preamble for enhanced understanding
    if (contextPreamble) {
      integrationContext.contextPreamble = contextPreamble;
    }

    // Add conversation context if available
    if (mentions && mentions.length > 0) {
      integrationContext.mentions = mentions;
      integrationContext.primaryIntegration = mentions[0].integration;
    }

    const result = await this.mcpIntegrationHandler.handleIntegrationOperation({
      userId,
      command,
      context: integrationContext,
    });

    return {
      content: result.result.message,
      agentPath: ['integration_handler', 'fallback'],
      optimizationsApplied: ['mcp_integration'],
      metadata: {
        success: result.success,
      },
    };
  }

  /**
   * Internal wrapper for MCP route processing (Express parity)
   * Converts HandlerRequest format to processMCPRoute format
   */
  async handleMCPRoute(
    request: HandlerRequest,
    context: ConversationContext,
    recentMessages: any[],
    contextPreamble?: string,
  ): Promise<HandlerResult> {
    const result = await this.processMCPRoute(
      {
        userId: request.userId,
        message: request.message,
        conversationId: request.conversationId,
        githubContext: request.githubContext,
        vercelContext: request.vercelContext,
        mongodbContext: request.mongodbContext,
        slackContext: request.slackContext,
        discordContext: request.discordContext,
        jiraContext: request.jiraContext,
        linearContext: request.linearContext,
        awsContext: request.awsContext,
        googleContext: request.googleContext,
      },
      context,
      recentMessages,
      contextPreamble,
      this.mapHandlerMentionsToParsedMentions(request.parsedMentions),
    );

    return {
      response: result.response,
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      mongodbIntegrationData: result.mongodbIntegrationData,
      formattedResult: result.formattedResult,
      githubIntegrationData: result.githubIntegrationData,
      vercelIntegrationData: result.vercelIntegrationData,
      slackIntegrationData: result.slackIntegrationData,
      discordIntegrationData: result.discordIntegrationData,
      jiraIntegrationData: result.jiraIntegrationData,
      linearIntegrationData: result.linearIntegrationData,
      googleIntegrationData: result.googleIntegrationData,
      awsIntegrationData: result.awsIntegrationData,
      requiresConnection: result.requiresConnection,
      requiresSelection: result.requiresSelection,
      selection: result.selection,
    };
  }

  async processMCPRoute(
    chatRequest: {
      userId: string;
      message?: string;
      conversationId?: string;
      mongodbContext?: any;
      githubContext?: any;
      vercelContext?: any;
      slackContext?: any;
      discordContext?: any;
      jiraContext?: any;
      linearContext?: any;
      awsContext?: any;
      googleContext?: any;
    },
    context: ConversationContext,
    recentMessages: any[],
    contextPreamble?: string,
    parsedMentions?: ParsedMention[],
  ): Promise<{
    response: string;
    agentPath: string[];
    optimizationsApplied: string[];
    cacheHit: boolean;
    riskLevel: string;
    mongodbIntegrationData?: any;
    formattedResult?: any;
    githubIntegrationData?: any;
    vercelIntegrationData?: any;
    slackIntegrationData?: any;
    discordIntegrationData?: any;
    jiraIntegrationData?: any;
    linearIntegrationData?: any;
    googleIntegrationData?: any;
    awsIntegrationData?: any;
    requiresConnection?: any;
    requiresSelection?: boolean;
    selection?: any;
  }> {
    const message = chatRequest.message ?? '';
    const mentions = parsedMentions || (await this.detectMentions(message));

    // Gather all possible integration data from chatRequest (even if undefined)
    const baseIntegrationData = {
      mongodbIntegrationData: chatRequest.mongodbContext,
      githubIntegrationData: chatRequest.githubContext,
      vercelIntegrationData: chatRequest.vercelContext,
      slackIntegrationData: chatRequest.slackContext,
      discordIntegrationData: chatRequest.discordContext,
      jiraIntegrationData: chatRequest.jiraContext,
      linearIntegrationData: chatRequest.linearContext,
      googleIntegrationData: chatRequest.googleContext,
      awsIntegrationData: chatRequest.awsContext,
    };

    if (mentions.length > 0) {
      /**
       * Pass context and recentMessages to the integration handler
       * in case they're needed for integration logic.
       */
      const result = await this.handleIntegrationCommands(
        chatRequest.userId,
        message,
        mentions,
        chatRequest.githubContext,
        {
          context,
          recentMessages,
        },
        contextPreamble,
      );

      return {
        response: result.content ?? '',
        agentPath: result.agentPath ?? ['mcp'],
        optimizationsApplied: result.optimizationsApplied ?? [],
        cacheHit: result.cacheHit ?? false,
        riskLevel: result.riskLevel ?? 'low',
        ...baseIntegrationData,
        ...(result.metadata && { formattedResult: result.metadata }),
        ...(result.requiresConnection && {
          requiresConnection: result.requiresConnection,
        }),
        ...(typeof result.requiresSelection === 'boolean' && {
          requiresSelection: result.requiresSelection,
        }),
        ...(result.selection && { selection: result.selection }),
      };
    }

    return {
      response:
        'No integration command detected. Use @integration:action to run integration commands.',
      agentPath: ['mcp', 'no_command'],
      optimizationsApplied: [],
      cacheHit: false,
      riskLevel: 'low',
      ...baseIntegrationData,
    };
  }

  /**
   * Known integrations that are supported by the system
   */
  private static readonly KNOWN_INTEGRATIONS = new Set([
    'jira',
    'linear',
    'slack',
    'discord',
    'github',
    'vercel',
    'mongodb',
    'aws',
    'google',
    'gmail',
    'drive',
    'sheets',
    'calendar',
    'webhook',
  ]);

  /**
   * Map HandlerRequest-style mentions (type, id?, displayName?) to ParsedMention[]
   * for processMCPRoute. Returns undefined when input is undefined so callers can fall back to detectMentions.
   */
  private mapHandlerMentionsToParsedMentions(
    parsedMentions: Array<{ type: string; id?: string; displayName?: string }> | undefined,
  ): ParsedMention[] | undefined {
    if (!parsedMentions || parsedMentions.length === 0) {
      return undefined;
    }
    return parsedMentions.map((m) => ({
      integration: m.type,
      originalMention: m.displayName ? `@${m.type}:${m.displayName}` : `@${m.type}`,
      entityId: m.id,
    }));
  }

  /**
   * Detect @mentions in message, filtering for known integrations only
   */
  private async detectMentions(message: string): Promise<ParsedMention[]> {
    const mentions: ParsedMention[] = [];

    // Complex regex matching Express pattern: @integration:entityType:entityId:subEntity
    // Also supports @integration:action and @integration
    const complexMentionRegex =
      /@([a-z]+)(?::([a-z]+(?:-[a-z]+)*)(?::([a-zA-Z0-9_-]+))?(?::([a-z]+):([a-zA-Z0-9_-]+))?)?/g;
    const simpleMentionRegex = /@([a-z]+)(?![:\w])/g;

    let match;

    // Try complex pattern first (entity-based mentions)
    while ((match = complexMentionRegex.exec(message)) !== null) {
      const [, integration, entityType, entityId, subEntityType, subEntityId] =
        match;

      // Only include mentions for known integrations
      if (ChatService.KNOWN_INTEGRATIONS.has(integration.toLowerCase())) {
        mentions.push({
          integration,
          entityType,
          entityId,
          subEntityType,
          subEntityId,
          originalMention: match[0],
        });
      }
    }

    // If no complex mentions found, try simple pattern
    if (mentions.length === 0) {
      while ((match = simpleMentionRegex.exec(message)) !== null) {
        const [, integration] = match;

        // Only include mentions for known integrations
        if (ChatService.KNOWN_INTEGRATIONS.has(integration.toLowerCase())) {
          mentions.push({
            integration,
            originalMention: match[0],
          });
        }
      }
    }

    return mentions;
  }

  /**
   * Fetch document metadata for attached documents
   */
  private async fetchDocumentMetadata(
    documentIds: string[],
    userId: string,
  ): Promise<
    Array<{
      documentId: string;
      fileName: string;
      chunksCount: number;
      fileType?: string;
    }>
  > {
    const documents = await this.documentModel
      .find({
        _id: { $in: documentIds },
        $or: [
          { 'metadata.userId': userId },
          { 'metadata.source': { $in: ['knowledge-base', 'user-upload'] } },
        ],
        status: 'active',
      })
      .select('metadata.fileName metadata.fileType totalChunks _id')
      .lean()
      .exec();

    return documents.map((doc: any) => ({
      documentId: doc._id.toString(),
      fileName: doc.metadata?.fileName || 'Unknown Document',
      chunksCount: doc.totalChunks || 0,
      fileType: doc.metadata?.fileType,
    }));
  }

  /**
   * Get or create conversation
   */
  private async getOrCreateConversation(
    userId: string,
    dto: SendMessageDto,
  ): Promise<ChatConversationDocument> {
    if (dto.conversationId) {
      const conversation = await this.conversationModel.findOne({
        _id: dto.conversationId,
        userId,
      });

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      return conversation;
    }

    // Create new conversation with smart title generation
    const title = dto.message
      ? this.generateSimpleTitle(dto.message, dto.modelId)
      : 'New Chat';

    const conversation = await this.conversationModel.create({
      userId,
      title,
      modelId: dto.modelId,
    });

    return conversation;
  }

  /**
   * Update conversation after message
   */
  private async updateConversationAfterMessage(
    conversation: ChatConversationDocument,
    message: ChatMessageDocument,
    session?: any,
  ): Promise<void> {
    conversation.messageCount = (conversation.messageCount || 0) + 2; // user + assistant
    conversation.lastMessage = message.content?.substring(0, 49999) ?? '';
    conversation.lastMessageAt = message.createdAt;
    conversation.totalCost =
      (conversation.totalCost || 0) + (message.metadata?.cost || 0);
    await conversation.save({ session });
  }

  /**
   * Get available models from registry
   */
  getAvailableModels(): Array<{
    id: string;
    name: string;
    provider: string;
    description?: string;
    contextLength: number;
    costPerToken: number;
    capabilities: string[];
    pricing?: { input: number; output: number; unit: string };
    isAvailable: boolean;
  }> {
    const models = ModelRegistry.getAvailableModels();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      description:
        m.description || `${m.name} - AI model for text generation and chat`,
      contextLength: 128000,
      costPerToken: (m.pricing?.input ?? 0) + (m.pricing?.output ?? 0) / 2,
      capabilities: m.capabilities ?? ['text'],
      pricing: m.pricing,
      isAvailable: true,
    }));
  }

  /**
   * Get user conversations
   */
  async getUserConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    includeArchived: boolean = false,
  ): Promise<{
    conversations: ConversationResponse[];
    total: number; // Express API compatibility
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const filter: any = { userId };
    if (!includeArchived) {
      filter.isArchived = { $ne: true };
    }

    const total = await this.conversationModel.countDocuments(filter);
    const conversations = await this.conversationModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const pages = Math.ceil(total / limit);
    const page = Math.floor(offset / limit) + 1;

    return {
      conversations: conversations.map((c) => ({
        id: c._id.toString(),
        userId: c.userId,
        title: c.title,
        modelId: c.modelId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messageCount || 0,
        lastMessage: c.lastMessage,
        totalCost: c.totalCost || 0,
        isPinned: c.isPinned,
        isArchived: c.isArchived,
        githubContext: c.githubContext
          ? {
              connectionId:
                c.githubContext.connectionId != null
                  ? String(c.githubContext.connectionId)
                  : undefined,
              repositoryId: c.githubContext.repositoryId,
              repositoryName: c.githubContext.repositoryName,
              repositoryFullName: c.githubContext.repositoryFullName,
              integrationId:
                c.githubContext.integrationId != null
                  ? String(c.githubContext.integrationId)
                  : undefined,
              branchName: c.githubContext.branchName,
            }
          : undefined,
        vercelContext: c.vercelContext
          ? {
              connectionId:
                c.vercelContext.connectionId != null
                  ? String(c.vercelContext.connectionId)
                  : undefined,
              projectId: c.vercelContext.projectId,
              projectName: c.vercelContext.projectName,
            }
          : undefined,
      })),
      total, // Express API compatibility
      pagination: {
        page,
        limit,
        total,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(
    conversationId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{
    conversation: { id: string; title: string; modelId: string };
    messages: ChatMessageResponse[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    // Verify conversation ownership
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const total = await this.chatMessageModel.countDocuments({
      conversationId: new Types.ObjectId(conversationId),
    });
    const messages = await this.chatMessageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const page = Math.floor(offset / limit) + 1;
    const pages = Math.ceil(total / limit);

    return {
      conversation: {
        id: conversation._id.toString(),
        title: conversation.title,
        modelId: conversation.modelId,
      },
      messages: messages.map((m) => ({
        id: m._id.toString(),
        conversationId: String(m.conversationId),
        role: m.role,
        content: m.content,
        modelId: m.modelId,
        messageType: m.messageType,
        governedTaskId:
          m.governedTaskId != null ? String(m.governedTaskId) : undefined,
        planState: m.planState,
        attachedDocuments: m.attachedDocuments,
        attachments: m.attachments,
        timestamp: m.createdAt,
        metadata: m.metadata,
        agentPath: m.agentPath,
        optimizationsApplied: m.optimizationsApplied,
        cacheHit: m.cacheHit,
        riskLevel: m.riskLevel,
      })),
      pagination: {
        page,
        limit,
        total,
        hasNext: page < pages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get a single conversation by id (ownership enforced).
   */
  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationResponse | null> {
    const conversation = await this.conversationModel
      .findOne({ _id: conversationId, userId })
      .lean();

    if (!conversation) return null;

    return {
      id: conversation._id.toString(),
      userId: conversation.userId,
      title: conversation.title,
      modelId: conversation.modelId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messageCount || 0,
      lastMessage: conversation.lastMessage,
      totalCost: conversation.totalCost || 0,
      isPinned: conversation.isPinned,
      isArchived: conversation.isArchived,
      githubContext: conversation.githubContext
        ? {
            connectionId:
              conversation.githubContext.connectionId != null
                ? String(conversation.githubContext.connectionId)
                : undefined,
            repositoryId: conversation.githubContext.repositoryId,
            repositoryName: conversation.githubContext.repositoryName,
            repositoryFullName: conversation.githubContext.repositoryFullName,
            integrationId:
              conversation.githubContext.integrationId != null
                ? String(conversation.githubContext.integrationId)
                : undefined,
            branchName: conversation.githubContext.branchName,
          }
        : undefined,
      vercelContext: conversation.vercelContext
        ? {
            connectionId:
              conversation.vercelContext.connectionId != null
                ? String(conversation.vercelContext.connectionId)
                : undefined,
            projectId: conversation.vercelContext.projectId,
            projectName: conversation.vercelContext.projectName,
          }
        : undefined,
    };
  }

  /**
   * Clear in-memory context cache for a conversation (e.g. on conversation delete or reset).
   */
  async clearConversationContext(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    this.contextManager.clearContext(conversationId);
    this.logger.debug('Conversation context cleared', {
      conversationId,
      userId,
    });
  }

  /**
   * Resolve a prompt template into a message string using template variables.
   * Used when sending a message with templateId (e.g. from SendMessageDto).
   * Returns the resolved prompt to use as the message content.
   * Requires PromptTemplateModule to be imported in ChatModule.
   */
  async resolveMessageWithTemplate(
    templateId: string,
    userId: string,
    variables?: Record<string, unknown>,
    context?: Array<{ role: string; content: string }>,
  ): Promise<{
    content: string;
    templateName?: string;
    templateMetadata?: any;
  }> {
    if (!this.promptTemplateService) {
      throw new Error(
        'Template resolution not available: import PromptTemplateModule in ChatModule',
      );
    }

    // Try context-aware resolution if context is provided
    let content: string;
    let templateMetadata: any;

    if (context && context.length > 0) {
      try {
        // Check if the service has useTemplateWithContext method
        if (
          typeof (this.promptTemplateService as any).useTemplateWithContext ===
          'function'
        ) {
          const result = await (
            this.promptTemplateService as any
          ).useTemplateWithContext(
            templateId,
            userId,
            (variables ?? {}) as Record<string, any>,
            context,
          );
          content = result.content;
          templateMetadata = result.templateMetadata;
        } else {
          // Fallback to regular template resolution
          content = await this.promptTemplateService.useTemplate(
            templateId,
            userId,
            (variables ?? {}) as Record<string, any>,
          );
        }
      } catch (contextError) {
        // Fallback to regular template resolution
        content = await this.promptTemplateService.useTemplate(
          templateId,
          userId,
          (variables ?? {}) as Record<string, any>,
        );
      }
    } else {
      // No context provided, use regular resolution
      content = await this.promptTemplateService.useTemplate(
        templateId,
        userId,
        (variables ?? {}) as Record<string, any>,
      );
    }

    return { content, templateMetadata };
  }

  /**
   * Update conversation Vercel context (project/deployment context).
   */
  async updateVercelContext(
    conversationId: string,
    userId: string,
    dto: {
      connectionId?: string;
      projectId?: string;
      projectName?: string;
    },
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const update: Record<string, unknown> = {};
    if (dto.connectionId != null)
      update['vercelContext.connectionId'] = dto.connectionId;
    if (dto.projectId != null)
      update['vercelContext.projectId'] = dto.projectId;
    if (dto.projectName != null)
      update['vercelContext.projectName'] = dto.projectName;

    if (Object.keys(update).length > 0) {
      await this.conversationModel.updateOne(
        { _id: conversationId, userId },
        { $set: update, updatedAt: new Date() },
      );
    }
  }

  /**
   * Create new conversation
   */
  async createConversation(
    userId: string,
    dto: { title?: string; modelId?: string },
  ): Promise<ChatConversationDocument> {
    const conversation = await this.conversationModel.create({
      userId,
      title: dto.title || 'New Chat',
      modelId: dto.modelId || 'nova-pro',
    });

    return conversation;
  }

  /**
   * Generate a smart title from the first message content
   */
  private generateSimpleTitle(firstMessage: string, modelId: string): string {
    // Remove markdown, code blocks, etc.
    const cleaned = firstMessage
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();

    // Get first sentence or first 60 characters
    const firstSentence = cleaned.split(/[.!?]/)[0].trim();

    if (firstSentence.length > 60) {
      return firstSentence.substring(0, 57) + '...';
    } else if (firstSentence.length > 0) {
      return firstSentence;
    } else {
      return `Chat with ${ModelRegistry.getDisplayName(modelId)}`;
    }
  }

  /**
   * Create a user message in a conversation (e.g. for governed agent initiation).
   */
  async createUserMessage(
    conversationId: string,
    userId: string,
    content: string,
  ): Promise<ChatMessageDocument> {
    const message = await this.chatMessageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      userId,
      role: 'user',
      content,
    });
    return message;
  }

  /**
   * Update conversation GitHub context
   */
  async updateGitHubContext(
    conversationId: string,
    userId: string,
    dto: {
      connectionId?: string;
      repositoryId?: number;
      repositoryName?: string;
      repositoryFullName?: string;
      integrationId?: string;
      branchName?: string;
    },
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Validate GitHub connection ownership if connectionId is provided
    if (dto.connectionId) {
      const githubConnection = await this.githubConnectionModel.findOne({
        _id: dto.connectionId,
        userId,
        isActive: true,
      });

      if (!githubConnection) {
        throw new Error('GitHub connection not found or access denied');
      }
    }

    const update: Record<string, unknown> = {};
    if (dto.connectionId != null)
      update['githubContext.connectionId'] = dto.connectionId;
    if (dto.repositoryId != null)
      update['githubContext.repositoryId'] = dto.repositoryId;
    if (dto.repositoryName != null)
      update['githubContext.repositoryName'] = dto.repositoryName;
    if (dto.repositoryFullName != null)
      update['githubContext.repositoryFullName'] = dto.repositoryFullName;
    if (dto.integrationId != null)
      update['githubContext.integrationId'] = dto.integrationId;
    if (dto.branchName != null)
      update['githubContext.branchName'] = dto.branchName;

    if (Object.keys(update).length > 0) {
      await this.conversationModel.updateOne(
        { _id: conversationId, userId },
        { $set: update, updatedAt: new Date() },
      );
    }
  }

  /**
   * Update conversation MongoDB context
   */
  async updateMongoDBContext(
    conversationId: string,
    userId: string,
    dto: {
      connectionId?: string;
      activeDatabase?: string;
      activeCollection?: string;
      recentQueries?: Array<{
        query: any;
        collection: string;
        timestamp?: Date;
      }>;
    },
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const update: Record<string, unknown> = {};
    if (dto.connectionId != null)
      update['mongodbContext.connectionId'] = dto.connectionId;
    if (dto.activeDatabase != null)
      update['mongodbContext.activeDatabase'] = dto.activeDatabase;
    if (dto.activeCollection != null)
      update['mongodbContext.activeCollection'] = dto.activeCollection;
    if (dto.recentQueries != null)
      update['mongodbContext.recentQueries'] = dto.recentQueries;

    if (Object.keys(update).length > 0) {
      await this.conversationModel.updateOne(
        { _id: conversationId, userId },
        { $set: update, updatedAt: new Date() },
      );
    }
  }

  /**
   * Update conversation model
   */
  async updateConversationModel(
    conversationId: string,
    userId: string,
    modelId: string,
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Validate model exists
    const availableModels = ModelRegistry.getAvailableModels();
    const modelExists = availableModels.some(
      (model: { id: string }) => model.id === modelId,
    );

    if (!modelExists) {
      throw new Error(`Invalid model ID: ${modelId}`);
    }

    await this.conversationModel.updateOne(
      { _id: conversationId, userId },
      {
        $set: {
          modelId,
          updatedAt: new Date(),
        },
      },
    );
  }

  /**
   * Delete conversation (soft delete)
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const result = await this.conversationModel.updateOne(
      { _id: conversationId, userId },
      {
        deletedAt: new Date(),
        isArchived: true,
      },
    );

    if (result.matchedCount === 0) {
      throw new Error('Conversation not found');
    }
  }

  /**
   * Update conversation operations (rename, archive, pin)
   */
  async renameConversation(
    conversationId: string,
    userId: string,
    title: string,
  ): Promise<any> {
    const result = await this.conversationModel.updateOne(
      { _id: conversationId, userId },
      { title },
    );

    if (result.matchedCount === 0) {
      throw new Error('Conversation not found');
    }

    // Return the updated conversation
    return await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });
  }

  async archiveConversation(
    conversationId: string,
    userId: string,
    archived: boolean,
  ): Promise<any> {
    const result = await this.conversationModel.updateOne(
      { _id: conversationId, userId },
      { isArchived: archived },
    );

    if (result.matchedCount === 0) {
      throw new Error('Conversation not found');
    }

    // Return the updated conversation
    return await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });
  }

  async pinConversation(
    conversationId: string,
    userId: string,
    pinned: boolean,
  ): Promise<any> {
    const result = await this.conversationModel.updateOne(
      { _id: conversationId, userId },
      { isPinned: pinned },
    );

    if (result.matchedCount === 0) {
      throw new Error('Conversation not found');
    }

    // Return the updated conversation
    return await this.conversationModel.findOne({
      _id: conversationId,
      userId,
    });
  }

  /**
   * Governed agent plan operations – handles plan modification for a governed agent task within a chat.
   * This method validates the conversation and delegates plan changes to the GovernedAgentService.
   *
   * @param chatId - The conversation/chat identifier (must exist and belong to user)
   * @param taskId - The governed agent task identifier to modify
   * @param userId - The user requesting the plan modification (ownership enforced)
   * @param dto - The changes to apply (steps to add, remove, or modify)
   *
   * Throws if the conversation or the link to the requested task is not found or not allowed.
   */
  async modifyPlan(
    chatId: string,
    taskId: string,
    userId: string,
    dto: {
      addSteps?: any[];
      removeSteps?: string[];
      modifySteps?: { stepId: string; changes: any }[];
    },
  ): Promise<any> {
    // Step 1: Ensure the conversation exists and is owned by user
    const conversation = await this.conversationModel.findOne({
      _id: chatId,
      userId,
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Step 2: Ensure the taskId is linked to this conversation
    // (This prevents modifying tasks not associated with the chat)
    const chatTaskLink = await this.chatTaskLinkModel.findOne({
      chatId: new Types.ObjectId(chatId),
    });
    if (
      !chatTaskLink ||
      !chatTaskLink.taskIds?.some((id: any) => id?.toString() === taskId)
    ) {
      throw new Error('Task is not linked to this conversation');
    }

    // Step 3: Delegate plan modification logic to the GovernedAgentService
    const updatedTask = await this.governedAgentService.modifyPlan(
      taskId,
      userId,
      {
        addSteps: dto.addSteps,
        removeSteps: dto.removeSteps,
        modifySteps: dto.modifySteps,
      },
    );

    return updatedTask;
  }

  /**
   * Ask a question about the governed agent plan in the context of a chat.
   * This checks chat & user ownership, task linkage, and delegates to GovernedAgentService.
   *
   * @param chatId - The conversation/chat identifier (must exist and belong to user)
   * @param taskId - The governed agent task identifier (must be linked to chat)
   * @param userId - The user asking the question (ownership enforced)
   * @param dto - The question details
   *
   * @returns The response string from the GovernedAgentService
   * @throws If chat does not exist or task is not linked to chat
   */
  async askAboutPlan(
    chatId: string,
    taskId: string,
    userId: string,
    dto: { question: string },
  ): Promise<string> {
    // Step 1: Ensure the conversation exists and is owned by the user
    const conversation = await this.conversationModel.findOne({
      _id: chatId,
      userId,
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Step 2: Ensure the taskId is linked to this conversation
    const chatTaskLink = await this.chatTaskLinkModel.findOne({
      chatId: new Types.ObjectId(chatId),
    });
    if (
      !chatTaskLink ||
      !chatTaskLink.taskIds?.some((id: any) => id?.toString() === taskId)
    ) {
      throw new Error('Task is not linked to this conversation');
    }

    // Step 3: Delegate to GovernedAgentService for answering the plan question
    return this.governedAgentService.askAboutPlan(taskId, userId, dto.question);
  }

  /**
   * Request code changes for a governed agent task in the context of a chat.
   * Checks that the chat exists and is owned by the user, and that the task is linked to this chat.
   * Delegates the change request to the GovernedAgentService.
   *
   * @param chatId - The conversation/chat identifier (must exist and belong to user)
   * @param taskId - The governed agent task identifier (must be linked to chat)
   * @param userId - The user requesting the code change (ownership enforced)
   * @param dto - The code change request details
   *
   * @throws If the conversation does not exist or the task is not linked to the chat
   */
  async requestCodeChanges(
    chatId: string,
    taskId: string,
    userId: string,
    dto: { changeRequest: string },
  ): Promise<any> {
    // Step 1: Ensure the conversation exists and is owned by the user
    const conversation = await this.conversationModel.findOne({
      _id: chatId,
      userId,
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Step 2: Ensure the taskId is linked to this conversation
    const chatTaskLink = await this.chatTaskLinkModel.findOne({
      chatId: new Types.ObjectId(chatId),
    });
    if (
      !chatTaskLink ||
      !chatTaskLink.taskIds?.some((id: any) => id?.toString() === taskId)
    ) {
      throw new Error('Task is not linked to this conversation');
    }

    // Step 3: Delegate code change request to the GovernedAgentService and return the new task
    const newTask = await this.governedAgentService.requestCodeChanges(
      taskId,
      userId,
      dto.changeRequest,
    );

    return newTask;
  }

  async getChatPlans(chatId: string, userId: string): Promise<any[]> {
    const conversation = await this.conversationModel.findOne({
      _id: chatId,
      userId,
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    const link = await this.chatTaskLinkModel
      .findOne({ chatId: new Types.ObjectId(chatId) })
      .lean();
    if (!link || !link.taskIds?.length) return [];

    // Fetch full governed task documents
    const taskIds = link.taskIds.map((taskId) =>
      typeof taskId === 'string' ? taskId : String(taskId),
    );
    const tasks = await this.governedTaskModel
      .find({
        id: { $in: taskIds },
        userId,
      })
      .lean();

    return tasks;
  }

  /**
   * Update message view type
   */
  async updateMessageViewType(
    messageId: string,
    userId: string,
    dto: any,
  ): Promise<boolean> {
    const result = await this.chatMessageModel.updateOne(
      {
        _id: messageId,
        userId,
        'mongodbIntegrationData.action': { $exists: true },
      }, // Ensure it's a MongoDB result message
      {
        mongodbSelectedViewType: dto.viewType,
        updatedAt: new Date(),
      },
    );

    if (result.matchedCount === 0) {
      throw new Error('MongoDB message not found for view type update');
    }

    return true;
  }

  /**
   * Update message feedback
   */
  async updateMessageFeedback(
    messageId: string,
    userId: string,
    dto: { feedback: 'positive' | 'negative' | 'neutral'; reason?: string },
  ): Promise<boolean> {
    const result = await this.chatMessageModel.updateOne(
      {
        _id: messageId,
        userId,
        role: 'assistant', // Only allow feedback on assistant messages
      },
      {
        feedback: dto.feedback,
        feedbackReason: dto.reason,
        updatedAt: new Date(),
      },
    );

    if (result.matchedCount === 0) {
      throw new Error('Assistant message not found for feedback update');
    }

    return true;
  }

  /**
   * Get user preferences for personalized chat experience
   */
  async getUserPreferences(userId: string): Promise<any> {
    try {
      const preferences =
        await this.userPreferenceService.getUserPreferences(userId);

      if (preferences) {
        return {
          userPreferences: preferences,
        };
      }

      // Return default preferences if none exist
      return {
        userPreferences: {
          preferredModel: null,
          preferredChatMode: 'balanced',
          preferredStyle: null,
          commonTopics: [],
          costPreference: 'balanced',
          responseLength: 'detailed',
          technicalLevel: 'intermediate',
          notificationPreferences: {
            email: true,
            push: true,
            sms: false,
          },
        },
      };
    } catch (error) {
      this.logger.warn('Failed to get user preferences', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { userPreferences: {} };
    }
  }

  /**
   * Get a single message by ID
   */
  async getMessage(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageDocument | null> {
    const message = await this.chatMessageModel
      .findOne({
        _id: messageId,
        userId, // Ensure user owns the message
      })
      .populate('conversationId', 'title userId');

    if (!message) {
      return null;
    }

    return message;
  }

  /**
   * Update a message (edit content, attachments, etc.)
   */
  async updateMessage(
    messageId: string,
    userId: string,
    updateData: {
      content?: string;
      metadata?: Record<string, any>;
      attachments?: any[];
    },
  ): Promise<ChatMessageDocument | null> {
    // Only allow editing user messages (not assistant/system messages)
    const message = await this.chatMessageModel.findOneAndUpdate(
      {
        _id: messageId,
        userId,
        role: 'user', // Only user messages can be edited
      },
      {
        ...updateData,
        metadata: {
          ...updateData.metadata,
          edited: true,
          editedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!message) {
      return null;
    }

    // Emit message update event
    this.chatEventsService.emitMessage(
      message.conversationId.toString(),
      userId,
      {
        id: message._id.toString(),
        conversationId: message.conversationId.toString(),
        role: message.role,
        content: message.content,
        timestamp: message.createdAt,
        attachments: message.attachments,
        metadata: {
          ...message.metadata,
          edited: true,
          editedAt: new Date(),
        },
      },
    );

    return message;
  }

  /**
   * Delete a message (soft delete by marking as deleted)
   */
  async deleteMessage(messageId: string, userId: string): Promise<boolean> {
    // Only allow deleting user messages
    const result = await this.chatMessageModel.updateOne(
      {
        _id: messageId,
        userId,
        role: 'user', // Only user messages can be deleted
      },
      {
        content: '[Message deleted]',
        metadata: {
          deleted: true,
          deletedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return false;
    }

    // Get the message to emit deletion event
    const message = await this.chatMessageModel.findById(messageId);
    if (message) {
      this.chatEventsService.emitMessage(
        message.conversationId.toString(),
        userId,
        {
          id: message._id.toString(),
          conversationId: message.conversationId.toString(),
          role: message.role,
          content: '[Message deleted]',
          timestamp: message.createdAt,
          metadata: {
            deleted: true,
            deletedAt: new Date(),
          },
        },
      );
    }

    return true;
  }

  /**
   * Analyze usage patterns to infer user preferences
   */
  private analyzeUsagePatterns(usageData: any[]): {
    topModels: string[];
    avgDailyRequests: number;
    avgCostPerRequest: number;
    totalSpend: number;
    peakHours: number[];
    costSensitivity: 'low' | 'medium' | 'high';
    preferredChatMode: 'fast' | 'balanced' | 'quality';
    workingHours: boolean;
    preferredComplexity: 'simple' | 'complex';
    optimizationPreferences: {
      promptCaching: boolean;
      modelSwitching: boolean;
      batchProcessing: boolean;
    };
  } {
    if (!usageData.length) {
      return {
        topModels: [],
        avgDailyRequests: 0,
        avgCostPerRequest: 0,
        totalSpend: 0,
        peakHours: [],
        costSensitivity: 'medium',
        preferredChatMode: 'balanced',
        workingHours: false,
        preferredComplexity: 'simple',
        optimizationPreferences: {
          promptCaching: false,
          modelSwitching: false,
          batchProcessing: false,
        },
      };
    }

    // Calculate basic stats
    const totalSpend = usageData.reduce((sum, u) => sum + u.cost, 0);
    const avgCostPerRequest = totalSpend / usageData.length;

    // Model preferences
    const modelUsage = usageData.reduce((acc, u) => {
      acc[u.model] = (acc[u.model] || 0) + 1;
      return acc;
    }, {});
    const topModels = Object.entries(modelUsage)
      .sort(([, a]: [string, number], [, b]: [string, number]) => b - a)
      .slice(0, 3)
      .map(([model]) => model);

    // Cost sensitivity analysis
    const costSensitivity =
      avgCostPerRequest > 0.01
        ? 'high'
        : avgCostPerRequest > 0.005
          ? 'medium'
          : 'low';

    // Working hours detection
    const hourDistribution = usageData.reduce((acc, u) => {
      const hour = new Date(u.createdAt).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});
    const peakHours = Object.entries(hourDistribution)
      .sort(([, a]: [string, number], [, b]: [string, number]) => b - a)
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));
    const workingHours = peakHours.some((h) => h >= 9 && h <= 17);

    // Complexity preferences based on token usage
    const avgTokens =
      usageData.reduce((sum, u) => sum + u.totalTokens, 0) / usageData.length;
    const preferredComplexity = avgTokens > 2000 ? 'complex' : 'simple';

    // Chat mode preference based on response times and costs
    const avgResponseTime =
      usageData.reduce((sum, u) => sum + u.responseTime, 0) / usageData.length;
    const preferredChatMode =
      costSensitivity === 'high' && avgResponseTime < 2000
        ? 'fast'
        : avgTokens > 1000
          ? 'quality'
          : 'balanced';

    // Optimization preferences
    const hasPromptCaching = usageData.some((u) => u.promptCaching?.enabled);
    const hasModelSwitching = usageData.some(
      (u) => u.optimizationOpportunities?.costOptimization?.recommendedModel,
    );
    const hasBatchProcessing = usageData.some(
      (u) => u.orchestrationOverheadPercentage,
    );

    return {
      topModels,
      avgDailyRequests: usageData.length / 30, // Rough daily average
      avgCostPerRequest,
      totalSpend,
      peakHours,
      costSensitivity,
      preferredChatMode,
      workingHours,
      preferredComplexity,
      optimizationPreferences: {
        promptCaching: hasPromptCaching,
        modelSwitching: hasModelSwitching,
        batchProcessing: hasBatchProcessing,
      },
    };
  }

  /**
   * Fetch real aggregated stats for a user from the Usage collection.
   * Returns a compact summary string for injection into the system prompt.
   */
  private async getUserStats(userId: string): Promise<string> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [aggResult, recentUsage] = await Promise.all([
        this.usageModel
          .aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                createdAt: { $gte: thirtyDaysAgo },
              },
            },
            {
              $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
                totalRequests: { $sum: 1 },
                totalTokens: {
                  $sum: { $add: ['$promptTokens', '$completionTokens'] },
                },
                uniqueModels: { $addToSet: '$model' },
                uniqueProviders: { $addToSet: '$provider' },
                avgCostPerRequest: { $avg: '$cost' },
              },
            },
          ])
          .exec(),
        this.usageModel
          .find({ userId: new Types.ObjectId(userId) })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('model provider cost createdAt')
          .lean(),
      ]);

      interface AggStats {
        totalCost: number;
        totalRequests: number;
        totalTokens: number;
        uniqueModels: string[];
        uniqueProviders: string[];
        avgCostPerRequest: number;
      }
      const defaultStats: AggStats = {
        totalCost: 0,
        totalRequests: 0,
        totalTokens: 0,
        uniqueModels: [],
        uniqueProviders: [],
        avgCostPerRequest: 0,
      };
      const s: AggStats =
        (aggResult[0] as AggStats | undefined) ?? defaultStats;

      const topModels = s.uniqueModels.slice(0, 5).join(', ') || 'none yet';
      const providers = s.uniqueProviders.join(', ') || 'none yet';
      const recentActivity =
        recentUsage.length > 0
          ? (recentUsage as Array<{ model?: string; cost?: number }>)
              .map((u) => {
                const cost = (u.cost ?? 0).toFixed(4);
                return `${u.model ?? 'unknown'} ($${cost})`;
              })
              .join(', ')
          : 'no recent activity';

      return [
        `Total spend (last 30 days): $${s.totalCost.toFixed(4)}`,
        `Total API requests (last 30 days): ${s.totalRequests}`,
        `Total tokens used: ${s.totalTokens.toLocaleString()}`,
        `Avg cost per request: $${s.avgCostPerRequest.toFixed(6)}`,
        `Models used: ${topModels}`,
        `Providers: ${providers}`,
        `Recent calls: ${recentActivity}`,
      ].join('\n');
    } catch {
      return 'Usage data unavailable.';
    }
  }

  /**
   * Build a Cost-Katana-aware prompt that injects the platform identity,
   * the user's real usage stats, and conversation history before the query.
   */
  private buildConversationalPrompt(
    query: string,
    previousMessages: Array<{ role: string; content: string }>,
    userStats?: string,
  ): string {
    const systemBlock = [
      'You are Cost Katana, an AI-powered cost optimization assistant.',
      'Your mission is to help users monitor, analyze, and reduce their AI API spending across all providers.',
      "You have access to this user's actual Cost Katana account data shown below.",
      'Always answer questions about their usage, costs, and models using this data',
      '— never say you lack access to their records.',
      '',
      '=== USER ACCOUNT DATA ===',
      userStats ?? 'No usage data available yet.',
      '=== END USER ACCOUNT DATA ===',
    ].join('\n');

    const recent = (previousMessages ?? []).slice(-6);
    const historyLines = recent.map(
      (m) =>
        `${m.role === 'user' ? 'Human' : 'Assistant'}: ${(m.content || '').trim()}`,
    );

    return [
      `System: ${systemBlock}`,
      '',
      ...historyLines,
      `Human: ${query}`,
      'Assistant:',
    ].join('\n\n');
  }

  /**
   * Handle strategy formation response in multi-turn flow
   */
  private async handleStrategyFormationResponse(
    userId: string,
    dto: SendMessageDto,
    conversation: ChatConversationDocument,
    effectiveMessage: string,
    startTime: number,
  ): Promise<ChatMessageResponse> {
    try {
      const sessionId = (dto.selectionResponse as any).sessionId;
      const session = await this.getUserInputSession(sessionId);

      if (session) {
        const { state, questionIndex } = session;

        // Update strategy with user response
        state.strategyFormation.responses[`question_${questionIndex}`] =
          dto.selectionResponse!.value;

        // Check if more questions remain
        if (questionIndex < state.strategyFormation.questions.length - 1) {
          // Continue with next question - route to multi-agent flow for next question
          return await this.continueStrategyFormation(
            userId,
            dto,
            conversation,
            state,
            questionIndex + 1,
            startTime,
          );
        } else {
          // Strategy formation complete - execute final synthesis
          return await this.completeStrategyFormation(
            userId,
            dto,
            conversation,
            state,
            sessionId,
            effectiveMessage,
            startTime,
          );
        }
      } else {
        throw new Error('Strategy formation session not found');
      }
    } catch (error) {
      this.logger.error('Strategy formation response handling failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: (dto.selectionResponse as any)?.sessionId,
      });
      throw error;
    }
  }

  /**
   * Continue strategy formation with next question
   */
  private async continueStrategyFormation(
    userId: string,
    dto: SendMessageDto,
    conversation: ChatConversationDocument,
    state: any,
    nextQuestionIndex: number,
    startTime: number,
  ): Promise<ChatMessageResponse> {
    // Route through Langchain orchestrator with user_input_collection agent
    if (!this.langchainOrchestrator.isInitialized()) {
      throw new Error('Langchain orchestrator not initialized');
    }

    const graph = this.langchainOrchestrator.getGraph();
    if (!graph) {
      throw new Error('Langchain graph not available');
    }

    // Update state with user response and increment question index
    const updatedState = {
      ...state,
      strategyFormation: {
        ...state.strategyFormation,
        currentQuestion: nextQuestionIndex,
        responses: {
          ...state.strategyFormation.responses,
          [`question_${nextQuestionIndex - 1}`]: dto.selectionResponse!.value,
        },
      },
    };

    const inputState = {
      messages: [
        ...(state.messages || []),
        { role: 'user', content: dto.selectionResponse!.value },
      ],
      userId,
      userMessage: dto.selectionResponse!.value,
      conversationId: conversation._id.toString(),
      context: updatedState.context,
      strategyFormation: updatedState.strategyFormation,
      currentAgent: 'user_input_collection',
    };

    const langchainResult = await graph.invoke(inputState);

    // Check if the result contains selection UI (IntegrationSelector)
    if (
      langchainResult?.userInputCollection?.currentField?.type === 'selection'
    ) {
      const selectionField = langchainResult.userInputCollection.currentField;

      // Update session for next question
      const sessionId = `${conversation._id}_${Date.now()}`;
      await this.storeUserInputSession(sessionId, {
        state: updatedState,
        questionIndex: nextQuestionIndex,
      });

      // Return with selection UI (requiresSelection: true)
      return {
        id: `temp_${Date.now()}`,
        conversationId: conversation._id.toString(),
        role: 'assistant',
        content: selectionField.question,
        modelId: dto.modelId,
        timestamp: new Date(),
        agentPath: ['strategy_formation'],
        optimizationsApplied: ['dynamic_user_input'],
        requiresSelection: true,
        selection: {
          parameterName: selectionField.parameterName,
          question: selectionField.question,
          options: selectionField.options,
          allowCustom: selectionField.allowCustom,
          customPlaceholder: selectionField.customPlaceholder,
          integration: 'strategy',
          pendingAction: 'strategy_formation',
          collectedParams: selectionField.collectedParams,
          sessionId: sessionId,
        },
        metadata: {
          latency: Date.now() - startTime,
        },
      };
    }

    // Extract response text for conversational questions
    const finalMessages =
      langchainResult?.messages ?? langchainResult?.finalResponse;
    let responseText: string;

    if (typeof finalMessages === 'string') {
      responseText = finalMessages;
    } else if (Array.isArray(finalMessages) && finalMessages.length > 0) {
      const lastMessage = finalMessages[finalMessages.length - 1];
      responseText = lastMessage?.content ?? String(lastMessage);
    } else {
      responseText = (langchainResult as any)?.finalResponse ?? '';
    }

    // Create user message for the selection
    await this.chatMessageModel.create({
      conversationId: conversation._id,
      userId,
      role: 'user',
      content: `Selected: ${dto.selectionResponse!.value}`,
      metadata: {
        type: 'strategy_response',
        value: dto.selectionResponse!.value,
      },
    });

    // Create assistant message with next question
    const assistantMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      userId,
      role: 'assistant',
      content: responseText,
      modelId: dto.modelId,
      agentPath: ['strategy_formation'],
      optimizationsApplied: ['dynamic_user_input'],
    });

    await this.updateConversationAfterMessage(conversation, assistantMessage);

    return {
      id: assistantMessage._id.toString(),
      conversationId: conversation._id.toString(),
      role: 'assistant',
      content: responseText,
      modelId: dto.modelId,
      timestamp: assistantMessage.createdAt,
      agentPath: ['strategy_formation'],
      optimizationsApplied: ['dynamic_user_input'],
      metadata: {
        latency: Date.now() - startTime,
      },
    };
  }

  /**
   * Complete strategy formation with final synthesis
   */
  private async completeStrategyFormation(
    userId: string,
    dto: SendMessageDto,
    conversation: ChatConversationDocument,
    state: any,
    sessionId: string,
    effectiveMessage: string,
    startTime: number,
  ): Promise<ChatMessageResponse> {
    // Mark strategy as complete
    state.strategyFormation.isComplete = true;

    // Execute final synthesis through Langchain orchestrator
    if (!this.langchainOrchestrator.isInitialized()) {
      throw new Error('Langchain orchestrator not initialized');
    }

    const graph = this.langchainOrchestrator.getGraph();
    if (!graph) {
      throw new Error('Langchain graph not available');
    }

    const inputState = {
      messages: [
        ...(state.messages || []),
        { role: 'user', content: dto.selectionResponse!.value },
      ],
      userId,
      userMessage: dto.selectionResponse!.value,
      conversationId: conversation._id.toString(),
      context: state.context,
      strategyFormation: {
        ...state.strategyFormation,
        isComplete: true,
      },
      currentAgent: 'response_synthesis',
    };

    const langchainResult = await graph.invoke(inputState);
    const finalMessages =
      langchainResult?.messages ?? langchainResult?.finalResponse;

    let responseText: string;
    if (typeof finalMessages === 'string') {
      responseText = finalMessages;
    } else if (Array.isArray(finalMessages) && finalMessages.length > 0) {
      const lastMessage = finalMessages[finalMessages.length - 1];
      responseText = lastMessage?.content ?? String(lastMessage);
    } else {
      responseText = (langchainResult as any)?.finalResponse ?? '';
    }

    const result = { response: responseText };

    // Clean up session
    await this.deleteUserInputSession(sessionId);

    // Create user message for final selection
    await this.chatMessageModel.create({
      conversationId: conversation._id,
      userId,
      role: 'user',
      content: effectiveMessage,
      metadata: {
        type: 'strategy_response',
        value: dto.selectionResponse!.value,
      },
    });

    // Create final assistant message
    const assistantMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      userId,
      role: 'assistant',
      content: result.response ?? '',
      modelId: dto.modelId,
      agentPath: ['strategy_complete'],
      optimizationsApplied: ['strategy_formation', 'dynamic_user_input'],
      metadata: {
        type: 'strategy_complete',
        strategyFormation: state.strategyFormation,
      },
    });

    await this.updateConversationAfterMessage(conversation, assistantMessage);

    return {
      id: assistantMessage._id.toString(),
      conversationId: conversation._id.toString(),
      role: 'assistant',
      content: result.response ?? '',
      messageType: 'assistant',
      modelId: dto.modelId,
      timestamp: assistantMessage.createdAt,
      agentPath: ['strategy_complete'],
      optimizationsApplied: ['strategy_formation', 'dynamic_user_input'],
      metadata: {
        latency: Date.now() - startTime,
      },
    };
  }

  /**
   * Extract thinking from multi-agent flow result
   */
  private extractThinkingFromMultiAgentResult(result: any): any {
    // Extract comprehensive thinking from multi-agent result
    const thinking = [];
    let stepCounter = 1;

    // Analyze agent path for orchestration insights
    if (result.agentPath && result.agentPath.length > 0) {
      const agentPathStr = result.agentPath.join(' → ');
      const uniqueAgents = [...new Set(result.agentPath)];
      const coordinationComplexity =
        result.agentPath.length > 3 ? 'complex' : 'simple';

      thinking.push({
        step: stepCounter++,
        description: 'Multi-agent orchestration analysis',
        reasoning: `Coordinated ${result.agentPath.length} agent executions using ${uniqueAgents.length} unique agents in a ${coordinationComplexity} workflow: ${agentPathStr}`,
        outcome: `Successfully synthesized responses from ${uniqueAgents.join(', ')} agents`,
      });

      // Analyze workflow efficiency
      if (result.executionTime && result.agentPath.length > 1) {
        const avgTimePerAgent = result.executionTime / result.agentPath.length;
        const efficiency =
          avgTimePerAgent < 500
            ? 'high'
            : avgTimePerAgent < 1000
              ? 'moderate'
              : 'low';
        thinking.push({
          step: stepCounter++,
          description: 'Workflow efficiency assessment',
          reasoning: `Average ${avgTimePerAgent.toFixed(0)}ms per agent execution indicates ${efficiency} coordination efficiency`,
          outcome: `${efficiency.charAt(0).toUpperCase() + efficiency.slice(1)} parallel processing achieved`,
        });
      }
    }

    // Analyze optimizations with cost impact
    if (result.optimizationsApplied && result.optimizationsApplied.length > 0) {
      const costImpact =
        result.costSavings > 0.01
          ? 'significant'
          : result.costSavings > 0
            ? 'moderate'
            : 'minimal';
      const optimizationTypes = result.optimizationsApplied.map(
        (opt: string) => {
          if (opt.includes('cache')) return 'caching';
          if (opt.includes('semantic')) return 'semantic processing';
          if (opt.includes('parallel')) return 'parallel execution';
          return opt.replace(/_/g, ' ');
        },
      );

      thinking.push({
        step: stepCounter++,
        description: 'Cost optimization analysis',
        reasoning: `Applied ${result.optimizationsApplied.length} optimizations (${optimizationTypes.join(', ')}) resulting in ${costImpact} cost savings of $${result.costSavings?.toFixed(4) || '0.0000'}`,
        outcome: `Resource utilization optimized through ${optimizationTypes[0]} and ${result.optimizationsApplied.length - 1} additional strategies`,
      });
    }

    // Analyze metadata for additional insights
    if (result.metadata) {
      // Cache hit analysis
      if (result.metadata.fromCache !== undefined) {
        const cacheStrategy = result.metadata.fromCache
          ? 'utilized existing cached results'
          : 'generated fresh response';
        thinking.push({
          step: stepCounter++,
          description: 'Cache utilization strategy',
          reasoning: `System ${cacheStrategy}, balancing response freshness with computational efficiency`,
          outcome: result.metadata.fromCache
            ? 'Reduced latency through intelligent caching'
            : 'Ensured response accuracy with fresh computation',
        });
      }

      // Web search decision analysis
      if (result.metadata.webSearchUsed !== undefined) {
        const searchDecision = result.metadata.webSearchUsed
          ? 'incorporated external web data'
          : 'relied on internal knowledge';
        thinking.push({
          step: stepCounter++,
          description: 'Information sourcing strategy',
          reasoning: `Query analysis determined to ${searchDecision} for comprehensive response generation`,
          outcome: result.metadata.webSearchUsed
            ? 'Enhanced response with current external information'
            : 'Optimized for speed using internal knowledge base',
        });
      }

      // Risk level assessment
      if (result.metadata.riskLevel) {
        const riskContext =
          result.metadata.riskLevel === 'high'
            ? 'identified potential cost overruns'
            : result.metadata.riskLevel === 'medium'
              ? 'monitored moderate cost patterns'
              : 'confirmed cost-effective execution';
        thinking.push({
          step: stepCounter++,
          description: 'Cost risk assessment',
          reasoning: `Predictive analytics ${riskContext}, enabling proactive cost management`,
          outcome: `Risk level: ${result.metadata.riskLevel.toUpperCase()} - appropriate safeguards applied`,
        });
      }
    }

    // Performance benchmarking
    if (result.executionTime) {
      const performance =
        result.executionTime < 1000
          ? 'excellent'
          : result.executionTime < 3000
            ? 'good'
            : result.executionTime < 5000
              ? 'acceptable'
              : 'needs optimization';
      thinking.push({
        step: stepCounter++,
        description: 'Performance benchmarking',
        reasoning: `Total execution time of ${result.executionTime}ms indicates ${performance} system performance`,
        outcome: `Response delivered within ${result.executionTime < 2000 ? 'optimal' : 'acceptable'} time frame`,
      });
    }

    return thinking.length > 0
      ? {
          title: 'Advanced Multi-Agent Processing Analysis',
          summary: `Successfully executed complex multi-agent workflow with ${thinking.length} analytical insights and optimizations`,
          steps: thinking,
        }
      : undefined;
  }

  /**
   * Track usage analytics for chat messages
   */
  private async trackUsage(params: {
    userId: string;
    conversationId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    prompt?: string;
    completion?: string;
    service?: string;
    responseTime?: number;
    errorOccurred?: boolean;
    promptCaching?: {
      enabled: boolean;
      type?: string;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
    };
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (!this.usageModel) {
      return;
    }

    try {
      // Truncate prompt and completion to first 500 chars (like Express)
      const truncatedPrompt = params.prompt;
      const truncatedCompletion = params.completion;

      const usageData = {
        userId: params.userId,
        type: 'chat_message',
        modelId: params.modelId,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cost: params.cost,
        service: params.service,
        responseTime: params.responseTime,
        errorOccurred: params.errorOccurred,
        tags: params.metadata?.templateUsage ? ['template'] : [],
        prompt: truncatedPrompt,
        completion: truncatedCompletion,
        promptCaching: params.promptCaching,
        metadata: params.metadata || {},
      };

      await this.usageModel.create(usageData);

      // Additional service calls for anomaly detection and cost tracking (like Express)
      try {
        // AIRouterService anomaly detection
        if (this.aiRouterService && truncatedPrompt && truncatedCompletion) {
          await this.aiRouterService.invokeModel({
            model: params.modelId,
            prompt: [truncatedPrompt, truncatedCompletion].join('\n\n'),
            parameters: {
              maxTokens: 100,
              temperature: 0.1,
            },
            metadata: {
              operation: 'anomaly_detection',
              userId: params.userId,
              cost: params.cost,
              responseTime: params.responseTime,
            },
          });
        }

        // AICostTrackingService for cross-model cost comparison
        if (
          this.aiCostTrackingService &&
          truncatedPrompt &&
          truncatedCompletion
        ) {
          await this.aiCostTrackingService.trackRequest(
            {
              prompt: truncatedPrompt,
              model: params.modelId,
              promptTokens: params.inputTokens,
            },
            {
              content: truncatedCompletion,
              usage: {
                promptTokens: params.inputTokens,
                completionTokens: params.outputTokens,
                totalTokens: params.inputTokens + params.outputTokens,
              },
            },
            params.userId,
            {
              service: params.service || 'chat',
              conversationId: params.conversationId,
              errorOccurred: params.errorOccurred,
              promptCaching: params.promptCaching,
            },
          );
        }
      } catch (additionalError) {
        // Don't fail the main tracking if additional services fail
        this.logger.warn('Additional tracking services failed', {
          error:
            additionalError instanceof Error
              ? additionalError.message
              : String(additionalError),
          userId: params.userId,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to track usage', {
        error: error instanceof Error ? error.message : String(error),
        userId: params.userId,
        conversationId: params.conversationId,
      });
    }
  }

  /**
   * Stream model response with token-level updates
   */
  async streamModelResponse(
    messages: Array<{ role: string; content: string }>,
    modelId: string,
    options: { maxTokens?: number; temperature?: number },
    onChunk: (chunk: string, done: boolean) => void | Promise<void>,
  ): Promise<{
    fullResponse: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    return this.bedrockService.streamModelResponse(messages, modelId, {
      ...options,
      onChunk,
    });
  }

  /**
   * Create a message record after streaming is complete
   */
  async createStreamedMessage(
    userId: string,
    dto: any,
    content: string,
    inputTokens: number,
    outputTokens: number,
    cost: number,
  ): Promise<any> {
    // Use MongoDB transaction for consistency
    const session = await this.chatMessageModel.db.startSession();

    try {
      return await session.withTransaction(async () => {
        // Find or create conversation
        let conversation;
        if (dto.conversationId) {
          conversation = await this.conversationModel
            .findOne({
              _id: dto.conversationId,
              userId,
            })
            .session(session);
        } else {
          // Auto-create conversation if none provided
          const created = await this.conversationModel.create(
            [
              {
                userId,
                title:
                  dto.message?.substring(0, 50) + '...' || 'New Conversation',
                modelId: dto.modelId,
              },
            ],
            { session },
          );
          conversation = created[0];
        }

        if (!conversation) {
          throw new Error('Conversation not found');
        }

        // Create the message record
        const createdMessages = await this.chatMessageModel.create(
          [
            {
              conversationId: conversation._id,
              userId,
              role: 'assistant',
              content,
              modelId: dto.modelId,
              agentPath: ['streaming_agent'],
              metadata: {
                temperature: dto.temperature,
                maxTokens: dto.maxTokens,
                inputTokens,
                outputTokens,
                cost,
                streaming: true,
              },
            },
          ],
          { session },
        );
        const message = createdMessages[0];

        // Update conversation (within transaction)
        await this.updateConversationAfterMessage(
          conversation,
          message,
          session,
        );

        return message;
      });
    } catch (error) {
      this.logger.error('Failed to create streamed message', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        conversationId: dto.conversationId,
        contentLength: content?.length,
      });
      throw error; // Re-throw to let caller handle
    } finally {
      await session.endSession();
    }
  }
}
