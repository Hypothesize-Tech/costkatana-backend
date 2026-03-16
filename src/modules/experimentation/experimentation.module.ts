/**
 * Experimentation Module
 *
 * NestJS module for all experimentation functionality including
 * model comparisons, what-if scenarios, and real-time analysis.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

// Internal modules - from src/modules/experimentation/
import { SchemasModule } from '../../schemas/schemas.module';
import { CortexModule } from '../cortex/cortex.module';
import { UserSessionModule } from '../user-session/user-session.module';
import { UtilsModule } from '../utils/utils.module';
import { AuthModule } from '../auth/auth.module';

// Controllers
import { ExperimentationController } from './experimentation.controller';

// Services
import { ExperimentationService } from './services/experimentation.service';
import { ExperimentAnalyticsService } from './services/experiment-analytics.service';
import { ExperimentConfigurationService } from './services/experiment-configuration.service';
import { ExperimentManagerService } from './services/experiment-manager.service';

// Providers (add additional injectable providers here if needed in the future)
const experimentationProviders = [
  ExperimentationService,
  ExperimentAnalyticsService,
  ExperimentConfigurationService,
  ExperimentManagerService,
];

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: 3600 },
      }),
      inject: [ConfigService],
    }),
    SchemasModule,
    UserSessionModule,
    CortexModule,
    UtilsModule,
    AuthModule,
  ],
  controllers: [ExperimentationController],
  providers: [...experimentationProviders],
  exports: [
    ...experimentationProviders,
    ExperimentAnalyticsService,
    ExperimentConfigurationService,
    ExperimentManagerService,
  ],
})
export class ExperimentationModule {}
