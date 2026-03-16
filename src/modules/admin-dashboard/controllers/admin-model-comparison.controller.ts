import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminModelComparisonService } from '../services/admin-model-comparison.service';
import {
  ModelComparisonQueryDto,
  ServiceComparisonQueryDto,
} from '../dto/model-comparison-query.dto';

@Controller('api/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminModelComparisonController {
  private readonly logger = new Logger(AdminModelComparisonController.name);

  constructor(
    private readonly adminModelComparisonService: AdminModelComparisonService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get model comparison
   * GET /api/admin/analytics/model-comparison
   */
  @Get('model-comparison')
  async getModelComparison(@Query() query: ModelComparisonQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getModelComparison');

      const comparison =
        await this.adminModelComparisonService.getModelComparison({
          startDate: query.startDate,
          endDate: query.endDate,
          service: query.service,
          userId: query.userId,
        });

      this.controllerHelper.logRequestSuccess('getModelComparison', startTime, {
        modelCount: comparison.length,
      });

      return {
        success: true,
        data: comparison,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getModelComparison', error, startTime);
    }
  }

  /**
   * Get service comparison
   * GET /api/admin/analytics/service-comparison
   */
  @Get('service-comparison')
  async getServiceComparison(@Query() query: ServiceComparisonQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getServiceComparison');

      const comparison =
        await this.adminModelComparisonService.getServiceComparison({
          startDate: query.startDate,
          endDate: query.endDate,
          userId: query.userId,
        });

      this.controllerHelper.logRequestSuccess(
        'getServiceComparison',
        startTime,
        {
          serviceCount: comparison.length,
        },
      );

      return {
        success: true,
        data: comparison,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getServiceComparison',
        error,
        startTime,
      );
    }
  }
}
