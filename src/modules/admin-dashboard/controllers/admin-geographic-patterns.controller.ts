import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminGeographicPatternsService } from '../services/admin-geographic-patterns.service';
import {
  GeographicUsageQueryDto,
  PeakUsageTimesQueryDto,
  UsagePatternsByTimezoneQueryDto,
  RegionalPerformanceQueryDto,
} from '../dto/geographic-query.dto';

@Controller('api/admin/analytics/geographic')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminGeographicPatternsController {
  private readonly logger = new Logger(AdminGeographicPatternsController.name);

  constructor(
    private readonly adminGeographicPatternsService: AdminGeographicPatternsService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get geographic usage patterns
   * GET /api/admin/geographic/usage
   */
  @Get('usage')
  async getGeographicUsage(@Query() query: GeographicUsageQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getGeographicUsage');

      const usage =
        await this.adminGeographicPatternsService.getGeographicUsage(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess('getGeographicUsage', startTime, {
        countryCount: usage.length,
      });

      return {
        success: true,
        data: usage,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getGeographicUsage', error, startTime);
    }
  }

  /**
   * Get peak usage times
   * GET /api/admin/analytics/geographic/peak-times
   */
  @Get('peak-times')
  async getPeakUsageTimes(@Query() query: PeakUsageTimesQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getPeakUsageTimes');

      const peaks = await this.adminGeographicPatternsService.getPeakUsageTimes(
        query.countryCode,
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess('getPeakUsageTimes', startTime, {
        countryCode: query.countryCode,
        peakCount: peaks.length,
      });

      return {
        success: true,
        data: peaks,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getPeakUsageTimes', error, startTime);
    }
  }

  /**
   * Get usage patterns by timezone
   * GET /api/admin/analytics/geographic/patterns
   */
  @Get('patterns')
  async getUsagePatternsByTimezone(
    @Query() query: UsagePatternsByTimezoneQueryDto,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUsagePatternsByTimezone');

      const patterns =
        await this.adminGeographicPatternsService.getUsagePatternsByTimezone(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getUsagePatternsByTimezone',
        startTime,
        {
          timezoneCount: patterns.length,
        },
      );

      return {
        success: true,
        data: patterns,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getUsagePatternsByTimezone',
        error,
        startTime,
      );
    }
  }

  /**
   * Get regional performance metrics
   * GET /api/admin/geographic/performance
   */
  @Get('performance')
  async getRegionalPerformance(@Query() query: RegionalPerformanceQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getRegionalPerformance');

      const performance =
        await this.adminGeographicPatternsService.getRegionalPerformance(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getRegionalPerformance',
        startTime,
        {
          regionCount: performance.length,
        },
      );

      return {
        success: true,
        data: performance,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getRegionalPerformance',
        error,
        startTime,
      );
    }
  }

  /**
   * Get available geographic regions
   * GET /api/admin/geographic/regions
   */
  @Get('regions')
  async getGeographicRegions() {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getGeographicRegions');

      const regions =
        await this.adminGeographicPatternsService.getGeographicRegions();

      this.controllerHelper.logRequestSuccess(
        'getGeographicRegions',
        startTime,
        {
          regionCount: regions.length,
        },
      );

      return {
        success: true,
        data: regions,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getGeographicRegions',
        error,
        startTime,
      );
    }
  }

  /**
   * Get cost distribution by geographic region
   * GET /api/admin/geographic/cost-distribution
   */
  @Get('cost-distribution')
  async getCostDistributionByRegion(@Query() query: GeographicUsageQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getCostDistributionByRegion');

      const costDistribution =
        await this.adminGeographicPatternsService.getCostDistributionByRegion(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getCostDistributionByRegion',
        startTime,
        {
          regionCount: costDistribution.length,
        },
      );

      return {
        success: true,
        data: costDistribution,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getCostDistributionByRegion',
        error,
        startTime,
      );
    }
  }
}
