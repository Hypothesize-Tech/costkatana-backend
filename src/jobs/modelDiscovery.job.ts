import cron from 'node-cron';
import { ModelDiscoveryService } from '../services/modelDiscovery.service';
import { ModelDiscoveryFallbackService } from '../services/modelDiscoveryFallback.service';
import { loggingService } from '../services/logging.service';

/**
 * Model Discovery Cron Job
 * Runs daily at 2 AM UTC to discover and update AI model pricing
 */
export class ModelDiscoveryJob {
    private static isRunning = false;
    private static lastRun: Date | null = null;
    private static task: any | null = null;

    // All supported providers
    private static readonly PROVIDERS = [
        'openai',
        'anthropic',
        'google-ai',
        'aws-bedrock',
        'cohere',
        'mistral',
        'xai'
    ];

    /**
     * Start the cron job
     */
    static start(): void {
        const schedule = process.env.MODEL_DISCOVERY_CRON_SCHEDULE || '0 2 * * *';
        const enabled = process.env.MODEL_DISCOVERY_ENABLED !== 'false';

        if (!enabled) {
            loggingService.info('Model discovery cron job is disabled');
            return;
        }

        loggingService.info(`Starting model discovery cron job with schedule: ${schedule}`);

        this.task = cron.schedule(schedule, async () => {
            await this.runDiscovery();
        }, {
            timezone: 'UTC'
        });

        loggingService.info('Model discovery cron job started successfully');
    }

    /**
     * Stop the cron job
     */
    static stop(): void {
        if (this.task) {
            this.task.stop();
            loggingService.info('Model discovery cron job stopped');
        }
    }

    /**
     * Manually trigger discovery (for testing or immediate updates)
     */
    static async trigger(): Promise<any> {
        if (this.isRunning) {
            const message = 'Model discovery job is already running';
            loggingService.warn(message);
            return {
                success: false,
                message,
                lastRun: this.lastRun
            };
        }

        const results = await this.runDiscovery();
        return {
            success: true,
            results,
            timestamp: new Date()
        };
    }

    /**
     * Run the discovery process for all providers
     */
    private static async runDiscovery(): Promise<any[]> {
        if (this.isRunning) {
            loggingService.warn('Discovery job already running, skipping');
            return [];
        }

        this.isRunning = true;
        const startTime = Date.now();
        const results: any[] = [];

        loggingService.info('==== Starting daily model discovery job ====');

        try {
            for (const provider of this.PROVIDERS) {
                try {
                    loggingService.info(`Processing provider: ${provider}`);
                    
                    const result = await ModelDiscoveryService.discoverModelsForProvider(provider);
                    results.push({
                        ...result,
                        success: true
                    });

                    // If discovery failed, try fallback
                    if (result.modelsValidated === 0 && result.errors.length > 0) {
                        loggingService.warn(`Discovery failed for ${provider}, attempting fallback`);
                        
                        const fallbackSuccess = await ModelDiscoveryFallbackService.executeFullFallback(
                            provider,
                            result.errors.join('; ')
                        );

                        results[results.length - 1].fallbackExecuted = true;
                        results[results.length - 1].fallbackSuccess = fallbackSuccess;
                    }

                    // Add delay between providers to avoid rate limiting
                    await this.delay(2000);

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.error(`Error discovering models for ${provider}`, {
                        provider,
                        error: errorMessage
                    });

                    results.push({
                        provider,
                        success: false,
                        error: errorMessage,
                        modelsDiscovered: 0,
                        modelsValidated: 0,
                        modelsFailed: 0
                    });

                    // Try fallback on error
                    await ModelDiscoveryFallbackService.executeFullFallback(provider, errorMessage);
                }
            }

            const duration = Date.now() - startTime;
            const totalDiscovered = results.reduce((sum, r) => sum + (r.modelsDiscovered || 0), 0);
            const totalValidated = results.reduce((sum, r) => sum + (r.modelsValidated || 0), 0);
            const totalFailed = results.reduce((sum, r) => sum + (r.modelsFailed || 0), 0);

            loggingService.info('==== Model discovery job completed ====', {
                duration,
                totalDiscovered,
                totalValidated,
                totalFailed,
                results: results.length
            });

            this.lastRun = new Date();

        } catch (error) {
            loggingService.error('Fatal error in model discovery job', {
                error: error instanceof Error ? error.message : String(error)
            });
        } finally {
            this.isRunning = false;
        }

        return results;
    }

    /**
     * Get job status
     */
    static getStatus(): {
        isRunning: boolean;
        lastRun: Date | null;
        nextRun: Date | null;
        schedule: string;
        enabled: boolean;
    } {
        const schedule = process.env.MODEL_DISCOVERY_CRON_SCHEDULE || '0 2 * * *';
        const enabled = process.env.MODEL_DISCOVERY_ENABLED !== 'false';

        // Calculate next run time (approximate)
        let nextRun: Date | null = null;
        if (enabled && this.task) {
            // Simple calculation for daily 2 AM UTC
            const now = new Date();
            const next = new Date(now);
            next.setUTCHours(2, 0, 0, 0);
            if (next <= now) {
                next.setUTCDate(next.getUTCDate() + 1);
            }
            nextRun = next;
        }

        return {
            isRunning: this.isRunning,
            lastRun: this.lastRun,
            nextRun,
            schedule,
            enabled
        };
    }

    /**
     * Utility delay function
     */
    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
