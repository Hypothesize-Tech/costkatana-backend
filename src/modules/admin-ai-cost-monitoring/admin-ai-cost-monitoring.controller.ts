import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ControllerHelper } from '../../common/services/controller-helper.service';
import { AICostTrackingService } from './ai-cost-tracking.service';
import {
  SummaryRangeQueryDto,
  CleanupBodyDto,
} from './dto/ai-cost-monitoring.dto';

@Controller('api/admin/ai-costs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAiCostMonitoringController {
  constructor(
    private readonly aiCostTrackingService: AICostTrackingService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get monthly AI cost summary
   * GET /admin/ai-cost-monitoring/summary/monthly
   */
  @Get('summary/monthly')
  async getMonthlySummary(@CurrentUser() user: { id: string }) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart('getMonthlySummary', { user });

    try {
      const summary = await this.aiCostTrackingService.getMonthlySummary();
      this.controllerHelper.logRequestSuccess(
        'getMonthlySummary',
        { user },
        startTime,
      );
      return { success: true, data: summary };
    } catch (error) {
      this.controllerHelper.handleError(
        'getMonthlySummary',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Get custom date range summary
   * GET /admin/ai-cost-monitoring/summary/range?startDate=...&endDate=...
   */
  @Get('summary/range')
  async getSummaryRange(
    @CurrentUser() user: { id: string },
    @Query() query: SummaryRangeQueryDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart('getSummaryRange', { user });

    try {
      const { startDate, endDate } = query;
      if (!startDate || !endDate) {
        throw new BadRequestException('startDate and endDate are required');
      }

      const summary = this.aiCostTrackingService.getSummary(
        new Date(startDate),
        new Date(endDate),
      );
      this.controllerHelper.logRequestSuccess(
        'getSummaryRange',
        { user },
        startTime,
      );
      return { success: true, data: summary };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.controllerHelper.handleError(
        'getSummaryRange',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Clear old records
   * POST /admin/ai-cost-monitoring/cleanup
   */
  @Post('cleanup')
  async cleanup(
    @CurrentUser() user: { id: string },
    @Body() body: CleanupBodyDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart('cleanup', { user });

    try {
      const daysToKeep = body.daysToKeep ?? 30;
      const { removed, remaining } =
        await this.aiCostTrackingService.clearOldRecords(daysToKeep);
      this.controllerHelper.logRequestSuccess('cleanup', { user }, startTime, {
        removed,
        remaining,
      });
      return {
        success: true,
        message: `Cleared records older than ${daysToKeep} days`,
        data: { removed, remaining },
      };
    } catch (error) {
      this.controllerHelper.handleError('cleanup', error, { user }, startTime);
    }
  }
}
