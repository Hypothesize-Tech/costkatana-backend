import cron from 'node-cron';
import { loggingService } from '../services/logging.service';
import { GuardrailsService } from '../services/guardrails.service';
import { AICostTrackingService } from '../services/aiCostTracking.service';

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

    // Weekly AI cost monitoring report - runs every Monday at 10 AM
    cron.schedule('0 10 * * 1', async () => {
        loggingService.info('Running weekly AI cost monitoring report', {
            component: 'cronJobs',
            operation: 'aiCostReport',
            step: 'start',
            schedule: '0 10 * * 1 (Mondays at 10 AM)'
        });
        try {
            const summary = AICostTrackingService.getMonthlySummary();
            const drivers = AICostTrackingService.getTopCostDrivers(10);
            const serviceSummary = AICostTrackingService.getServiceSummary();

            // Alert if costs exceed threshold ($500/month)
            if (summary.totalCost > 500) {
                loggingService.warn('🚨 HIGH AI COSTS DETECTED!', {
                    totalCost: summary.totalCost,
                    threshold: 500,
                    topDrivers: drivers.slice(0, 5)
                });
            }

            // Log weekly summary
            loggingService.info('📊 Weekly AI Cost Report', {
                summary,
                topDrivers: drivers.slice(0, 5),
                serviceBreakdown: serviceSummary
            });

            loggingService.info('Weekly AI cost monitoring report completed', {
                component: 'cronJobs',
                operation: 'aiCostReport',
                step: 'complete',
                totalCost: summary.totalCost,
                totalCalls: summary.totalCalls
            });
        } catch (error) {
            loggingService.error('Weekly AI cost monitoring report failed', {
                component: 'cronJobs',
                operation: 'aiCostReport',
                step: 'error',
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