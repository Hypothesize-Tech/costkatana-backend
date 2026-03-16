/**
 * Optimization Module (NestJS)
 *
 * Main module for prompt optimization functionality, integrating Cortex AI capabilities
 * with traditional optimization techniques for comprehensive cost reduction.
 */

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Schemas
import {
  Optimization,
  OptimizationSchema,
} from '../../schemas/core/optimization.schema';
import {
  OptimizationConfig,
  OptimizationConfigSchema,
} from '../../schemas/core/optimization-config.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Activity,
  ActivitySchema,
} from '../../schemas/logging/activity.schema';
import { Alert, AlertSchema } from '../../schemas/core/alert.schema';
import {
  OptimizationTemplate,
  OptimizationTemplateSchema,
} from '../../schemas/misc/optimization-template.schema';

// Services and Controllers
import { OptimizationService } from './optimization.service';
import { OptimizationController } from './optimization.controller';
import { OptimizationTemplateService } from './services/optimization-template.service';

// Dependent modules
import { CortexModule } from '../cortex/cortex.module';
import { UtilsModule } from '../utils/utils.module';
import { CompilerModule } from '../compiler/compiler.module';
import { ProactiveSuggestionsModule } from '../proactive-suggestions/proactive-suggestions.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Optimization.name, schema: OptimizationSchema },
      { name: OptimizationConfig.name, schema: OptimizationConfigSchema },
      { name: User.name, schema: UserSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: Alert.name, schema: AlertSchema },
      { name: OptimizationTemplate.name, schema: OptimizationTemplateSchema },
    ]),
    CortexModule,
    UtilsModule,
    CompilerModule,
    forwardRef(() => ProactiveSuggestionsModule),
    AuthModule,
  ],
  controllers: [OptimizationController],
  providers: [OptimizationService, OptimizationTemplateService],
  exports: [OptimizationService],
})
export class OptimizationModule {}
