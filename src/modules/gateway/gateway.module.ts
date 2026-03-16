import {
  Module,
  MiddlewareConsumer,
  RequestMethod,
  forwardRef,
} from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

// Import existing modules and services
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { KeyVaultModule } from '../key-vault/key-vault.module';
import { CortexModule } from '../cortex/cortex.module';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { ModerationModule } from '../moderation/moderation.module';
import { CompilerModule } from '../compiler/compiler.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { SecurityModule } from '../security/security.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AlertModule } from '../alert/alert.module';

// Import gateway components
import { GatewayController } from './gateway.controller';
import { GatewayAuthGuard } from './guards/gateway-auth.guard';
import { GatewayHeadersMiddleware } from './middleware/gateway-headers.middleware';
import { GatewayRateLimitMiddleware } from './middleware/gateway-rate-limit.middleware';
import { PriorityQueueMiddleware } from './middleware/priority-queue.middleware';

// Import gateway services
import { GatewayService } from './services/gateway.service';
import { GatewayCacheService } from './services/gateway-cache.service';
import { GatewayRetryService } from './services/gateway-retry.service';
import { GatewayFirewallService } from './services/gateway-firewall.service';
import { BudgetEnforcementService } from './services/budget-enforcement.service';
import { GatewayAnalyticsService } from './services/gateway-analytics.service';
import { RequestProcessingService } from './services/request-processing.service';
import { ResponseHandlingService } from './services/response-handling.service';
import { OutputModerationService } from './services/output-moderation.service';
import { GatewayCortexService } from './services/gateway-cortex.service';
import { FailoverService } from './services/failover.service';
import { PriorityQueueService } from './services/priority-queue.service';
import { LazySummarizationService } from './services/lazy-summarization.service';
import { TrafficManagementService } from './services/traffic-management.service';
import { CostSimulatorModule } from '../cost-simulator/cost-simulator.module';

// Import provider services
import { AnthropicPromptCachingService } from './providers/anthropic-prompt-caching.service';
import { OpenAIPromptCachingService } from './providers/openai-prompt-caching.service';
import { GoogleGeminiPromptCachingService } from './providers/google-prompt-caching.service';

// Import agent identity module
import { AgentIdentityModule } from '../agent-identity/agent-identity.module';

@Module({
  imports: [
    // External modules
    HttpModule,

    // Internal modules
    forwardRef(() => CommonModule), // For CacheService, LoggerService
    AuthModule, // For AuthService
    KeyVaultModule, // For KeyVaultService
    forwardRef(() => CortexModule), // For full Cortex integration
    GuardrailsModule, // For guardrails service
    ModerationModule, // For output moderation
    CompilerModule, // For prompt compilation
    SchemasModule, // For database schemas including Usage
    SecurityModule, // For ThreatLog, HtmlSecurityService, firewall

    // Custom modules
    AgentIdentityModule, // For agent authentication
    forwardRef(() => AnalyticsModule), // For AnalyticsService (BudgetEnforcementService)
    AlertModule, // For budget/cost alerts
    CostSimulatorModule, // For cost simulation in budget enforcement and analytics
  ],
  controllers: [GatewayController],
  providers: [
    // Guards
    GatewayAuthGuard,

    // Middleware (as providers for dependency injection)
    GatewayHeadersMiddleware,
    GatewayRateLimitMiddleware,
    PriorityQueueMiddleware,

    // Core services
    GatewayService,
    GatewayCacheService,
    GatewayRetryService,
    GatewayFirewallService,
    BudgetEnforcementService,
    GatewayAnalyticsService,
    RequestProcessingService,
    ResponseHandlingService,
    OutputModerationService,
    GatewayCortexService,
    FailoverService,
    PriorityQueueService,
    LazySummarizationService,
    TrafficManagementService,

    // Provider services
    AnthropicPromptCachingService,
    OpenAIPromptCachingService,
    GoogleGeminiPromptCachingService,
  ],
  exports: [
    // Export services that might be used by other modules
    GatewayService,
    GatewayCacheService,
    GatewayAnalyticsService,
    FailoverService,
    PriorityQueueService,
    TrafficManagementService,

    // Export provider services
    AnthropicPromptCachingService,
    OpenAIPromptCachingService,
    GoogleGeminiPromptCachingService,
  ],
})
export class GatewayModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply gateway middleware stack for all gateway routes
    consumer
      .apply(
        GatewayHeadersMiddleware,
        GatewayRateLimitMiddleware,
        PriorityQueueMiddleware,
      )
      .forRoutes({ path: 'gateway/*', method: RequestMethod.ALL });
  }
}
