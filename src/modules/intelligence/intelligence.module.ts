import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tip, TipSchema } from '../../schemas/misc/tip.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  QualityScore,
  QualityScoreSchema,
} from '../../schemas/analytics/quality-score.schema';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './services/intelligence.service';
import { QualityService } from './services/quality.service';
import { IntelligenceAiCostTrackingService } from './services/ai-cost-tracking.service';
import { CortexModule } from '../cortex/cortex.module';
import { ActivityModule } from '../activity/activity.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tip.name, schema: TipSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: User.name, schema: UserSchema },
      { name: QualityScore.name, schema: QualityScoreSchema },
    ]),
    CortexModule,
    ActivityModule,
    SubscriptionModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [IntelligenceController],
  providers: [
    IntelligenceService,
    QualityService,
    IntelligenceAiCostTrackingService,
  ],
  exports: [IntelligenceService, QualityService],
})
export class IntelligenceModule {}
