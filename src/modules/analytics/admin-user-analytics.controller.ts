import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  Headers,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminUserAnalyticsService } from './admin-user-analytics.service';
import { ControllerHelper } from '../../common/services/controller-helper.service';
import { LoggingService } from '../../common/services/logging.service';
import { ServiceHelper } from '../../common/services/service-helper.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AdminUserAnalyticsQueryDto,
  SpendingTrendsQueryDto,
  ExportUserSpendingQueryDto,
  PaginatedUserSpendingResponseDto,
  UserSpendingResponseDto,
  UserDetailedSpendingResponseDto,
  UsersByServiceResponseDto,
  SpendingTrendsResponseWrapperDto,
  PlatformSummaryResponseWrapperDto,
  ExportUserSpendingResponseDto,
} from './dto/admin-user-analytics.dto';
import type { UserSpendingSummary } from './admin-user-analytics.service';

@Controller('api/admin/user-spending')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUserAnalyticsController {
  constructor(
    private readonly adminUserAnalyticsService: AdminUserAnalyticsService,
    private readonly controllerHelper: ControllerHelper,
    private readonly loggingService: LoggingService,
  ) {}

  private mapToDetailedSpendingDto(
    s: UserSpendingSummary,
    period: { startDate?: Date; endDate?: Date },
  ): UserDetailedSpendingResponseDto {
    return {
      userId: s.userId,
      userEmail: s.userEmail,
      userName: s.userName,
      summary: {
        totalCost: s.totalCost,
        totalTokens: s.totalTokens,
        totalRequests: s.totalRequests,
        averageCostPerRequest: s.averageCostPerRequest,
        firstActivity: s.firstActivity,
        lastActivity: s.lastActivity,
      },
      breakdown: {
        services: s.services.map((x) => ({
          service: x.service,
          totalCost: x.cost,
          totalTokens: x.tokens,
          totalRequests: x.requests,
        })),
        models: s.models.map((x) => ({
          model: x.model,
          totalCost: x.cost,
          totalTokens: x.tokens,
          totalRequests: x.requests,
        })),
        projects: s.projects.map((x) => ({
          projectId: x.projectId,
          projectName: x.projectName,
          totalCost: x.cost,
          totalTokens: x.tokens,
          totalRequests: x.requests,
        })),
        workflows: s.workflows.map((x) => ({
          workflowId: x.workflowId,
          workflowName: x.workflowName,
          totalCost: x.cost,
          totalTokens: x.tokens,
          totalRequests: x.requests,
        })),
        features: s.features.map((x) => ({
          feature: x.feature,
          totalCost: x.cost,
          totalTokens: x.tokens,
          totalRequests: x.requests,
        })),
      },
      period: {
        startDate: period.startDate,
        endDate: period.endDate,
      },
    };
  }

  /**
   * Get all users spending summary
   * GET /api/admin/users/spending
   */
  @Get()
  async getAllUsersSpending(
    @CurrentUser() user: { id: string },
    @Query() query: AdminUserAnalyticsQueryDto,
  ): Promise<PaginatedUserSpendingResponseDto> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getAllUsersSpending', { user });

      const filters = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        service: query.service,
        model: query.model,
        projectId: query.projectId,
        workflowId: query.workflowId,
        userId: query.userId,
        minCost: query.minCost,
        maxCost: query.maxCost,
      };

      const usersSpending =
        await this.adminUserAnalyticsService.getAllUsersSpending(filters);

      // Apply cost filters if specified
      let filteredResults = usersSpending;
      if (filters.minCost !== undefined || filters.maxCost !== undefined) {
        filteredResults = usersSpending.filter((user) => {
          if (
            filters.minCost !== undefined &&
            user.totalCost < filters.minCost
          ) {
            return false;
          }
          if (
            filters.maxCost !== undefined &&
            user.totalCost > filters.maxCost
          ) {
            return false;
          }
          return true;
        });
      }

      this.controllerHelper.logRequestSuccess(
        'getAllUsersSpending',
        { user },
        startTime,
        {
          userCount: filteredResults.length,
        },
      );

      return {
        success: true,
        data: filteredResults,
        meta: {
          total: filteredResults.length,
          filters:
            Object.keys(filters).length > 0
              ? {
                  startDate: filters.startDate?.toISOString?.(),
                  endDate: filters.endDate?.toISOString?.(),
                  service: filters.service,
                  model: filters.model,
                  projectId: filters.projectId,
                  workflowId: filters.workflowId,
                  userId: filters.userId,
                  minCost: filters.minCost,
                  maxCost: filters.maxCost,
                }
              : undefined,
        },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'getAllUsersSpending',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Get users filtered by service
   * GET /api/admin/users/spending/by-service/:service
   */
  @Get('by-service/:service')
  async getUsersByService(
    @CurrentUser() user: { id: string },
    @Param('service') service: string,
    @Query() query: AdminUserAnalyticsQueryDto,
  ): Promise<UsersByServiceResponseDto> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUsersByService', { user });

      if (!service) {
        throw new BadRequestException('Service is required');
      }

      const filters = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
      };

      const usersSpending =
        await this.adminUserAnalyticsService.getUsersByService(
          service,
          filters,
        );

      this.controllerHelper.logRequestSuccess(
        'getUsersByService',
        { user },
        startTime,
        {
          service,
          userCount: usersSpending.length,
        },
      );

      return {
        success: true,
        data: usersSpending,
        meta: {
          service,
          total: usersSpending.length,
        },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'getUsersByService',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Get spending trends
   * GET /api/admin/users/spending/trends
   */
  @Get('trends')
  async getSpendingTrends(
    @CurrentUser() user: { id: string },
    @Query() query: SpendingTrendsQueryDto,
  ): Promise<SpendingTrendsResponseWrapperDto> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getSpendingTrends', { user });

      const timeRange = query.timeRange || 'daily';

      const filters = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        service: query.service,
        model: query.model,
        projectId: query.projectId,
        userId: query.userId,
      };

      const trends = await this.adminUserAnalyticsService.getSpendingTrends(
        timeRange,
        filters,
      );

      this.controllerHelper.logRequestSuccess(
        'getSpendingTrends',
        { user },
        startTime,
        {
          timeRange,
          dataPoints: trends.length,
        },
      );

      return {
        success: true,
        data: trends,
        meta: {
          timeRange,
          total: trends.length,
        },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'getSpendingTrends',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Get platform summary statistics
   * GET /api/admin/users/spending/summary
   */
  @Get('summary')
  async getPlatformSummary(
    @CurrentUser() user: { id: string },
    @Query() query: AdminUserAnalyticsQueryDto,
  ): Promise<PlatformSummaryResponseWrapperDto> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getPlatformSummary', { user });

      const filters = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        service: query.service,
      };

      const summary =
        await this.adminUserAnalyticsService.getPlatformSummary(filters);

      this.controllerHelper.logRequestSuccess(
        'getPlatformSummary',
        { user },
        startTime,
      );

      return {
        success: true,
        data: summary,
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'getPlatformSummary',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Export user spending data
   * GET /api/admin/users/spending/export
   */
  @Get('export')
  async exportUserSpending(
    @CurrentUser() user: { id: string },
    @Res() res: Response,
    @Query() query: ExportUserSpendingQueryDto,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('exportUserSpending', { user });

      const format = query.format || 'json';

      const filters = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        service: query.service,
        model: query.model,
        projectId: query.projectId,
        workflowId: query.workflowId,
        userId: query.userId,
        minCost: query.minCost,
        maxCost: query.maxCost,
      };

      const usersSpending =
        await this.adminUserAnalyticsService.getAllUsersSpending(filters);

      if (format === 'csv') {
        // Set CSV headers
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="user-spending-${Date.now()}.csv"`,
        );

        // Write CSV header
        const header =
          'User Email,User Name,Total Cost,Total Tokens,Total Requests,Avg Cost/Request,First Activity,Last Activity\n';
        res.write(header);

        // Write CSV rows
        for (const user of usersSpending) {
          const row =
            [
              user.userEmail,
              user.userName,
              user.totalCost.toFixed(4),
              user.totalTokens,
              user.totalRequests,
              user.averageCostPerRequest.toFixed(4),
              user.firstActivity.toISOString(),
              user.lastActivity.toISOString(),
            ]
              .map((field) => `"${field}"`)
              .join(',') + '\n';
          res.write(row);
        }

        res.end();
      } else {
        // JSON export
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="user-spending-${Date.now()}.json"`,
        );
        const response: ExportUserSpendingResponseDto = {
          success: true,
          data: usersSpending,
          meta: {
            exportedAt: new Date().toISOString(),
            total: usersSpending.length,
            filters:
              Object.keys(filters).length > 0
                ? {
                    startDate: filters.startDate?.toISOString?.(),
                    endDate: filters.endDate?.toISOString?.(),
                    service: filters.service,
                    model: filters.model,
                    projectId: filters.projectId,
                    workflowId: filters.workflowId,
                    userId: filters.userId,
                    minCost: filters.minCost,
                    maxCost: filters.maxCost,
                  }
                : undefined,
          },
        };
        res.json(response);
      }

      this.controllerHelper.logRequestSuccess(
        'exportUserSpending',
        { user },
        startTime,
        {
          format,
          recordCount: usersSpending.length,
        },
      );
    } catch (error) {
      this.controllerHelper.handleError(
        'exportUserSpending',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Get detailed spending for a specific user
   * GET /api/admin/user-spending/:userId
   * Must be declared after specific paths (trends, summary, export, by-service) to avoid route conflicts.
   */
  @Get(':userId')
  async getUserDetailedSpending(
    @CurrentUser() user: { id: string },
    @Param('userId') userId: string,
    @Query() query: AdminUserAnalyticsQueryDto,
  ): Promise<UserSpendingResponseDto> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUserDetailedSpending', {
        user,
      });

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      ServiceHelper.validateObjectId(userId, 'userId');

      const filters = {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        service: query.service,
        model: query.model,
        projectId: query.projectId,
        workflowId: query.workflowId,
      };

      const userSpending =
        await this.adminUserAnalyticsService.getUserDetailedSpending(
          userId,
          filters,
        );

      if (!userSpending) {
        throw new NotFoundException('User spending data not found');
      }

      const data = this.mapToDetailedSpendingDto(userSpending, filters);

      this.controllerHelper.logRequestSuccess(
        'getUserDetailedSpending',
        { user },
        startTime,
        {
          userId,
        },
      );

      return {
        success: true,
        data,
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'getUserDetailedSpending',
        error,
        { user },
        startTime,
      );
    }
  }
}
