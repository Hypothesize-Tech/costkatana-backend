import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';

import {
  AgentDefinition,
  AgentDefinitionSchema,
} from '../../schemas/agent-platform/agent-definition.schema';
import {
  AgentVersion,
  AgentVersionSchema,
} from '../../schemas/agent-platform/agent-version.schema';
import {
  AgentRun,
  AgentRunSchema,
} from '../../schemas/agent-platform/agent-run.schema';
import {
  AgentRunStep,
  AgentRunStepSchema,
} from '../../schemas/agent-platform/agent-run-step.schema';
import {
  AgentDeployment,
  AgentDeploymentSchema,
} from '../../schemas/agent-platform/agent-deployment.schema';
import {
  AgentKnowledgeBase,
  AgentKnowledgeBaseSchema,
} from '../../schemas/agent-platform/agent-knowledge-base.schema';
import {
  AgentKbChunk,
  AgentKbChunkSchema,
} from '../../schemas/agent-platform/agent-kb-chunk.schema';
import {
  AgentTemplate,
  AgentTemplateSchema,
} from '../../schemas/agent-platform/agent-template.schema';
import {
  Organization,
  OrganizationSchema,
} from '../../schemas/team-project/organization.schema';

import { AgentDefinitionService } from './services/agent-definition.service';
import { AgentCompilerService } from './services/agent-compiler.service';
import { AgentRunnerService } from './services/agent-runner.service';
import { AgentTemplateService } from './services/agent-template.service';
import { AgentDeploymentService } from './services/agent-deployment.service';
import { WidgetSessionService } from './services/widget-session.service';
import { WidgetSessionGuard } from './guards/widget-session.guard';
import { AgentPlatformController } from './controllers/agent-platform.controller';
import { AgentWidgetPublicController } from './controllers/agent-widget-public.controller';

import { BedrockModule } from '../bedrock/bedrock.module';
import { UtilsModule } from '../utils/utils.module';

import { NodeExecutorRegistry } from './node-executors/node-executor.registry';
import { UserMessageInputExecutor } from './node-executors/user-message-input.executor';
import { ResponseOutputExecutor } from './node-executors/response-output.executor';
import { LlmCallExecutor } from './node-executors/llm-call.executor';
import { IfElseExecutor } from './node-executors/if-else.executor';
import { CheckpointExecutor } from './node-executors/checkpoint.executor';
import { WebSearchExecutor } from './node-executors/web-search.executor';
import { VectorStoreBedrockKbExecutor } from './node-executors/vector-store-bedrock-kb.executor';
import { TextToAgentService } from './services/text-to-agent.service';
import { KbIngestionService } from './services/kb-ingestion.service';
import { KbIndexService } from './services/kb-index.service';

@Module({
  imports: [
    CommonModule,
    AuthModule,
    BedrockModule,
    UtilsModule,
    EventEmitterModule.forRoot({
      wildcard: true,
      maxListeners: 50,
    }),
    MongooseModule.forFeature([
      { name: AgentDefinition.name, schema: AgentDefinitionSchema },
      { name: AgentVersion.name, schema: AgentVersionSchema },
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: AgentRunStep.name, schema: AgentRunStepSchema },
      { name: AgentDeployment.name, schema: AgentDeploymentSchema },
      { name: AgentKnowledgeBase.name, schema: AgentKnowledgeBaseSchema },
      { name: AgentKbChunk.name, schema: AgentKbChunkSchema },
      { name: AgentTemplate.name, schema: AgentTemplateSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [AgentPlatformController, AgentWidgetPublicController],
  providers: [
    AgentDefinitionService,
    AgentCompilerService,
    AgentRunnerService,
    AgentTemplateService,
    AgentDeploymentService,
    WidgetSessionService,
    WidgetSessionGuard,
    TextToAgentService,
    KbIngestionService,
    KbIndexService,

    UserMessageInputExecutor,
    ResponseOutputExecutor,
    LlmCallExecutor,
    IfElseExecutor,
    CheckpointExecutor,
    WebSearchExecutor,
    VectorStoreBedrockKbExecutor,

    {
      provide: NodeExecutorRegistry,
      useFactory: (
        userMessageInput: UserMessageInputExecutor,
        responseOutput: ResponseOutputExecutor,
        llmCall: LlmCallExecutor,
        ifElse: IfElseExecutor,
        checkpoint: CheckpointExecutor,
        webSearch: WebSearchExecutor,
        vectorStoreBedrockKb: VectorStoreBedrockKbExecutor,
      ) =>
        new NodeExecutorRegistry([
          userMessageInput,
          responseOutput,
          llmCall,
          ifElse,
          checkpoint,
          webSearch,
          vectorStoreBedrockKb,
        ]),
      inject: [
        UserMessageInputExecutor,
        ResponseOutputExecutor,
        LlmCallExecutor,
        IfElseExecutor,
        CheckpointExecutor,
        WebSearchExecutor,
        VectorStoreBedrockKbExecutor,
      ],
    },
  ],
  exports: [
    AgentDefinitionService,
    AgentCompilerService,
    AgentRunnerService,
    AgentTemplateService,
    AgentDeploymentService,
    WidgetSessionService,
    TextToAgentService,
    KbIngestionService,
    KbIndexService,
    NodeExecutorRegistry,
  ],
})
export class AgentPlatformModule {}
