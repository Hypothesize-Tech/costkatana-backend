import { Module, forwardRef } from '@nestjs/common';
import { GroundingConfidenceService } from './services/grounding-confidence.service';
import { IntegrationCostTrackingService } from './services/integration-cost-tracking.service';
import { IntegrationSecurityService } from './services/integration-security.service';
import { ROIMetricsService } from './services/roi-metrics.service';
import { TrueCostService } from './services/true-cost.service';
import { LatencyRouterService } from './services/latency-router.service';
import { TelemetryService } from './services/telemetry.service';
import { TokenCounterService } from './services/token-counter.service';
import { PricingService } from './services/pricing.service';
import { UtilsController } from './utils.controller';
import { LinkMetadataService } from './services/link-metadata.service';
import { WebSearchToolService } from './services/web-search.tool.service';
import { GoogleSearchService } from './services/google-search.service';
import { OptimizationUtilsService } from './services/optimization-utils.service';
import { CalculationUtilsService } from './services/calculation-utils.service';
import { TextExtractionService } from './services/text-extraction.service';

// Import required schemas
import {
  CostTrackingRecord,
  CostTrackingRecordSchema,
} from '../../schemas/misc/cost-tracking-record.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  SimulationTracking,
  SimulationTrackingSchema,
} from '../../schemas/analytics/simulation-tracking.schema';
import {
  Optimization,
  OptimizationSchema,
} from '../../schemas/core/optimization.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { GatewayModule } from '../gateway/gateway.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => GatewayModule), // For GatewayAnalyticsService (circular dependency)
    AuthModule,
    StorageModule, // TextExtractionService depends on StorageService
    MongooseModule.forFeature([
      {
        name: CostTrackingRecord.name,
        schema: CostTrackingRecordSchema,
      },
      {
        name: Usage.name,
        schema: UsageSchema,
      },
      {
        name: Project.name,
        schema: ProjectSchema,
      },
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: SimulationTracking.name,
        schema: SimulationTrackingSchema,
      },
      {
        name: Optimization.name,
        schema: OptimizationSchema,
      },
    ]),
  ],
  controllers: [UtilsController],
  providers: [
    GroundingConfidenceService,
    IntegrationCostTrackingService,
    IntegrationSecurityService,
    ROIMetricsService,
    TrueCostService,
    LatencyRouterService,
    TelemetryService,
    TokenCounterService,
    PricingService,
    GoogleSearchService,
    WebSearchToolService,
    LinkMetadataService,
    OptimizationUtilsService,
    CalculationUtilsService,
    TextExtractionService,
  ],
  exports: [
    GroundingConfidenceService,
    IntegrationCostTrackingService,
    IntegrationSecurityService,
    ROIMetricsService,
    TrueCostService,
    LatencyRouterService,
    TelemetryService,
    TokenCounterService,
    PricingService,
    GoogleSearchService,
    WebSearchToolService,
    LinkMetadataService,
    OptimizationUtilsService,
    CalculationUtilsService,
    TextExtractionService,
  ],
})
export class UtilsModule {}
