import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminIntegrationAnalyticsService } from '../services/admin-integration-analytics.service';
import {
  IntegrationStatsQueryDto,
  IntegrationTrendsQueryDto,
  IntegrationHealthQueryDto,
  TopIntegrationsQueryDto,
  HighErrorIntegrationsQueryDto,
  PerformanceIssuesQueryDto,
} from '../dto/integration-query.dto';

@Controller('api/admin/analytics/integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminIntegrationAnalyticsController {
  private readonly logger = new Logger(
    AdminIntegrationAnalyticsController.name,
  );

  constructor(
    private readonly adminIntegrationAnalyticsService: AdminIntegrationAnalyticsService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get integration statistics
   * GET /api/admin/analytics/integrations
   */
  @Get()
  async getIntegrationStats(@Query() query: IntegrationStatsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getIntegrationStats');

      const stats =
        await this.adminIntegrationAnalyticsService.getIntegrationStats(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getIntegrationStats',
        startTime,
        {
          integrationCount: stats.length,
        },
      );

      return {
        success: true,
        data: stats,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getIntegrationStats',
        error,
        startTime,
      );
    }
  }

  /**
   * Get integration trends
   * GET /api/admin/integrations/trends
   */
  @Get('trends')
  async getIntegrationTrends(@Query() query: IntegrationTrendsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getIntegrationTrends');

      const trends =
        await this.adminIntegrationAnalyticsService.getIntegrationTrends(
          query.service,
          query.startDate,
          query.endDate,
          query.period,
        );

      this.controllerHelper.logRequestSuccess(
        'getIntegrationTrends',
        startTime,
        {
          service: query.service,
          period: query.period,
          dataPoints: trends.length,
        },
      );

      return {
        success: true,
        data: trends,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getIntegrationTrends',
        error,
        startTime,
      );
    }
  }

  /**
   * Get integration health status
   * GET /api/admin/integrations/health
   */
  @Get('health')
  async getIntegrationHealth(@Query() query: IntegrationHealthQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getIntegrationHealth');

      const health =
        await this.adminIntegrationAnalyticsService.getIntegrationHealth();

      this.controllerHelper.logRequestSuccess(
        'getIntegrationHealth',
        startTime,
        {
          integrationCount: health.length,
        },
      );

      return {
        success: true,
        data: health,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getIntegrationHealth',
        error,
        startTime,
      );
    }
  }

  /**
   * Get top integrations
   * GET /api/admin/integrations/top
   */
  @Get('top')
  async getTopIntegrations(@Query() query: TopIntegrationsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getTopIntegrations');

      const limit = query.limit || 10;
      const metric = query.metric || 'requests';
      const topIntegrations =
        await this.adminIntegrationAnalyticsService.getTopIntegrations(
          metric,
          limit,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess('getTopIntegrations', startTime, {
        metric,
        limit,
        integrationCount: topIntegrations.length,
      });

      return {
        success: true,
        data: topIntegrations,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getTopIntegrations', error, startTime);
    }
  }

  /**
   * Get integrations with high error rates
   * GET /api/admin/integrations/errors
   */
  @Get('errors')
  async getIntegrationsWithHighErrors(
    @Query() query: HighErrorIntegrationsQueryDto,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getIntegrationsWithHighErrors');

      const threshold = query.threshold || 10;
      const limit = query.limit || 10;
      const errorIntegrations =
        await this.adminIntegrationAnalyticsService.getIntegrationsWithHighErrors(
          threshold,
          limit,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getIntegrationsWithHighErrors',
        startTime,
        {
          threshold,
          limit,
          integrationCount: errorIntegrations.length,
        },
      );

      return {
        success: true,
        data: errorIntegrations,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getIntegrationsWithHighErrors',
        error,
        startTime,
      );
    }
  }

  /**
   * Get integrations with performance issues
   * GET /api/admin/integrations/performance
   */
  @Get('performance')
  async getIntegrationsWithPerformanceIssues(
    @Query() query: PerformanceIssuesQueryDto,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart(
        'getIntegrationsWithPerformanceIssues',
      );

      const responseTimeThreshold = query.responseTimeThreshold || 5000;
      const limit = query.limit || 10;
      const performanceIssues =
        await this.adminIntegrationAnalyticsService.getIntegrationsWithPerformanceIssues(
          responseTimeThreshold,
          limit,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getIntegrationsWithPerformanceIssues',
        startTime,
        {
          responseTimeThreshold,
          limit,
          integrationCount: performanceIssues.length,
        },
      );

      return {
        success: true,
        data: performanceIssues,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getIntegrationsWithPerformanceIssues',
        error,
        startTime,
      );
    }
  }
}
