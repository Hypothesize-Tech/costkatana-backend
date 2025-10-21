import * as cron from 'node-cron';
import { ingestionService } from './ingestion.service';
import { loggingService } from './logging.service';
import { TelemetryPollerService } from './telemetryPoller.service';

export class IngestionJobService {
    private scheduledJobs: cron.ScheduledTask[] = [];
    private isRunning = false;

    /**
     * Start all scheduled ingestion jobs
     */
    startScheduler(): void {
        if (this.isRunning) {
            loggingService.warn('Ingestion scheduler already running', {
                component: 'IngestionJobService',
                operation: 'startScheduler'
            });
            return;
        }

        const syncInterval = parseInt(process.env.RAG_SYNC_INTERVAL_HOURS || '6');
        const enableIngestion = process.env.ENABLE_RAG_INGESTION !== 'false';

        if (!enableIngestion) {
            loggingService.info('RAG ingestion is disabled', {
                component: 'IngestionJobService',
                operation: 'startScheduler'
            });
            return;
        }

        loggingService.info('Starting ingestion scheduler', {
            component: 'IngestionJobService',
            operation: 'startScheduler',
            syncIntervalHours: syncInterval
        });

        // Schedule conversation sync every X hours
        if (process.env.INGEST_CONVERSATIONS !== 'false') {
            const conversationJob = cron.schedule(`0 */${syncInterval} * * *`, async () => {
                await this.syncConversations();
            });
            this.scheduledJobs.push(conversationJob);
            loggingService.info(`✅ Conversation sync scheduled every ${syncInterval} hours`);
        }

        // Schedule telemetry sync every X hours
        if (process.env.INGEST_TELEMETRY !== 'false') {
            const telemetryJob = cron.schedule(`15 */${syncInterval} * * *`, async () => {
                await this.syncTelemetry();
            });
            this.scheduledJobs.push(telemetryJob);
            loggingService.info(`✅ Telemetry sync scheduled every ${syncInterval} hours`);
        }

        // Schedule knowledge base sync once per day
        const knowledgeBaseJob = cron.schedule('0 2 * * *', async () => {
            await this.syncKnowledgeBase();
        });
        this.scheduledJobs.push(knowledgeBaseJob);
        loggingService.info('✅ Knowledge base sync scheduled daily at 2 AM');

        // Schedule cleanup job daily
        const cleanupJob = cron.schedule('0 3 * * *', async () => {
            await this.cleanupOldDocuments();
        });
        this.scheduledJobs.push(cleanupJob);
        loggingService.info('✅ Cleanup job scheduled daily at 3 AM');

        // Schedule external telemetry polling
        const enablePolling = process.env.ENABLE_TELEMETRY_POLLING !== 'false';
        if (enablePolling) {
            const pollInterval = parseInt(process.env.TELEMETRY_SYNC_INTERVAL_MINUTES || '5');
            const pollingJob = cron.schedule(`*/${pollInterval} * * * *`, async () => {
                await TelemetryPollerService.pollAllEndpoints();
            });
            this.scheduledJobs.push(pollingJob);
            loggingService.info(`✅ External telemetry polling scheduled every ${pollInterval} minutes`);
        }

        this.isRunning = true;

        loggingService.info('✅ All ingestion jobs scheduled successfully', {
            component: 'IngestionJobService',
            operation: 'startScheduler',
            jobCount: this.scheduledJobs.length
        });
    }

    /**
     * Stop all scheduled jobs
     */
    stopScheduler(): void {
        if (!this.isRunning) return;

        loggingService.info('Stopping ingestion scheduler', {
            component: 'IngestionJobService',
            operation: 'stopScheduler'
        });

        this.scheduledJobs.forEach(job => job.stop());
        this.scheduledJobs = [];
        this.isRunning = false;

        loggingService.info('✅ Ingestion scheduler stopped', {
            component: 'IngestionJobService',
            operation: 'stopScheduler'
        });
    }

    /**
     * Sync new conversations
     */
    private async syncConversations(): Promise<void> {
        try {
            loggingService.info('🔄 Starting scheduled conversation sync', {
                component: 'IngestionJobService',
                operation: 'syncConversations'
            });

            // Sync conversations from last sync interval
            const syncInterval = parseInt(process.env.RAG_SYNC_INTERVAL_HOURS || '6');
            const since = new Date(Date.now() - syncInterval * 60 * 60 * 1000);

            const result = await ingestionService.ingestConversations(undefined, since);

            loggingService.info('✅ Scheduled conversation sync completed', {
                component: 'IngestionJobService',
                operation: 'syncConversations',
                documentsIngested: result.documentsIngested,
                duration: result.duration,
                errors: result.errors.length
            });
        } catch (error) {
            loggingService.error('❌ Scheduled conversation sync failed', {
                component: 'IngestionJobService',
                operation: 'syncConversations',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Sync new telemetry
     */
    private async syncTelemetry(): Promise<void> {
        try {
            loggingService.info('🔄 Starting scheduled telemetry sync', {
                component: 'IngestionJobService',
                operation: 'syncTelemetry'
            });

            // Sync telemetry from last sync interval
            const syncInterval = parseInt(process.env.RAG_SYNC_INTERVAL_HOURS || '6');
            const since = new Date(Date.now() - syncInterval * 60 * 60 * 1000);

            const result = await ingestionService.ingestTelemetry(undefined, since);

            loggingService.info('✅ Scheduled telemetry sync completed', {
                component: 'IngestionJobService',
                operation: 'syncTelemetry',
                documentsIngested: result.documentsIngested,
                duration: result.duration,
                errors: result.errors.length
            });
        } catch (error) {
            loggingService.error('❌ Scheduled telemetry sync failed', {
                component: 'IngestionJobService',
                operation: 'syncTelemetry',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Sync knowledge base (checks for changes)
     */
    private async syncKnowledgeBase(): Promise<void> {
        try {
            loggingService.info('🔄 Starting scheduled knowledge base sync', {
                component: 'IngestionJobService',
                operation: 'syncKnowledgeBase'
            });

            const result = await ingestionService.ingestKnowledgeBase();

            loggingService.info('✅ Scheduled knowledge base sync completed', {
                component: 'IngestionJobService',
                operation: 'syncKnowledgeBase',
                documentsIngested: result.documentsIngested,
                duration: result.duration,
                errors: result.errors.length
            });
        } catch (error) {
            loggingService.error('❌ Scheduled knowledge base sync failed', {
                component: 'IngestionJobService',
                operation: 'syncKnowledgeBase',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Cleanup old or inactive documents
     */
    private async cleanupOldDocuments(): Promise<void> {
        try {
            loggingService.info('🧹 Starting scheduled document cleanup', {
                component: 'IngestionJobService',
                operation: 'cleanupOldDocuments'
            });

            const { DocumentModel } = await import('../models/Document');

            // Mark old inactive user uploads as archived
            const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days
            const result = await DocumentModel.updateMany(
                {
                    'metadata.source': 'user-upload',
                    status: 'active',
                    lastAccessedAt: { $lt: cutoffDate }
                },
                {
                    $set: { status: 'archived' }
                }
            );

            loggingService.info('✅ Scheduled document cleanup completed', {
                component: 'IngestionJobService',
                operation: 'cleanupOldDocuments',
                documentsArchived: result.modifiedCount
            });
        } catch (error) {
            loggingService.error('❌ Scheduled document cleanup failed', {
                component: 'IngestionJobService',
                operation: 'cleanupOldDocuments',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Run initial ingestion on startup
     */
    async runStartupIngestion(): Promise<void> {
        const ingestOnStartup = process.env.INGEST_ON_STARTUP !== 'false';

        if (!ingestOnStartup) {
            loggingService.info('Startup ingestion disabled', {
                component: 'IngestionJobService',
                operation: 'runStartupIngestion'
            });
            return;
        }

        try {
            loggingService.info('🚀 Starting startup ingestion', {
                component: 'IngestionJobService',
                operation: 'runStartupIngestion'
            });

            // Only ingest knowledge base on startup (faster)
            const result = await ingestionService.ingestKnowledgeBase();

            loggingService.info('✅ Startup ingestion completed', {
                component: 'IngestionJobService',
                operation: 'runStartupIngestion',
                documentsIngested: result.documentsIngested,
                duration: result.duration,
                errors: result.errors.length
            });
        } catch (error) {
            loggingService.error('❌ Startup ingestion failed', {
                component: 'IngestionJobService',
                operation: 'runStartupIngestion',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get scheduler status
     */
    getStatus(): { isRunning: boolean; activeJobs: number } {
        return {
            isRunning: this.isRunning,
            activeJobs: this.scheduledJobs.length
        };
    }
}

// Singleton instance
export const ingestionJobService = new IngestionJobService();

