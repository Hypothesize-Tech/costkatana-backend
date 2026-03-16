import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Usage, UsageSchema } from '../../schemas/analytics/usage.schema';
import {
  WorkflowTemplateVersion,
  WorkflowTemplateVersionSchema,
} from '../../schemas/misc/workflow-template-version.schema';
import { CommonModule } from '../../common/common.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PricingModule } from '../pricing/pricing.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service';
import { WorkflowAlertingService } from './services/workflow-alerting.service';
import { WorkflowVersioningService } from './services/workflow-versioning.service';
import { WorkflowOptimizationService } from './services/workflow-optimization.service';

@Module({
  imports: [
    CommonModule,
    SubscriptionModule,
    PricingModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      {
        name: WorkflowTemplateVersion.name,
        schema: WorkflowTemplateVersionSchema,
      },
    ]),
  ],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    WorkflowOrchestratorService,
    WorkflowAlertingService,
    WorkflowVersioningService,
    WorkflowOptimizationService,
  ],
  exports: [
    WorkflowOrchestratorService,
    WorkflowService,
    WorkflowAlertingService,
    WorkflowVersioningService,
    WorkflowOptimizationService,
  ],
})
export class WorkflowModule {}
