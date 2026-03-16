import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  RequestFeedback,
  RequestFeedbackSchema,
} from '../../schemas/analytics/request-feedback.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { RequestFeedbackController } from './request-feedback.controller';
import { RequestFeedbackService } from './request-feedback.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: RequestFeedback.name, schema: RequestFeedbackSchema },
      { name: Usage.name, schema: UsageSchema },
    ]),
  ],
  controllers: [RequestFeedbackController],
  providers: [RequestFeedbackService],
  exports: [RequestFeedbackService],
})
export class RequestFeedbackModule {}
