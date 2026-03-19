/**
 * Recommendation Engine Module (NestJS)
 *
 * Provides scaling and cost optimization recommendations from usage data.
 */

import { Module } from '@nestjs/common';
import { RecommendationEngineService } from './recommendation-engine.service';
import { RecommendationEngineController } from './recommendation-engine.controller';
import { UsageModule } from '../usage/usage.module';
import { UtilsModule } from '../utils/utils.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [UsageModule, UtilsModule, AuthModule],
  controllers: [RecommendationEngineController],
  providers: [RecommendationEngineService],
  exports: [RecommendationEngineService],
})
export class RecommendationEngineModule {}
