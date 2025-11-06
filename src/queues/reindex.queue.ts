import { Queue, Worker, Job } from 'bullmq';
import { resolveRedisUrl, getRedisOptions } from '../config/redis';
import { loggingService } from '../services/logging.service';
import { MultiRepoIntelligenceService } from '../services/multiRepoIntelligence.service';
import { GitHubConnection } from '../models';
import IORedis from 'ioredis';

export interface ReindexJobData {
    repoFullName: string;
    branch?: string;
    userId: string;
    connectionId: string;
    priority: 'high' | 'medium' | 'low';
}

/**
 * Reindex Queue for background repository reindexing
 */
export class ReindexQueue {
    private static queue: Queue<ReindexJobData> | null = null;
    private static worker: Worker<ReindexJobData> | null = null;
    private static redisConnection: IORedis | null = null;

    /**
     * Initialize the reindex queue
     */
    static async initialize(): Promise<void> {
        if (this.queue) {
            return; // Already initialized
        }

        try {
            // Create Redis connection for BullMQ
            const redisUrl = resolveRedisUrl();
            const redisOptions = getRedisOptions(true); // BullMQ options

            this.redisConnection = new IORedis(redisUrl, redisOptions);

            // Create queue
            this.queue = new Queue<ReindexJobData>('repo-reindex', {
                connection: this.redisConnection,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000 // Start with 5 seconds
                    },
                    removeOnComplete: {
                        age: 24 * 3600, // Keep completed jobs for 24 hours
                        count: 1000 // Keep last 1000 jobs
                    },
                    removeOnFail: {
                        age: 7 * 24 * 3600 // Keep failed jobs for 7 days
                    }
                }
            });

            // Create worker
            this.worker = new Worker<ReindexJobData>(
                'repo-reindex',
                async (job: Job<ReindexJobData>) => {
                    return await this.processReindexJob(job);
                },
                {
                    connection: this.redisConnection,
                    concurrency: 2, // Process 2 jobs concurrently
                    limiter: {
                        max: 10, // Max 10 jobs
                        duration: 60000 // Per minute
                    }
                }
            );

            // Worker event handlers
            this.worker.on('completed', (job) => {
                loggingService.info('Reindex job completed', {
                    jobId: job.id,
                    repo: job.data.repoFullName
                });
            });

            this.worker.on('failed', (job, err) => {
                loggingService.error('Reindex job failed', {
                    jobId: job?.id,
                    repo: job?.data.repoFullName,
                    error: err.message,
                    attempts: job?.attemptsMade
                });
            });

            this.worker.on('error', (err) => {
                loggingService.error('Reindex worker error', {
                    error: err.message
                });
            });

            loggingService.info('Reindex queue initialized');
        } catch (error) {
            loggingService.error('Failed to initialize reindex queue', {
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Process a reindex job
     */
    private static async processReindexJob(job: Job<ReindexJobData>): Promise<void> {
        const { repoFullName, branch, userId, connectionId } = job.data;

        loggingService.info('Processing reindex job', {
            jobId: job.id,
            repoFullName,
            branch,
            userId,
            priority: job.data.priority
        });

        try {
            // Get GitHub connection
            const connection = await GitHubConnection.findById(connectionId)
                .select('+accessToken')
                .exec();

            if (!connection) {
                throw new Error(`GitHub connection not found: ${connectionId}`);
            }

            if (!connection.isActive) {
                throw new Error(`GitHub connection is inactive: ${connectionId}`);
            }

            // Decrypt token
            const decryptToken = connection.decryptToken.bind(connection);

            // Reindex repository
            await MultiRepoIntelligenceService.reindexRepository(
                { ...connection.toObject(), decryptToken } as any,
                repoFullName,
                branch
            );

            loggingService.info('Reindex job completed successfully', {
                jobId: job.id,
                repoFullName
            });
        } catch (error) {
            loggingService.error('Reindex job processing failed', {
                jobId: job.id,
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error; // Re-throw to trigger retry
        }
    }

    /**
     * Add a reindex job to the queue
     */
    static async addReindexJob(data: ReindexJobData): Promise<Job<ReindexJobData>> {
        if (!this.queue) {
            await this.initialize();
        }

        if (!this.queue) {
            throw new Error('Reindex queue not initialized');
        }

        // Determine job priority based on priority field
        const jobOptions: any = {
            priority: data.priority === 'high' ? 1 : data.priority === 'medium' ? 5 : 10
        };

        // Add delay for low priority jobs
        if (data.priority === 'low') {
            jobOptions.delay = 5 * 60 * 1000; // 5 minutes delay
        } else if (data.priority === 'medium') {
            jobOptions.delay = 1 * 60 * 1000; // 1 minute delay
        }

        const job = await this.queue.add('reindex', data, jobOptions);

        loggingService.info('Reindex job added to queue', {
            jobId: job.id,
            repoFullName: data.repoFullName,
            priority: data.priority
        });

        return job;
    }

    /**
     * Get queue statistics
     */
    static async getQueueStats(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }> {
        if (!this.queue) {
            return { waiting: 0, active: 0, completed: 0, failed: 0 };
        }

        const [waiting, active, completed, failed] = await Promise.all([
            this.queue.getWaitingCount(),
            this.queue.getActiveCount(),
            this.queue.getCompletedCount(),
            this.queue.getFailedCount()
        ]);

        return { waiting, active, completed, failed };
    }

    /**
     * Close the queue and worker
     */
    static async close(): Promise<void> {
        if (this.worker) {
            await this.worker.close();
            this.worker = null;
        }

        if (this.queue) {
            await this.queue.close();
            this.queue = null;
        }

        if (this.redisConnection) {
            await this.redisConnection.quit();
            this.redisConnection = null;
        }

        loggingService.info('Reindex queue closed');
    }
}

// Initialize queue on module load
ReindexQueue.initialize().catch(err => {
    loggingService.error('Failed to initialize reindex queue on startup', {
        error: err instanceof Error ? err.message : 'Unknown'
    });
});

