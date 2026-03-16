import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminFeatureAnalyticsService } from '../services/admin-feature-analytics.service';
import {
  FeatureUsageStatsQueryDto,
  FeatureAdoptionRatesQueryDto,
  FeatureCostAnalysisQueryDto,
} from '../dto/feature-analytics-query.dto';

@Controller('api/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminFeatureAnalyticsController {
  private readonly logger = new Logger(AdminFeatureAnalyticsController.name);

  constructor(
    private readonly adminFeatureAnalyticsService: AdminFeatureAnalyticsService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get feature usage stats
   * GET /api/admin/analytics/feature-usage
   */
  @Get('feature-usage')
  async getFeatureUsageStats(@Query() query: FeatureUsageStatsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getFeatureUsageStats');

      const stats =
        await this.adminFeatureAnalyticsService.getFeatureUsageStats({
          startDate: query.startDate,
          endDate: query.endDate,
          userId: query.userId,
        });

      this.controllerHelper.logRequestSuccess(
        'getFeatureUsageStats',
        startTime,
        {
          featureCount: stats.length,
        },
      );

      return {
        success: true,
        data: stats,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getFeatureUsageStats',
        error,
        startTime,
      );
    }
  }

  /**
   * Get feature adoption rates
   * GET /api/admin/analytics/feature-adoption
   */
  @Get('feature-adoption')
  async getFeatureAdoptionRates(@Query() query: FeatureAdoptionRatesQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getFeatureAdoptionRates');

      const adoption =
        await this.adminFeatureAnalyticsService.getFeatureAdoptionRates({
          startDate: query.startDate,
          endDate: query.endDate,
        });

      this.controllerHelper.logRequestSuccess(
        'getFeatureAdoptionRates',
        startTime,
        {
          featureCount: adoption.length,
        },
      );

      return {
        success: true,
        data: adoption,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getFeatureAdoptionRates',
        error,
        startTime,
      );
    }
  }

  /**
   * Get feature cost analysis
   * GET /api/admin/analytics/feature-cost
   */
  @Get('feature-cost')
  async getFeatureCostAnalysis(@Query() query: FeatureCostAnalysisQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getFeatureCostAnalysis');

      const analysis =
        await this.adminFeatureAnalyticsService.getFeatureCostAnalysis({
          startDate: query.startDate,
          endDate: query.endDate,
        });

      this.controllerHelper.logRequestSuccess(
        'getFeatureCostAnalysis',
        startTime,
        {
          featureCount: analysis.length,
        },
      );

      return {
        success: true,
        data: analysis,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getFeatureCostAnalysis',
        error,
        startTime,
      );
    }
  }
}
