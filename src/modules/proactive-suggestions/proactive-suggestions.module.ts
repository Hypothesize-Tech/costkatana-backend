import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  OptimizationOutcome,
  OptimizationOutcomeSchema,
} from '../../schemas/analytics/optimization-outcome.schema';
import {
  ModelPerformanceHistory,
  ModelPerformanceHistorySchema,
} from '../../schemas/ai/model-performance-history.schema';
import {
  ProactiveSuggestion,
  ProactiveSuggestionSchema,
} from '../../schemas/analytics/proactive-suggestion.schema';
import {
  UserProfile,
  UserProfileSchema,
} from '../../schemas/analytics/user-profile.schema';
import {
  SuggestionOutcome,
  SuggestionOutcomeSchema,
} from '../../schemas/analytics/suggestion-outcome.schema';
import {
  ModelPerformance,
  ModelPerformanceSchema,
} from '../../schemas/analytics/model-performance.schema';
import { ProactiveSuggestionsController } from './proactive-suggestions.controller';
import { ProactiveSuggestionsService } from './services/proactive-suggestions.service';
import { OptimizationFeedbackLoopService } from './services/optimization-feedback-loop.service';
import { UsageModule } from '../usage/usage.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: OptimizationOutcome.name, schema: OptimizationOutcomeSchema },
      {
        name: ModelPerformanceHistory.name,
        schema: ModelPerformanceHistorySchema,
      },
      { name: ProactiveSuggestion.name, schema: ProactiveSuggestionSchema },
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: SuggestionOutcome.name, schema: SuggestionOutcomeSchema },
      { name: ModelPerformance.name, schema: ModelPerformanceSchema },
    ]),
    UsageModule,
    SubscriptionModule,
    CommonModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [ProactiveSuggestionsController],
  providers: [ProactiveSuggestionsService, OptimizationFeedbackLoopService],
  exports: [ProactiveSuggestionsService, OptimizationFeedbackLoopService],
})
export class ProactiveSuggestionsModule {}
