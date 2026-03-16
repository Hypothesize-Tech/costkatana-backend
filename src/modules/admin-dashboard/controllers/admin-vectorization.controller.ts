import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { BackgroundVectorizationService } from '../services/background-vectorization.service';
import { SmartSamplingService } from '../services/smart-sampling.service';
import {
  StartVectorizationJobDto,
  GenerateSmartSampleDto,
  OptimizeSamplingParametersDto,
  SamplingQualityMetricsDto,
  VectorizationHealthDto,
  TimeEstimateDto,
} from '../dto/vectorization-query.dto';

@Controller('api/admin/vectorization')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminVectorizationController {
  private readonly logger = new Logger(AdminVectorizationController.name);

  constructor(
    private readonly backgroundVectorizationService: BackgroundVectorizationService,
    private readonly smartSamplingService: SmartSamplingService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Start a vectorization job
   * POST /api/admin/vectorization/jobs
   */
  @Post('jobs')
  async startVectorizationJob(@Query() query: StartVectorizationJobDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('startVectorizationJob');

      const jobId =
        await this.backgroundVectorizationService.startVectorizationJob(
          query.samplingRate,
          query.vectorizationMethod,
          query.targetDimensions,
        );

      this.controllerHelper.logRequestSuccess(
        'startVectorizationJob',
        startTime,
        {
          jobId,
          samplingRate: query.samplingRate,
          vectorizationMethod: query.vectorizationMethod,
          targetDimensions: query.targetDimensions,
        },
      );

      return {
        success: true,
        data: { jobId },
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'startVectorizationJob',
        error,
        startTime,
      );
    }
  }

  /**
   * Get vectorization job status
   * GET /api/admin/vectorization/jobs/:jobId
   */
  @Get('jobs/:jobId')
  async getVectorizationJobStatus(@Param('jobId') jobId: string) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getVectorizationJobStatus');

      const status =
        await this.backgroundVectorizationService.getVectorizationJobStatus(
          jobId,
        );

      this.controllerHelper.logRequestSuccess(
        'getVectorizationJobStatus',
        startTime,
        {
          jobId,
        },
      );

      return {
        success: true,
        data: status,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getVectorizationJobStatus',
        error,
        startTime,
      );
    }
  }

  /**
   * Get all vectorization jobs
   * GET /api/admin/vectorization/jobs
   */
  @Get('jobs')
  async getVectorizationJobs() {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getVectorizationJobs');

      const jobs =
        await this.backgroundVectorizationService.getVectorizationJobs();

      this.controllerHelper.logRequestSuccess(
        'getVectorizationJobs',
        startTime,
        {
          jobCount: jobs.length,
        },
      );

      return {
        success: true,
        data: jobs,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getVectorizationJobs',
        error,
        startTime,
      );
    }
  }

  /**
   * Cancel a vectorization job
   * DELETE /api/admin/vectorization/jobs/:jobId
   */
  @Delete('jobs/:jobId')
  async cancelVectorizationJob(@Param('jobId') jobId: string) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('cancelVectorizationJob');

      await this.backgroundVectorizationService.cancelVectorizationJob(jobId);

      this.controllerHelper.logRequestSuccess(
        'cancelVectorizationJob',
        startTime,
        {
          jobId,
        },
      );

      return {
        success: true,
        message: 'Vectorization job cancelled successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'cancelVectorizationJob',
        error,
        startTime,
      );
    }
  }

  /**
   * Generate smart sample
   * GET /api/admin/vectorization/sample
   */
  @Get('sample')
  async generateSmartSample(@Query() query: GenerateSmartSampleDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('generateSmartSample');

      const sample = await this.smartSamplingService.generateSmartSample(
        query.sampleSize,
        query.stratificationFields,
        query.startDate,
        query.endDate,
      );

      this.controllerHelper.logRequestSuccess(
        'generateSmartSample',
        startTime,
        {
          sampleSize: query.sampleSize,
          stratificationFields: query.stratificationFields,
        },
      );

      return {
        success: true,
        data: sample,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'generateSmartSample',
        error,
        startTime,
      );
    }
  }

  /**
   * Optimize sampling parameters
   * GET /api/admin/vectorization/optimize
   */
  @Get('optimize')
  async optimizeSamplingParameters(
    @Query() query: OptimizeSamplingParametersDto,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('optimizeSamplingParameters');

      const optimization =
        await this.smartSamplingService.optimizeSamplingParameters(
          query.targetMetrics,
          query.confidenceLevel,
          query.marginOfError,
          query.startDate,
          query.endDate,
        );

      this.controllerHelper.logRequestSuccess(
        'optimizeSamplingParameters',
        startTime,
        {
          targetMetrics: query.targetMetrics,
          confidenceLevel: query.confidenceLevel,
          marginOfError: query.marginOfError,
        },
      );

      return {
        success: true,
        data: optimization,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'optimizeSamplingParameters',
        error,
        startTime,
      );
    }
  }

  /**
   * Get sampling quality metrics
   * GET /api/admin/vectorization/quality
   */
  @Get('quality')
  async getSamplingQualityMetrics(@Query() query: SamplingQualityMetricsDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getSamplingQualityMetrics');

      // Generate sample first
      const sampleData = await this.smartSamplingService.generateSmartSample(
        query.sampleSize,
        query.stratificationFields,
      );

      // Get quality metrics
      const qualityMetrics =
        await this.smartSamplingService.getSamplingQualityMetrics(
          sampleData.sample,
        );

      this.controllerHelper.logRequestSuccess(
        'getSamplingQualityMetrics',
        startTime,
        {
          sampleSize: query.sampleSize,
        },
      );

      return {
        success: true,
        data: qualityMetrics,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getSamplingQualityMetrics',
        error,
        startTime,
      );
    }
  }

  /**
   * Get vectorization health
   * GET /api/admin/vectorization/health
   */
  @Get('health')
  async getVectorizationHealth(@Query() query: VectorizationHealthDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getVectorizationHealth');

      // Get current jobs status
      const jobs =
        await this.backgroundVectorizationService.getVectorizationJobs();

      // Calculate health metrics
      const totalJobs = jobs.length;
      const runningJobs = jobs.filter((job) => job.status === 'running').length;
      const failedJobs = jobs.filter((job) => job.status === 'failed').length;
      const completedJobs = jobs.filter(
        (job) => job.status === 'completed',
      ).length;

      const healthScore =
        totalJobs > 0
          ? (completedJobs * 100 + runningJobs * 50 - failedJobs * 25) /
            totalJobs
          : 100;

      const health = {
        overallHealth:
          healthScore >= 80
            ? 'healthy'
            : healthScore >= 60
              ? 'warning'
              : 'critical',
        healthScore: Math.max(0, Math.min(100, healthScore)),
        metrics: {
          totalJobs,
          runningJobs,
          completedJobs,
          failedJobs,
          successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 100,
        },
        recentJobs: jobs.slice(0, 5), // Last 5 jobs
        lastUpdated: new Date(),
      };

      this.controllerHelper.logRequestSuccess(
        'getVectorizationHealth',
        startTime,
      );

      return {
        success: true,
        data: health,
      };
    } catch (error: any) {
      this.controllerHelper.handleError(
        'getVectorizationHealth',
        error,
        startTime,
      );
    }
  }

  /**
   * Get time estimate for vectorization job
   * GET /api/admin/vectorization/estimate
   */
  @Get('estimate')
  async getTimeEstimate(@Query() query: TimeEstimateDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getTimeEstimate');

      // Estimate based on historical data and parameters
      const baseTimePerRecord = 0.01; // 10ms per record (simplified)
      const setupTime = 2; // 2 seconds setup time
      const estimatedTotalRecords = 100000; // Approximate total records

      const sampleSize = Math.floor(
        estimatedTotalRecords * (query.samplingRate || 0.1),
      );
      const processingTime = sampleSize * baseTimePerRecord;
      const totalEstimatedTime = setupTime + processingTime;

      // Factor in vectorization method complexity
      const methodMultiplier =
        query.vectorizationMethod === 'pca'
          ? 1.0
          : query.vectorizationMethod === 'tsne'
            ? 3.0
            : query.vectorizationMethod === 'umap'
              ? 2.0
              : 1.5;

      const adjustedTime = totalEstimatedTime * methodMultiplier;

      // Factor in target dimensions
      const dimensionMultiplier = Math.max(
        1.0,
        (query.targetDimensions || 128) / 128,
      );
      const finalEstimate = adjustedTime * dimensionMultiplier;

      const estimate = {
        estimatedDuration: finalEstimate,
        estimatedDurationFormatted: this.formatDuration(finalEstimate),
        parameters: {
          samplingRate: query.samplingRate,
          vectorizationMethod: query.vectorizationMethod,
          targetDimensions: query.targetDimensions,
          estimatedSampleSize: sampleSize,
        },
        assumptions: {
          totalRecords: estimatedTotalRecords,
          processingRate: `${(1 / baseTimePerRecord).toFixed(0)} records/second`,
          methodComplexity: methodMultiplier,
          dimensionScaling: dimensionMultiplier,
        },
      };

      this.controllerHelper.logRequestSuccess('getTimeEstimate', startTime);

      return {
        success: true,
        data: estimate,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getTimeEstimate', error, startTime);
    }
  }

  /**
   * Format duration in seconds to human readable format
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(1)} seconds`;
    } else if (seconds < 3600) {
      return `${(seconds / 60).toFixed(1)} minutes`;
    } else {
      return `${(seconds / 3600).toFixed(1)} hours`;
    }
  }

  /**
   * Clean up old jobs (maintenance endpoint)
   * POST /api/admin/vectorization/cleanup
   */
  @Post('cleanup')
  async cleanupOldJobs() {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('cleanupOldJobs');

      await this.backgroundVectorizationService.cleanupOldJobs();

      this.controllerHelper.logRequestSuccess('cleanupOldJobs', startTime);

      return {
        success: true,
        message: 'Old vectorization jobs cleaned up successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError('cleanupOldJobs', error, startTime);
    }
  }
}
