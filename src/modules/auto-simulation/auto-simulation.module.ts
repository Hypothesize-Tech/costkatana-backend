/**
 * Auto-Simulation Module
 *
 * NestJS module for all auto-simulation functionality including
 * settings management, queue processing, and optimization approval.
 */

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Internal modules - schemas live under src/schemas
import { SchemasModule } from '../../schemas/schemas.module';
import { ExperimentationModule } from '../experimentation/experimentation.module';
import { SimulationTrackingModule } from '../simulation-tracking/simulation-tracking.module';
import { AuthModule } from '../auth/auth.module';

// Schemas
import {
  AutoSimulationSettings,
  AutoSimulationSettingsSchema,
} from '../../schemas/analytics/auto-simulation-settings.schema';
import {
  AutoSimulationQueue,
  AutoSimulationQueueSchema,
} from '../../schemas/analytics/auto-simulation-queue.schema';

// Controllers
import { AutoSimulationController } from './auto-simulation.controller';

// Services
import { AutoSimulationService } from './auto-simulation.service';

// Providers (add additional injectable providers here if needed in the future)
const autoSimulationProviders = [AutoSimulationService];

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: AutoSimulationSettings.name,
        schema: AutoSimulationSettingsSchema,
      },
      { name: AutoSimulationQueue.name, schema: AutoSimulationQueueSchema },
    ]),
    SchemasModule,
    forwardRef(() => ExperimentationModule),
    SimulationTrackingModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [AutoSimulationController],
  providers: [...autoSimulationProviders],
  exports: [...autoSimulationProviders],
})
export class AutoSimulationModule {}
