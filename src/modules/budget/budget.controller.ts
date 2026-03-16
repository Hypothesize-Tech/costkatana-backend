/**
 * Budget Controller (NestJS)
 *
 * Production API for budget status.
 * Path: api/budget (per-controller prefix; no global api prefix).
 * Full parity with Express budget.controller and budget.routes.
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BudgetService } from './budget.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { BudgetStatusQueryDto } from './dto/budget-status-query.dto';

@Controller('api/budget')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class BudgetController {
  constructor(
    private readonly budgetService: BudgetService,
    private readonly businessLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Get budget status (optional filter by project name or id)
   * GET api/budget/status?project=
   */
  @Get('status')
  async getBudgetStatus(
    @CurrentUser('id') userId: string,
    @Query() query: BudgetStatusQueryDto,
  ) {
    const startTime = Date.now();
    const projectFilter = query.project ?? undefined;

    const budgetStatus = await this.budgetService.getBudgetStatus(
      userId,
      projectFilter,
    );

    const duration = Date.now() - startTime;

    this.businessLogging.logBusiness({
      event: 'budget_status_retrieved',
      category: 'budget_management',
      value: duration,
      metadata: {
        userId,
        project: projectFilter ?? 'all',
        hasBudgetData: !!budgetStatus,
      },
    });

    return {
      success: true,
      message: 'Budget status retrieved successfully',
      data: budgetStatus,
    };
  }
}
