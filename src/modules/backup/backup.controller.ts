/**
 * Backup Controller (NestJS)
 *
 * API for backup scheduler: status, start, stop, trigger, stats.
 * Path: api/backup (per-controller prefix). Full parity with Express backupRoutes.
 */

import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { BackupSchedulerService } from './backup-scheduler.service';

@Controller('api/backup')
export class BackupController {
  constructor(private readonly backupScheduler: BackupSchedulerService) {}

  /**
   * GET /api/backup/status
   * Get backup scheduler status and statistics
   */
  @Get('status')
  async getStatus() {
    try {
      const schedulerStatus = this.backupScheduler.getStatus();
      const statistics = await this.backupScheduler.getBackupStats();
      return {
        success: true,
        data: {
          scheduler: schedulerStatus,
          statistics,
        },
      };
    } catch (error) {
      throw new InternalServerErrorException({
        success: false,
        error: 'Failed to get backup status',
      });
    }
  }

  /**
   * POST /api/backup/start
   * Start the backup scheduler
   */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  start() {
    try {
      this.backupScheduler.start();
      return {
        success: true,
        message: 'Backup scheduler started',
      };
    } catch (error) {
      throw new InternalServerErrorException({
        success: false,
        error: 'Failed to start backup scheduler',
      });
    }
  }

  /**
   * POST /api/backup/stop
   * Stop the backup scheduler
   */
  @Post('stop')
  @HttpCode(HttpStatus.OK)
  stop() {
    try {
      this.backupScheduler.stop();
      return {
        success: true,
        message: 'Backup scheduler stopped',
      };
    } catch (error) {
      throw new InternalServerErrorException({
        success: false,
        error: 'Failed to stop backup scheduler',
      });
    }
  }

  /**
   * POST /api/backup/trigger
   * Trigger an immediate backup
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async trigger() {
    try {
      const result = await this.backupScheduler.performImmediateBackup();
      return {
        success: true,
        message: 'Immediate backup completed',
        data: result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to trigger backup';
      throw new InternalServerErrorException({
        success: false,
        error: message,
      });
    }
  }

  /**
   * GET /api/backup/stats
   * Get backup statistics
   */
  @Get('stats')
  async getStats() {
    try {
      const stats = await this.backupScheduler.getBackupStats();
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      throw new InternalServerErrorException({
        success: false,
        error: 'Failed to get backup statistics',
      });
    }
  }
}
