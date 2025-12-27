import cron from 'node-cron';
import { loggingService } from '../services/logging.service';
import { GuardrailsService } from '../services/guardrails.service';

import { VectorizationJob } from '../jobs/vectorization.job';

export const initializeCronJobs = () => {
    loggingService.info('Initializing cron jobs', {
        component: 'cronJobs',
        operation: 'initializeCronJobs',
        step: 'start'
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
                isActive: true
            }).select('_id usage subscriptionId').populate('subscriptionId');

            for (const user of freeUsers) {
                const usage = user.usage?.currentMonth;
                const subscription = (user as any).subscriptionId;
                if (!subscription || subscription.plan !== 'free') continue;
                const limits = subscription?.limits;
                
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

    // Daily account deletion cleanup at 4 AM
    cron.schedule('0 4 * * *', async () => {
        loggingService.info('Running daily account deletion cleanup', {
            component: 'cronJobs',
            operation: 'accountDeletionCleanup',
            step: 'start',
            schedule: '0 4 * * *'
        });
        try {
            const { accountClosureService } = await import('../services/accountClosure.service');
            const result = await accountClosureService.cleanupExpiredAccounts();
            loggingService.info('Account deletion cleanup completed', {
                component: 'cronJobs',
                operation: 'accountDeletionCleanup',
                step: 'complete',
                schedule: '0 4 * * *',
                deletedCount: result.deletedCount,
                finalizedCount: result.finalizedCount,
            });
        } catch (error) {
            loggingService.error('Account deletion cleanup failed', {
                component: 'cronJobs',
                operation: 'accountDeletionCleanup',
                step: 'error',
                schedule: '0 4 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Weekly warning emails on Sundays at 10 AM
    cron.schedule('0 10 * * 0', async () => {
        loggingService.info('Running weekly account deletion warnings', {
            component: 'cronJobs',
            operation: 'accountDeletionWarnings',
            step: 'start',
            schedule: '0 10 * * 0'
        });
        try {
            const { accountClosureService } = await import('../services/accountClosure.service');
            const sentCount = await accountClosureService.sendDeletionWarnings();
            loggingService.info('Account deletion warnings sent', {
                component: 'cronJobs',
                operation: 'accountDeletionWarnings',
                step: 'complete',
                schedule: '0 10 * * 0',
                sentCount,
            });
        } catch (error) {
            loggingService.error('Account deletion warnings failed', {
                component: 'cronJobs',
                operation: 'accountDeletionWarnings',
                step: 'error',
                schedule: '0 10 * * 0',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Daily Cortex usage reset - runs at midnight every day
    cron.schedule('0 0 * * *', async () => {
        loggingService.info('Running daily Cortex usage reset', {
            component: 'cronJobs',
            operation: 'dailyCortexReset',
            step: 'start',
            schedule: '0 0 * * *'
        });
        try {
            const { SubscriptionService } = await import('../services/subscription.service');
            await SubscriptionService.resetDailyCortexUsage();
            loggingService.info('Daily Cortex usage reset completed', {
                component: 'cronJobs',
                operation: 'dailyCortexReset',
                step: 'complete',
                schedule: '0 0 * * *'
            });
        } catch (error) {
            loggingService.error('Daily Cortex usage reset failed', {
                component: 'cronJobs',
                operation: 'dailyCortexReset',
                step: 'error',
                schedule: '0 0 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Trial expiration check - runs every hour
    cron.schedule('0 * * * *', async () => {
        loggingService.info('Running trial expiration check', {
            component: 'cronJobs',
            operation: 'trialExpirationCheck',
            step: 'start',
            schedule: '0 * * * *'
        });
        try {
            const { SubscriptionService } = await import('../services/subscription.service');
            await SubscriptionService.processTrialExpirations();
            loggingService.info('Trial expiration check completed', {
                component: 'cronJobs',
                operation: 'trialExpirationCheck',
                step: 'complete',
                schedule: '0 * * * *'
            });
        } catch (error) {
            loggingService.error('Trial expiration check failed', {
                component: 'cronJobs',
                operation: 'trialExpirationCheck',
                step: 'error',
                schedule: '0 * * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Scheduled cancellations - runs every hour
    cron.schedule('0 * * * *', async () => {
        loggingService.info('Running scheduled cancellations check', {
            component: 'cronJobs',
            operation: 'scheduledCancellations',
            step: 'start',
            schedule: '0 * * * *'
        });
        try {
            const { SubscriptionService } = await import('../services/subscription.service');
            await SubscriptionService.processCancellations();
            loggingService.info('Scheduled cancellations check completed', {
                component: 'cronJobs',
                operation: 'scheduledCancellations',
                step: 'complete',
                schedule: '0 * * * *'
            });
        } catch (error) {
            loggingService.error('Scheduled cancellations check failed', {
                component: 'cronJobs',
                operation: 'scheduledCancellations',
                step: 'error',
                schedule: '0 * * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Failed payment retries (dunning management) - runs every 6 hours
    cron.schedule('0 */6 * * *', async () => {
        loggingService.info('Running failed payment retries', {
            component: 'cronJobs',
            operation: 'failedPaymentRetries',
            step: 'start',
            schedule: '0 */6 * * *'
        });
        try {
            const { SubscriptionService } = await import('../services/subscription.service');
            await SubscriptionService.processFailedPayments();
            loggingService.info('Failed payment retries completed', {
                component: 'cronJobs',
                operation: 'failedPaymentRetries',
                step: 'complete',
                schedule: '0 */6 * * *'
            });
        } catch (error) {
            loggingService.error('Failed payment retries failed', {
                component: 'cronJobs',
                operation: 'failedPaymentRetries',
                step: 'error',
                schedule: '0 */6 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Usage alerts check - runs every 4 hours
    cron.schedule('0 */4 * * *', async () => {
        loggingService.info('Running usage alerts check', {
            component: 'cronJobs',
            operation: 'usageAlertsCheck',
            step: 'start',
            schedule: '0 */4 * * *'
        });
        try {
            const { Subscription } = await import('../models/Subscription');
            const subscriptions = await Subscription.find({
                status: { $in: ['active', 'trialing'] },
            }).select('userId');

            const { SubscriptionService } = await import('../services/subscription.service');
            for (const subscription of subscriptions) {
                await SubscriptionService.checkUsageAlerts(subscription.userId);
            }

            loggingService.info('Usage alerts check completed', {
                component: 'cronJobs',
                operation: 'usageAlertsCheck',
                step: 'complete',
                schedule: '0 */4 * * *',
                subscriptionsChecked: subscriptions.length
            });
        } catch (error) {
            loggingService.error('Usage alerts check failed', {
                component: 'cronJobs',
                operation: 'usageAlertsCheck',
                step: 'error',
                schedule: '0 */4 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Smart Sampling for Message Selection - Daily at 1 AM (before conversation processing)
    cron.schedule('0 1 * * *', async () => {
        loggingService.info('Running smart sampling for message selection', {
            component: 'cronJobs',
            operation: 'smartSampling',
            step: 'start',
            schedule: '0 1 * * *'
        });
        try {
            await VectorizationJob.performSmartSampling();
            loggingService.info('Smart sampling completed', {
                component: 'cronJobs',
                operation: 'smartSampling',
                step: 'complete',
                schedule: '0 1 * * *'
            });
        } catch (error) {
            loggingService.error('Smart sampling failed', {
                component: 'cronJobs',
                operation: 'smartSampling',
                step: 'error',
                schedule: '0 1 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // UserMemory Vectorization - Every hour
    cron.schedule('0 * * * *', async () => {
        loggingService.info('Running UserMemory vectorization', {
            component: 'cronJobs',
            operation: 'userMemoryVectorization',
            step: 'start',
            schedule: '0 * * * *'
        });
        try {
            await VectorizationJob.processUserMemories();
            loggingService.info('UserMemory vectorization completed', {
                component: 'cronJobs',
                operation: 'userMemoryVectorization',
                step: 'complete',
                schedule: '0 * * * *'
            });
        } catch (error) {
            loggingService.error('UserMemory vectorization failed', {
                component: 'cronJobs',
                operation: 'userMemoryVectorization',
                step: 'error',
                schedule: '0 * * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // ConversationMemory Vectorization - Daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
        loggingService.info('Running ConversationMemory vectorization', {
            component: 'cronJobs',
            operation: 'conversationVectorization',
            step: 'start',
            schedule: '0 2 * * *'
        });
        try {
            await VectorizationJob.processConversations();
            loggingService.info('ConversationMemory vectorization completed', {
                component: 'cronJobs',
                operation: 'conversationVectorization',
                step: 'complete',
                schedule: '0 2 * * *'
            });
        } catch (error) {
            loggingService.error('ConversationMemory vectorization failed', {
                component: 'cronJobs',
                operation: 'conversationVectorization',
                step: 'error',
                schedule: '0 2 * * *',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // High-Value Message Vectorization - Weekly on Sunday at 3 AM
    cron.schedule('0 3 * * 0', async () => {
        loggingService.info('Running high-value message vectorization', {
            component: 'cronJobs',
            operation: 'messageVectorization',
            step: 'start',
            schedule: '0 3 * * 0'
        });
        try {
            await VectorizationJob.processMessages();
            loggingService.info('High-value message vectorization completed', {
                component: 'cronJobs',
                operation: 'messageVectorization',
                step: 'complete',
                schedule: '0 3 * * 0'
            });
        } catch (error) {
            loggingService.error('High-value message vectorization failed', {
                component: 'cronJobs',
                operation: 'messageVectorization',
                step: 'error',
                schedule: '0 3 * * 0',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Vectorization Health Check - Monthly on 1st at 4 AM
    cron.schedule('0 4 1 * *', async () => {
        loggingService.info('Running vectorization health check', {
            component: 'cronJobs',
            operation: 'vectorizationHealthCheck',
            step: 'start',
            schedule: '0 4 1 * *'
        });
        try {
            await VectorizationJob.performHealthCheck();
            loggingService.info('Vectorization health check completed', {
                component: 'cronJobs',
                operation: 'vectorizationHealthCheck',
                step: 'complete',
                schedule: '0 4 1 * *'
            });
        } catch (error) {
            loggingService.error('Vectorization health check failed', {
                component: 'cronJobs',
                operation: 'vectorizationHealthCheck',
                step: 'error',
                schedule: '0 4 1 * *',
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