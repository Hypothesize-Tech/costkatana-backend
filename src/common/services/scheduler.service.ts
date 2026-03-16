/**
 * Scheduler service for automated tasks: optimization monitoring, cleanup, custom cron jobs.
 * Ported from Express scheduler.service.ts.
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as cron from 'node-cron';
import { CacheService } from '../cache/cache.service';
import { CostOptimizationEngineService } from '../../modules/usage/services/cost-optimization-engine.service';
import { Usage, UsageDocument } from '../../schemas/core/usage.schema';
import { Alert, AlertDocument } from '../../schemas/core/alert.schema';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly cronJobs = new Map<string, cron.ScheduledTask>();
  private isRunning = false;

  constructor(
    private readonly cacheService: CacheService,
    private readonly costOptimizationEngine: CostOptimizationEngineService,
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
    @InjectModel(Alert.name) private readonly alertModel: Model<AlertDocument>,
  ) {}

  onModuleInit(): void {
    void this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.isRunning) {
      this.logger.warn('Scheduler service is already running');
      return;
    }
    try {
      this.scheduleOptimizationMonitoring();
      this.scheduleCleanupTasks();
      this.isRunning = true;
      this.logger.log('Scheduler service started successfully');
    } catch (error) {
      this.logger.error('Failed to start scheduler service', error as Error);
      throw error;
    }
  }

  stop(): void {
    try {
      this.cronJobs.forEach((job, name) => {
        void job.stop();
        this.logger.debug(`Stopped cron job: ${name}`);
      });
      this.cronJobs.clear();
      this.isRunning = false;
      this.logger.log('Scheduler service stopped');
    } catch (error) {
      this.logger.error('Error stopping scheduler service', error as Error);
    }
  }

  private async runScheduledOptimizationMonitoring(): Promise<void> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const userIds = await this.usageModel.distinct('userId', {
      createdAt: { $gte: oneDayAgo },
    });
    const limit = 100;
    const ids = Array.from(userIds)
      .slice(0, limit)
      .map((id) =>
        typeof id === 'string' ? id : (id as { toString(): string }).toString(),
      );
    for (const userId of ids) {
      try {
        await this.costOptimizationEngine.monitorOptimizationOpportunities(
          userId,
          { timeWindowHours: 24 },
        );
      } catch (err) {
        this.logger.warn('Optimization monitoring failed for user', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private scheduleOptimizationMonitoring(): void {
    const task = cron.schedule(
      '0 */6 * * *',
      () => {
        void (async () => {
          try {
            this.logger.log('Running scheduled optimization monitoring');
            await this.runScheduledOptimizationMonitoring();
            this.logger.log('Optimization monitoring completed successfully');
          } catch (error) {
            this.logger.error(
              'Error in scheduled optimization monitoring',
              error as Error,
            );
          }
        })();
      },
      { timezone: 'UTC' },
    );
    this.cronJobs.set('optimization_monitoring', task);
    void task.start();
    this.logger.log('Scheduled optimization monitoring (every 6 hours)');
  }

  private scheduleCleanupTasks(): void {
    const task = cron.schedule(
      '0 2 * * *',
      () => {
        void (async () => {
          try {
            this.logger.log('Running scheduled cleanup tasks');
            await this.runCleanupTasks();
            this.logger.log('Cleanup tasks completed successfully');
          } catch (error) {
            this.logger.error(
              'Error in scheduled cleanup tasks',
              error as Error,
            );
          }
        })();
      },
      { timezone: 'UTC' },
    );
    this.cronJobs.set('cleanup_tasks', task);
    void task.start();
    this.logger.log('Scheduled cleanup tasks (daily at 2 AM UTC)');
  }

  private async runCleanupTasks(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const resultAlerts = await this.alertModel.deleteMany({
      read: true,
      createdAt: { $lt: thirtyDaysAgo },
    });
    this.logger.log('Cleaned up old read alerts', {
      deletedCount: resultAlerts.deletedCount,
    });

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const resultUsage = await this.usageModel.deleteMany({
      createdAt: { $lt: ninetyDaysAgo },
      requestTracking: { $exists: false },
    });
    this.logger.log('Cleaned up old usage data', {
      deletedCount: resultUsage.deletedCount,
    });

    await this.cleanupCache();
  }

  private async cleanupCache(): Promise<void> {
    try {
      const keys = await this.cacheService.keys('performance_metrics:*');
      const historicalKeys = await this.cacheService.keys(
        'performance_historical:*',
      );
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const key of [...keys, ...historicalKeys]) {
        try {
          const data = await this.cacheService.get<{ timestamp?: number }>(key);
          if (data == null) continue;
          const ts =
            typeof data.timestamp === 'number'
              ? data.timestamp
              : (data as { timestamp?: number }).timestamp;
          if (ts != null && ts < sevenDaysAgo) {
            await this.cacheService.del(key);
            deletedCount++;
          }
        } catch {
          await this.cacheService.del(key);
          deletedCount++;
        }
      }

      this.logger.log('Cleaned up cache', {
        deletedKeys: deletedCount,
        totalKeysChecked: keys.length + historicalKeys.length,
      });
    } catch (error) {
      this.logger.error('Error cleaning up cache', error as Error);
    }
  }

  addCustomTask(
    name: string,
    cronExpression: string,
    task: () => Promise<void>,
  ): void {
    const existing = this.cronJobs.get(name);
    if (existing) {
      this.logger.warn(`Cron job '${name}' already exists, stopping it`);
      void existing.stop();
    }
    const cronTask = cron.schedule(
      cronExpression,
      () => {
        void (async () => {
          try {
            this.logger.log(`Running custom task: ${name}`);
            await task();
            this.logger.log(`Custom task completed: ${name}`);
          } catch (error) {
            this.logger.error(`Error in custom task '${name}'`, error as Error);
          }
        })();
      },
      { timezone: 'UTC' },
    );
    this.cronJobs.set(name, cronTask);
    void cronTask.start();
    this.logger.log(`Added custom scheduled task: ${name} (${cronExpression})`);
  }

  removeCustomTask(name: string): boolean {
    const task = this.cronJobs.get(name);
    if (task) {
      void task.stop();
      this.cronJobs.delete(name);
      this.logger.log(`Removed custom scheduled task: ${name}`);
      return true;
    }
    return false;
  }

  getStatus(): {
    isRunning: boolean;
    totalJobs: number;
    jobs: Record<string, unknown>;
  } {
    const jobs: Record<string, unknown> = {};
    this.cronJobs.forEach((_, name) => {
      jobs[name] = { running: true };
    });
    return {
      isRunning: this.isRunning,
      totalJobs: this.cronJobs.size,
      jobs,
    };
  }
}
