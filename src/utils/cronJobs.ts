import cron from 'node-cron';
import { User } from '../models/User';
import { logger } from './logger';

export function setupCronJobs() {
    // Reset monthly usage on the 1st of each month at midnight
    cron.schedule('0 0 1 * *', async () => {
        try {
            logger.info('Starting monthly usage reset');
            await (User as any).resetAllMonthlyUsage();
            logger.info('Monthly usage reset completed');
        } catch (error) {
            logger.error('Error resetting monthly usage:', error);
        }
    });

    logger.info('Cron jobs scheduled');
} 