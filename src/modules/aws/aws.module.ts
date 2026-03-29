import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerService } from '../../common/logger/logger.service';
import { CacheService } from '../../common/cache/cache.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';

// Cost anomaly schemas
import {
  CostAnomalyHistory,
  CostAnomalyHistorySchema,
} from '../../schemas/cost/cost-anomaly-history.schema';
import {
  CustomerCostMetrics,
  CustomerCostMetricsSchema,
} from '../../schemas/cost/customer-cost-metrics.schema';
import { CostAlert, CostAlertSchema } from '../../schemas/cost/cost-alert.schema';

// Core security services
import { TenantIsolationService } from './services/tenant-isolation.service';
import { ExternalIdService } from './services/external-id.service';
import { KillSwitchService } from './services/kill-switch.service';
import { InternalAccessControlService } from './services/internal-access-control.service';

// Audit services
import { AuditLoggerService } from './services/audit-logger.service';
import { AuditAnchorService } from './services/audit-anchor.service';

// Permission services
import { PermissionValidatorService } from './services/permission-validator.service';

// DSL and Intent services
import { DslParserService } from './services/dsl-parser.service';
import { IntentParserService } from './services/intent-parser.service';

// Execution pipeline services
import { PlanGeneratorService } from './services/plan-generator.service';
import { ExecutionEngineService } from './services/execution-engine.service';
import { SimulationEngineService } from './services/simulation-engine.service';
import { CostAnomalyGuardService } from './services/cost-anomaly-guard.service';
import { ResourceCreationPlanGeneratorService } from './services/resource-creation-plan-generator.service';
import { DefaultResourceConfigService } from './services/default-resource-config.service';

// Provider services
import { StsCredentialService } from './services/sts-credential.service';
import { PermissionBoundaryService } from './services/permission-boundary.service';
import { CostExplorerService } from './services/cost-explorer.service';
import { Ec2Service } from './services/ec2.service';
import { S3Service } from './services/s3.service';
import { RdsService } from './services/rds.service';
import { LambdaService } from './services/lambda.service';
import { CloudWatchService } from './services/cloudwatch.service';
import { DynamoDbService } from './services/dynamodb.service';
import { EcsService } from './services/ecs.service';
import { AwsPricingService } from './services/aws-pricing.service';

// Chat handler
import { AwsChatHandlerService } from './services/aws-chat-handler.service';

// Controller
import { AwsController } from './aws.controller';

// Schemas
import {
  AWSConnection,
  AWSConnectionSchema,
} from '@/schemas/integration/aws-connection.schema';
import {
  AwsSimulationResult,
  AwsSimulationResultSchema,
} from '@/schemas/integration/aws-simulation-result.schema';
import {
  AWSAuditLog,
  AWSAuditLogSchema,
} from '@/schemas/security/aws-audit-log.schema';
import {
  AuditAnchor,
  AuditAnchorSchema,
} from '@/schemas/security/audit-anchor.schema';
import {
  DailyAnchorSummary,
  DailyAnchorSummarySchema,
} from '@/schemas/security/daily-anchor-summary.schema';
import {
  RootOfTrust,
  RootOfTrustSchema,
} from '@/schemas/security/root-of-trust.schema';
import {
  InternalAudit,
  InternalAuditSchema,
} from '@/schemas/security/internal-audit.schema';
import {
  OperatorMFA,
  OperatorMFASchema,
} from '@/schemas/security/operator-mfa.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    MongooseModule.forFeature([
      { name: AWSConnection.name, schema: AWSConnectionSchema },
      { name: AwsSimulationResult.name, schema: AwsSimulationResultSchema },
      { name: AWSAuditLog.name, schema: AWSAuditLogSchema },
      { name: AuditAnchor.name, schema: AuditAnchorSchema },
      { name: DailyAnchorSummary.name, schema: DailyAnchorSummarySchema },
      { name: RootOfTrust.name, schema: RootOfTrustSchema },
      { name: InternalAudit.name, schema: InternalAuditSchema },
      { name: OperatorMFA.name, schema: OperatorMFASchema },
      { name: CostAnomalyHistory.name, schema: CostAnomalyHistorySchema },
      { name: CustomerCostMetrics.name, schema: CustomerCostMetricsSchema },
      { name: CostAlert.name, schema: CostAlertSchema },
    ]),
  ],
  controllers: [AwsController],
  providers: [
    LoggerService,
    CacheService,
    EncryptionService,
    BusinessEventLoggingService,

    // Core security services
    TenantIsolationService,
    ExternalIdService,
    KillSwitchService,
    InternalAccessControlService,

    // Audit services
    AuditLoggerService,
    AuditAnchorService,

    // Permission services
    PermissionValidatorService,

    // DSL and Intent services
    DslParserService,
    IntentParserService,

    // Execution pipeline services
    PlanGeneratorService,
    ExecutionEngineService,
    SimulationEngineService,
    CostAnomalyGuardService,
    ResourceCreationPlanGeneratorService,
    DefaultResourceConfigService,

    // Provider services
    StsCredentialService,
    PermissionBoundaryService,
    CostExplorerService,
    Ec2Service,
    S3Service,
    RdsService,
    LambdaService,
    CloudWatchService,
    DynamoDbService,
    EcsService,
    AwsPricingService,

    // Chat handler
    AwsChatHandlerService,
  ],
  exports: [
    // Core security services
    TenantIsolationService,
    ExternalIdService,
    KillSwitchService,
    InternalAccessControlService,

    // Audit services
    AuditLoggerService,
    AuditAnchorService,

    // Permission services
    PermissionValidatorService,

    // DSL and Intent services
    DslParserService,
    IntentParserService,

    // Execution pipeline services
    PlanGeneratorService,
    ExecutionEngineService,
    SimulationEngineService,
    CostAnomalyGuardService,
    ResourceCreationPlanGeneratorService,
    DefaultResourceConfigService,

    // Provider services
    StsCredentialService,
    PermissionBoundaryService,
    CostExplorerService,
    Ec2Service,
    S3Service,
    RdsService,
    LambdaService,
    CloudWatchService,
    DynamoDbService,
    EcsService,
    AwsPricingService,

    // Chat handler
    AwsChatHandlerService,
  ],
})
export class AwsModule {}
