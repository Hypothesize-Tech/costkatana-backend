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

import { NODE_EXECUTOR } from './node-executors/base-node-executor';
import { NodeExecutorRegistry } from './node-executors/node-executor.registry';
import { UserMessageInputExecutor } from './node-executors/user-message-input.executor';
import { ResponseOutputExecutor } from './node-executors/response-output.executor';
import { LlmCallExecutor } from './node-executors/llm-call.executor';
import { IfElseExecutor } from './node-executors/if-else.executor';
import { CheckpointExecutor } from './node-executors/checkpoint.executor';
import { WebSearchExecutor } from './node-executors/web-search.executor';
import { VectorStoreBedrockKbExecutor } from './node-executors/vector-store-bedrock-kb.executor';
import { TextToAgentService } from './services/text-to-agent.service';

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
    NodeExecutorRegistry,

    // Node executors are individual providers; the multi-token registration
    // below collects them into the NodeExecutorRegistry's constructor.
    UserMessageInputExecutor,
    ResponseOutputExecutor,
    LlmCallExecutor,
    IfElseExecutor,
    CheckpointExecutor,
    WebSearchExecutor,
    VectorStoreBedrockKbExecutor,

    {
      provide: NODE_EXECUTOR,
      useExisting: UserMessageInputExecutor,
      multi: true,
    },
    {
      provide: NODE_EXECUTOR,
      useExisting: ResponseOutputExecutor,
      multi: true,
    },
    {
      provide: NODE_EXECUTOR,
      useExisting: LlmCallExecutor,
      multi: true,
    },
    {
      provide: NODE_EXECUTOR,
      useExisting: IfElseExecutor,
      multi: true,
    },
    {
      provide: NODE_EXECUTOR,
      useExisting: CheckpointExecutor,
      multi: true,
    },
    {
      provide: NODE_EXECUTOR,
      useExisting: WebSearchExecutor,
      multi: true,
    },
    {
      provide: NODE_EXECUTOR,
      useExisting: VectorStoreBedrockKbExecutor,
      multi: true,
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
    NodeExecutorRegistry,
  ],
})
export class AgentPlatformModule {}
