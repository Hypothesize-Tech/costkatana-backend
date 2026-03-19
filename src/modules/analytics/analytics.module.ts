/**
 * Analytics Module
 * Provides traffic prediction, observability, and analytics services
 */

import { Module, forwardRef, type DynamicModule } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';

// Services
import { TrafficPredictionService } from './services/traffic-prediction.service';
import { MultiRepoIntelligenceService } from './services/multi-repo-intelligence.service';
import { SelfHealingSpanProcessorService } from './services/self-healing-span-processor.service';
import { ChatSecurityHandlerService } from './services/chat-security-handler.service';
import { AnalyticsService } from './analytics.service';

// Controllers
import { AnalyticsController } from './analytics.controller';

// Schemas
import {
  MultiRepoIndex,
  MultiRepoIndexSchema,
} from '../../schemas/document/multi-repo-index.schema';
import {
  GitHubConnection,
  GitHubConnectionSchema,
} from '../../schemas/integration/github-connection.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';

// GitHub module for Octokit-based API access
import { GitHubModule } from '../github/github.module';
import { AuthModule } from '../auth/auth.module';
import { RequestFeedbackModule } from '../request-feedback/request-feedback.module';
import { ProjectModule } from '../project/project.module';

@Module({
  imports: [
    CacheModule.register() as DynamicModule,
    EventEmitterModule.forRoot(),
    MongooseModule.forFeature([
      { name: MultiRepoIndex.name, schema: MultiRepoIndexSchema },
      { name: GitHubConnection.name, schema: GitHubConnectionSchema },
      { name: Usage.name, schema: UsageSchema },
    ]),
    GitHubModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
    RequestFeedbackModule, // RequestFeedbackService for AnalyticsController
    ProjectModule, // ProjectService for AnalyticsController
    forwardRef(() => require('../security/security.module').SecurityModule), // Lazy require breaks cycle
  ],
  controllers: [AnalyticsController],
  providers: [
    TrafficPredictionService,
    MultiRepoIntelligenceService,
    SelfHealingSpanProcessorService,
    ChatSecurityHandlerService,
    AnalyticsService,
  ],
  exports: [
    TrafficPredictionService,
    MultiRepoIntelligenceService,
    SelfHealingSpanProcessorService,
    ChatSecurityHandlerService,
    AnalyticsService,
  ],
})
export class AnalyticsModule {}
