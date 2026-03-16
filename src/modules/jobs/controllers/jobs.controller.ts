import { Controller, Get, Post, UseGuards, Logger } from '@nestjs/common';
import { JobsService } from '../services/jobs.service';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

@Controller('api/admin/jobs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(private readonly jobsService: JobsService) {}

  /**
   * Get job status
   */
  @Get('status')
  async getJobStatus() {
    try {
      const status = await this.jobsService.getJobStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      this.logger.error('Failed to get job status', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to get job status',
      };
    }
  }

  /**
   * Run all jobs once (manual trigger)
   */
  @Post('run-all')
  async runAllJobsOnce() {
    try {
      await this.jobsService.runAllJobsOnce();
      return {
        success: true,
        message: 'All jobs started in background',
      };
    } catch (error) {
      this.logger.error('Failed to run all jobs', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to run all jobs',
      };
    }
  }

  /**
   * Get queue statistics
   */
  @Get('queues/stats')
  async getQueueStats() {
    try {
      const stats = await this.jobsService.getQueueStats();
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      this.logger.error('Failed to get queue stats', error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to get queue stats',
      };
    }
  }

  /**
   * Health check for jobs system
   */
  @Get('health')
  async getHealth() {
    try {
      const status = await this.jobsService.getJobStatus();
      const queues = await this.jobsService.getQueueStats();

      return {
        success: true,
        healthy: true,
        jobs: status,
        queues,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        healthy: false,
        error:
          error instanceof Error ? error.message : 'Jobs health check failed',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
