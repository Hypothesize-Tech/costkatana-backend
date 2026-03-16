import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminUserGrowthService } from '../services/admin-user-growth.service';
import {
  UserGrowthQueryDto,
  UserEngagementQueryDto,
  UserSegmentsQueryDto,
} from '../dto/user-growth-query.dto';

@Controller('api/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUserGrowthController {
  private readonly logger = new Logger(AdminUserGrowthController.name);

  constructor(
    private readonly adminUserGrowthService: AdminUserGrowthService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get user growth trends
   * GET /api/admin/analytics/user-growth
   */
  @Get('user-growth')
  async getUserGrowthTrends(@Query() query: UserGrowthQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUserGrowthTrends');

      const period = query.period || 'daily';
      const trends = await this.adminUserGrowthService.getUserGrowthTrends(
        period,
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess(
        'getUserGrowthTrends',
        startTime,
        {
          period,
          trendCount: trends.length,
        },
      );

      return {
        success: true,
        data: trends,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getUserGrowthTrends',
        error,
        startTime,
      );
    }
  }

  /**
   * Get user engagement metrics
   * GET /api/admin/analytics/engagement
   */
  @Get('engagement')
  async getUserEngagementMetrics(@Query() query: UserEngagementQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUserEngagementMetrics');

      const metrics =
        await this.adminUserGrowthService.getUserEngagementMetrics(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getUserEngagementMetrics',
        startTime,
      );

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getUserEngagementMetrics',
        error,
        startTime,
      );
    }
  }

  /**
   * Get user segments
   * GET /api/admin/analytics/user-segments
   */
  @Get('user-segments')
  async getUserSegments(@Query() query: UserSegmentsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUserSegments');

      const segments = await this.adminUserGrowthService.getUserSegments(
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess('getUserSegments', startTime, {
        segmentCount: segments.length,
      });

      return {
        success: true,
        data: segments,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getUserSegments', error, startTime);
    }
  }
}
