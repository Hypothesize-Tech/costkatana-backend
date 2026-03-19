import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { MemoryModule } from '../memory/memory.module';
import { DataNetworkEffectsController } from './controllers/data-network-effects.controller';
import { ModelPerformanceFingerprintService } from './services/model-performance-fingerprint.service';
import { LearningLoopService } from './services/learning-loop.service';
import { AgentBehaviorAnalyticsService } from './services/agent-behavior-analytics.service';
import { SemanticPatternAnalyzerService } from './services/semantic-pattern-analyzer.service';
import { GlobalBenchmarksService } from './services/global-benchmarks.service';
import { CrossModalIntelligenceService } from './services/cross-modal-intelligence.service';

// Import schemas
import {
  ModelPerformanceFingerprint,
  ModelPerformanceFingerprintSchema,
} from '../../schemas/ai/model-performance-fingerprint.schema';
import {
  RecommendationOutcome,
  RecommendationOutcomeSchema,
} from '../../schemas/analytics/recommendation-outcome.schema';
import {
  RecommendationStrategy,
  RecommendationStrategySchema,
} from '../../schemas/analytics/recommendation-strategy.schema';
import {
  AgentDecisionLog,
  AgentDecisionLogSchema,
} from '../../schemas/agent/agent-decision-log.schema';
import {
  SemanticCluster,
  SemanticClusterSchema,
} from '../../schemas/misc/semantic-cluster.schema';
import {
  GlobalBenchmark,
  GlobalBenchmarkSchema,
} from '../../schemas/ai/global-benchmark.schema';
import {
  OptimizationOutcome,
  OptimizationOutcomeSchema,
} from '../../schemas/analytics/optimization-outcome.schema';
import {
  UserMemory,
  UserMemorySchema,
  ConversationMemory,
  ConversationMemorySchema,
} from '../../schemas/agent/memory.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';

// Import related models
import {
  Telemetry,
  TelemetrySchema,
} from '../../schemas/core/telemetry.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { AILog, AILogSchema } from '../../schemas/ai/ai-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ModelPerformanceFingerprint.name,
        schema: ModelPerformanceFingerprintSchema,
      },
      {
        name: RecommendationOutcome.name,
        schema: RecommendationOutcomeSchema,
      },
      {
        name: RecommendationStrategy.name,
        schema: RecommendationStrategySchema,
      },
      {
        name: AgentDecisionLog.name,
        schema: AgentDecisionLogSchema,
      },
      {
        name: SemanticCluster.name,
        schema: SemanticClusterSchema,
      },
      {
        name: GlobalBenchmark.name,
        schema: GlobalBenchmarkSchema,
      },
      {
        name: OptimizationOutcome.name,
        schema: OptimizationOutcomeSchema,
      },
      {
        name: Telemetry.name,
        schema: TelemetrySchema,
      },
      {
        name: Usage.name,
        schema: UsageSchema,
      },
      {
        name: AILog.name,
        schema: AILogSchema,
      },
      {
        name: UserMemory.name,
        schema: UserMemorySchema,
      },
      {
        name: ConversationMemory.name,
        schema: ConversationMemorySchema,
      },
      {
        name: ChatMessage.name,
        schema: ChatMessageSchema,
      },
    ]),
    AuthModule,
    forwardRef(() => JobsModule),
    forwardRef(() => MemoryModule),
  ],
  controllers: [DataNetworkEffectsController],
  providers: [
    ModelPerformanceFingerprintService,
    LearningLoopService,
    AgentBehaviorAnalyticsService,
    SemanticPatternAnalyzerService,
    GlobalBenchmarksService,
    CrossModalIntelligenceService,
  ],
  exports: [
    ModelPerformanceFingerprintService,
    LearningLoopService,
    AgentBehaviorAnalyticsService,
    SemanticPatternAnalyzerService,
    GlobalBenchmarksService,
    CrossModalIntelligenceService,
  ],
})
export class DataNetworkEffectsModule {}
