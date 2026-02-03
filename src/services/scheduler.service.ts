import * as cron from 'node-cron';
import { loggingService } from './logging.service';
import { costOptimizationEngine } from './cost-optimization-engine.service';
import { performanceMonitoringService } from './performance-monitoring.service';

/**
 * Scheduler service for managing automated tasks
 */
export class SchedulerService {
    private static instance: SchedulerService;
    private cronJobs: Map<string, cron.ScheduledTask> = new Map();
    private isRunning: boolean = false;

    private constructor() {}

    public static getInstance(): SchedulerService {
        if (!SchedulerService.instance) {
            SchedulerService.instance = new SchedulerService();
        }
        return SchedulerService.instance;
    }

    /**
     * Start all scheduled tasks
     */
    public start(): void {
        if (this.isRunning) {
            loggingService.warn('Scheduler service is already running');
            return;
        }

        try {
            this.scheduleOptimizationMonitoring();
            this.schedulePerformanceMonitoring();
            this.scheduleCleanupTasks();
            
            this.isRunning = true;
            loggingService.info('Scheduler service started successfully');
        } catch (error) {
            loggingService.error('Failed to start scheduler service', error as Error);
            throw error;
        }
    }

    /**
     * Stop all scheduled tasks
     */
    public stop(): void {
        try {
            this.cronJobs.forEach((job, name) => {
                job.stop();
                loggingService.debug(`Stopped cron job: ${name}`);
            });
            
            this.cronJobs.clear();
            this.isRunning = false;
            loggingService.info('Scheduler service stopped');
        } catch (error) {
            loggingService.error('Error stopping scheduler service', error as Error);
        }
    }

    /**
     * Schedule optimization opportunity monitoring
     * Runs every 6 hours to check for new optimization opportunities
     */
    private scheduleOptimizationMonitoring(): void {
        const task = cron.schedule('0 */6 * * *', async () => {
            try {
                loggingService.info('Running scheduled optimization monitoring');
                await costOptimizationEngine.monitorOptimizationOpportunities();
                loggingService.info('Optimization monitoring completed successfully');
        } catch (error) {
            loggingService.error('Error in scheduled optimization monitoring', error as Error);
            }
        }, {
            timezone: 'UTC'
        });

        this.cronJobs.set('optimization_monitoring', task);
        task.start();
        loggingService.info('Scheduled optimization monitoring (every 6 hours)');
    }

    /**
     * Schedule performance monitoring
     * Runs every minute for real-time performance tracking
     */
    private schedulePerformanceMonitoring(): void {
        const task = cron.schedule('* * * * *', async () => {
            try {
                // This is handled by the PerformanceMonitoringService's own intervals
                // We just ensure the service is running
                if (!performanceMonitoringService.isMonitoring()) {
                    await performanceMonitoringService.startRealTimeMonitoring();
                }
        } catch (error) {
            loggingService.error('Error checking performance monitoring service', error as Error);
            }
        }, {
            timezone: 'UTC'
        });

        this.cronJobs.set('performance_monitoring_check', task);
        task.start();
        loggingService.info('Scheduled performance monitoring check (every minute)');
    }

    /**
     * Schedule cleanup tasks
     * Runs daily at 2 AM UTC to clean up old data
     */
    private scheduleCleanupTasks(): void {
        const task = cron.schedule('0 2 * * *', async () => {
            try {
                loggingService.info('Running scheduled cleanup tasks');
                await this.runCleanupTasks();
                loggingService.info('Cleanup tasks completed successfully');
        } catch (error) {
            loggingService.error('Error in scheduled cleanup tasks', error as Error);
            }
        }, {
            timezone: 'UTC'
        });

        this.cronJobs.set('cleanup_tasks', task);
        task.start();
        loggingService.info('Scheduled cleanup tasks (daily at 2 AM UTC)');
    }

    /**
     * Run data cleanup tasks
     */
    private async runCleanupTasks(): Promise<void> {
        try {
            const { Usage } = await import('../models/Usage');
            const { Alert } = await import('../models/Alert');
            
            // Clean up old resolved alerts (older than 30 days)
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const deletedAlerts = await Alert.deleteMany({
                isResolved: true,
                createdAt: { $lt: thirtyDaysAgo }
            });
            
            loggingService.info('Cleaned up old resolved alerts', {
                deletedCount: deletedAlerts.deletedCount
            });

            // Clean up very old usage data without comprehensive tracking (older than 90 days)
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const deletedUsage = await Usage.deleteMany({
                createdAt: { $lt: ninetyDaysAgo },
                requestTracking: { $exists: false } // Only delete old usage without comprehensive data
            });
            
            loggingService.info('Cleaned up old usage data', {
                deletedCount: deletedUsage.deletedCount
            });

            // Clean up Redis cache (performance metrics older than 7 days)
            await this.cleanupRedisCache();

        } catch (error) {
            loggingService.error('Error in cleanup tasks', error as Error);
            throw error;
        }
    }

    /**
     * Clean up old Redis cache data
     */
    private async cleanupRedisCache(): Promise<void> {
        try {
            const { redisService } = await import('./redis.service');
            
            // Get all performance metrics keys
            const keys = await redisService.client.keys('performance_metrics:*');
            const historicalKeys = await redisService.client.keys('performance_historical:*');
            
            let deletedCount = 0;
            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            
            // Check each key's timestamp and delete if older than 7 days
            for (const key of [...keys, ...historicalKeys]) {
                const data = await redisService.client.get(key);
                if (data) {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.timestamp && parsed.timestamp < sevenDaysAgo) {
                            await redisService.client.del(key);
                            deletedCount++;
                        }
                    } catch (parseError) {
                        // If we can't parse the data, it might be corrupted, delete it
                        await redisService.client.del(key);
                        deletedCount++;
                    }
                }
            }
            
            loggingService.info('Cleaned up Redis cache', {
                deletedKeys: deletedCount,
                totalKeysChecked: keys.length + historicalKeys.length
            });
        } catch (error) {
            loggingService.error('Error cleaning up Redis cache', error as Error);
            // Don't throw - Redis cleanup is not critical
        }
    }

    /**
     * Add a custom scheduled task
     */
    public addCustomTask(name: string, cronExpression: string, task: () => Promise<void>): void {
        if (this.cronJobs.has(name)) {
            loggingService.warn(`Cron job '${name}' already exists, stopping the existing one`);
            this.cronJobs.get(name)?.stop();
        }

        const cronTask = cron.schedule(cronExpression, async () => {
            try {
                loggingService.info(`Running custom task: ${name}`);
                await task();
                loggingService.info(`Custom task completed: ${name}`);
            } catch (error) {
                loggingService.error(`Error in custom task '${name}'`, error as Error);
            }
        }, {
            timezone: 'UTC'
        });

        this.cronJobs.set(name, cronTask);
        cronTask.start();
        loggingService.info(`Added custom scheduled task: ${name} (${cronExpression})`);
    }

    /**
     * Remove a custom scheduled task
     */
    public removeCustomTask(name: string): boolean {
        const task = this.cronJobs.get(name);
        if (task) {
            task.stop();
            this.cronJobs.delete(name);
            loggingService.info(`Removed custom scheduled task: ${name}`);
            return true;
        }
        return false;
    }

    /**
     * Get status of all scheduled tasks
     */
    public getStatus(): { [key: string]: any } {
        const status: { [key: string]: any } = {
            isRunning: this.isRunning,
            totalJobs: this.cronJobs.size,
            jobs: {}
        };

        this.cronJobs.forEach((task, name) => {
            status.jobs[name] = {
                running: true // task.running property is not available in node-cron
            };
        });

        return status;
    }
}

// Export singleton instance
export const schedulerService = SchedulerService.getInstance();