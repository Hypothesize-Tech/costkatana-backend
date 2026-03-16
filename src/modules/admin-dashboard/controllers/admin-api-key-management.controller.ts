import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminApiKeyManagementService } from '../services/admin-api-key-management.service';
import {
  ApiKeyStatsQueryDto,
  ApiKeyUsageQueryDto,
  TopApiKeysQueryDto,
  ExpiringApiKeysQueryDto,
  ApiKeysOverBudgetQueryDto,
} from '../dto/api-key-query.dto';

@Controller('api/admin/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminApiKeyManagementController {
  private readonly logger = new Logger(AdminApiKeyManagementController.name);

  constructor(
    private readonly adminApiKeyManagementService: AdminApiKeyManagementService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get API key statistics
   * GET /api/admin/api-keys/stats
   */
  @Get('stats')
  async getApiKeyStats(@Query() query: ApiKeyStatsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getApiKeyStats');

      const stats = await this.adminApiKeyManagementService.getApiKeyStats();

      this.controllerHelper.logRequestSuccess('getApiKeyStats', startTime);

      return {
        success: true,
        data: stats,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getApiKeyStats', error, startTime);
    }
  }

  /**
   * Get API key usage
   * GET /api/admin/api-keys/usage
   */
  @Get('usage')
  async getApiKeyUsage(@Query() query: ApiKeyUsageQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getApiKeyUsage');

      const usage = await this.adminApiKeyManagementService.getApiKeyUsage(
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess('getApiKeyUsage', startTime, {
        keyCount: usage.length,
      });

      return {
        success: true,
        data: usage,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getApiKeyUsage', error, startTime);
    }
  }

  /**
   * Get top API keys
   * GET /api/admin/api-keys/top
   */
  @Get('top')
  async getTopApiKeys(@Query() query: TopApiKeysQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getTopApiKeys');

      const limit = query.limit || 10;
      const topKeys =
        await this.adminApiKeyManagementService.getTopApiKeys(limit);

      this.controllerHelper.logRequestSuccess('getTopApiKeys', startTime, {
        limit,
        keyCount: topKeys.length,
      });

      return {
        success: true,
        data: topKeys,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getTopApiKeys', error, startTime);
    }
  }

  /**
   * Get expiring API keys
   * GET /api/admin/api-keys/expiring
   */
  @Get('expiring')
  async getExpiringApiKeys(@Query() query: ExpiringApiKeysQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getExpiringApiKeys');

      const days = query.days || 30;
      const expiringKeys =
        await this.adminApiKeyManagementService.getExpiringApiKeys(days);

      this.controllerHelper.logRequestSuccess('getExpiringApiKeys', startTime, {
        days,
        keyCount: expiringKeys.length,
      });

      return {
        success: true,
        data: expiringKeys,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getExpiringApiKeys', error, startTime);
    }
  }

  /**
   * Get API keys over budget
   * GET /api/admin/api-keys/over-budget
   */
  @Get('over-budget')
  async getApiKeysOverBudget(@Query() query: ApiKeysOverBudgetQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getApiKeysOverBudget');

      const overBudgetKeys =
        await this.adminApiKeyManagementService.getApiKeysOverBudget();

      this.controllerHelper.logRequestSuccess(
        'getApiKeysOverBudget',
        startTime,
        {
          keyCount: overBudgetKeys.length,
        },
      );

      return {
        success: true,
        data: overBudgetKeys,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getApiKeysOverBudget',
        error,
        startTime,
      );
    }
  }
}
