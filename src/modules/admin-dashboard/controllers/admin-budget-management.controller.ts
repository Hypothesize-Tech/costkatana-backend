import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminBudgetManagementService } from '../services/admin-budget-management.service';
import {
  BudgetOverviewQueryDto,
  ProjectBudgetStatusQueryDto,
  BudgetAlertsQueryDto,
  BudgetTrendsQueryDto,
  SendBudgetAlertsQueryDto,
} from '../dto/budget-query.dto';

@Controller('api/admin/budget')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminBudgetManagementController {
  private readonly logger = new Logger(AdminBudgetManagementController.name);

  constructor(
    private readonly adminBudgetManagementService: AdminBudgetManagementService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get budget overview
   * GET /api/admin/budgets/overview
   */
  @Get('overview')
  async getBudgetOverview(@Query() query: BudgetOverviewQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getBudgetOverview');

      const overview =
        await this.adminBudgetManagementService.getBudgetOverview(
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess('getBudgetOverview', startTime);

      return {
        success: true,
        data: overview,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getBudgetOverview', error, startTime);
    }
  }

  /**
   * Get project budget status
   * GET /api/admin/budgets/projects
   */
  @Get('projects')
  async getProjectBudgetStatus(@Query() query: ProjectBudgetStatusQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getProjectBudgetStatus');

      const status =
        await this.adminBudgetManagementService.getProjectBudgetStatus(
          query.projectId,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'getProjectBudgetStatus',
        startTime,
        {
          projectCount: status.length,
        },
      );

      return {
        success: true,
        data: status,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getProjectBudgetStatus',
        error,
        startTime,
      );
    }
  }

  /**
   * Get budget alerts
   * GET /api/admin/budgets/alerts
   */
  @Get('alerts')
  async getBudgetAlerts(@Query() query: BudgetAlertsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getBudgetAlerts');

      const alerts = await this.adminBudgetManagementService.getBudgetAlerts();

      this.controllerHelper.logRequestSuccess('getBudgetAlerts', startTime, {
        alertCount: alerts.length,
      });

      return {
        success: true,
        data: alerts,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getBudgetAlerts', error, startTime);
    }
  }

  /**
   * Get budget trends
   * GET /api/admin/budget/trends
   */
  @Get('trends')
  async getBudgetTrends(@Query() query: BudgetTrendsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getBudgetTrends');

      const trends = await this.adminBudgetManagementService.getBudgetTrends(
        query.entityId,
        query.entityType,
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess('getBudgetTrends', startTime, {
        dataPoints: trends.length,
      });

      return {
        success: true,
        data: trends,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getBudgetTrends', error, startTime);
    }
  }

  /**
   * Send budget alert notifications
   * POST /api/admin/budgets/alerts/send
   */
  @Post('alerts/send')
  async sendBudgetAlertNotifications(@Query() query: SendBudgetAlertsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('sendBudgetAlertNotifications');

      await this.adminBudgetManagementService.sendBudgetAlertNotifications();

      this.controllerHelper.logRequestSuccess(
        'sendBudgetAlertNotifications',
        startTime,
      );

      return {
        success: true,
        message: 'Budget alert notifications sent successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'sendBudgetAlertNotifications',
        error,
        startTime,
      );
    }
  }
}
