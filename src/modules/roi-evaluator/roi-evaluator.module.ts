import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoiEvaluatorController } from './roi-evaluator.controller';
import { RoiEvaluatorService } from './roi-evaluator.service';
import { BenchmarkFetcherService } from './services/benchmark-fetcher.service';
import { RoiCalculatorService } from './services/roi-calculator.service';
import { RoiLead, RoiLeadSchema } from '../../schemas/misc/roi-lead.schema';
import { UtilsModule } from '../utils/utils.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RoiLead.name, schema: RoiLeadSchema }]),
    UtilsModule,
    EmailModule,
  ],
  controllers: [RoiEvaluatorController],
  providers: [
    RoiEvaluatorService,
    BenchmarkFetcherService,
    RoiCalculatorService,
  ],
  exports: [RoiEvaluatorService],
})
export class RoiEvaluatorModule {}
