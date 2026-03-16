import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminAnomalyDetectionService } from '../services/admin-anomaly-detection.service';
import {
  SpendingAnomalyQueryDto,
  ErrorAnomalyQueryDto,
  AlertsQueryDto,
} from '../dto/anomaly-detection-query.dto';

@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAnomalyDetectionController {
  private readonly logger = new Logger(AdminAnomalyDetectionController.name);

  constructor(
    private readonly adminAnomalyDetectionService: AdminAnomalyDetectionService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get current alerts
   * GET /api/admin/alerts
   */
  @Get('alerts')
  async getCurrentAlerts(@Query() query: AlertsQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getCurrentAlerts');

      const alerts = await this.adminAnomalyDetectionService.getCurrentAlerts();

      this.controllerHelper.logRequestSuccess('getCurrentAlerts', startTime, {
        alertCount: alerts.length,
      });

      return {
        success: true,
        data: alerts,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getCurrentAlerts', error, startTime);
    }
  }

  /**
   * Detect spending anomalies
   * GET /api/admin/anomalies/spending
   */
  @Get('anomalies/spending')
  async detectSpendingAnomalies(@Query() query: SpendingAnomalyQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('detectSpendingAnomalies');

      const timeWindow = query.timeWindow || 'day';
      const threshold = query.threshold || 2.0;

      const anomalies =
        await this.adminAnomalyDetectionService.detectSpendingAnomalies(
          timeWindow,
          threshold,
        );

      this.controllerHelper.logRequestSuccess(
        'detectSpendingAnomalies',
        startTime,
        {
          anomalyCount: anomalies.length,
          timeWindow,
          threshold,
        },
      );

      return {
        success: true,
        data: anomalies,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'detectSpendingAnomalies',
        error,
        startTime,
      );
    }
  }

  /**
   * Detect error anomalies
   * GET /api/admin/anomalies/errors
   */
  @Get('anomalies/errors')
  async detectErrorAnomalies(@Query() query: ErrorAnomalyQueryDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('detectErrorAnomalies');

      const timeWindow = query.timeWindow || 'day';
      const threshold = query.threshold || 0.1;

      const anomalies =
        await this.adminAnomalyDetectionService.detectErrorAnomalies(
          timeWindow,
          threshold,
        );

      this.controllerHelper.logRequestSuccess(
        'detectErrorAnomalies',
        startTime,
        {
          anomalyCount: anomalies.length,
          timeWindow,
          threshold,
        },
      );

      return {
        success: true,
        data: anomalies,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'detectErrorAnomalies',
        error,
        startTime,
      );
    }
  }
}
