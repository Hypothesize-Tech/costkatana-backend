import * as cron from 'node-cron';
import { backupService } from './backupService';
import { loggingService } from './logging.service';

interface BackupResult {
  success: boolean;
  localPath?: string;
  s3Key?: string;
  size?: number;
  error?: string;
  timestamp: Date;
}

export class BackupScheduler {
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor() {
    this.initializeScheduler();
  }

  private initializeScheduler(): void {
    const enableBackup = process.env.ENABLE_DB_BACKUP === 'true';
    const intervalHours = parseInt(process.env.BACKUP_INTERVAL_HOURS ?? '12');

    if (!enableBackup) {
      loggingService.info('Database backup scheduler is disabled');
      return;
    }

    // Convert hours to cron expression
    const cronExpression = this.getCronExpression(intervalHours);
    
    loggingService.info(`Initializing backup scheduler with ${intervalHours}h interval (${cronExpression})`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.performScheduledBackup();
    }, {
      timezone: 'UTC'
    });
  }

  private getCronExpression(intervalHours: number): string {
    switch (intervalHours) {
      case 1:
        return '0 * * * *'; // Every hour
      case 6:
        return '0 */6 * * *'; // Every 6 hours
      case 12:
        return '0 */12 * * *'; // Every 12 hours
      case 24:
        return '0 0 * * *'; // Daily at midnight
      default:
        loggingService.warn(`Unsupported backup interval: ${intervalHours} hours. Using 12-hour default.`);
        return '0 */12 * * *';
    }
  }

  /**
   * Start the backup scheduler
   */
  start(): void {
    if (this.cronJob && !this.isRunning) {
      void this.cronJob.start();
      this.isRunning = true;
      void loggingService.info('Backup scheduler started');
    }
  }

  /**
   * Stop the backup scheduler
   */
  stop(): void {
    if (this.cronJob && this.isRunning) {
      void this.cronJob.stop();
      this.isRunning = false;
      void loggingService.info('Backup scheduler stopped');
    }
  }

  /**
   * Perform a scheduled backup
   */
  private async performScheduledBackup(): Promise<void> {
    if (this.isRunning) {
      loggingService.warn('Backup already in progress, skipping scheduled backup');
      return;
    }

    this.isRunning = true;
    
    try {
      void loggingService.info('Starting scheduled database backup...');
      
      const result = await backupService.performBackup();
      
      if (result.success) {
        void loggingService.info('Scheduled backup completed successfully', {
          localPath: result.localPath,
          s3Key: result.s3Key,
          size: result.size,
          timestamp: result.timestamp
        });
        
        // Clean up old backups after successful backup
        void backupService.cleanupOldBackups();
      } else {
        loggingService.error('Scheduled backup failed', {
          error: result.error,
          timestamp: result.timestamp
        });
      }
    } catch (error) {
      loggingService.error('Scheduled backup error', { error });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Perform an immediate backup (manual trigger)
   */
  async performImmediateBackup(): Promise<BackupResult> {
    if (this.isRunning) {
      throw new Error('Backup is already in progress');
    }

    this.isRunning = true;
    
    try {
      void loggingService.info('Starting immediate database backup...');
      
      const result = await backupService.performBackup();
      
      if (result.success) {
        void loggingService.info('Immediate backup completed successfully', {
          localPath: result.localPath,
          s3Key: result.s3Key,
          size: result.size,
          timestamp: result.timestamp
        });
        
        return result;
      } else {
        throw new Error(result.error ?? 'Backup failed');
      }
    } catch (error) {
      loggingService.error('Immediate backup error', { error });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    isScheduled: boolean;
    nextRun?: Date;
  } {
    return {
      isRunning: this.isRunning,
      isScheduled: this.cronJob?.getStatus() === 'scheduled',
      nextRun: undefined // nextDate() is not available in the current node-cron version
    };
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    localBackups: number;
    localSize: number;
    s3Backups: number;
    lastBackup?: Date;
  }> {
    return await backupService.getBackupStats();
  }
}

export const backupScheduler = new BackupScheduler();
