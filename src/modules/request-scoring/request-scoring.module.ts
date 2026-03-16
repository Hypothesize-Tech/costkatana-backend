import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequestScoringController } from './request-scoring.controller';
import { RequestScoringService } from './request-scoring.service';
import {
  RequestScore,
  RequestScoreSchema,
} from '../../schemas/analytics/request-score.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RequestScore.name, schema: RequestScoreSchema },
    ]),
  ],
  controllers: [RequestScoringController],
  providers: [RequestScoringService],
  exports: [RequestScoringService],
})
export class RequestScoringModule {}
