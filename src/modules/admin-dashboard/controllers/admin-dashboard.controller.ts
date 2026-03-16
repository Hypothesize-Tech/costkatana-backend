import { Controller, Get, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { BackgroundVectorizationService } from '../services/background-vectorization.service';
import { SmartSamplingService } from '../services/smart-sampling.service';

@Controller('api/admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminDashboardController {
  private readonly logger = new Logger(AdminDashboardController.name);

  constructor(
    private readonly backgroundVectorizationService: BackgroundVectorizationService,
    private readonly smartSamplingService: SmartSamplingService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get vectorization system health and statistics
   * GET /api/admin/dashboard/vectorization
   */
  @Get('vectorization')
  async getVectorizationDashboard() {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getVectorizationDashboard');

      // Get current vectorization jobs
      const jobs =
        await this.backgroundVectorizationService.getVectorizationJobs();

      // Calculate basic stats from jobs
      const totalJobs = jobs.length;
      const runningJobs = jobs.filter(
        (job: any) => job.status === 'running',
      ).length;
      const completedJobs = jobs.filter(
        (job: any) => job.status === 'completed',
      ).length;
      const failedJobs = jobs.filter(
        (job: any) => job.status === 'failed',
      ).length;

      const successRate =
        totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

      // Generate smart sample to get sampling metrics
      const sampleData = await this.smartSamplingService.generateSmartSample(
        100,
        [],
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date(),
      );
      const qualityMetrics =
        await this.smartSamplingService.getSamplingQualityMetrics(
          sampleData.sample,
        );

      // Prepare dashboard data
      const dashboardData = {
        health: {
          overallHealth:
            successRate >= 80
              ? 'healthy'
              : successRate >= 60
                ? 'warning'
                : 'critical',
          totalJobs,
          runningJobs,
          completedJobs,
          failedJobs,
          successRate,
          lastUpdated: new Date(),
        },
        jobs: jobs.slice(0, 5), // Recent jobs
        samplingStats: {
          currentSamplingRate: 0.1, // Default
          recommendedSamplingRate:
            qualityMetrics.recommendedSamplingRate || 0.1,
          samplingQuality: qualityMetrics.quality || 0,
          lastOptimized: new Date(),
        },
        processingStats: {
          averageProcessingTime: 0, // Placeholder
          totalProcessedItems: jobs.reduce(
            (sum: number, job: any) => sum + (job.processedItems || 0),
            0,
          ),
          efficiency: qualityMetrics.efficiency || 0,
        },
      };

      this.controllerHelper.logRequestSuccess(
        'getVectorizationDashboard',
        startTime,
        {
          totalJobs,
          successRate,
        },
      );

      return {
        success: true,
        data: dashboardData,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getVectorizationDashboard',
        error,
        startTime,
      );
    }
  }
}
