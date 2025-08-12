import axios, { AxiosError } from 'axios';
import { IWebhook, Webhook } from '../models/Webhook';
import { IWebhookDelivery, WebhookDelivery } from '../models/WebhookDelivery';
import { webhookService } from './webhook.service';
import { logger } from '../utils/logger';
import { Queue, Worker } from 'bullmq';
import IORedis, { Redis, RedisOptions } from 'ioredis';
import { config } from '../config';

export interface WebhookDeliveryJob {
    deliveryId: string;
    attempt: number;
}

export class WebhookDeliveryService {
    private static instance: WebhookDeliveryService;
    private deliveryQueue!: Queue<WebhookDeliveryJob>;
    private deliveryWorker!: Worker<WebhookDeliveryJob>;
    private redisClient!: Redis;
    private bullConnection!: Redis; // dedicated connection for BullMQ
    private constructor() {
        // Initialize Redis and queue immediately
        this.initializeRedis().catch(error => {
            logger.error('Failed to initialize Redis during construction', { error });
        });
    }

    static getInstance(): WebhookDeliveryService {
        if (!WebhookDeliveryService.instance) {
            WebhookDeliveryService.instance = new WebhookDeliveryService();
        }
        return WebhookDeliveryService.instance;
    }

    private async initializeRedis() {
        try {
            // For local development, use local Redis
            const inLocalDev = process.env.NODE_ENV === 'development' && !process.env.REDIS_HOST && !process.env.REDIS_URL;
            
            if (inLocalDev) {
                // Use local Redis for development
                const localRedisUrl = 'redis://127.0.0.1:6379';
                logger.info(`🔧 Webhook service: Using local Redis at ${localRedisUrl}`);
                
                const commonOpts: RedisOptions = {
                    // BullMQ-safe requirements:
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                    connectTimeout: 5000,
                    retryStrategy: (times) => {
                        if (times > 3) return null; // Stop after 3 attempts for local
                        return Math.min(times * 1000, 3000);
                    },
                    enableOfflineQueue: true
                };
                
                this.redisClient = new IORedis(localRedisUrl, commonOpts);
            } else {
                // Get Redis URL from config
                const redisUrl = config.redis?.url;
                
                const commonOpts: RedisOptions = {
                    // BullMQ-safe requirements:
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                    
                    // AWS ElastiCache optimized settings
                    connectTimeout: 10000, // 10 seconds for AWS
                    retryStrategy: (times) => {
                        // For AWS ElastiCache, we need more patience
                        if (times > 5) return null; // Stop after 5 attempts
                        return Math.min(times * 1000, 10000); // Longer delays, up to 10 seconds
                    },
                    reconnectOnError: (err) => {
                        // Only reconnect on specific errors
                        const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
                        for (const targetError of targetErrors) {
                            if (err.message.includes(targetError)) return true;
                        }
                        return false;
                    },
                    enableOfflineQueue: true
                };
                
                if (redisUrl) {
                    // Connect using URL (preferred method)
                    logger.info(`🔧 Webhook service: Connecting to Redis using URL: ${redisUrl.substring(0, 8)}...`);
                    this.redisClient = new IORedis(redisUrl, commonOpts);
                } else {
                    // Connect using individual parameters
                    const host = config.redis?.host || '127.0.0.1';
                    const port = config.redis?.port || 6379;
                    logger.info(`🔧 Webhook service: Connecting to Redis at ${host}:${port}`);
                    
                    this.redisClient = new IORedis({
                        host,
                        port,
                        password: config.redis?.password,
                        db: config.redis?.db || 0,
                        ...commonOpts,
                    });
                }
            }
            
            // 👇 Create a dedicated BullMQ connection with the same options
            this.bullConnection = this.redisClient.duplicate();

            // Handle Redis events
            this.redisClient.on('connect', () => logger.info('Redis client connecting'));
            
            this.redisClient.on('ready', () => {
                logger.info('Redis client ready');
                this.initializeQueue();
            });
            
            this.redisClient.on('error', (err) => {
                // Check for connection issues
                if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
                    logger.warn('Redis connection issue - using in-memory fallback', { error: err.message });
                    // Create a mock Redis client for fallback
                    this.createInMemoryFallback();
                } else {
                    logger.error('Redis client error', { error: err.message });
                }
                
                // Initialize queue even if there are errors
                if (!this.deliveryQueue) this.initializeQueue();
            });
            
            this.redisClient.on('close', () => logger.warn('Redis connection closed'));
            
            this.redisClient.on('reconnecting', () => logger.info('Redis client reconnecting'));
            
            // Initialize queue immediately (it will use bullConnection)
            this.initializeQueue();
            
        } catch (error) {
            logger.error('Failed to initialize Redis client', { error });
            // Create in-memory fallback
            this.createInMemoryFallback();
            // Initialize queue even if Redis fails
            this.initializeQueue();
        }
    }
    
    /**
     * Create an in-memory fallback for Redis
     */
    private createInMemoryFallback(): void {
        logger.info('🔄 Creating in-memory fallback for Redis and BullMQ');
        
        // Create a simple in-memory implementation
        const inMemoryData = new Map<string, any>();
        const inMemoryQueue = new Map<string, any[]>();
        
        // Create a mock Redis client
        const mockRedisClient = {
            // Basic methods
            set: async (key: string, value: any) => {
                inMemoryData.set(key, value);
                return 'OK';
            },
            get: async (key: string) => {
                return inMemoryData.get(key) || null;
            },
            del: async (key: string) => {
                return inMemoryData.delete(key) ? 1 : 0;
            },
            // Connection methods
            quit: async () => 'OK',
            disconnect: () => {},
            // Status properties
            status: 'ready',
            // Event handlers
            on: () => mockRedisClient,
            // Duplicate method
            duplicate: () => mockRedisClient
        };
        
        // Replace Redis clients with mock implementation
        this.redisClient = mockRedisClient as unknown as Redis;
        this.bullConnection = mockRedisClient as unknown as Redis;
        
        // Create mock BullMQ Queue and Worker implementations
        this.deliveryQueue = {
            add: async (name: string, data: WebhookDeliveryJob, options?: any) => {
                const queueName = 'webhook-deliveries';
                if (!inMemoryQueue.has(queueName)) {
                    inMemoryQueue.set(queueName, []);
                }
                
                const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                const job = {
                    id: jobId,
                    name,
                    data,
                    opts: options || {}
                };
                
                inMemoryQueue.get(queueName)!.push(job);
                
                // Process job immediately or with delay
                const delay = options?.delay || 0;
                if (delay > 0) {
                    setTimeout(() => this.processDelivery(data), delay);
                } else {
                    // Process immediately but asynchronously
                    setTimeout(() => this.processDelivery(data), 0);
                }
                
                return job;
            },
            // Add other Queue methods as needed
            close: async () => {}
        } as unknown as Queue<WebhookDeliveryJob>;
        
        // Mock Worker (doesn't need to do anything since we process jobs directly)
        this.deliveryWorker = {
            on: (_event: string, _callback: any) => {
                // Unused parameters prefixed with underscore to avoid linting warnings
                return this.deliveryWorker;
            },
            close: async () => {}
        } as unknown as Worker<WebhookDeliveryJob>;
        
        logger.info('✅ In-memory fallback created successfully');
    }
    
    private async initializeQueue() {
        try {
            // Skip initialization if we already have a queue (likely from in-memory fallback)
            if (this.deliveryQueue) {
                logger.debug('Queue already initialized, skipping BullMQ initialization');
                return;
            }
            
            // Check if we're in local development without Redis
            const inLocalDev = process.env.NODE_ENV === 'development' && 
                (!process.env.REDIS_HOST && !process.env.REDIS_URL);
            
            if (inLocalDev || !this.bullConnection) {
                logger.info('Using in-memory queue implementation for local development');
                this.createInMemoryFallback();
                return;
            }
            
            const queueOptions: any = {
                defaultJobOptions: {
                    attempts: 1, // We handle retries manually
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            };
            
            // Add connection if we have a real Redis client
            if (this.bullConnection && typeof this.bullConnection.status === 'string') {
                queueOptions.connection = this.bullConnection;
            }
            
            // Initialize queue with BullMQ-compatible options
            this.deliveryQueue = new Queue<WebhookDeliveryJob>('webhook-deliveries', queueOptions);

            const workerOptions: any = {
                concurrency: 5, // Reduced concurrency for better stability
                lockDuration: 30000, // 30 seconds
                maxStalledCount: 1 // Only try once for stalled jobs
            };
            
            // Add connection if we have a real Redis client
            if (this.bullConnection && typeof this.bullConnection.status === 'string') {
                workerOptions.connection = this.bullConnection;
            }

            // Initialize worker with same connection
            this.deliveryWorker = new Worker<WebhookDeliveryJob>(
                'webhook-deliveries',
                async (job) => this.processDelivery(job.data),
                workerOptions
            );

            // Error handling
            this.deliveryWorker.on('failed', (job, err) => {
                logger.error('Webhook delivery job failed', { 
                    jobId: job?.id, 
                    error: err,
                    deliveryId: job?.data?.deliveryId 
                });
            });
            
            this.deliveryWorker.on('completed', (job) => {
                logger.debug('Webhook delivery job completed', {
                    jobId: job?.id,
                    deliveryId: job?.data?.deliveryId
                });
            });
            
            this.deliveryWorker.on('error', (err) => {
                logger.error('Webhook delivery worker error', { error: err });
            });

            logger.info('Webhook delivery queue initialized with BullMQ');
        } catch (error) {
            logger.error('Failed to initialize webhook delivery queue', { error });
            // Create in-memory fallback on error
            this.createInMemoryFallback();
        }
    }

    /**
     * Queue a webhook delivery for processing
     */
    async queueDelivery(deliveryId: string, delay?: number): Promise<void> {
        try {
            // Check if queue is initialized
            if (!this.deliveryQueue) {
                logger.warn('Queue not initialized when queueing delivery', { deliveryId });
                
                // Try to initialize Redis and queue
                try {
                    await this.initializeRedis();
                } catch (initError) {
                    logger.error('Failed to initialize Redis on demand', { error: initError });
                    // Fall back to direct processing
                    const job: WebhookDeliveryJob = { deliveryId, attempt: 1 };
                    await this.processDelivery(job);
                    return;
                }
            }
            
            const jobData: WebhookDeliveryJob = {
                deliveryId,
                attempt: 1
            };

            await this.deliveryQueue.add(
                'process-delivery',
                jobData,
                {
                    delay: delay || 0,
                }
            );

            logger.debug('Webhook delivery queued', { deliveryId, delay });
        } catch (error) {
            logger.error('Error queueing webhook delivery', { error, deliveryId });
            
            // Attempt direct processing as fallback
            try {
                logger.info('Attempting direct processing as fallback', { deliveryId });
                const job: WebhookDeliveryJob = { deliveryId, attempt: 1 };
                await this.processDelivery(job);
            } catch (processError) {
                logger.error('Direct processing fallback also failed', { error: processError });
                throw error;
            }
        }
    }

    /**
     * Process a webhook delivery
     */
    private async processDelivery(jobData: WebhookDeliveryJob): Promise<void> {
        const { deliveryId } = jobData;

        try {
            // Get delivery record
            const delivery = await WebhookDelivery.findById(deliveryId);
            if (!delivery) {
                logger.error('Delivery not found', { deliveryId });
                return;
            }

            // Check if already processed
            if (delivery.status !== 'pending') {
                logger.debug('Delivery already processed', { 
                    deliveryId, 
                    status: delivery.status 
                });
                return;
            }

            // Get webhook
            const webhook = await Webhook.findById(delivery.webhookId);
            if (!webhook) {
                await this.markDeliveryFailed(delivery, {
                    type: 'webhook_not_found',
                    message: 'Associated webhook not found'
                });
                return;
            }

            // Check if webhook is active
            if (!webhook.active) {
                await this.markDeliveryFailed(delivery, {
                    type: 'webhook_inactive',
                    message: 'Webhook is inactive'
                });
                return;
            }

            // Attempt delivery
            await this.attemptDelivery(delivery, webhook);

        } catch (error) {
            logger.error('Error processing webhook delivery', { error, deliveryId });
        }
    }

    /**
     * Attempt to deliver a webhook
     */
    private async attemptDelivery(
        delivery: IWebhookDelivery, 
        webhook: IWebhook
    ): Promise<void> {
        const startTime = Date.now();

        try {
            logger.debug('Attempting webhook delivery', { 
                deliveryId: delivery._id,
                url: webhook.url,
                attempt: delivery.attempt 
            });

            // Make HTTP request
            const response = await axios({
                method: delivery.request.method,
                url: delivery.request.url,
                headers: delivery.request.headers,
                data: delivery.request.body,
                timeout: webhook.timeout,
                validateStatus: () => true, // Don't throw on any status
                maxRedirects: 5,
            });

            const responseTime = Date.now() - startTime;

            // Update delivery record
            delivery.response = {
                statusCode: response.status,
                headers: response.headers as Record<string, string>,
                body: this.truncateResponseBody(JSON.stringify(response.data)),
                responseTime,
                timestamp: new Date()
            };

            // Check if successful (2xx status)
            if (response.status >= 200 && response.status < 300) {
                await this.markDeliverySuccess(delivery, responseTime);
            } else if (response.status >= 500 && delivery.retriesLeft > 0) {
                // Server error - retry
                await this.scheduleRetry(delivery, webhook, `HTTP ${response.status}`);
            } else {
                // Client error or no retries left
                await this.markDeliveryFailed(delivery, {
                    type: 'http_error',
                    message: `HTTP ${response.status}`,
                    code: response.status.toString()
                });
            }

        } catch (error) {
            const responseTime = Date.now() - startTime;

            if (axios.isAxiosError(error)) {
                await this.handleAxiosError(error, delivery, webhook, responseTime);
            } else {
                await this.markDeliveryFailed(delivery, {
                    type: 'unknown_error',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    details: error
                });
            }
        }
    }

    /**
     * Handle Axios errors
     */
    private async handleAxiosError(
        error: AxiosError,
        delivery: IWebhookDelivery,
        webhook: IWebhook,
        responseTime: number
    ): Promise<void> {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            // Timeout
            delivery.response = {
                statusCode: 0,
                headers: {},
                body: '',
                responseTime,
                timestamp: new Date()
            };

            if (delivery.retriesLeft > 0) {
                await this.scheduleRetry(delivery, webhook, 'Timeout');
            } else {
                await this.markDeliveryFailed(delivery, {
                    type: 'timeout',
                    message: `Request timed out after ${webhook.timeout}ms`,
                    code: error.code
                });
            }
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            // Network error
            await this.markDeliveryFailed(delivery, {
                type: 'network_error',
                message: error.message,
                code: error.code
            });
        } else if (error.response) {
            // Got response but with error status
            delivery.response = {
                statusCode: error.response.status,
                headers: error.response.headers as Record<string, string>,
                body: this.truncateResponseBody(JSON.stringify(error.response.data)),
                responseTime,
                timestamp: new Date()
            };

            if (error.response.status >= 500 && delivery.retriesLeft > 0) {
                await this.scheduleRetry(delivery, webhook, `HTTP ${error.response.status}`);
            } else {
                await this.markDeliveryFailed(delivery, {
                    type: 'http_error',
                    message: `HTTP ${error.response.status}`,
                    code: error.response.status.toString()
                });
            }
        } else {
            // Other errors
            await this.markDeliveryFailed(delivery, {
                type: 'request_error',
                message: error.message,
                code: error.code
            });
        }
    }

    /**
     * Schedule a retry for failed delivery
     */
    private async scheduleRetry(
        delivery: IWebhookDelivery,
        webhook: IWebhook,
        reason: string
    ): Promise<void> {
        const nextAttempt = delivery.attempt + 1;
        const delay = this.calculateRetryDelay(
            nextAttempt,
            webhook.retryConfig?.initialDelay || 5000,
            webhook.retryConfig?.backoffMultiplier || 2
        );

        delivery.status = 'failed';
        delivery.retriesLeft = delivery.retriesLeft - 1;
        delivery.nextRetryAt = new Date(Date.now() + delay);
        delivery.error = {
            type: 'retry_scheduled',
            message: `Retry scheduled due to: ${reason}`,
            details: {
                nextAttempt,
                delay,
                retriesLeft: delivery.retriesLeft
            }
        };

        await delivery.save();

        // Create new delivery for retry
        const retryDelivery = new WebhookDelivery({
            webhookId: delivery.webhookId,
            userId: delivery.userId,
            eventId: delivery.eventId,
            eventType: delivery.eventType,
            eventData: delivery.eventData,
            attempt: nextAttempt,
            status: 'pending',
            request: delivery.request,
            retriesLeft: delivery.retriesLeft,
            metadata: {
                ...delivery.metadata,
                previousAttemptId: delivery._id
            }
        });

        await retryDelivery.save();

        // Queue the retry
        await this.queueDelivery(retryDelivery._id!.toString(), delay);

        logger.info('Webhook retry scheduled', {
            deliveryId: delivery._id,
            retryDeliveryId: retryDelivery._id,
            attempt: nextAttempt,
            delay,
            reason
        });
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    private calculateRetryDelay(
        attempt: number,
        initialDelay: number,
        backoffMultiplier: number
    ): number {
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 + 0.85; // 85% to 115% of calculated delay
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1) * jitter;
        
        // Cap at 1 hour
        return Math.min(delay, 3600000);
    }

    /**
     * Mark delivery as successful
     */
    private async markDeliverySuccess(
        delivery: IWebhookDelivery,
        responseTime: number
    ): Promise<void> {
        delivery.status = 'success';
        await delivery.save();

        // Update webhook stats
        await webhookService.updateWebhookStats(
            delivery.webhookId.toString(),
            true,
            responseTime
        );

        logger.info('Webhook delivered successfully', {
            deliveryId: delivery._id,
            webhookId: delivery.webhookId,
            responseTime
        });
    }

    /**
     * Mark delivery as failed
     */
    private async markDeliveryFailed(
        delivery: IWebhookDelivery,
        error: {
            type: string;
            message: string;
            code?: string;
            details?: any;
        }
    ): Promise<void> {
        delivery.status = 'failed';
        delivery.error = error;
        await delivery.save();

        // Update webhook stats
        await webhookService.updateWebhookStats(
            delivery.webhookId.toString(),
            false
        );

        logger.error('Webhook delivery failed', {
            deliveryId: delivery._id,
            webhookId: delivery.webhookId,
            error
        });

        // Check if we should deactivate the webhook due to repeated failures
        await this.checkWebhookHealth(delivery.webhookId.toString());
    }

    /**
     * Check webhook health and deactivate if too many failures
     */
    private async checkWebhookHealth(webhookId: string): Promise<void> {
        try {
            // Count recent failures (last 24 hours)
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentFailures = await WebhookDelivery.countDocuments({
                webhookId,
                status: 'failed',
                createdAt: { $gte: oneDayAgo }
            });

            // If more than 50 failures in 24 hours, deactivate
            if (recentFailures > 50) {
                await Webhook.findByIdAndUpdate(webhookId, {
                    active: false,
                    'metadata.deactivatedAt': new Date(),
                    'metadata.deactivationReason': 'Too many failures'
                });

                logger.warn('Webhook deactivated due to excessive failures', {
                    webhookId,
                    recentFailures
                });
            }
        } catch (error) {
            logger.error('Error checking webhook health', { error, webhookId });
        }
    }

    /**
     * Truncate response body to reasonable size
     */
    private truncateResponseBody(body: string, maxLength: number = 10000): string {
        if (body.length <= maxLength) {
            return body;
        }
        return body.substring(0, maxLength) + '... [truncated]';
    }

    /**
     * Process pending deliveries (for recovery after restart)
     */
    async processPendingDeliveries(): Promise<void> {
        try {
            // First check if Redis is ready
            if (!this.redisClient) {
                logger.warn('Redis client not initialized when processing pending deliveries');
                return;
            }
            
            // For AWS ElastiCache, we need to be more lenient with status checks
            const acceptableStatuses = ['ready', 'connect', 'connecting'];
            if (!acceptableStatuses.includes(this.redisClient.status)) {
                logger.warn(`Redis not in acceptable state (${this.redisClient.status}) when processing pending deliveries, delaying...`);
                return;
            }

            const pendingDeliveries = await WebhookDelivery.find({
                status: 'pending',
                nextRetryAt: { $lte: new Date() }
            }).limit(100);

            if (pendingDeliveries.length === 0) {
                logger.info('No pending webhook deliveries to process');
                return;
            }

            logger.info(`Found ${pendingDeliveries.length} pending webhook deliveries`);
            
            for (const delivery of pendingDeliveries) {
                try {
                    await this.queueDelivery(delivery._id!.toString());
                } catch (error) {
                    logger.error('Error queueing pending delivery', { 
                        error, 
                        deliveryId: delivery._id 
                    });
                    // Continue with next delivery
                }
            }

            logger.info(`Processed ${pendingDeliveries.length} pending webhook deliveries`);
        } catch (error) {
            logger.error('Error processing pending deliveries', { error });
        }
    }

    /**
     * Get delivery queue stats
     */
    async getQueueStats(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }> {
        try {
            // Check if queue is initialized
            if (!this.deliveryQueue) {
                logger.warn('Queue not initialized when getting stats');
                return { waiting: 0, active: 0, completed: 0, failed: 0 };
            }
            
            const [waiting, active, completed, failed] = await Promise.all([
                this.deliveryQueue.getWaitingCount().catch(() => 0),
                this.deliveryQueue.getActiveCount().catch(() => 0),
                this.deliveryQueue.getCompletedCount().catch(() => 0),
                this.deliveryQueue.getFailedCount().catch(() => 0)
            ]);

            return { waiting, active, completed, failed };
        } catch (error) {
            logger.error('Error getting queue stats', { error });
            return { waiting: 0, active: 0, completed: 0, failed: 0 };
        }
    }

    /**
     * Shutdown the delivery service
     */
    async shutdown(): Promise<void> {
        try {
            // Only close if initialized
            if (this.deliveryWorker) {
                try {
                    await this.deliveryWorker.close();
                    logger.info('Webhook delivery worker closed successfully');
                } catch (err) {
                    logger.warn('Error closing delivery worker', { error: err });
                }
            }
            
            if (this.deliveryQueue) {
                try {
                    await this.deliveryQueue.close();
                    logger.info('Webhook delivery queue closed successfully');
                } catch (err) {
                    logger.warn('Error closing delivery queue', { error: err });
                }
            }
            
            // Close both Redis connections
            if (this.bullConnection) {
                try {
                    await this.bullConnection.quit();
                    logger.info('BullMQ Redis connection closed successfully');
                } catch (err) {
                    logger.warn('Error closing BullMQ Redis connection', { error: err });
                    // Force disconnect if quit fails
                    try {
                        this.bullConnection.disconnect();
                    } catch (disconnectErr) {
                        logger.warn('Error forcing BullMQ Redis disconnect', { error: disconnectErr });
                    }
                }
            }
            
            if (this.redisClient) {
                try {
                    await this.redisClient.quit();
                    logger.info('Redis client closed successfully');
                } catch (err) {
                    logger.warn('Error closing Redis client', { error: err });
                    // Force disconnect if quit fails
                    try {
                        this.redisClient.disconnect();
                    } catch (disconnectErr) {
                        logger.warn('Error forcing Redis disconnect', { error: disconnectErr });
                    }
                }
            }
            
            logger.info('Webhook delivery service shut down');
        } catch (error) {
            logger.error('Error during webhook delivery service shutdown', { error });
        }
    }
}

// Export singleton instance
export const webhookDeliveryService = WebhookDeliveryService.getInstance();