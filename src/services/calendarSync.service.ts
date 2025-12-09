import { CalendarAlertSettings } from '../models/CalendarAlertSettings';
import { BudgetAlertCalendarService } from './budgetAlertCalendar.service';
import { GoogleConnection } from '../models/GoogleConnection';
import { GoogleService } from './google.service';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

/**
 * Background service for syncing calendar alerts
 * Runs hourly via cron job
 */
export class CalendarSyncService {
    private static isRunning = false;
    private static lastRunTime: Date | null = null;

    /**
     * Main sync function - to be called by cron job
     */
    static async syncAllCalendars(): Promise<void> {
        if (this.isRunning) {
            loggingService.warn('Calendar sync already running, skipping this execution');
            return;
        }

        try {
            this.isRunning = true;
            const startTime = new Date();
            loggingService.info('Starting calendar sync job');

            // Get all users with enabled calendar alert settings
            const settings = await CalendarAlertSettings.find({ enabled: true });

            let successCount = 0;
            let failureCount = 0;

            // Process each user
            for (const setting of settings) {
                try {
                    await this.syncUserCalendar(setting.userId);
                    successCount++;
                } catch (error: any) {
                    loggingService.error('Failed to sync calendar for user', {
                        userId: setting.userId.toString(),
                        error: error.message
                    });
                    failureCount++;
                }
            }

            const duration = Date.now() - startTime.getTime();
            this.lastRunTime = new Date();

            loggingService.info('Calendar sync job completed', {
                duration: `${duration}ms`,
                totalUsers: settings.length,
                successCount,
                failureCount,
                lastRunTime: this.lastRunTime
            });
        } catch (error: any) {
            loggingService.error('Calendar sync job failed', {
                error: error.message,
                stack: error.stack
            });
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Sync calendar for a single user
     */
    private static async syncUserCalendar(userId: mongoose.Types.ObjectId): Promise<void> {
        try {
            // Monitor budgets and create alerts
            await BudgetAlertCalendarService.monitorAndCreateAlerts(userId);

            // Cleanup old completed alerts (older than 7 days)
            await this.cleanupUserOldEvents(userId);

            // Verify calendar connection health
            const connection = await GoogleConnection.findOne({
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (connection) {
                // Test connection by fetching calendar list
                try {
                    await GoogleService.listCalendarEvents(
                        connection,
                        new Date(),
                        undefined,
                        1
                    );
                    loggingService.debug('Calendar connection verified', { userId: userId.toString() });
                } catch (connError: any) {
                    loggingService.warn('Calendar connection issue detected', {
                        userId: userId.toString(),
                        error: connError.message
                    });
                }
            }

            loggingService.debug('User calendar synced successfully', { userId: userId.toString() });
        } catch (error: any) {
            loggingService.error('Failed to sync user calendar', {
                userId: userId.toString(),
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Cleanup old events for a specific user
     */
    private static async cleanupUserOldEvents(userId: mongoose.Types.ObjectId): Promise<void> {
        try {
            const connection = await GoogleConnection.findOne({
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) return;

            // Get events from the past 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const events = await GoogleService.listCalendarEvents(
                connection,
                thirtyDaysAgo,
                new Date(),
                100
            );

            // Filter budget alert events that are completed and older than 7 days
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const eventsToDelete = events.filter((event: any) => {
                const isBudgetAlert = event.summary?.includes('Budget Alert');
                const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null;
                const isOld = eventEnd && eventEnd < sevenDaysAgo;
                return isBudgetAlert && isOld;
            });

            let deletedCount = 0;
            for (const event of eventsToDelete) {
                try {
                    await GoogleService.deleteCalendarEvent(connection, event.id);
                    deletedCount++;
                } catch (deleteError: any) {
                    loggingService.warn('Failed to delete old calendar event', {
                        userId: userId.toString(),
                        eventId: event.id,
                        error: deleteError.message
                    });
                }
            }

            if (deletedCount > 0) {
                loggingService.info('Cleaned up old budget alert events', {
                    userId: userId.toString(),
                    deletedCount
                });
            }
        } catch (error: any) {
            loggingService.error('Failed to cleanup old events for user', {
                userId: userId.toString(),
                error: error.message
            });
            // Don't throw - cleanup is non-critical
        }
    }

    /**
     * Manual trigger for syncing a specific user's calendar
     */
    static async syncUserCalendarManual(userId: mongoose.Types.ObjectId): Promise<{
        success: boolean;
        message: string;
    }> {
        try {
            const settings = await CalendarAlertSettings.findOne({ userId, enabled: true });

            if (!settings) {
                return {
                    success: false,
                    message: 'Calendar alerts not enabled for this user'
                };
            }

            await this.syncUserCalendar(userId);

            return {
                success: true,
                message: 'Calendar synced successfully'
            };
        } catch (error: any) {
            loggingService.error('Manual calendar sync failed', {
                userId: userId.toString(),
                error: error.message
            });

            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Cleanup old calendar events (runs daily)
     */
    static async cleanupOldEvents(): Promise<void> {
        try {
            loggingService.info('Starting calendar cleanup job');

            const settings = await CalendarAlertSettings.find({ enabled: true });
            let totalDeleted = 0;

            for (const setting of settings) {
                try {
                    const connection = await GoogleConnection.findOne({
                        userId: setting.userId,
                        isActive: true
                    }).select('+accessToken +refreshToken');

                    if (!connection) continue;

                    // Get all past events (up to 60 days back)
                    const sixtyDaysAgo = new Date();
                    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

                    const events = await GoogleService.listCalendarEvents(
                        connection,
                        sixtyDaysAgo,
                        new Date(),
                        250
                    );

                    // Delete budget alerts older than 14 days
                    const fourteenDaysAgo = new Date();
                    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

                    const eventsToDelete = events.filter((event: any) => {
                        const isBudgetAlert = event.summary?.includes('Budget Alert') || 
                                             event.description?.includes('Budget:') ||
                                             event.description?.includes('Threshold Alert:');
                        const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null;
                        const isOld = eventEnd && eventEnd < fourteenDaysAgo;
                        return isBudgetAlert && isOld;
                    });

                    for (const event of eventsToDelete) {
                        try {
                            await GoogleService.deleteCalendarEvent(connection, event.id);
                            totalDeleted++;
                        } catch (deleteError: any) {
                            loggingService.warn('Failed to delete calendar event', {
                                userId: setting.userId.toString(),
                                eventId: event.id,
                                error: deleteError.message
                            });
                        }
                    }

                    loggingService.debug('Cleaned up old events for user', {
                        userId: setting.userId.toString(),
                        eventsDeleted: eventsToDelete.length
                    });
                } catch (error: any) {
                    loggingService.error('Failed to cleanup events for user', {
                        userId: setting.userId.toString(),
                        error: error.message
                    });
                }
            }

            loggingService.info('Calendar cleanup job completed', {
                totalUsers: settings.length,
                totalEventsDeleted: totalDeleted
            });
        } catch (error: any) {
            loggingService.error('Calendar cleanup job failed', {
                error: error.message
            });
        }
    }

    /**
     * Get sync status
     */
    static getSyncStatus(): {
        isRunning: boolean;
        lastRunTime: Date | null;
    } {
        return {
            isRunning: this.isRunning,
            lastRunTime: this.lastRunTime
        };
    }

    /**
     * Schedule cron jobs (call this when server starts)
     */
    static initializeCronJobs(): void {
        try {
            // Using setInterval as a simple scheduler
            // For production, consider using node-cron, bull, or agenda for more robust scheduling

            // Run calendar sync every hour (3600000 ms)
            setInterval(async () => {
                try {
                    await this.syncAllCalendars();
                } catch (error: any) {
                    loggingService.error('Scheduled calendar sync failed', {
                        error: error.message
                    });
                }
            }, 60 * 60 * 1000); // 1 hour

            // Run cleanup daily at 2 AM
            const scheduleCleanup = () => {
                const now = new Date();
                const next2AM = new Date();
                next2AM.setHours(2, 0, 0, 0);

                // If it's already past 2 AM today, schedule for tomorrow
                if (now.getHours() >= 2) {
                    next2AM.setDate(next2AM.getDate() + 1);
                }

                const msUntil2AM = next2AM.getTime() - now.getTime();

                setTimeout(async () => {
                    try {
                        await this.cleanupOldEvents();
                    } catch (error: any) {
                        loggingService.error('Scheduled cleanup failed', {
                            error: error.message
                        });
                    }

                    // Schedule next cleanup (24 hours later)
                    setInterval(async () => {
                        try {
                            await this.cleanupOldEvents();
                        } catch (error: any) {
                            loggingService.error('Scheduled cleanup failed', {
                                error: error.message
                            });
                        }
                    }, 24 * 60 * 60 * 1000); // 24 hours
                }, msUntil2AM);
            };

            scheduleCleanup();

            // Run initial sync after 1 minute
            setTimeout(async () => {
                try {
                    loggingService.info('Running initial calendar sync');
                    await this.syncAllCalendars();
                } catch (error: any) {
                    loggingService.error('Initial calendar sync failed', {
                        error: error.message
                    });
                }
            }, 60 * 1000); // 1 minute

            loggingService.info('Calendar sync cron jobs initialized', {
                syncSchedule: 'Every hour',
                cleanupSchedule: 'Daily at 2 AM',
                initialSyncIn: '1 minute'
            });
        } catch (error: any) {
            loggingService.error('Failed to initialize cron jobs', {
                error: error.message
            });
        }
    }
}

