import cron from 'node-cron';
import { logger } from './logger';
import { IntelligentMonitoringService } from '../services/intelligentMonitoring.service';

export const initializeCronJobs = () => {
    logger.info('Initializing cron jobs...');

    // Daily intelligent monitoring - runs at 9 AM every day
    cron.schedule('0 9 * * *', async () => {
        logger.info('Running daily intelligent monitoring...');
        try {
            await IntelligentMonitoringService.runDailyMonitoring();
            logger.info('Daily intelligent monitoring completed');
        } catch (error) {
            logger.error('Daily intelligent monitoring failed:', error);
        }
    });

    // Weekly digest check - runs at 10 AM on Mondays
    cron.schedule('0 10 * * 1', async () => {
        logger.info('Running weekly digest check...');
        try {
            await IntelligentMonitoringService.runDailyMonitoring(); // This handles weekly digests too
            logger.info('Weekly digest check completed');
        } catch (error) {
            logger.error('Weekly digest check failed:', error);
        }
    });

    // Urgent alerts check - runs every 2 hours during business hours
    cron.schedule('0 */2 8-20 * * *', async () => {
        logger.info('Running urgent alerts check...');
        try {
            // Get users who might need urgent alerts
            const { User } = await import('../models/User');
            const activeUsers = await User.find({
                isActive: true,
                'preferences.emailAlerts': true
            }).select('_id').limit(100); // Process in batches

            const promises = activeUsers.map(user =>
                IntelligentMonitoringService.monitorUserUsage(user._id.toString())
                    .catch(error => logger.error(`Failed urgent check for user ${user._id}:`, error))
            );

            await Promise.all(promises);
            logger.info(`Urgent alerts check completed for ${activeUsers.length} users`);
        } catch (error) {
            logger.error('Urgent alerts check failed:', error);
        }
    });

    // Monthly usage reset - runs at midnight on the 1st of every month
    cron.schedule('0 0 1 * *', async () => {
        logger.info('Running monthly usage reset...');
        try {
            const { User } = await import('../models/User');
            // Reset monthly usage for all users
            await User.updateMany({}, { 
                $set: { 
                    'monthlyUsage.current': 0,
                    'monthlyUsage.lastReset': new Date()
                }
            });
            logger.info('Monthly usage reset completed');
        } catch (error) {
            logger.error('Monthly usage reset failed:', error);
        }
    });

    logger.info('Cron jobs initialized successfully');
}; 