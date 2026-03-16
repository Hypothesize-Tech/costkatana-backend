import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  Telemetry,
  TelemetrySchema,
} from '../../schemas/core/telemetry.schema';
import { TelemetryService } from '../../services/telemetry.service';
import { TelemetryBootstrapService } from './telemetry-bootstrap.service';
import { UserTelemetryConfigController } from './user-telemetry-config.controller';
import { UserTelemetryConfigService } from './services/user-telemetry-config.service';
import { TelemetryPollerService } from './services/telemetry-poller.service';
import { TelemetryQueryController } from './telemetry-query.controller';
import { TelemetryQueryService } from './services/telemetry-query.service';
import { CostStreamingService } from './services/cost-streaming.service';
import { CostStreamingController } from './cost-streaming.controller';
import { TelemetryCleanupService } from './services/telemetry-cleanup.service';
import { TelemetryIngestionService } from './services/telemetry-ingestion.service';
import { IngestionJobService } from './services/ingestion-job.service';
import { SchemasModule } from '../../schemas/schemas.module';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Telemetry.name, schema: TelemetrySchema },
    ]),
    SchemasModule,
    CommonModule,
    AuthModule,
  ],
  controllers: [
    UserTelemetryConfigController,
    TelemetryQueryController,
    CostStreamingController,
  ],
  providers: [
    TelemetryService,
    TelemetryBootstrapService,
    UserTelemetryConfigService,
    TelemetryPollerService,
    TelemetryQueryService,
    CostStreamingService,
    TelemetryCleanupService,
    TelemetryIngestionService,
    IngestionJobService,
  ],
  exports: [
    TelemetryService,
    UserTelemetryConfigService,
    TelemetryPollerService,
    TelemetryQueryService,
    CostStreamingService,
    TelemetryCleanupService,
    TelemetryIngestionService,
  ],
})
export class TelemetryModule {}
