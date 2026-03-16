import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  SimulationTracking,
  SimulationTrackingSchema,
} from '@/schemas/analytics/simulation-tracking.schema';
import { Usage, UsageSchema } from '@/schemas/analytics/usage.schema';
import { SimulationTrackingController } from './simulation-tracking.controller';
import { SimulationTrackingService } from './simulation-tracking.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: SimulationTracking.name, schema: SimulationTrackingSchema },
      { name: Usage.name, schema: UsageSchema },
    ]),
  ],
  controllers: [SimulationTrackingController],
  providers: [SimulationTrackingService],
  exports: [SimulationTrackingService],
})
export class SimulationTrackingModule {}
