import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Usage, UsageSchema } from '@/schemas/core/usage.schema';
import { Project, ProjectSchema } from '@/schemas/team-project/project.schema';
import {
  QualityScore,
  QualityScoreSchema,
} from '@/schemas/analytics/quality-score.schema';
import { AuthModule } from '../auth/auth.module';
import { PerformanceCostAnalysisService } from './services/performance-cost-analysis.service';
import { PredictiveCostIntelligenceService } from './services/predictive-cost-intelligence.service';
import { PredictiveIntelligenceController } from './predictive-intelligence.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: QualityScore.name, schema: QualityScoreSchema },
    ]),
  ],
  controllers: [PredictiveIntelligenceController],
  providers: [
    PerformanceCostAnalysisService,
    PredictiveCostIntelligenceService,
  ],
  exports: [PerformanceCostAnalysisService, PredictiveCostIntelligenceService],
})
export class PredictiveIntelligenceModule {}
