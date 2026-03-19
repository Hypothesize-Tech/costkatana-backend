import { Global, Module, forwardRef, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { LoggerService } from './logger/logger.service';
import { EncryptionService } from './encryption/encryption.service';
import { CacheService } from './cache/cache.service';
import { BusinessEventLoggingService } from './services/business-event-logging.service';
import { MixpanelService } from './services/mixpanel.service';
import { LoggingService } from './services/logging.service';
import { ControllerHelper } from './services/controller-helper.service';
import { ErrorHandlerService } from './services/error-handler.service';
import { OpenTelemetryService } from './services/opentelemetry.service';
import { OTelEnricherService } from './services/otel-enricher.service';
import { UserNotificationService } from './services/user-notification.service';
import { UserNotificationController } from './controllers/user-notification.controller';
import { EnterpriseSecurityGuard } from './guards/enterprise-security.guard';
import { ENTERPRISE_SECURITY_OPTIONS } from './guards/enterprise-security.guard';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { SecurityDashboardGuard } from './guards/security-dashboard.guard';
import { OtelBaggageInterceptor } from './interceptors/otel-baggage.interceptor';
import { RequestMetricsInterceptor } from './interceptors/request-metrics.interceptor';
import { GlobalTrackingInterceptor } from './interceptors/global-tracking.interceptor';
import { ServicePrioritizationService } from './services/service-prioritization.service';
import { AdaptiveRateLimitService } from './services/adaptive-rate-limit.service';
import { AILoggerService } from './services/ai-logger.service';
import { LangSmithService } from './services/langsmith.service';
import { SentryInstrumentationService } from './services/sentry-instrumentation.service';
import { GenerationDecisionService } from './services/generation-decision.service';
import { GenerationQueueService } from './services/generation-queue.service';
import { UserDataQueryService } from './services/user-data-query.service';
import { UserSessionEmailService } from './services/user-session-email.service';
import { RequirementsAnalysisService } from './services/requirements-analysis.service';
import { LanguagePrioritizerService } from './services/language-prioritizer.service';
import { DynamicContextMetricsService } from './services/dynamic-context-metrics.service';
import { FindReferencesService } from './services/find-references.service';
import { RealTimeSecurityMonitoringService } from './services/real-time-security-monitoring.service';
import { PreemptiveThrottlingService } from './services/preemptive-throttling.service';
import { NormalizationService } from './services/normalization.service';
import { RecommendationRulesService } from './services/recommendation-rules.service';
import { GitHubRetrievalService } from './services/github-retrieval.service';
import { IndexingMetricsService } from './services/indexing-metrics.service';
import { TracedAIService } from './services/traced-ai.service';
import { AcceptanceMetricsService } from './services/acceptance-metrics.service';
import { FeatureScoringService } from './services/feature-scoring.service';
import { ProviderAdapterInitializerService } from './services/provider-adapter-initializer.service';
import { BudgetAlertCalendarService } from './services/budget-alert-calendar.service';
import { CalendarSyncService } from './services/calendar-sync.service';
import { ContextFileManagerService } from './services/context-file-manager.service';
import { AILoggingInterceptor } from './interceptors/ai-logging.interceptor';
import { CortexGatewayMiddleware } from './middleware/cortex-gateway.middleware';
import { CortexResponseInterceptor } from './interceptors/cortex-response.interceptor';
import { CortexErrorFilter } from './filters/cortex-error.filter';
import {
  MCPMiddleware,
  MCPRateLimitMiddleware,
} from './middleware/mcp.middleware';
import { CacheMiddleware } from './middleware/cache.middleware';
import { RateLimitMiddleware } from './middleware/rate-limit.middleware';
import { SecurityModule } from '../modules/security/security.module';
import { CortexModule } from '../modules/cortex/cortex.module';
import { SchemasModule } from '../schemas/schemas.module';
import { EmailModule } from '../modules/email/email.module';
import { WebhookModule } from '../modules/webhook/webhook.module';
import { AwsModule } from '../modules/aws/aws.module';
import { PricingModule } from '../modules/pricing/pricing.module';
import { AuthModule } from '../modules/auth/auth.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule,
    HttpModule.register({ timeout: 10000 }),
    EventEmitterModule.forRoot({ wildcard: true }),
    CacheModule.register() as DynamicModule,
    SecurityModule,
    forwardRef(() => CortexModule),
    SchemasModule,
    EmailModule,
    WebhookModule,
    forwardRef(() => AwsModule),
    PricingModule,
    AuthModule,
  ],
  controllers: [UserNotificationController],
  providers: [
    LoggerService,
    EncryptionService,
    CacheService,
    BusinessEventLoggingService,
    MixpanelService,
    LoggingService,
    ControllerHelper,
    ErrorHandlerService,
    OpenTelemetryService,
    OTelEnricherService,
    UserNotificationService,
    { provide: ENTERPRISE_SECURITY_OPTIONS, useValue: {} },
    EnterpriseSecurityGuard,
    WebhookSignatureGuard,
    SecurityDashboardGuard,
    OtelBaggageInterceptor,
    RequestMetricsInterceptor,
    GlobalTrackingInterceptor,
    ServicePrioritizationService,
    AdaptiveRateLimitService,
    AILoggerService,
    LangSmithService,
    SentryInstrumentationService,
    GenerationDecisionService,
    GenerationQueueService,
    UserDataQueryService,
    UserSessionEmailService,
    RequirementsAnalysisService,
    LanguagePrioritizerService,
    DynamicContextMetricsService,
    FindReferencesService,
    RealTimeSecurityMonitoringService,
    PreemptiveThrottlingService,
    NormalizationService,
    RecommendationRulesService,
    GitHubRetrievalService,
    IndexingMetricsService,
    TracedAIService,
    AcceptanceMetricsService,
    FeatureScoringService,
    ProviderAdapterInitializerService,
    BudgetAlertCalendarService,
    CalendarSyncService,
    ContextFileManagerService,
    AILoggingInterceptor,
    CortexGatewayMiddleware,
    CortexResponseInterceptor,
    CortexErrorFilter,
    MCPMiddleware,
    MCPRateLimitMiddleware,
    CacheMiddleware,
    RateLimitMiddleware,
  ],
  exports: [
    LoggerService,
    EncryptionService,
    CacheService,
    BusinessEventLoggingService,
    MixpanelService,
    LoggingService,
    ControllerHelper,
    ErrorHandlerService,
    OpenTelemetryService,
    OTelEnricherService,
    UserNotificationService,
    EnterpriseSecurityGuard,
    WebhookSignatureGuard,
    SecurityDashboardGuard,
    OtelBaggageInterceptor,
    RequestMetricsInterceptor,
    GlobalTrackingInterceptor,
    ServicePrioritizationService,
    AdaptiveRateLimitService,
    AILoggerService,
    LangSmithService,
    SentryInstrumentationService,
    GenerationDecisionService,
    GenerationQueueService,
    UserDataQueryService,
    UserSessionEmailService,
    RequirementsAnalysisService,
    LanguagePrioritizerService,
    DynamicContextMetricsService,
    FindReferencesService,
    RealTimeSecurityMonitoringService,
    PreemptiveThrottlingService,
    NormalizationService,
    RecommendationRulesService,
    GitHubRetrievalService,
    IndexingMetricsService,
    TracedAIService,
    AcceptanceMetricsService,
    FeatureScoringService,
    ProviderAdapterInitializerService,
    BudgetAlertCalendarService,
    CalendarSyncService,
    ContextFileManagerService,
    AILoggingInterceptor,
    CortexGatewayMiddleware,
    CortexResponseInterceptor,
    CortexErrorFilter,
    MCPMiddleware,
    MCPRateLimitMiddleware,
    CacheMiddleware,
    RateLimitMiddleware,
  ],
})
export class CommonModule {}
