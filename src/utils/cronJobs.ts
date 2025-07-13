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

    // Automatically update pricing data every 6 hours
    cron.schedule('0 */6 * * *', async () => {
        try {
            logger.info('🔄 Starting automatic pricing data update via cron job');

            // Use RealtimePricingService for consistent pricing updates
            const { RealtimePricingService } = await import('../services/realtime-pricing.service');
            await RealtimePricingService.updateAllPricing();

            logger.info('✅ Automatic pricing update completed via cron job');

        } catch (error) {
            logger.error('❌ Error in automatic pricing update:', error);
        }
    });

    // Initial pricing data update on startup (after 30 seconds delay)
    setTimeout(async () => {
        try {
            logger.info('🚀 Starting initial pricing data update on startup');

            const { RealtimePricingService } = await import('../services/realtime-pricing.service');

            // Trigger update but don't block startup if it fails
            RealtimePricingService.updateAllPricing().catch(error => {
                logger.error('❌ Initial pricing update failed:', error);
            });

            logger.info('✅ Initial pricing update initiated (running in background)');

        } catch (error) {
            logger.error('❌ Error initiating initial pricing update:', error);
        }
    }, 30000); // 30 seconds delay

    logger.info('🕐 Cron jobs scheduled: monthly usage reset, automatic pricing updates every 6 hours');
} 