import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { Alert, AlertSchema } from '../../schemas/core/alert.schema';
import {
  AgentTraceVersion,
  AgentTraceVersionSchema,
} from '../../schemas/agent/agent-trace-version.schema';
import {
  Activity,
  ActivitySchema,
} from '../../schemas/team-project/activity.schema';
import { CommonModule } from '../../common/common.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { IntegrationModule } from '../integration/integration.module';
import { CortexModule } from '../cortex/cortex.module';
import { AuthModule } from '../auth/auth.module';
import { AgentTraceController } from './agent-trace.controller';
import { AgentTraceService } from './agent-trace.service';
import { AgentTraceAlertingService } from './services/agent-trace-alerting.service';
import { AgentTraceVersioningService } from './services/agent-trace-versioning.service';
import { AgentTraceOptimizationService } from './services/agent-trace-optimization.service';
import { AgentTraceOrchestratorService } from './services/agent-trace-orchestrator.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: AgentTraceVersion.name, schema: AgentTraceVersionSchema },
      { name: Alert.name, schema: AlertSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
    HttpModule,
    CommonModule,
    WorkflowModule,
    GuardrailsModule,
    IntegrationModule,
    CortexModule,
    AuthModule,
  ],
  controllers: [AgentTraceController],
  providers: [
    AgentTraceService,
    AgentTraceAlertingService,
    AgentTraceVersioningService,
    AgentTraceOptimizationService,
    AgentTraceOrchestratorService,
  ],
  exports: [
    AgentTraceService,
    AgentTraceAlertingService,
    AgentTraceVersioningService,
    AgentTraceOptimizationService,
    AgentTraceOrchestratorService,
  ],
})
export class AgentTraceModule {}
