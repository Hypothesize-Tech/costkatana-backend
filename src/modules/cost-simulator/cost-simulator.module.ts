/**
 * Cost Simulator Module (NestJS)
 *
 * Provides cost simulation and prediction for gateway and budget enforcement.
 * Port from Express costSimulator.service.ts.
 */

import { Module, forwardRef } from '@nestjs/common';
import { CostSimulatorService } from './cost-simulator.service';
import { BudgetModule } from '../budget/budget.module';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [BudgetModule, forwardRef(() => UtilsModule)],
  providers: [CostSimulatorService],
  exports: [CostSimulatorService],
})
export class CostSimulatorModule {}
