import cron from 'node-cron';
import { loggingService } from '../services/logging.service';
import { IntelligentMonitoringService } from '../services/intelligentMonitoring.service';
import { GuardrailsService } from '../services/guardrails.service';

export const initializeCronJobs = () => {
    loggingService.info('Initializing cron jobs', {
        component: 'cronJobs',
        operation: 'initializeCronJobs',
        step: 'start'
    });

    // Daily intelligent monitoring - runs at 9 AM every day
    cron.schedule('0 9 * * *', async () => {
        loggingService.info('Running daily intelligent monitoring', {
            component: 'cronJobs',
            operation: 'dailyIntelligentMonitoring',
            step: 'start',
            schedule: '0 9 * * *'
        });
        try {
            await IntelligentMonitoringService.runDailyMonitoring();
            loggingService.info('Daily intelligent monitoring completed', {
                component: 'cronJobs',
                operation: 'dailyIntelligentMonitoring',
                step: 'complete',
                schedule: '0 9 * * *'
            });
        } catch (error) {
            loggingService.error('Daily intelligent monitoring failed', {
                component: 'cronJobs',
                operation: 'dailyIntelligentMonitoring',
                step: 'error',
                schedule: '0 9 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Weekly digest check - runs at 10 AM on Mondays
    cron.schedule('0 10 * * 1', async () => {
        loggingService.info('Running weekly digest check', {
            component: 'cronJobs',
            operation: 'weeklyDigestCheck',
            step: 'start',
            schedule: '0 10 * * 1'
        });
        try {
            await IntelligentMonitoringService.runDailyMonitoring(); // This handles weekly digests too
            loggingService.info('Weekly digest check completed', {
                component: 'cronJobs',
                operation: 'weeklyDigestCheck',
                step: 'complete',
                schedule: '0 10 * * 1'
            });
        } catch (error) {
            loggingService.error('Weekly digest check failed', {
                component: 'cronJobs',
                operation: 'weeklyDigestCheck',
                step: 'error',
                schedule: '0 10 * * 1',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Urgent alerts check - runs every 2 hours during business hours
    cron.schedule('0 */2 8-20 * * *', async () => {
        loggingService.info('Running urgent alerts check', {
            component: 'cronJobs',
            operation: 'urgentAlertsCheck',
            step: 'start',
            schedule: '0 */2 8-20 * * *'
        });
        try {
            // Get users who might need urgent alerts
            const { User } = await import('../models/User');
            const activeUsers = await User.find({
                isActive: true,
                'preferences.emailAlerts': true
            }).select('_id').limit(100); // Process in batches

            const promises = activeUsers.map(user =>
                IntelligentMonitoringService.monitorUserUsage(user._id.toString())
                    .catch(error => loggingService.error('Failed urgent check for user', {
                        component: 'cronJobs',
                        operation: 'urgentAlertsCheck',
                        step: 'userCheckError',
                        userId: user._id.toString(),
                        error: error instanceof Error ? error.message : String(error)
                    }))
            );

            await Promise.all(promises);
            loggingService.info('Urgent alerts check completed', {
                component: 'cronJobs',
                operation: 'urgentAlertsCheck',
                step: 'complete',
                schedule: '0 */2 8-20 * * *',
                usersProcessed: activeUsers.length
            });
        } catch (error) {
            loggingService.error('Urgent alerts check failed', {
                component: 'cronJobs',
                operation: 'urgentAlertsCheck',
                step: 'error',
                schedule: '0 */2 8-20 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Monthly usage reset - runs at midnight on the 1st of every month
    cron.schedule('0 0 1 * *', async () => {
        loggingService.info('Running monthly usage reset', {
            component: 'cronJobs',
            operation: 'monthlyUsageReset',
            step: 'start',
            schedule: '0 0 1 * *'
        });
        try {
            const { User } = await import('../models/User');
            // Reset monthly usage for all users
            await User.updateMany({}, { 
                $set: { 
                    'monthlyUsage.current': 0,
                    'monthlyUsage.lastReset': new Date()
                }
            });
            loggingService.info('Monthly usage reset completed', {
                component: 'cronJobs',
                operation: 'monthlyUsageReset',
                step: 'complete',
                schedule: '0 0 1 * *'
            });
        } catch (error) {
            loggingService.error('Monthly usage reset failed', {
                component: 'cronJobs',
                operation: 'monthlyUsageReset',
                step: 'error',
                schedule: '0 0 1 * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Monthly usage reset - runs at midnight on the 1st of each month
    cron.schedule('0 0 1 * *', async () => {
        loggingService.info('Running monthly usage reset via guardrails', {
            component: 'cronJobs',
            operation: 'monthlyUsageResetGuardrails',
            step: 'start',
            schedule: '0 0 1 * *'
        });
        try {
            await GuardrailsService.resetMonthlyUsage();
            loggingService.info('Monthly usage reset via guardrails completed', {
                component: 'cronJobs',
                operation: 'monthlyUsageResetGuardrails',
                step: 'complete',
                schedule: '0 0 1 * *'
            });
        } catch (error) {
            loggingService.error('Monthly usage reset via guardrails failed', {
                component: 'cronJobs',
                operation: 'monthlyUsageResetGuardrails',
                step: 'error',
                schedule: '0 0 1 * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Hourly usage check for free tier throttling - runs every hour
    cron.schedule('0 * * * *', async () => {
        loggingService.info('Running hourly usage check for guardrails', {
            component: 'cronJobs',
            operation: 'hourlyUsageCheck',
            step: 'start',
            schedule: '0 * * * *'
        });
        try {
            // Check users approaching limits
            const { User } = await import('../models/User');
            const freeUsers = await User.find({
                'subscription.plan': 'free',
                isActive: true
            }).select('_id usage subscription');

            for (const user of freeUsers) {
                const usage = user.usage?.currentMonth;
                const limits = user.subscription?.limits;
                
                if (!usage || !limits) continue;

                // Check if approaching limits (80% threshold)
                const tokenPercentage = (usage.totalTokens / limits.tokensPerMonth) * 100;
                const requestPercentage = (usage.apiCalls / limits.apiCalls) * 100;

                if (tokenPercentage >= 80 || requestPercentage >= 80) {
                    loggingService.warn('User approaching limits', {
                        component: 'cronJobs',
                        operation: 'hourlyUsageCheck',
                        step: 'userLimitWarning',
                        userId: user._id.toString(),
                        tokenPercentage: tokenPercentage.toFixed(2),
                        requestPercentage: requestPercentage.toFixed(2),
                        threshold: 80
                    });

                    // The GuardrailsService will handle sending alerts
                    await GuardrailsService.checkRequestGuardrails(
                        user._id.toString(),
                        'token',
                        0
                    );
                }
            }

            loggingService.info('Hourly usage check completed', {
                component: 'cronJobs',
                operation: 'hourlyUsageCheck',
                step: 'complete',
                schedule: '0 * * * *',
                usersProcessed: freeUsers.length
            });
        } catch (error) {
            loggingService.error('Hourly usage check failed', {
                component: 'cronJobs',
                operation: 'hourlyUsageCheck',
                step: 'error',
                schedule: '0 * * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    loggingService.info('Cron jobs initialized successfully', {
        component: 'cronJobs',
        operation: 'initializeCronJobs',
        step: 'complete'
    });
}; 