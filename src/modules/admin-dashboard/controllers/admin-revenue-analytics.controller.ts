import { Controller, Get, Query, UseGuards, Logger, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminRevenueAnalyticsService } from '../services/admin-revenue-analytics.service';
import {
  RevenueMetricsQueryDto,
  SubscriptionMetricsQueryDto,
  ConversionMetricsQueryDto,
  UpcomingRenewalsQueryDto,
} from '../dto/revenue-analytics-query.dto';

@Controller('api/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminRevenueAnalyticsController {
  private readonly logger = new Logger(AdminRevenueAnalyticsController.name);

  constructor(
    private readonly adminRevenueAnalyticsService: AdminRevenueAnalyticsService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get revenue metrics
   * GET /api/admin/analytics/revenue
   */
  @Get('revenue')
  async getRevenueMetrics(
    @Query() query: RevenueMetricsQueryDto,
    @Req() req: any,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getRevenueMetrics', req);

      const metrics = await this.adminRevenueAnalyticsService.getRevenueMetrics(
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess(
        'getRevenueMetrics',
        req,
        startTime,
      );

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getRevenueMetrics',
        error,
        req,
        startTime,
      );
    }
  }

  /**
   * Get subscription metrics
   * GET /api/admin/analytics/subscriptions
   */
  @Get('subscriptions')
  async getSubscriptionMetrics(@Query() query: SubscriptionMetricsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getSubscriptionMetrics');

      const metrics =
        await this.adminRevenueAnalyticsService.getSubscriptionMetrics(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getSubscriptionMetrics',
        startTime,
      );

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getSubscriptionMetrics',
        error,
        startTime,
      );
    }
  }

  /**
   * Get conversion metrics
   * GET /api/admin/analytics/conversions
   */
  @Get('conversions')
  async getConversionMetrics(@Query() query: ConversionMetricsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getConversionMetrics');

      const metrics =
        await this.adminRevenueAnalyticsService.getConversionMetrics(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getConversionMetrics',
        startTime,
      );

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getConversionMetrics',
        error,
        startTime,
      );
    }
  }

  /**
   * Get upcoming renewals
   * GET /api/admin/analytics/renewals
   */
  @Get('renewals')
  async getUpcomingRenewals(@Query() query: UpcomingRenewalsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUpcomingRenewals');

      const days = query.days || 30;
      const renewals =
        await this.adminRevenueAnalyticsService.getUpcomingRenewals(days);

      this.controllerHelper.logRequestSuccess(
        'getUpcomingRenewals',
        startTime,
        {
          days,
          renewalCount: renewals.length,
        },
      );

      return {
        success: true,
        data: renewals,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getUpcomingRenewals',
        error,
        startTime,
      );
    }
  }
}
