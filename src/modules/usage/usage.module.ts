import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

// Modules
import { UserModule } from '../user/user.module';
import { CommonModule } from '../../common/common.module';
import { BedrockModule } from '../bedrock/bedrock.module';
import { IntegrationModule } from '../integration/integration.module';
import { BudgetModule } from '../budget/budget.module';
import { AuthModule } from '../auth/auth.module';

// Schemas
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Session,
  SessionSchema,
  SharedSession,
  SharedSessionSchema,
} from '../../schemas/misc/session.schema';
import { Alert, AlertSchema } from '../../schemas/core/alert.schema';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';

// Services
import { UsageService } from './services/usage.service';
import { RealtimeUpdateService } from './services/realtime-update.service';
import { SessionReplayService } from './services/session-replay.service';
import { InAppRecordingService } from './services/in-app-recording.service';
import { ComprehensiveTrackingService } from './services/comprehensive-tracking.service';
import { PerformanceMonitoringService } from './services/performance-monitoring.service';
import { CostOptimizationEngineService } from './services/cost-optimization-engine.service';
import { SchedulerService } from '../../common/services/scheduler.service';

// Controller
import { UsageController } from './usage.controller';

@Module({
  imports: [
    // MongoDB schemas
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: Session.name, schema: SessionSchema },
      { name: SharedSession.name, schema: SharedSessionSchema },
      { name: Alert.name, schema: AlertSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: User.name, schema: UserSchema },
    ]),

    // Event emitter for performance monitoring
    EventEmitterModule.forRoot(),

    // Schedule module for cron jobs (performance monitoring)
    ScheduleModule.forRoot(),

    // User module for accessing user preferences
    UserModule,

    // BedrockModule for BedrockService (usage analytics / AI)
    BedrockModule,

    // IntegrationModule for IntegrationService
    IntegrationModule,

    // BudgetModule for BudgetService (realtime updates)
    BudgetModule,

    // CommonModule for CacheService (scheduler cleanup)
    CommonModule,

    // AuthModule for JwtAuthGuard and OptionalJwtAuthGuard
    AuthModule,
  ],
  controllers: [UsageController],
  providers: [
    UsageService,
    RealtimeUpdateService,
    SessionReplayService,
    InAppRecordingService,
    ComprehensiveTrackingService,
    PerformanceMonitoringService,
    CostOptimizationEngineService,
    SchedulerService,
  ],
  exports: [
    UsageService,
    RealtimeUpdateService,
    SessionReplayService,
    InAppRecordingService,
    ComprehensiveTrackingService,
    PerformanceMonitoringService,
    CostOptimizationEngineService,
    SchedulerService,
  ],
})
export class UsageModule {}
