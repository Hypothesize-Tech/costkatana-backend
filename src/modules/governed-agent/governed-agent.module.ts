import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Core modules
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { AwsModule } from '../aws/aws.module';
import { McpModule } from '../mcp/mcp.module';
import { CortexModule } from '../cortex/cortex.module';
import { UtilsModule } from '../utils/utils.module';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
// Services
import { BedrockService } from '../bedrock/bedrock.service';
import { GenAITelemetryService } from '../../utils/genaiTelemetry';

// Schemas
import {
  GovernedTask,
  GovernedTaskSchema,
} from '../../schemas/governed-agent/governed-task.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';
import {
  ChatConversation,
  ChatConversationSchema,
} from '../../schemas/chat/conversation.schema';
import {
  AgentExecution,
  AgentExecutionSchema,
} from '../../schemas/agent/agent-execution.schema';

// Controllers
import { GovernedAgentController } from './controllers/governed-agent.controller';

// Services
import { GovernedAgentService } from './services/governed-agent.service';
import { TaskClassifierService } from './services/task-classifier.service';
import { UniversalPlanGeneratorService } from './services/universal-plan-generator.service';
import { RiskAssessorService } from './services/risk-assessor.service';
import { ApprovalManagerService } from './services/approval-manager.service';
import { GovernedAgentSseService } from './services/governed-agent-sse.service';
import { IntegrationOrchestratorService } from './services/integration-orchestrator.service';
import { UniversalVerificationService } from './services/universal-verification.service';
import { FileByFileCodeGeneratorService } from './services/file-by-file-code-generator.service';
import { PostDeploymentManagerService } from './services/post-deployment-manager.service';
import { AgentSandboxService } from './services/agent-sandbox.service';
import { AiIntentRouterService } from './services/ai-intent-router.service';
import { AiQueryRouterService } from './services/ai-query-router.service';

@Module({
  imports: [
    // Core NestJS modules
    CommonModule,
    SchemasModule,
    AwsModule,

    // Feature modules
    McpModule,
    CortexModule,
    UtilsModule,
    AuthModule,
    forwardRef(() => ChatModule),

    // Mongoose models
    MongooseModule.forFeature([
      { name: GovernedTask.name, schema: GovernedTaskSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatConversation.name, schema: ChatConversationSchema },
      { name: AgentExecution.name, schema: AgentExecutionSchema },
    ]),
  ],
  controllers: [GovernedAgentController],
  providers: [
    GenAITelemetryService,
    BedrockService,
    // Main service
    GovernedAgentService,

    // Supporting services
    TaskClassifierService,
    UniversalPlanGeneratorService,
    RiskAssessorService,
    ApprovalManagerService,
    GovernedAgentSseService,
    IntegrationOrchestratorService,
    UniversalVerificationService,
    FileByFileCodeGeneratorService,
    PostDeploymentManagerService,
    AgentSandboxService,
    AiIntentRouterService,
    AiQueryRouterService,
  ],
  exports: [
    GovernedAgentService,
    GovernedAgentSseService,
    AiQueryRouterService,
    AiIntentRouterService,
  ],
})
export class GovernedAgentModule {}
