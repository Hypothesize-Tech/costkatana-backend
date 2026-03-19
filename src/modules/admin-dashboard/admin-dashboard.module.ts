import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Schemas
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../../schemas/user/workspace.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../../schemas/core/subscription.schema';
import {
  SubscriptionHistory,
  SubscriptionHistorySchema,
} from '../../schemas/billing/subscription-history.schema';
import { ProxyKey, ProxyKeySchema } from '../../schemas/misc/proxy-key.schema';
import {
  ScheduledReport,
  ScheduledReportSchema,
} from '../../schemas/logging/scheduled-report.schema';
import {
  VectorizationJob,
  VectorizationJobSchema,
} from '../../schemas/vectorization/vectorization-job.schema';
import {
  VectorizationDocument,
  VectorizationDocumentSchema,
} from '../../schemas/vectorization/vectorization-document.schema';

// Modules
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { HttpModule } from '@nestjs/axios';

// Controllers
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminUserGrowthController } from './controllers/admin-user-growth.controller';
import { AdminAnomalyDetectionController } from './controllers/admin-anomaly-detection.controller';
import { AdminModelComparisonController } from './controllers/admin-model-comparison.controller';
import { AdminFeatureAnalyticsController } from './controllers/admin-feature-analytics.controller';
import { AdminProjectAnalyticsController } from './controllers/admin-project-analytics.controller';
import { AdminUserManagementController } from './controllers/admin-user-management.controller';
import { AdminActivityFeedController } from './controllers/admin-activity-feed.controller';
import { AdminRevenueAnalyticsController } from './controllers/admin-revenue-analytics.controller';
import { AdminApiKeyManagementController } from './controllers/admin-api-key-management.controller';
import { AdminEndpointPerformanceController } from './controllers/admin-endpoint-performance.controller';
import { AdminGeographicPatternsController } from './controllers/admin-geographic-patterns.controller';
import { AdminBudgetManagementController } from './controllers/admin-budget-management.controller';
import { AdminIntegrationAnalyticsController } from './controllers/admin-integration-analytics.controller';
import { AdminReportingController } from './controllers/admin-reporting.controller';
import { AdminVectorizationController } from './controllers/admin-vectorization.controller';
import { AdminUserAnalyticsController } from '../analytics/admin-user-analytics.controller';

// Services
import { AdminUserGrowthService } from './services/admin-user-growth.service';
import { AdminAnomalyDetectionService } from './services/admin-anomaly-detection.service';
import { AdminModelComparisonService } from './services/admin-model-comparison.service';
import { AdminFeatureAnalyticsService } from './services/admin-feature-analytics.service';
import { AdminProjectAnalyticsService } from './services/admin-project-analytics.service';
import { AdminUserManagementService } from './services/admin-user-management.service';
import { AdminActivityFeedService } from './services/admin-activity-feed.service';
import { AdminRevenueAnalyticsService } from './services/admin-revenue-analytics.service';
import { AdminApiKeyManagementService } from './services/admin-api-key-management.service';
import { AdminEndpointPerformanceService } from './services/admin-endpoint-performance.service';
import { AdminGeographicPatternsService } from './services/admin-geographic-patterns.service';
import { AdminBudgetManagementService } from './services/admin-budget-management.service';
import { AdminIntegrationAnalyticsService } from './services/admin-integration-analytics.service';
import { AdminReportingService } from './services/admin-reporting.service';
import { BackgroundVectorizationService } from './services/background-vectorization.service';
import { SmartSamplingService } from './services/smart-sampling.service';
import { AdminUserAnalyticsService } from '../analytics/admin-user-analytics.service';

@Module({
  imports: [
    CommonModule,
    AuthModule,
    EmailModule,
    HttpModule,
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: User.name, schema: UserSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      {
        name: SubscriptionHistory.name,
        schema: SubscriptionHistorySchema,
      },
      { name: ProxyKey.name, schema: ProxyKeySchema },
      { name: ScheduledReport.name, schema: ScheduledReportSchema },
      { name: VectorizationJob.name, schema: VectorizationJobSchema },
      { name: VectorizationDocument.name, schema: VectorizationDocumentSchema },
    ]),
  ],
  controllers: [
    AdminDashboardController,
    AdminUserGrowthController,
    AdminAnomalyDetectionController,
    AdminModelComparisonController,
    AdminFeatureAnalyticsController,
    AdminProjectAnalyticsController,
    AdminUserManagementController,
    AdminActivityFeedController,
    AdminRevenueAnalyticsController,
    AdminApiKeyManagementController,
    AdminEndpointPerformanceController,
    AdminGeographicPatternsController,
    AdminBudgetManagementController,
    AdminIntegrationAnalyticsController,
    AdminReportingController,
    AdminVectorizationController,
    AdminUserAnalyticsController,
  ],
  providers: [
    AdminUserGrowthService,
    AdminAnomalyDetectionService,
    AdminModelComparisonService,
    AdminFeatureAnalyticsService,
    AdminProjectAnalyticsService,
    AdminUserManagementService,
    AdminActivityFeedService,
    AdminRevenueAnalyticsService,
    AdminApiKeyManagementService,
    AdminEndpointPerformanceService,
    AdminGeographicPatternsService,
    AdminBudgetManagementService,
    AdminIntegrationAnalyticsService,
    AdminReportingService,
    BackgroundVectorizationService,
    SmartSamplingService,
    AdminUserAnalyticsService,
  ],
  exports: [
    AdminUserGrowthService,
    AdminAnomalyDetectionService,
    AdminModelComparisonService,
    AdminFeatureAnalyticsService,
    AdminProjectAnalyticsService,
    AdminUserManagementService,
    AdminActivityFeedService,
    AdminRevenueAnalyticsService,
    AdminApiKeyManagementService,
    AdminEndpointPerformanceService,
    AdminGeographicPatternsService,
    AdminBudgetManagementService,
    AdminIntegrationAnalyticsService,
    AdminReportingService,
    BackgroundVectorizationService,
    SmartSamplingService,
    AdminUserAnalyticsService,
  ],
})
export class AdminDashboardModule {}
