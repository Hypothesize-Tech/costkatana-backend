/**
 * Recommendation Engine Module (NestJS)
 *
 * Provides scaling and cost optimization recommendations from usage data.
 */

import { Module } from '@nestjs/common';
import { RecommendationEngineService } from './recommendation-engine.service';
import { UsageModule } from '../usage/usage.module';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [UsageModule, UtilsModule],
  providers: [RecommendationEngineService],
  exports: [RecommendationEngineService],
})
export class RecommendationEngineModule {}
