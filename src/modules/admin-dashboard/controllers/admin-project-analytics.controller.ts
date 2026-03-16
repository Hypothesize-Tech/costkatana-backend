import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminProjectAnalyticsService } from '../services/admin-project-analytics.service';
import {
  ProjectAnalyticsQueryDto,
  WorkspaceAnalyticsQueryDto,
  ProjectTrendsQueryDto,
} from '../dto/project-analytics-query.dto';

@Controller('api/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminProjectAnalyticsController {
  private readonly logger = new Logger(AdminProjectAnalyticsController.name);

  constructor(
    private readonly adminProjectAnalyticsService: AdminProjectAnalyticsService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get project analytics
   * GET /api/admin/analytics/projects
   */
  @Get('projects')
  async getProjectAnalytics(@Query() query: ProjectAnalyticsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getProjectAnalytics');

      const analytics =
        await this.adminProjectAnalyticsService.getProjectAnalytics({
          startDate: query.startDate,
          endDate: query.endDate,
          workspaceId: query.workspaceId,
          isActive: query.isActive,
        });

      this.controllerHelper.logRequestSuccess(
        'getProjectAnalytics',
        startTime,
        {
          projectCount: analytics.length,
        },
      );

      return {
        success: true,
        data: analytics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getProjectAnalytics',
        error,
        startTime,
      );
    }
  }

  /**
   * Get workspace analytics
   * GET /api/admin/analytics/workspaces
   */
  @Get('workspaces')
  async getWorkspaceAnalytics(@Query() query: WorkspaceAnalyticsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getWorkspaceAnalytics');

      const analytics =
        await this.adminProjectAnalyticsService.getWorkspaceAnalytics({
          startDate: query.startDate,
          endDate: query.endDate,
        });

      this.controllerHelper.logRequestSuccess(
        'getWorkspaceAnalytics',
        startTime,
        {
          workspaceCount: analytics.length,
        },
      );

      return {
        success: true,
        data: analytics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getWorkspaceAnalytics',
        error,
        startTime,
      );
    }
  }

  /**
   * Get project trends
   * GET /api/admin/analytics/projects/:projectId/trends
   */
  @Get('projects/:projectId/trends')
  async getProjectTrends(
    @Param('projectId') projectId: string,
    @Query() query: ProjectTrendsQueryDto,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getProjectTrends');

      if (!projectId) {
        throw new BadRequestException('Project ID is required');
      }

      const period = query.period || 'daily';
      const trends = await this.adminProjectAnalyticsService.getProjectTrends(
        projectId,
        period,
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess('getProjectTrends', startTime, {
        projectId,
        period,
      });

      return {
        success: true,
        data: trends,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getProjectTrends', error, startTime);
    }
  }
}
