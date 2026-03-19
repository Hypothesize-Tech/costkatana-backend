import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { UtilsModule } from '../utils/utils.module';
import { AdminAiCostMonitoringController } from './admin-ai-cost-monitoring.controller';
import { AICostTrackingService } from './ai-cost-tracking.service';
import {
  AICallRecord,
  AICallRecordSchema,
} from '../../schemas/admin/ai-call-record.schema';

@Module({
  imports: [
    CommonModule,
    AuthModule,
    UtilsModule,
    MongooseModule.forFeature([
      { name: AICallRecord.name, schema: AICallRecordSchema },
    ]),
  ],
  controllers: [AdminAiCostMonitoringController],
  providers: [AICostTrackingService],
  exports: [AICostTrackingService],
})
export class AdminAiCostMonitoringModule {}
