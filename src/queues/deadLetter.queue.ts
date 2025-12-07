/**
 * Dead Letter Queue using BullMQ
 * 
 * Centralized queue for failed operations with retry logic, exponential backoff,
 * and proper observability.
 */

import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { loggingService } from '../services/logging.service';
import { resolveRedisUrl, getRedisOptions } from '../config/redis';

export interface DeadLetterJobData {
    operation: string;
    request: any;
    response?: any;
    userId: string;
    metadata?: any;
    originalError?: string;
    timestamp: number;
}

/**
 * Dead Letter Queue for handling failed operations
 */
export class DeadLetterQueue {
    private static queue: Queue<DeadLetterJobData> | null = null;
    private static worker: Worker<DeadLetterJobData> | null = null;
    private static redisConnection: IORedis | null = null;
    private static handlers: Map<string, (data: DeadLetterJobData) => Promise<void>> = new Map();

    /**
     * Initialize the dead letter queue
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

            // Create queue with exponential backoff
            this.queue = new Queue<DeadLetterJobData>('dead-letter', {
                connection: this.redisConnection,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 1000 // Start with 1 second, doubles each retry
                    },
                    removeOnComplete: {
                        age: 7 * 24 * 3600, // Keep completed jobs for 7 days
                        count: 5000 // Keep last 5000 successful jobs
                    },
                removeOnFail: {
                    age: 30 * 24 * 3600 // Keep failed jobs for 30 days
                }
                }
            });

            // Create worker
            this.worker = new Worker<DeadLetterJobData>(
                'dead-letter',
                async (job: Job<DeadLetterJobData>) => {
                    return await this.processJob(job);
                },
                {
                    connection: this.redisConnection,
                    concurrency: 3, // Process 3 jobs concurrently
                    limiter: {
                        max: 50, // Max 50 jobs
                        duration: 60000 // Per minute
                    }
                }
            );

            // Worker event handlers
            this.worker.on('completed', (job) => {
                loggingService.info('Dead letter job completed', {
                    jobId: job.id,
                    operation: job.data.operation,
                    userId: job.data.userId,
                    attempts: job.attemptsMade
                });
            });

            this.worker.on('failed', (job, error) => {
                if (job) {
                    loggingService.error('Dead letter job permanently failed', {
                        jobId: job.id,
                        operation: job.data.operation,
                        userId: job.data.userId,
                        attempts: job.attemptsMade,
                        error: error.message
                    });
                }
            });

            this.worker.on('error', (error) => {
                loggingService.error('Dead letter worker error', {
                    error: error.message
                });
            });

            loggingService.info('Dead Letter Queue initialized successfully');
        } catch (error) {
            loggingService.error('Failed to initialize Dead Letter Queue', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Register a handler for a specific operation type
     */
    static registerHandler(operation: string, handler: (data: DeadLetterJobData) => Promise<void>): void {
        this.handlers.set(operation, handler);
        loggingService.info(`Registered dead letter handler for operation: ${operation}`);
    }

    /**
     * Add a failed operation to the dead letter queue
     */
    static async add(data: DeadLetterJobData): Promise<string | undefined> {
        if (!this.queue) {
            loggingService.warn('Dead Letter Queue not initialized, operation dropped', {
                operation: data.operation,
                userId: data.userId
            });
            return undefined;
        }

        try {
            const job = await this.queue.add(
                data.operation,
                data,
                {
                    priority: this.determinePriority(data),
                    jobId: `dl-${data.operation}-${data.userId}-${Date.now()}`
                }
            );

            loggingService.info('Added job to dead letter queue', {
                jobId: job.id,
                operation: data.operation,
                userId: data.userId
            });

            return job.id;
        } catch (error) {
            loggingService.error('Failed to add job to dead letter queue', {
                operation: data.operation,
                userId: data.userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Process a dead letter job
     */
    private static async processJob(job: Job<DeadLetterJobData>): Promise<void> {
        const { operation, userId } = job.data;

        loggingService.info('Processing dead letter job', {
            jobId: job.id,
            operation,
            userId,
            attempt: job.attemptsMade + 1
        });

        // Find registered handler
        const handler = this.handlers.get(operation);
        if (!handler) {
            throw new Error(`No handler registered for operation: ${operation}`);
        }

        // Execute handler
        await handler(job.data);
    }

    /**
     * Determine job priority based on data
     */
    private static determinePriority(data: DeadLetterJobData): number {
        // Higher priority (lower number) for:
        // - Recent failures (< 5 minutes old)
        // - Cost tracking operations
        // - User-facing operations
        
        const age = Date.now() - data.timestamp;
        const isRecent = age < 300000; // 5 minutes
        const isCostTracking = data.operation.includes('cost');
        
        if (isRecent && isCostTracking) return 1;
        if (isRecent) return 2;
        if (isCostTracking) return 3;
        return 5;
    }

    /**
     * Get queue statistics
     */
    static async getStats(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
    }> {
        if (!this.queue) {
            return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
        }

        const [waiting, active, completed, failed, delayed] = await Promise.all([
            this.queue.getWaitingCount(),
            this.queue.getActiveCount(),
            this.queue.getCompletedCount(),
            this.queue.getFailedCount(),
            this.queue.getDelayedCount()
        ]);

        return { waiting, active, completed, failed, delayed };
    }

    /**
     * Clean up old jobs
     */
    static async cleanup(olderThan: number = 30 * 24 * 3600 * 1000): Promise<void> {
        if (!this.queue) {
            return;
        }

        await this.queue.clean(olderThan, 1000, 'completed');
        await this.queue.clean(olderThan, 1000, 'failed');
        
        loggingService.info('Dead Letter Queue cleaned up', { olderThan });
    }

    /**
     * Shutdown the queue gracefully
     */
    static async shutdown(): Promise<void> {
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

        loggingService.info('Dead Letter Queue shut down');
    }
}

