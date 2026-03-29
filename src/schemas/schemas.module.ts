import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Core schemas
import { Usage, UsageSchema } from './core/usage.schema';
import { Optimization, OptimizationSchema } from './core/optimization.schema';
import { Alert, AlertSchema } from './core/alert.schema';
import {
  CortexTrainingData,
  CortexTrainingDataSchema,
} from './core/cortex-training-data.schema';
import { Telemetry, TelemetrySchema } from './core/telemetry.schema';
import { Subscription, SubscriptionSchema } from './core/subscription.schema';

// Common schemas
import {
  IndexingMetrics,
  IndexingMetricsSchema,
  IndexingOperation,
  IndexingOperationSchema,
  SearchOperation,
  SearchOperationSchema,
} from './common/indexing-metrics.schema';
import {
  AcceptanceEvent,
  AcceptanceEventSchema,
} from './common/acceptance-metrics.schema';

// User schemas
import { User, UserSchema } from './user/user.schema';
import { UserSession, UserSessionSchema } from './user/user-session.schema';
import {
  UserApprovalRequest,
  UserApprovalRequestSchema,
} from './user/user-approval-request.schema';
import { Workspace, WorkspaceSchema } from './user/workspace.schema';
import {
  MagicLinkToken,
  MagicLinkTokenSchema,
} from './user/magic-link-token.schema';
import {
  UserModerationConfig,
  UserModerationConfigSchema,
} from './user/user-moderation-config.schema';
import {
  UserOptimizationConfig,
  UserOptimizationConfigSchema,
} from './user/user-optimization-config.schema';

// Team & Project schemas
import { Team, TeamSchema } from './team-project/team.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from './team-project/team-member.schema';
import { Project, ProjectSchema } from './team-project/project.schema';
import {
  Organization,
  OrganizationSchema,
} from './team-project/organization.schema';
import { Activity, ActivitySchema } from './team-project/activity.schema';

// Integration schemas
import {
  Integration,
  IntegrationSchema,
} from './integration/integration.schema';
import {
  GitHubConnection,
  GitHubConnectionSchema,
} from './integration/github-connection.schema';
import {
  GitHubIntegration,
  GitHubIntegrationSchema,
} from './integration/github-integration.schema';
import {
  VercelConnection,
  VercelConnectionSchema,
} from './integration/vercel-connection.schema';
import {
  AWSConnection,
  AWSConnectionSchema,
} from './integration/aws-connection.schema';
import {
  MongoDBConnection,
  MongoDBConnectionSchema,
} from './integration/mongodb-connection.schema';
import {
  GoogleConnection,
  GoogleConnectionSchema,
} from './integration/google-connection.schema';
import {
  GoogleWorkflow,
  GoogleWorkflowSchema,
} from './integration/google-workflow.schema';
import {
  GoogleFileAccess,
  GoogleFileAccessSchema,
} from './integration/google-file-access.schema';
import {
  GoogleExportAudit,
  GoogleExportAuditSchema,
} from './integration/google-export-audit.schema';
import {
  UserTelemetryConfig,
  UserTelemetryConfigSchema,
} from './integration/user-telemetry-config.schema';

// Prompt schemas
import {
  PromptTemplate,
  PromptTemplateSchema,
} from './prompt/prompt-template.schema';
import {
  TemplateExecution,
  TemplateExecutionSchema,
} from './prompt/template-execution.schema';

// Chat schemas
import { Conversation, ConversationSchema } from './chat/conversation.schema';
import { ChatMessage, ChatMessageSchema } from './chat/chat-message.schema';
import { ChatTaskLink, ChatTaskLinkSchema } from './chat/chat-task-link.schema';

// Document schemas
import { Document, DocumentSchema } from './document/document.schema';
import {
  MultiRepoIndex,
  MultiRepoIndexSchema,
} from './document/multi-repo-index.schema';

// Vectorization schemas
import {
  VectorizationDocument,
  VectorizationDocumentSchema,
} from './vectorization/vectorization-document.schema';
import { SymbolIndex, SymbolIndexSchema } from './document/symbol-index.schema';
import {
  GitHubCodeChunk,
  GitHubCodeChunkSchema,
} from './document/github-code-chunk.schema';

// Job schemas
import {
  DeadLetterJob,
  DeadLetterJobSchema,
} from './jobs/dead-letter-job.schema';

// Analytics schemas
import {
  QualityScore,
  QualityScoreSchema,
} from './analytics/quality-score.schema';
import {
  RequestScore,
  RequestScoreSchema,
} from './analytics/request-score.schema';
import {
  RequestFeedback,
  RequestFeedbackSchema,
} from './analytics/request-feedback.schema';
import {
  RecommendationOutcome,
  RecommendationOutcomeSchema,
} from './analytics/recommendation-outcome.schema';
import {
  RecommendationStrategy,
  RecommendationStrategySchema,
} from './analytics/recommendation-strategy.schema';
import {
  UserProfile,
  UserProfileSchema,
} from './analytics/user-profile.schema';
import {
  SuggestionOutcome,
  SuggestionOutcomeSchema,
} from './analytics/suggestion-outcome.schema';
import {
  ModelPerformance,
  ModelPerformanceSchema,
} from './analytics/model-performance.schema';
import {
  OptimizationOutcome,
  OptimizationOutcomeSchema,
} from './analytics/optimization-outcome.schema';
import { Experiment, ExperimentSchema } from './analytics/experiment.schema';
import {
  ExperimentSession,
  ExperimentSessionSchema,
} from './analytics/experiment-session.schema';
import {
  WhatIfScenario,
  WhatIfScenarioSchema,
} from './analytics/what-if-scenario.schema';
import { AILog, AILogSchema } from './ai/ai-log.schema';
import { AIInsight, AIInsightSchema } from './ai/ai-insight.schema';
import {
  ModelPerformanceFingerprint,
  ModelPerformanceFingerprintSchema,
} from './ai/model-performance-fingerprint.schema';
import {
  GlobalBenchmark,
  GlobalBenchmarkSchema,
} from './analytics/global-benchmark.schema';

// Notebook schemas
import { Notebook, NotebookSchema } from './notebook/notebook.schema';
import {
  NotebookExecution,
  NotebookExecutionSchema,
} from './notebook/notebook-execution.schema';
import {
  DatasetVersion,
  DatasetVersionSchema,
} from './notebook/dataset-version.schema';
import {
  DatasetItemSchema,
  DatasetItemSchemaSchema,
} from './notebook/dataset-item-schema.schema';
import {
  WorkflowVersion,
  WorkflowVersionSchema,
} from './notebook/workflow-version.schema';

// Security schemas
import {
  MongodbMcpAuditLog,
  MongodbMcpAuditLogSchema,
} from './security/mongodb-mcp-audit-log.schema';
import {
  AWSAuditLog,
  AWSAuditLogSchema,
} from './security/aws-audit-log.schema';
import {
  McpPermission,
  McpPermissionSchema,
} from './security/mcp-permission.schema';
import {
  McpPermissionAuditLog,
  McpPermissionAuditLogSchema,
} from './security/mcp-permission-audit-log.schema';
import {
  McpSecurityEventLog,
  McpSecurityEventLogSchema,
} from './security/mcp-security-event-log.schema';
import { AuditAnchor, AuditAnchorSchema } from './security/audit-anchor.schema';
import {
  DailyAnchorSummary,
  DailyAnchorSummarySchema,
} from './security/daily-anchor-summary.schema';
import {
  RootOfTrust,
  RootOfTrustSchema,
} from './security/root-of-trust.schema';
import { ThreatLog, ThreatLogSchema } from './security/threat-log.schema';
// Billing schemas
import {
  PaymentMethod,
  PaymentMethodSchema,
} from './billing/payment-method.schema';
import { Invoice, InvoiceSchema } from './billing/invoice.schema';
import { Discount, DiscountSchema } from './billing/discount.schema';
import {
  SubscriptionHistory,
  SubscriptionHistorySchema,
} from './billing/subscription-history.schema';

// Webhook schemas
import { Webhook, WebhookSchema } from './webhook/webhook.schema';
import {
  WebhookDelivery,
  WebhookDeliverySchema,
} from './webhook/webhook-delivery.schema';

// Logging schemas
import {
  LogQueryConversation,
  LogQueryConversationSchema,
} from './logging/log-query-conversation.schema';
import {
  LogQueryAudit,
  LogQueryAuditSchema,
} from './logging/log-query-audit.schema';
import {
  ScheduledReport,
  ScheduledReportSchema,
} from './logging/scheduled-report.schema';

// Misc schemas
import {
  SemanticCluster,
  SemanticClusterSchema,
} from './misc/semantic-cluster.schema';
import {
  CostTrackingRecord,
  CostTrackingRecordSchema,
} from './cost/cost-tracking-record.schema';
import { Tip, TipSchema } from './misc/tip.schema';
import {
  InterventionLog,
  InterventionLogSchema,
} from './logging/intervention-log.schema';
import {
  CalendarAlertSettings,
  CalendarAlertSettingsSchema,
} from './misc/calendar-alert-settings.schema';
import { UploadedFile, UploadedFileSchema } from './misc/uploaded-file.schema';
import {
  RepositoryUserMapping,
  RepositoryUserMappingSchema,
} from './integration/repository-user-mapping.schema';
import {
  ApprovalRequest,
  ApprovalRequestSchema,
} from './core/approval-request.schema';
import { ProviderKey, ProviderKeySchema } from './security/provider-key.schema';
import { ProxyKey, ProxyKeySchema } from './security/proxy-key.schema';
import {
  WorkflowTemplateVersion,
  WorkflowTemplateVersionSchema,
} from './misc/workflow-template-version.schema';
import {
  OptimizationTemplate,
  OptimizationTemplateSchema,
} from './core/optimization-template.schema';
import {
  Session,
  SessionSchema,
  SharedSession,
  SharedSessionSchema,
} from './misc/session.schema';
import {
  RequestTracking,
  RequestTrackingSchema,
} from './misc/request-tracking.schema';
import { TraceSession, TraceSessionSchema } from './trace/trace-session.schema';
import { TraceSpan, TraceSpanSchema } from './trace/trace-span.schema';
import { TraceMessage, TraceMessageSchema } from './trace/trace-message.schema';

// Community schemas
import {
  UserExample,
  UserExampleSchema,
} from './community/user-example.schema';
import { Discussion, DiscussionSchema } from './community/discussion.schema';
import {
  ChatSession,
  ChatSessionSchema,
} from './community/chat-session.schema';
import {
  DocsComment,
  DocsCommentSchema,
} from './community/docs-comment.schema';
import {
  CommunityChatMessage,
  CommunityChatMessageSchema,
} from './community/community-chat-message.schema';

// Docs Analytics schemas
import {
  DocsPageFeedback,
  DocsPageFeedbackSchema,
} from './docs-analytics/docs-page-feedback.schema';
import {
  DocsPageRating,
  DocsPageRatingSchema,
} from './docs-analytics/docs-page-rating.schema';
import {
  DocsUserPreference,
  DocsUserPreferenceSchema,
} from './docs-analytics/docs-user-preference.schema';
import {
  DocsPageView,
  DocsPageViewSchema,
} from './docs-analytics/docs-page-view.schema';

// Gateway schemas
import {
  GatewayProviderMetrics,
  GatewayProviderMetricsSchema,
} from './gateway/gateway-provider-metrics.schema';

// Auto-simulation schemas
import {
  AutoSimulationSettings,
  AutoSimulationSettingsSchema,
} from './analytics/auto-simulation-settings.schema';
import {
  AutoSimulationQueue,
  AutoSimulationQueueSchema,
} from './analytics/auto-simulation-queue.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      // Core schemas
      { name: Usage.name, schema: UsageSchema },
      { name: Optimization.name, schema: OptimizationSchema },
      { name: Alert.name, schema: AlertSchema },
      { name: CortexTrainingData.name, schema: CortexTrainingDataSchema },
      { name: Telemetry.name, schema: TelemetrySchema },
      { name: Subscription.name, schema: SubscriptionSchema },

      // Common schemas
      { name: IndexingMetrics.name, schema: IndexingMetricsSchema },
      { name: IndexingOperation.name, schema: IndexingOperationSchema },
      { name: SearchOperation.name, schema: SearchOperationSchema },
      { name: AcceptanceEvent.name, schema: AcceptanceEventSchema },

      // User schemas
      { name: User.name, schema: UserSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: UserApprovalRequest.name, schema: UserApprovalRequestSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: MagicLinkToken.name, schema: MagicLinkTokenSchema },
      { name: UserModerationConfig.name, schema: UserModerationConfigSchema },
      {
        name: UserOptimizationConfig.name,
        schema: UserOptimizationConfigSchema,
      },

      // Team & Project schemas
      { name: Organization.name, schema: OrganizationSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Activity.name, schema: ActivitySchema },

      // Integration schemas
      { name: Integration.name, schema: IntegrationSchema },
      { name: GitHubConnection.name, schema: GitHubConnectionSchema },
      { name: GitHubIntegration.name, schema: GitHubIntegrationSchema },
      { name: VercelConnection.name, schema: VercelConnectionSchema },
      { name: AWSConnection.name, schema: AWSConnectionSchema },
      { name: MongoDBConnection.name, schema: MongoDBConnectionSchema },
      { name: GoogleConnection.name, schema: GoogleConnectionSchema },
      { name: GoogleWorkflow.name, schema: GoogleWorkflowSchema },
      { name: GoogleFileAccess.name, schema: GoogleFileAccessSchema },
      { name: GoogleExportAudit.name, schema: GoogleExportAuditSchema },
      { name: UserTelemetryConfig.name, schema: UserTelemetryConfigSchema },

      // Prompt schemas
      { name: PromptTemplate.name, schema: PromptTemplateSchema },
      { name: TemplateExecution.name, schema: TemplateExecutionSchema },

      // Chat schemas
      { name: Conversation.name, schema: ConversationSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatTaskLink.name, schema: ChatTaskLinkSchema },

      // Document schemas
      { name: Document.name, schema: DocumentSchema },
      { name: MultiRepoIndex.name, schema: MultiRepoIndexSchema },
      { name: SymbolIndex.name, schema: SymbolIndexSchema },
      { name: GitHubCodeChunk.name, schema: GitHubCodeChunkSchema },

      // Analytics schemas
      { name: QualityScore.name, schema: QualityScoreSchema },
      { name: RequestScore.name, schema: RequestScoreSchema },
      { name: RequestFeedback.name, schema: RequestFeedbackSchema },
      { name: RecommendationOutcome.name, schema: RecommendationOutcomeSchema },
      {
        name: RecommendationStrategy.name,
        schema: RecommendationStrategySchema,
      },
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: SuggestionOutcome.name, schema: SuggestionOutcomeSchema },
      { name: ModelPerformance.name, schema: ModelPerformanceSchema },
      { name: OptimizationOutcome.name, schema: OptimizationOutcomeSchema },
      { name: Experiment.name, schema: ExperimentSchema },
      { name: ExperimentSession.name, schema: ExperimentSessionSchema },
      { name: WhatIfScenario.name, schema: WhatIfScenarioSchema },
      { name: AILog.name, schema: AILogSchema },
      {
        name: ModelPerformanceFingerprint.name,
        schema: ModelPerformanceFingerprintSchema,
      },
      { name: GlobalBenchmark.name, schema: GlobalBenchmarkSchema },

      // Job schemas
      { name: DeadLetterJob.name, schema: DeadLetterJobSchema },

      // Notebook schemas
      { name: Notebook.name, schema: NotebookSchema },
      { name: NotebookExecution.name, schema: NotebookExecutionSchema },
      { name: DatasetVersion.name, schema: DatasetVersionSchema },
      { name: DatasetItemSchema.name, schema: DatasetItemSchemaSchema },
      { name: WorkflowVersion.name, schema: WorkflowVersionSchema },

      // Security schemas
      { name: ThreatLog.name, schema: ThreatLogSchema },
      { name: MongodbMcpAuditLog.name, schema: MongodbMcpAuditLogSchema },
      { name: AWSAuditLog.name, schema: AWSAuditLogSchema },
      { name: McpPermission.name, schema: McpPermissionSchema },
      { name: McpPermissionAuditLog.name, schema: McpPermissionAuditLogSchema },
      { name: McpSecurityEventLog.name, schema: McpSecurityEventLogSchema },
      { name: AuditAnchor.name, schema: AuditAnchorSchema },
      { name: DailyAnchorSummary.name, schema: DailyAnchorSummarySchema },
      { name: RootOfTrust.name, schema: RootOfTrustSchema },

      // Billing schemas
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: SubscriptionHistory.name, schema: SubscriptionHistorySchema },

      // Webhook schemas
      { name: Webhook.name, schema: WebhookSchema },
      { name: WebhookDelivery.name, schema: WebhookDeliverySchema },

      // Logging schemas
      { name: LogQueryConversation.name, schema: LogQueryConversationSchema },
      { name: LogQueryAudit.name, schema: LogQueryAuditSchema },
      { name: ScheduledReport.name, schema: ScheduledReportSchema },

      // Misc schemas
      { name: SemanticCluster.name, schema: SemanticClusterSchema },
      { name: CostTrackingRecord.name, schema: CostTrackingRecordSchema },
      { name: VectorizationDocument.name, schema: VectorizationDocumentSchema },
      { name: Tip.name, schema: TipSchema },
      { name: InterventionLog.name, schema: InterventionLogSchema },
      { name: CalendarAlertSettings.name, schema: CalendarAlertSettingsSchema },
      { name: UploadedFile.name, schema: UploadedFileSchema },
      { name: RepositoryUserMapping.name, schema: RepositoryUserMappingSchema },
      { name: AIInsight.name, schema: AIInsightSchema },
      { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
      { name: ProviderKey.name, schema: ProviderKeySchema },
      { name: ProxyKey.name, schema: ProxyKeySchema },
      { name: Session.name, schema: SessionSchema },
      { name: SharedSession.name, schema: SharedSessionSchema },
      { name: RequestTracking.name, schema: RequestTrackingSchema },
      {
        name: WorkflowTemplateVersion.name,
        schema: WorkflowTemplateVersionSchema,
      },
      { name: OptimizationTemplate.name, schema: OptimizationTemplateSchema },

      // Trace schemas (trace sessions, spans, messages)
      { name: TraceSession.name, schema: TraceSessionSchema },
      { name: TraceSpan.name, schema: TraceSpanSchema },
      { name: TraceMessage.name, schema: TraceMessageSchema },

      // Community schemas
      { name: UserExample.name, schema: UserExampleSchema },
      { name: Discussion.name, schema: DiscussionSchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: DocsComment.name, schema: DocsCommentSchema },
      { name: CommunityChatMessage.name, schema: CommunityChatMessageSchema },

      // Docs Analytics schemas
      { name: DocsPageFeedback.name, schema: DocsPageFeedbackSchema },
      { name: DocsPageRating.name, schema: DocsPageRatingSchema },
      { name: DocsUserPreference.name, schema: DocsUserPreferenceSchema },
      { name: DocsPageView.name, schema: DocsPageViewSchema },

      // Gateway schemas
      {
        name: GatewayProviderMetrics.name,
        schema: GatewayProviderMetricsSchema,
      },

      // Auto-simulation schemas
      {
        name: AutoSimulationSettings.name,
        schema: AutoSimulationSettingsSchema,
      },
      { name: AutoSimulationQueue.name, schema: AutoSimulationQueueSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class SchemasModule {}
