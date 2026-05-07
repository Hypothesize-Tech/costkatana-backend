import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  EvaluationResult,
  EvaluationResultSchema,
} from '../../schemas/analytics/evaluation-result.schema';
import {
  RequestFeedback,
  RequestFeedbackSchema,
} from '../../schemas/analytics/request-feedback.schema';
import { EvalsDashboardService } from './services/evals-dashboard.service';
import { EvalsDashboardController } from './evals-dashboard.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: EvaluationResult.name, schema: EvaluationResultSchema },
      { name: RequestFeedback.name, schema: RequestFeedbackSchema },
    ]),
  ],
  controllers: [EvalsDashboardController],
  providers: [EvalsDashboardService],
  exports: [EvalsDashboardService],
})
export class EvalsModule {}
