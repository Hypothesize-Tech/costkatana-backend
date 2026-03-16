import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  SessionReplay,
  SessionReplaySchema,
} from '@/schemas/analytics/session-replay.schema';
import { Telemetry, TelemetrySchema } from '@/schemas/core/telemetry.schema';
import { SessionReplayController } from './session-replay.controller';
import { SessionReplayService } from './session-replay.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: SessionReplay.name, schema: SessionReplaySchema },
      { name: Telemetry.name, schema: TelemetrySchema },
    ]),
  ],
  controllers: [SessionReplayController],
  providers: [SessionReplayService],
  exports: [SessionReplayService],
})
export class SessionReplayModule {}
