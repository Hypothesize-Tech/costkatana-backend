import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';

// Controllers
import { AgentController } from './agent.controller';

// Services
import { AgentService } from './services/agent.service';
import { RetryService } from './services/retry.service';
import { AgentPromptTemplateConfig } from './config/agent-prompt-template.config';
import { ResponseFormattersService } from './services/response-formatters.service';
import { ContextEngineeringService } from './services/context-engineering.service';
import { VectorStoreService } from './services/vector-store.service';
import { MultiLlmOrchestratorService } from './services/multi-llm-orchestrator.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { McpToolSyncerService } from './services/mcp-tool-syncer.service';
import { VercelToolsService } from './services/vercel-tools.service';
import { AgentMultiAgentFlowService } from './services/multi-agent-flow.service';

// Tools
import { KnowledgeBaseToolService } from './tools/knowledge-base.tool';
import { MongoDbReaderToolService } from './tools/mongodb-reader.tool';
import { ProjectManagerToolService } from './tools/project-manager.tool';
import { ModelSelectorToolService } from './tools/model-selector.tool';
import { AnalyticsManagerToolService } from './tools/analytics-manager.tool';
import { OptimizationManagerToolService } from './tools/optimization-manager.tool';
import { WebSearchToolService } from './tools/web-search.tool';
import { MongoDBIntegrationToolService } from './tools/mongodb-integration.tool';
import { FileSystemToolService } from './tools/file-system.tool';
import { AWSIntegrationToolService } from './tools/aws-integration.tool';
import { LifeUtilityToolService } from './tools/life-utility.tool';
import { LifeUtilityService } from './tools/life-utility.service';
import { GenericHTTPTool } from './tools/generic-http.tool';

// External modules
import { CommonModule } from '../../common/common.module';
import { CortexModule } from '../cortex/cortex.module';
import { ChatModule } from '../chat/chat.module';
import { SharedPreferencesModule } from '../shared-preferences/shared-preferences.module';
import { VercelModule } from '../vercel/vercel.module';
import { RagModule } from '../rag/rag.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { GatewayModule } from '../gateway/gateway.module';
import { UtilsModule } from '../utils/utils.module';
import { McpModule } from '../mcp/mcp.module';
import { BedrockModule } from '../bedrock/bedrock.module';
import { AuthModule } from '../auth/auth.module';
import { GovernedAgentModule } from '../governed-agent/governed-agent.module';

// Schemas (for MongooseModule.forFeature)
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Optimization,
  OptimizationSchema,
} from '../../schemas/core/optimization.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import {
  VercelConnection,
  VercelConnectionSchema,
} from '../../schemas/integration/vercel-connection.schema';
import {
  UserApprovalRequest,
  UserApprovalRequestSchema,
} from '../../schemas/user/user-approval-request.schema';
import {
  UserPreference,
  UserPreferenceSchema,
} from '../../schemas/agent/memory.schema';

@Module({
  imports: [
    // HTTP module for external API calls (web search, etc.)
    HttpModule,

    // Common module for shared services (logger, cache, encryption)
    CommonModule,

    // Feature modules
    CortexModule,
    ChatModule, // ChatService for AgentController
    SharedPreferencesModule,
    VercelModule,
    forwardRef(() => RagModule), // For retrieval-augmented generation – forwardRef breaks AgentModule ↔ RagModule cycle
    IngestionModule, // SafeBedrockEmbeddingsService for generateContextEmbeddings
    GatewayModule,
    UtilsModule, // For latency router service
    McpModule, // For MongoDbMcpService, VercelMcpService, AwsMcpService (McpToolSyncerService)
    BedrockModule, // For BedrockService (ModelSelectorToolService)
    AuthModule, // For JwtAuthGuard
    GovernedAgentModule, // For TaskClassifierService (MultiAgentFlowService)

    // Mongoose schemas needed by agent services
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: Optimization.name, schema: OptimizationSchema },
      { name: User.name, schema: UserSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: VercelConnection.name, schema: VercelConnectionSchema },
      { name: UserApprovalRequest.name, schema: UserApprovalRequestSchema },
      { name: UserPreference.name, schema: UserPreferenceSchema },
    ]),
  ],
  controllers: [AgentController],
  providers: [
    // Core agent service
    AgentService,

    // Supporting services
    RetryService,
    AgentPromptTemplateConfig,
    ResponseFormattersService,
    ContextEngineeringService,
    VectorStoreService,
    MultiLlmOrchestratorService,
    ToolRegistryService,
    McpToolSyncerService,
    VercelToolsService,
    AgentMultiAgentFlowService,

    // Agent tools (all 12)
    KnowledgeBaseToolService,
    MongoDbReaderToolService,
    ProjectManagerToolService,
    ModelSelectorToolService,
    AnalyticsManagerToolService,
    OptimizationManagerToolService,
    WebSearchToolService,
    MongoDBIntegrationToolService,
    FileSystemToolService,
    AWSIntegrationToolService,
    LifeUtilityToolService,
    LifeUtilityService,
    GenericHTTPTool,
  ],
  exports: [
    // Export services that other modules might need
    AgentService,
    VectorStoreService,
    ToolRegistryService,
    ContextEngineeringService,
    ResponseFormattersService,
    VercelToolsService,

    // Export tools for potential reuse
    KnowledgeBaseToolService,
    MongoDbReaderToolService,
    ProjectManagerToolService,
    ModelSelectorToolService,
    AnalyticsManagerToolService,
    OptimizationManagerToolService,
    WebSearchToolService,
    MongoDBIntegrationToolService,
    FileSystemToolService,
    AWSIntegrationToolService,
    LifeUtilityToolService,
    GenericHTTPTool,
  ],
})
export class AgentModule {}
