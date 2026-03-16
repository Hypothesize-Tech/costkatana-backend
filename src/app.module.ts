import { Module, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule as AppConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SchemasModule } from './schemas/schemas.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UserSessionModule } from './modules/user-session/user-session.module';
import { EmailModule } from './modules/email/email.module';
import { EmailTrackingModule } from './modules/email-tracking/email-tracking.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AccountClosureModule } from './modules/account-closure/account-closure.module';
import { UserModule } from './modules/user/user.module';
import { KeyVaultModule } from './modules/key-vault/key-vault.module';
import { PaymentGatewayModule } from './modules/payment-gateway/payment-gateway.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { VisualComplianceModule } from './modules/visual-compliance/visual-compliance.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { VercelModule } from './modules/vercel/vercel.module';
import { McpModule } from './modules/mcp/mcp.module';
import { UtilsModule } from './modules/utils/utils.module';
import { StorageModule } from './modules/storage/storage.module';
import { PaymentModule } from './modules/payment/payment.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminDiscountModule } from './modules/admin-discount/admin-discount.module';
import { AdminAiCostMonitoringModule } from './modules/admin-ai-cost-monitoring/admin-ai-cost-monitoring.module';
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module';
import { UsageModule } from './modules/usage/usage.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TrackerModule } from './modules/tracker/tracker.module';
import { TraceModule } from './modules/trace/trace.module';
import { TemplateAnalyticsModule } from './modules/template-analytics/template-analytics.module';
import { TaggingModule } from './modules/tagging/tagging.module';
import { SimulationTrackingModule } from './modules/simulation-tracking/simulation-tracking.module';
import { SessionReplayModule } from './modules/session-replay/session-replay.module';
import { SecurityModule } from './modules/security/security.module';
import { RequestFeedbackModule } from './modules/request-feedback/request-feedback.module';
import { TeamModule } from './modules/team/team.module';
import { ReferenceImageModule } from './modules/reference-image/reference-image.module';
import { RagEvalModule } from './modules/rag-eval/rag-eval.module';
import { PromptTemplateModule } from './modules/prompt-template/prompt-template.module';
import { ProjectModule } from './modules/project/project.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { NotebookModule } from './modules/notebook/notebook.module';
import { ProactiveSuggestionsModule } from './modules/proactive-suggestions/proactive-suggestions.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { PredictiveIntelligenceModule } from './modules/predictive-intelligence/predictive-intelligence.module';
import { PerformanceCostAnalysisModule } from './modules/performance-cost-analysis/performance-cost-analysis.module';
import { PaymentWebhookModule } from './modules/payment-webhook/payment-webhook.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { MongodbMcpModule } from './modules/mongodb-mcp/mongodb-mcp.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { ModelDiscoveryModule } from './modules/model-discovery/model-discovery.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MemoryModule } from './modules/memory/memory.module';

// New optimization modules
import { CortexModule } from './modules/cortex/cortex.module';
import { CompilerModule } from './modules/compiler/compiler.module';
import { OptimizationModule } from './modules/optimization/optimization.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { GuardrailsModule } from './modules/guardrails/guardrails.module';
import { GoogleModule } from './modules/google/google.module';
import { GovernedAgentModule } from './modules/governed-agent/governed-agent.module';
import { GitHubModule } from './modules/github/github.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { FileUploadModule } from './modules/file-upload/file-upload.module';
import { ExperimentationModule } from './modules/experimentation/experimentation.module';
import { DocsAnalyticsModule } from './modules/docs-analytics/docs-analytics.module';
import { CkqlModule } from './modules/ckql/ckql.module';
import { ChatGPTModule } from './modules/chatgpt/chatgpt.module';
import { ChatModule } from './modules/chat/chat.module';
import { CacheModule } from './modules/cache/cache.module';
import { BudgetModule } from './modules/budget/budget.module';
import { CostSimulatorModule } from './modules/cost-simulator/cost-simulator.module';
import { RecommendationEngineModule } from './modules/recommendation-engine/recommendation-engine.module';
import { BillingModule } from './modules/billing/billing.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';

// Backup module (DB backup scheduler, trigger, status)
import { BackupModule } from './modules/backup/backup.module';

// AWS module (complete AWS integration with all services)
import { AwsModule } from './modules/aws/aws.module';

// Auto-simulation module
import { AutoSimulationModule } from './modules/auto-simulation/auto-simulation.module';

// Agent trace module
import { AgentTraceModule } from './modules/agent-trace/agent-trace.module';

// Agent and RAG modules
import { AgentModule } from './modules/agent/agent.module';
import { RagModule } from './modules/rag/rag.module';

// Data Network Effects module
import { DataNetworkEffectsModule } from './modules/data-network-effects/data-network-effects.module';

// Cursor module
import { CursorModule } from './modules/cursor/cursor.module';

// Jobs module
import { JobsModule } from './modules/jobs/jobs.module';

// Enterprise Security module
import { EnterpriseSecurityModule } from './modules/enterprise-security/enterprise-security.module';

// Request Scoring module
import { RequestScoringModule } from './modules/request-scoring/request-scoring.module';

// Community module
import { CommunityModule } from './modules/community/community.module';

// Governance module
import { GovernanceModule } from './modules/governance/governance.module';

// Middleware
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TraceMiddleware } from './common/middleware/trace.middleware';
import { SentryMiddleware } from './common/middleware/sentry.middleware';
import { RawBodyMiddleware } from './common/middleware/raw-body.middleware';
import { UserSessionMiddleware } from './common/middleware/user-session.middleware';
import { OtelBaggageInterceptor } from './common/interceptors/otel-baggage.interceptor';
import { RequestMetricsInterceptor } from './common/interceptors/request-metrics.interceptor';
import { GlobalTrackingInterceptor } from './common/interceptors/global-tracking.interceptor';
import { CacheMiddleware } from './common/middleware/cache.middleware';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { AdaptiveRateLimitMiddleware } from './common/middleware/adaptive-rate-limit.middleware';
import { PreemptiveThrottlingMiddleware } from './common/middleware/preemptive-throttling.middleware';
import { ComprehensiveTrackingMiddleware } from './modules/usage/middleware/comprehensive-tracking.middleware';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: () => {
        const uri =
          process.env.NODE_ENV === 'production'
            ? process.env.MONGODB_URI_PROD
            : process.env.MONGODB_URI;
        if (!uri)
          throw new Error('MONGODB_URI (or MONGODB_URI_PROD) is required');
        return {
          uri,
          autoIndex: true,
          maxPoolSize: 10,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
        };
      },
    }),
    SchemasModule,

    // Feature modules
    AuthModule,
    UserSessionModule,
    EmailModule,
    EmailTrackingModule,
    SubscriptionModule,
    ActivityModule,
    AccountClosureModule,
    UserModule,
    KeyVaultModule,
    PaymentGatewayModule,
    WorkflowModule,
    WebhookModule,
    VisualComplianceModule,
    TelemetryModule,
    VercelModule,
    McpModule,
    UtilsModule,
    StorageModule,
    PaymentModule,
    AnalyticsModule,
    AdminDiscountModule,
    AdminAiCostMonitoringModule,
    AdminDashboardModule,
    UsageModule,
    TrackingModule,
    TrackerModule,
    TraceModule,
    TemplateAnalyticsModule,
    TaggingModule,
    SimulationTrackingModule,
    SessionReplayModule,
    SecurityModule,
    RequestFeedbackModule,
    TeamModule,
    ReferenceImageModule,
    RagEvalModule,
    PromptTemplateModule,
    ProjectModule,
    OnboardingModule,
    OAuthModule,
    NotebookModule,
    ProactiveSuggestionsModule,
    PricingModule,
    PredictiveIntelligenceModule,
    PerformanceCostAnalysisModule,
    PaymentWebhookModule,
    MonitoringModule,
    MongodbMcpModule,
    ModerationModule,
    ModelDiscoveryModule,
    MetricsModule,
    MemoryModule,

    // New optimization modules
    CortexModule,
    CompilerModule,
    OptimizationModule,
    IntelligenceModule,
    IntegrationModule,
    GuardrailsModule,
    GoogleModule,
    GitHubModule,
    GovernedAgentModule,
    GatewayModule,
    FileUploadModule,
    ExperimentationModule,
    DocsAnalyticsModule,
    CkqlModule,
    ChatGPTModule,
    ChatModule,
    CacheModule,
    BudgetModule,
    CostSimulatorModule,
    RecommendationEngineModule,
    BillingModule,
    ApiKeyModule,
    BackupModule,
    AwsModule,
    AutoSimulationModule,
    AgentTraceModule,

    // AI Agent and RAG modules
    AgentModule,
    RagModule,

    // Data Network Effects module
    DataNetworkEffectsModule,

    // Cursor module
    CursorModule,

    // Jobs module
    JobsModule,

    // Community module
    CommunityModule,

    // Governance module
    GovernanceModule,

    // Enterprise Security module
    EnterpriseSecurityModule,

    // Request Scoring module
    RequestScoringModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: OtelBaggageInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestMetricsInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: GlobalTrackingInterceptor,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        LoggerMiddleware,
        TraceMiddleware,
        SentryMiddleware,
        RawBodyMiddleware,
        CacheMiddleware,
        RateLimitMiddleware,
        AdaptiveRateLimitMiddleware,
        PreemptiveThrottlingMiddleware,
        ComprehensiveTrackingMiddleware,
        UserSessionMiddleware,
      )
      .forRoutes('*');
  }
}
