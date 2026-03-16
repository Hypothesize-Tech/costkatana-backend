/**
 * Backup Scheduler Service (NestJS)
 *
 * Manages scheduled MongoDB backups via node-cron. Start/stop/trigger and
 * status/stats API. Full parity with Express backupScheduler.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { LoggerService } from '../../common/logger/logger.service';
import { BackupService, BackupResult } from './backup.service';

export interface BackupSchedulerStatus {
  isRunning: boolean;
  isScheduled: boolean;
  nextRun?: Date;
}

@Injectable()
export class BackupSchedulerService implements OnModuleInit {
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(
    private readonly backupService: BackupService,
    private readonly logger: LoggerService,
  ) {
    this.initializeScheduler();
  }

  onModuleInit(): void {
    const enableBackup = process.env.ENABLE_DB_BACKUP === 'true';
    if (enableBackup && this.cronJob) {
      this.start();
    }
  }

  private initializeScheduler(): void {
    const enableBackup = process.env.ENABLE_DB_BACKUP === 'true';
    const intervalHours = parseInt(
      process.env.BACKUP_INTERVAL_HOURS ?? '12',
      10,
    );

    if (!enableBackup) {
      this.logger.log('Database backup scheduler is disabled');
      return;
    }

    const cronExpression = this.getCronExpression(intervalHours);
    this.logger.log(
      `Initializing backup scheduler with ${intervalHours}h interval (${cronExpression})`,
    );

    this.cronJob = cron.schedule(
      cronExpression,
      async () => {
        await this.performScheduledBackup();
      },
      { timezone: 'UTC' },
    );
  }

  private getCronExpression(intervalHours: number): string {
    switch (intervalHours) {
      case 1:
        return '0 * * * *';
      case 6:
        return '0 */6 * * *';
      case 12:
        return '0 */12 * * *';
      case 24:
        return '0 0 * * *';
      default:
        this.logger.warn(
          `Unsupported backup interval: ${intervalHours} hours. Using 12-hour default.`,
        );
        return '0 */12 * * *';
    }
  }

  start(): void {
    if (this.cronJob && !this.isRunning) {
      this.cronJob.start();
      this.isRunning = true;
      this.logger.log('Backup scheduler started');
    }
  }

  stop(): void {
    if (this.cronJob && this.isRunning) {
      this.cronJob.stop();
      this.isRunning = false;
      this.logger.log('Backup scheduler stopped');
    }
  }

  private async performScheduledBackup(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Backup already in progress, skipping scheduled backup');
      return;
    }

    this.isRunning = true;

    try {
      this.logger.log('Starting scheduled database backup...');

      const result = await this.backupService.performBackup();

      if (result.success) {
        this.logger.log('Scheduled backup completed successfully', {
          localPath: result.localPath,
          s3Key: result.s3Key,
          size: result.size,
          timestamp: result.timestamp,
        });
        await this.backupService.cleanupOldBackups();
      } else {
        this.logger.error('Scheduled backup failed', {
          error: result.error,
          timestamp: result.timestamp,
        });
      }
    } catch (error) {
      this.logger.error('Scheduled backup error', { error });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Perform an immediate backup (manual trigger via API).
   */
  async performImmediateBackup(): Promise<BackupResult> {
    if (this.isRunning) {
      throw new Error('Backup is already in progress');
    }

    this.isRunning = true;

    try {
      this.logger.log('Starting immediate database backup...');

      const result = await this.backupService.performBackup();

      if (result.success) {
        this.logger.log('Immediate backup completed successfully', {
          localPath: result.localPath,
          s3Key: result.s3Key,
          size: result.size,
          timestamp: result.timestamp,
        });
        return result;
      }

      throw new Error(result.error ?? 'Backup failed');
    } catch (error) {
      this.logger.error('Immediate backup error', { error });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  getStatus(): BackupSchedulerStatus {
    const task = this.cronJob as { getStatus?: () => string } | null;
    const isScheduled =
      (typeof task?.getStatus === 'function' &&
        task.getStatus() === 'scheduled') ||
      !!this.cronJob;
    return {
      isRunning: this.isRunning,
      isScheduled,
      nextRun: undefined,
    };
  }

  async getBackupStats(): Promise<{
    localBackups: number;
    localSize: number;
    s3Backups: number;
    lastBackup?: Date;
  }> {
    return this.backupService.getBackupStats();
  }
}
