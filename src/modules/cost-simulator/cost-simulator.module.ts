/**
 * Cost Simulator Module (NestJS)
 *
 * Provides cost simulation and prediction for gateway and budget enforcement.
 * Port from Express costSimulator.service.ts.
 */

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CostSimulatorService } from './cost-simulator.service';
import { BudgetModule } from '../budget/budget.module';
import { UtilsModule } from '../utils/utils.module';
import {
  SimulationAccuracy,
  SimulationAccuracySchema,
} from '../../schemas/analytics/simulation-accuracy.schema';

@Module({
  imports: [
    BudgetModule,
    forwardRef(() => UtilsModule),
    MongooseModule.forFeature([
      { name: SimulationAccuracy.name, schema: SimulationAccuracySchema },
    ]),
  ],
  providers: [CostSimulatorService],
  exports: [CostSimulatorService],
})
export class CostSimulatorModule {}
