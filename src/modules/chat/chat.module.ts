import {
  Module,
  forwardRef,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';

// Phase-2 chat pipeline.
import { ChatPipeline } from './pipeline/chat-pipeline.service';
import { SecurityStage } from './pipeline/stages/security.stage';
import { ConversationStage } from './pipeline/stages/conversation.stage';
import { ContextBuildStage } from './pipeline/stages/context-build.stage';
import { AttachmentStage } from './pipeline/stages/attachment.stage';
import { IntegrationStage } from './pipeline/stages/integration.stage';
import { RoutingStage } from './pipeline/stages/routing.stage';
import { PlanClassificationStage } from './pipeline/stages/plan-classification.stage';
import { ExecutionStage } from './pipeline/stages/execution.stage';
import { PersistenceStage } from './pipeline/stages/persistence.stage';
import { AttachmentResolver } from './pipeline/helpers/attachment-resolver.service';
import { ConversationLoader } from './pipeline/helpers/conversation-loader.service';
import {
  RouteDispatcher,
  MULTI_AGENT_FLOW_EXECUTOR,
} from './pipeline/helpers/route-dispatcher.service';
import {
  ConversationalFlowExecutor,
  AGENT_ROUTING_EXECUTOR,
} from './pipeline/helpers/conversational-flow-executor.service';
import {
  MessagePersister,
  CHAT_MESSAGE_EMITTER,
} from './pipeline/helpers/message-persister.service';
import { AssistantMessagePersister } from './pipeline/helpers/assistant-message-persister.service';
import { UserMessagePersistenceStage } from './pipeline/stages/user-message-persistence.stage';
import { IntegrationAvailabilityService } from './services/integration-availability.service';
import { Document as DocumentSchemaClass, DocumentSchema } from '../../schemas/document/document.schema';
import {
  GitHubConnection,
  GitHubConnectionSchema,
} from '../../schemas/integration/github-connection.schema';
import {
  VercelConnection,
  VercelConnectionSchema,
} from '../../schemas/integration/vercel-connection.schema';
import {
  GoogleConnection,
  GoogleConnectionSchema,
} from '../../schemas/integration/google-connection.schema';

// Core modules
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { AuthModule } from '../auth/auth.module';

// Middleware
import { ChatMentionsMiddleware } from '../../common/middleware/chat-mentions.middleware';
import { CortexGatewayMiddleware } from '../../common/middleware/cortex-gateway.middleware';

// Feature modules
import { GovernedAgentModule } from '../governed-agent/governed-agent.module';
import { AgentModule } from '../agent/agent.module';
import { IntegrationModule } from '../integration/integration.module';
import { McpModule } from '../mcp/mcp.module';
import { CortexModule } from '../cortex/cortex.module';
import { GitHubModule } from '../github/github.module';
import { GoogleModule } from '../google/google.module';
import { VercelModule } from '../vercel/vercel.module';
import { AwsModule } from '../aws/aws.module';
import { StorageModule } from '../storage/storage.module';
import { PromptTemplateModule } from '../prompt-template/prompt-template.module';
import { BedrockModule } from '../bedrock/bedrock.module';
import { RagModule } from '../rag/rag.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SecurityModule } from '../security/security.module';
import { AdminAiCostMonitoringModule } from '../admin-ai-cost-monitoring/admin-ai-cost-monitoring.module';
import { MemoryModule } from '../memory/memory.module';
import { UtilsModule } from '../utils/utils.module';
import { SharedPreferencesModule } from '../shared-preferences/shared-preferences.module';

// Services
import { WebSearchService } from './services/web-search.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { WebSearchTool } from './tools/web-search.tool';
import { ContextAssemblerService } from './services/context-assembler.service';
import { ContextAssemblyService } from './services/context-assembly.service';
import { IntegrationMcpMapperService } from './services/integration-mcp-mapper.service';
import { CortexStreamingOrchestratorService } from './services/cortex-streaming-orchestrator.service';
import { ChatEventsFactoryService } from './services/chat-events-factory.service';
import { ChatEventsEmitterService } from './services/chat-events-emitter.service';
import { ChatEventsRedisService } from './services/chat-events-redis.service';

// Schemas
import { ChatConversationSchema } from '../../schemas/chat/conversation.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';
import {
  ChatTaskLink,
  ChatTaskLinkSchema,
} from '../../schemas/chat/chat-task-link.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  GovernedTask,
  GovernedTaskSchema,
} from '../../schemas/agent/governed-task.schema';

// Controllers
import { ChatController } from './chat.controller';
import { ChatGovernedAgentController } from './chat-governed-agent.controller';
import { IntegrationChatController } from './integration-chat.controller';

// Services
import { ChatService } from './services/chat.service';
import { IntegrationChatService } from './services/integration-chat.service';
import { IntegrationAgentService } from './services/integration-agent.service';
import { MongoDBChatAgentService } from './services/mongodb-chat-agent.service';
import { ChatEventsService } from './services/chat-events.service'; // Legacy - kept for backward compatibility
import { IChatEventsService } from './services/chat-events.interface';
import { McpIntegrationHandlerService } from './services/mcp-integration-handler.service';
import { AgentService } from './services/agent.service';
import { MultiAgentFlowService } from './services/multi-agent-flow.service';
import { ConversationalFlowService } from './services/conversational-flow.service';
import { MCPClientService } from './services/mcp-client.service';
import { IntegrationFormatterService } from './services/integration-formatter.service';
import { VercelChatAgentService } from './services/vercel-chat-agent.service';
import { GithubChatAgentService } from './services/github-chat-agent.service';
import { AWSChatAgentService } from './services/aws-chat-agent.service';
import { ChatSSEService } from './services/chat-sse.service';
import { CitationsOrchestratorService } from './services/citations-orchestrator.service';

// Handlers
import { MCPHandler } from './handlers/mcp.handler';
import { WebScraperHandler } from './handlers/web-scraper.handler';
import { ConversationalFlowHandler } from './handlers/conversational-flow.handler';
import { MultiAgentHandler } from './handlers/multi-agent.handler';
import { FallbackHandler } from './handlers/fallback.handler';
import { KnowledgeBaseHandler } from './handlers/knowledge-base.handler';

// Context Services
import { ContextManager } from './context/context.manager';
import { EntityExtractor } from './context/entity-extractor';
import { MessageAnalyzer } from './context/message-analyzer';
import { CoreferenceResolver } from './context/coreference-resolver';

// Routing Services
import { AIRouter } from './routing/ai.router';
import { LegacyRouter } from './routing/legacy-router';

// Utility Services
import { AutonomousDetector } from './utils/autonomous-detector';
import { GovernedPlanMessageCreator } from './utils/governed-plan-message-creator';
import { RouteDecider } from './utils/route-decider';
import { ContextOptimizer } from './utils/context-optimizer';
import { LangchainHelpers } from './utils/langchain-helpers';
import { AttachmentProcessor } from './utils/attachment-processor';
import { ModelRegistry } from './utils/model-registry';
import { CostEstimator } from './utils/cost-estimator';
import { IntegrationDetector } from './utils/integration-detector';
import { ConnectionChecker } from './utils/connection-checker';
import { LinkMetadataEnricher } from './utils/link-metadata-enricher';
import { ResponseSanitizerService } from './utils/response-sanitizer';
import { TrendingDetectorService } from './services/trending-detector.service';
import { LangchainOrchestratorService } from './langchain/langchain-orchestrator.service';

@Module({
  imports: [
    // Core NestJS modules
    HttpModule,
    CommonModule,
    SchemasModule,
    AuthModule,

    // Feature modules
    forwardRef(() => GovernedAgentModule),
    forwardRef(() => AgentModule), // For VectorStoreService (breaks circular dependency)
    IntegrationModule,
    McpModule,
    CortexModule,
    GitHubModule,
    GoogleModule,
    VercelModule,
    AwsModule, // For AWSChatAgentService (Ec2Service, CostExplorerService, etc.)
    StorageModule,
    forwardRef(() => PromptTemplateModule), // Breaks cycle: PromptTemplateModule -> AgentModule -> ChatModule -> PromptTemplateModule
    BedrockModule,
    RagModule, // For RagServiceLocator (KnowledgeBaseHandler)
    IngestionModule, // For IntelligentRouterService (AIRouter)
    AnalyticsModule, // For ChatSecurityHandlerService
    SecurityModule, // For LLMSecurityService
    AdminAiCostMonitoringModule, // For AICostTrackingService
    MemoryModule, // For MemoryService
    UtilsModule, // For GroundingConfidenceService
    SharedPreferencesModule, // For UserPreferenceService

    // Mongoose models
    MongooseModule.forFeature([
      { name: 'ChatConversation', schema: ChatConversationSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatTaskLink.name, schema: ChatTaskLinkSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: GovernedTask.name, schema: GovernedTaskSchema },
      // Pipeline stage dependencies (Phase 2)
      { name: DocumentSchemaClass.name, schema: DocumentSchema },
      { name: GitHubConnection.name, schema: GitHubConnectionSchema },
      { name: VercelConnection.name, schema: VercelConnectionSchema },
      { name: GoogleConnection.name, schema: GoogleConnectionSchema },
    ]),
  ],
  controllers: [
    ChatController,
    ChatGovernedAgentController,
    IntegrationChatController,
  ],
  providers: [
    ChatService,
    IntegrationChatService,
    IntegrationAgentService,
    MongoDBChatAgentService,
    ChatEventsService, // Legacy - kept for backward compatibility
    ChatEventsFactoryService,
    ChatEventsEmitterService,
    ChatEventsRedisService,
    McpIntegrationHandlerService,
    AgentService,
    MultiAgentFlowService,
    ConversationalFlowService,
    MCPClientService,
    IntegrationFormatterService,
    WebSearchService,
    WebSearchTool,
    ToolRegistryService,
    VercelChatAgentService,
    GithubChatAgentService,
    AWSChatAgentService,
    ChatSSEService,
    CitationsOrchestratorService,
    ContextAssemblerService,
    ContextAssemblyService,
    IntegrationMcpMapperService,
    CortexStreamingOrchestratorService,

    // Utility Services
    LinkMetadataEnricher,
    ResponseSanitizerService,

    // Handlers
    MCPHandler,
    WebScraperHandler,
    ConversationalFlowHandler,
    MultiAgentHandler,
    FallbackHandler,
    KnowledgeBaseHandler,

    // Context Services
    ContextManager,
    EntityExtractor,
    MessageAnalyzer,
    CoreferenceResolver,

    // Routing Services
    AIRouter,
    LegacyRouter,

    // Utility Services
    AutonomousDetector,
    GovernedPlanMessageCreator,
    RouteDecider,
    ContextOptimizer,
    LangchainHelpers,
    AttachmentProcessor,
    ModelRegistry,
    CostEstimator,
    IntegrationDetector,
    ConnectionChecker,
    TrendingDetectorService,
    LangchainOrchestratorService,

    // Phase 2 — chat pipeline (DI-registered; sendMessage delegates to it)
    ChatPipeline,
    SecurityStage,
    ConversationStage,
    ContextBuildStage,
    AttachmentStage,
    IntegrationStage,
    RoutingStage,
    PlanClassificationStage,
    ExecutionStage,
    PersistenceStage,
    AttachmentResolver,
    ConversationLoader,
    RouteDispatcher,
    ConversationalFlowExecutor,
    MessagePersister,
    AssistantMessagePersister,
    UserMessagePersistenceStage,
    {
      // Bind structural ChatMessageEmitter to the factory's current service
      // — same indirection trick used elsewhere to keep helpers test-isolated.
      provide: CHAT_MESSAGE_EMITTER,
      useFactory: (factory: ChatEventsFactoryService) => factory.getService(),
      inject: [ChatEventsFactoryService],
    },
    {
      // Bind the structural MultiAgentFlowExecutor token to the concrete
      // service. Indirection lets RouteDispatcher stay testable in isolation
      // (its tests don't need to load the heavy multi-agent transitive deps).
      provide: MULTI_AGENT_FLOW_EXECUTOR,
      useExisting: MultiAgentFlowService,
    },
    {
      // Same indirection for AgentService — keeps ConversationalFlowExecutor
      // tests free from the agent-service transitive import chain.
      provide: AGENT_ROUTING_EXECUTOR,
      useExisting: AgentService,
    },
    IntegrationAvailabilityService,
  ],
  exports: [
    ChatService,
    ChatEventsService, // Legacy - kept for backward compatibility
    ChatEventsFactoryService,
    ChatEventsEmitterService,
    ChatEventsRedisService,
    ConversationalFlowService,
    MultiAgentFlowService, // Full 15-node LangGraph implementation for agent/chat flows
    CitationsOrchestratorService,
  ],
})
export class ChatModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ChatMentionsMiddleware, CortexGatewayMiddleware)
      .forRoutes({ path: 'api/chat*path', method: RequestMethod.POST });
  }
}
