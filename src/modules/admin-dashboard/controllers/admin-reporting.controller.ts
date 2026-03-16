import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  UseGuards,
  Logger,
  Req,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminReportingService } from '../services/admin-reporting.service';
import {
  GenerateUserActivityReportDto,
  GenerateCostAnalysisReportDto,
  GeneratePerformanceReportDto,
  ScheduleReportDto,
  SendReportDto,
  ScheduledReportsQueryDto,
} from '../dto/export-report.dto';

@Controller('api/admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminReportingController {
  private readonly logger = new Logger(AdminReportingController.name);

  constructor(
    private readonly adminReportingService: AdminReportingService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Generate user activity report
   * GET /api/admin/reports/user-activity
   */
  @Get('user-activity')
  async generateUserActivityReport(
    @Query() query: GenerateUserActivityReportDto,
    @Res() res: Response,
    @Req() req: any,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('generateUserActivityReport', req);

      const buffer =
        await this.adminReportingService.generateUserActivityReport(
          query.startDate,
          query.endDate,
        );

      const filename = `user-activity-report-${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', buffer.length);

      this.controllerHelper.logRequestSuccess(
        'generateUserActivityReport',
        req,
        startTime,
      );

      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to generate report' });
      this.controllerHelper.handleError(
        'generateUserActivityReport',
        error,
        req,
        startTime,
      );
    }
  }

  /**
   * Generate cost analysis report
   * GET /api/admin/reports/cost-analysis
   */
  @Get('cost-analysis')
  async generateCostAnalysisReport(
    @Query() query: GenerateCostAnalysisReportDto,
    @Res() res: Response,
    @Req() req: any,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('generateCostAnalysisReport', req);

      const buffer =
        await this.adminReportingService.generateCostAnalysisReport(
          query.startDate,
          query.endDate,
        );

      const filename = `cost-analysis-report-${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', buffer.length);

      this.controllerHelper.logRequestSuccess(
        'generateCostAnalysisReport',
        req,
        startTime,
      );

      res.send(buffer);
    } catch (error: any) {
      this.controllerHelper.handleError(
        'generateCostAnalysisReport',
        error,
        req,
        startTime,
      );
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }

  /**
   * Generate performance report
   * GET /api/admin/reports/performance
   */
  @Get('performance')
  async generatePerformanceReport(
    @Query() query: GeneratePerformanceReportDto,
    @Res() res: Response,
    @Req() req: any,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('generatePerformanceReport', req);

      const buffer = await this.adminReportingService.generatePerformanceReport(
        query.startDate,
        query.endDate,
      );

      const filename = `performance-report-${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', buffer.length);

      this.controllerHelper.logRequestSuccess(
        'generatePerformanceReport',
        req,
        startTime,
      );

      res.send(buffer);
    } catch (error: any) {
      this.controllerHelper.handleError(
        'generatePerformanceReport',
        error,
        req,
        startTime,
      );
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }

  /**
   * Schedule a report
   * POST /api/admin/reports/schedule
   */
  @Post('schedule')
  async scheduleReport(@Body() body: ScheduleReportDto, @Req() req: any) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('scheduleReport', req);

      const reportId = await this.adminReportingService.scheduleReport(
        body.reportType,
        body.frequency,
        body.recipients,
        body.config,
      );

      this.controllerHelper.logRequestSuccess(
        'scheduleReport',
        req,
        startTime,
        {
          reportType: body.reportType,
          frequency: body.frequency,
          recipientsCount: body.recipients.length,
          reportId,
        },
      );

      return {
        success: true,
        data: { reportId },
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'scheduleReport',
        error,
        req,
        startTime,
      );
    }
  }

  /**
   * Send report via email
   * POST /api/admin/reports/send
   */
  @Post('send')
  async sendReport(@Body() body: SendReportDto, @Req() req: any) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('sendReport', req);

      let reportBuffer: Buffer;
      let filename: string;

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];

      switch (body.reportType) {
        case 'user-activity':
          reportBuffer =
            await this.adminReportingService.generateUserActivityReport();
          filename = `user-activity-report-${dateStr}.xlsx`;
          break;
        case 'cost-analysis':
          reportBuffer =
            await this.adminReportingService.generateCostAnalysisReport();
          filename = `cost-analysis-report-${dateStr}.xlsx`;
          break;
        case 'performance':
          reportBuffer =
            await this.adminReportingService.generatePerformanceReport();
          filename = `performance-report-${dateStr}.xlsx`;
          break;
        default:
          throw new Error(`Unknown report type: ${body.reportType}`);
      }

      await this.adminReportingService.sendReportEmail(
        body.reportType,
        body.recipients,
        reportBuffer,
        filename,
      );

      this.controllerHelper.logRequestSuccess('sendReport', req, startTime, {
        reportType: body.reportType,
        recipientsCount: body.recipients.length,
      });

      return {
        success: true,
        message: 'Report sent successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError('sendReport', error, req, startTime);
    }
  }

  /**
   * Get scheduled reports
   * GET /api/admin/reports/scheduled
   */
  @Get('scheduled')
  async getScheduledReports(
    @Query() query: ScheduledReportsQueryDto,
    @Req() req: any,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getScheduledReports', req);

      const reports = await this.adminReportingService.getScheduledReports();

      this.controllerHelper.logRequestSuccess(
        'getScheduledReports',
        req,
        startTime,
        {
          reportCount: reports.length,
        },
      );

      return {
        success: true,
        data: reports,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getScheduledReports',
        error,
        req,
        startTime,
      );
    }
  }

  /**
   * Export report (legacy endpoint for compatibility)
   * POST /api/admin/reports/export
   */
  @Post('export')
  async exportReport(
    @Body() body: { reportType: string; startDate?: string; endDate?: string },
    @Res() res: Response,
    @Req() req: any,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('exportReport', req);

      const startDate = body.startDate ? new Date(body.startDate) : undefined;
      const endDate = body.endDate ? new Date(body.endDate) : undefined;

      let buffer: Buffer;
      let filename: string;
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];

      switch (body.reportType) {
        case 'user-activity':
          buffer = await this.adminReportingService.generateUserActivityReport(
            startDate,
            endDate,
          );
          filename = `user-activity-report-${dateStr}.xlsx`;
          break;
        case 'cost-analysis':
          buffer = await this.adminReportingService.generateCostAnalysisReport(
            startDate,
            endDate,
          );
          filename = `cost-analysis-report-${dateStr}.xlsx`;
          break;
        case 'performance':
          buffer = await this.adminReportingService.generatePerformanceReport(
            startDate,
            endDate,
          );
          filename = `performance-report-${dateStr}.xlsx`;
          break;
        default:
          throw new Error(`Unknown report type: ${body.reportType}`);
      }

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.setHeader('Content-Length', buffer.length);

      this.controllerHelper.logRequestSuccess('exportReport', req, startTime);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to export report' });
      this.controllerHelper.handleError('exportReport', error, req, startTime);
    }
  }

  /**
   * Process scheduled reports (internal endpoint for cron jobs)
   * POST /api/admin/reports/process-scheduled
   */
  @Post('process-scheduled')
  async processScheduledReports(@Req() req: any) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('processScheduledReports', req);

      await this.adminReportingService.processScheduledReports();

      this.controllerHelper.logRequestSuccess(
        'processScheduledReports',
        req,
        startTime,
      );

      return {
        success: true,
        message: 'Scheduled reports processed successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'processScheduledReports',
        error,
        req,
        startTime,
      );
    }
  }
}
