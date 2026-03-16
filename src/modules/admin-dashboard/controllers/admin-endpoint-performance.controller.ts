import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminEndpointPerformanceService } from '../services/admin-endpoint-performance.service';
import {
  EndpointPerformanceQueryDto,
  EndpointTrendsQueryDto,
  TopEndpointsQueryDto,
  SlowestEndpointsQueryDto,
  ErrorProneEndpointsQueryDto,
} from '../dto/endpoint-performance-query.dto';

@Controller('api/admin/analytics/endpoints')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminEndpointPerformanceController {
  private readonly logger = new Logger(AdminEndpointPerformanceController.name);

  constructor(
    private readonly adminEndpointPerformanceService: AdminEndpointPerformanceService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get endpoint performance metrics
   * GET /api/admin/analytics/endpoints/performance
   */
  @Get('performance')
  async getEndpointPerformance(@Query() query: EndpointPerformanceQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getEndpointPerformance');

      const performance =
        await this.adminEndpointPerformanceService.getEndpointPerformance(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getEndpointPerformance',
        startTime,
        {
          endpointCount: performance.length,
        },
      );

      return {
        success: true,
        data: performance,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getEndpointPerformance',
        error,
        startTime,
      );
    }
  }

  /**
   * Get endpoint trends
   * GET /api/admin/analytics/endpoints/trends
   */
  @Get('trends')
  async getEndpointTrends(@Query() query: EndpointTrendsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getEndpointTrends');

      const trends =
        await this.adminEndpointPerformanceService.getEndpointTrends(
          query.endpoint,
          query.startDate,
          query.endDate,
          query.period,
        );

      this.controllerHelper.logRequestSuccess('getEndpointTrends', startTime, {
        endpoint: query.endpoint,
        period: query.period,
        dataPoints: trends.length,
      });

      return {
        success: true,
        data: trends,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getEndpointTrends', error, startTime);
    }
  }

  /**
   * Get top endpoints
   * GET /api/admin/analytics/endpoints/top
   */
  @Get('top')
  async getTopEndpoints(@Query() query: TopEndpointsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getTopEndpoints');

      const limit = query.limit || 10;
      const metric = query.metric || 'requests';
      const topEndpoints =
        await this.adminEndpointPerformanceService.getTopEndpoints(
          metric,
          limit,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess('getTopEndpoints', startTime, {
        metric,
        limit,
        endpointCount: topEndpoints.length,
      });

      return {
        success: true,
        data: topEndpoints,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getTopEndpoints', error, startTime);
    }
  }

  /**
   * Get slowest endpoints
   * GET /api/admin/analytics/endpoints/slowest
   */
  @Get('slowest')
  async getSlowestEndpoints(@Query() query: SlowestEndpointsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getSlowestEndpoints');

      const limit = query.limit || 10;
      const slowestEndpoints =
        await this.adminEndpointPerformanceService.getSlowestEndpoints(
          limit,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getSlowestEndpoints',
        startTime,
        {
          limit,
          endpointCount: slowestEndpoints.length,
        },
      );

      return {
        success: true,
        data: slowestEndpoints,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getSlowestEndpoints',
        error,
        startTime,
      );
    }
  }

  /**
   * Get error prone endpoints
   * GET /api/admin/analytics/endpoints/errors
   */
  @Get('errors')
  async getErrorProneEndpoints(@Query() query: ErrorProneEndpointsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getErrorProneEndpoints');

      const limit = query.limit || 10;
      const errorEndpoints =
        await this.adminEndpointPerformanceService.getErrorProneEndpoints(
          limit,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getErrorProneEndpoints',
        startTime,
        {
          limit,
          endpointCount: errorEndpoints.length,
        },
      );

      return {
        success: true,
        data: errorEndpoints,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getErrorProneEndpoints',
        error,
        startTime,
      );
    }
  }
}
