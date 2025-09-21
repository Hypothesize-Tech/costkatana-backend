import axios, { AxiosError } from 'axios';
import { IWebhook, Webhook } from '../models/Webhook';
import { IWebhookDelivery, WebhookDelivery } from '../models/WebhookDelivery';
import { webhookService } from './webhook.service';
import { loggingService } from './logging.service';
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
    
    // Circuit breaker for Redis operations
    private static redisFailureCount: number = 0;
    private static readonly MAX_REDIS_FAILURES = 3;
    private static readonly REDIS_CIRCUIT_BREAKER_RESET_TIME = 180000; // 3 minutes
    private static lastRedisFailureTime: number = 0;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Connection pool optimization
    private static readonly MAX_RETRY_ATTEMPTS = 3;
    private static readonly CONNECTION_TIMEOUT = 10000;
    
    private constructor() {
        this.initializeRedis().catch(error => {
            loggingService.error('Failed to initialize Redis during construction', { error });
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
            const inLocalDev = process.env.NODE_ENV === 'development' && !process.env.REDIS_HOST && !process.env.REDIS_URL;
            if (inLocalDev) {
                const localRedisUrl = 'redis://127.0.0.1:6379';
                loggingService.info(`🔧 Webhook service: Using local Redis at ${localRedisUrl}`);
                const commonOpts: RedisOptions = {
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                    connectTimeout: 5000,
                    retryStrategy: (times) => {
                        if (times > 3) return null;
                        return Math.min(times * 1000, 3000);
                    },
                    enableOfflineQueue: true
                };
                this.redisClient = new IORedis(localRedisUrl, commonOpts);
            } else {
                const redisUrl = config.redis?.url;
                const commonOpts: RedisOptions = {
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                    connectTimeout: 10000,
                    retryStrategy: (times) => {
                        if (times > 5) return null;
                        return Math.min(times * 1000, 10000);
                    },
                    reconnectOnError: (err) => {
                        const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
                        for (const targetError of targetErrors) {
                            if (err.message.includes(targetError)) return true;
                        }
                        return false;
                    },
                    enableOfflineQueue: true
                };
                if (redisUrl) {
                    loggingService.info(`🔧 Webhook service: Connecting to Redis using URL: ${redisUrl.substring(0, 8)}...`);
                    this.redisClient = new IORedis(redisUrl, commonOpts);
                } else {
                    const host = config.redis?.host || '127.0.0.1';
                    const port = config.redis?.port || 6379;
                    loggingService.info(`🔧 Webhook service: Connecting to Redis at ${host}:${port}`);
                    this.redisClient = new IORedis({
                        host,
                        port,
                        password: config.redis?.password,
                        db: config.redis?.db || 0,
                        ...commonOpts,
                    });
                }
            }
            this.bullConnection = this.redisClient.duplicate();

            this.redisClient.on('connect', () => loggingService.info('Redis client connecting'));
            this.redisClient.on('ready', () => {
                loggingService.info('Redis client ready');
                this.initializeQueue();
            });
            this.redisClient.on('error', (err) => {
                if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
                    loggingService.warn('Redis connection issue - using in-memory fallback', { value:  { error: err.message  } });
                    this.createInMemoryFallback();
                } else {
                    loggingService.error('Redis client error', { error: err.message });
                }
                if (!this.deliveryQueue) this.initializeQueue();
            });
            this.redisClient.on('close', () => loggingService.warn('Redis connection closed'));
            this.redisClient.on('reconnecting', () => loggingService.info('Redis client reconnecting'));
            this.initializeQueue();
        } catch (error) {
            loggingService.error('Failed to initialize Redis client', { error });
            this.createInMemoryFallback();
            this.initializeQueue();
        }
    }

    private createInMemoryFallback(): void {
        loggingService.info('🔄 Creating in-memory fallback for Redis and BullMQ');
        const inMemoryData = new Map<string, any>();
        const inMemoryQueue = new Map<string, any[]>();
        const queueStats = {
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0
        };
        const mockRedisClient = {
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
            quit: async () => 'OK',
            disconnect: () => {},
            status: 'ready',
            on: () => mockRedisClient,
            duplicate: () => mockRedisClient
        };
        this.redisClient = mockRedisClient as unknown as Redis;
        this.bullConnection = mockRedisClient as unknown as Redis;
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
                    opts: options || {},
                    status: 'waiting'
                };
                inMemoryQueue.get(queueName)!.push(job);
                queueStats.waiting++;
                const delay = options?.delay || 0;
                const processJob = async () => {
                    try {
                        queueStats.waiting--;
                        queueStats.active++;
                        job.status = 'active';
                        await this.processDelivery(data);
                        queueStats.active--;
                        queueStats.completed++;
                        job.status = 'completed';
                    } catch (error) {
                        queueStats.active--;
                        queueStats.failed++;
                        job.status = 'failed';
                        loggingService.error('Error processing job in memory fallback', { error });
                    }
                };
                if (delay > 0) {
                    setTimeout(processJob, delay);
                } else {
                    setTimeout(processJob, 0);
                }
                return job;
            },
            getWaitingCount: async () => {
                try {
                    const count = await WebhookDelivery.countDocuments({ status: 'pending' });
                    return count + queueStats.waiting;
                } catch (error) {
                    return queueStats.waiting;
                }
            },
            getActiveCount: async () => {
                return queueStats.active;
            },
            getCompletedCount: async () => {
                try {
                    const count = await WebhookDelivery.countDocuments({ status: 'success' });
                    return count + queueStats.completed;
                } catch (error) {
                    return queueStats.completed;
                }
            },
            getFailedCount: async () => {
                try {
                    const count = await WebhookDelivery.countDocuments({ status: 'failed' });
                    return count + queueStats.failed;
                } catch (error) {
                    return queueStats.failed;
                }
            },
            close: async () => {}
        } as unknown as Queue<WebhookDeliveryJob>;
        this.deliveryWorker = {
            on: (_event: string, _callback: any) => {
                return this.deliveryWorker;
            },
            close: async () => {}
        } as unknown as Worker<WebhookDeliveryJob>;
        loggingService.info('✅ In-memory fallback created successfully');
    }

    private async initializeQueue() {
        try {
            if (this.deliveryQueue) {
                loggingService.debug('Queue already initialized, skipping BullMQ initialization');
                return;
            }
            const inLocalDev = process.env.NODE_ENV === 'development' &&
                (!process.env.REDIS_HOST && !process.env.REDIS_URL);
            if (inLocalDev || !this.bullConnection) {
                loggingService.info('Using in-memory queue implementation for local development');
                this.createInMemoryFallback();
                return;
            }
            const queueOptions: any = {
                defaultJobOptions: {
                    attempts: 1,
                    removeOnComplete: true,
                    removeOnFail: false,
                }
            };
            if (this.bullConnection && typeof this.bullConnection.status === 'string') {
                queueOptions.connection = this.bullConnection;
            }
            this.deliveryQueue = new Queue<WebhookDeliveryJob>('webhook-deliveries', queueOptions);

            const workerOptions: any = {
                concurrency: 5,
                lockDuration: 30000,
                maxStalledCount: 1
            };
            if (this.bullConnection && typeof this.bullConnection.status === 'string') {
                workerOptions.connection = this.bullConnection;
            }
            this.deliveryWorker = new Worker<WebhookDeliveryJob>(
                'webhook-deliveries',
                async (job) => this.processDelivery(job.data),
                workerOptions
            );
            this.deliveryWorker.on('failed', (job, err) => {
                loggingService.error('Webhook delivery job failed', {
                    jobId: job?.id,
                    error: err,
                    deliveryId: job?.data?.deliveryId
                });
            });
            this.deliveryWorker.on('completed', (job) => {
                loggingService.debug('Webhook delivery job completed', { value:  { jobId: job?.id,
                    deliveryId: job?.data?.deliveryId
                 } });
            });
            this.deliveryWorker.on('error', (err) => {
                if (err.message && err.message.includes('connect ETIMEDOUT')) {
                    loggingService.debug('Webhook delivery worker Redis connection timeout (expected when Redis unavailable)', { value:  { message: err.message
                     } });
                } else {
                    loggingService.error('Webhook delivery worker error', { error: err });
                }
            });
            loggingService.info('Webhook delivery queue initialized with BullMQ');
        } catch (error) {
            loggingService.error('Failed to initialize webhook delivery queue', { error });
            this.createInMemoryFallback();
        }
    }

    async queueDelivery(deliveryId: string, delay?: number): Promise<void> {
        try {
            if (!this.deliveryQueue) {
                loggingService.warn('Queue not initialized when queueing delivery', { value:  { deliveryId  } });
                try {
                    await this.initializeRedis();
                } catch (initError) {
                    loggingService.error('Failed to initialize Redis on demand', { error: initError });
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
            loggingService.debug('Webhook delivery queued', { value:  { deliveryId, delay  } });
        } catch (error) {
            loggingService.error('Error queueing webhook delivery', { error, deliveryId });
            try {
                loggingService.info('Attempting direct processing as fallback', { value:  {  deliveryId  } });
                const job: WebhookDeliveryJob = { deliveryId, attempt: 1 };
                await this.processDelivery(job);
            } catch (processError) {
                loggingService.error('Direct processing fallback also failed', { error: processError });
                throw error;
            }
        }
    }

    private async processDelivery(jobData: WebhookDeliveryJob): Promise<void> {
        const { deliveryId } = jobData;
        try {
            // Check database circuit breaker
            if (WebhookDeliveryService.isDbCircuitBreakerOpen()) {
                loggingService.warn('Webhook delivery processing skipped - database circuit breaker open', { deliveryId });
                return;
            }

            const delivery = await WebhookDelivery.findById(deliveryId);
            if (!delivery) {
                loggingService.error('Delivery not found', { deliveryId });
                return;
            }
            if (delivery.status !== 'pending') {
                return;
            }
            const webhook = await Webhook.findById(delivery.webhookId);
            if (!webhook) {
                await this.markDeliveryFailed(delivery, {
                    type: 'webhook_not_found',
                    message: 'Associated webhook not found'
                });
                return;
            }
            if (!webhook.active) {
                await this.markDeliveryFailed(delivery, {
                    type: 'webhook_inactive',
                    message: 'Webhook is inactive'
                });
                return;
            }

            // Reset failure count on successful database operations
            WebhookDeliveryService.dbFailureCount = 0;

            await this.attemptDelivery(delivery, webhook);
        } catch (error) {
            WebhookDeliveryService.recordDbFailure();
            loggingService.error('Error processing webhook delivery', { error, deliveryId });
        }
    }

    private async attemptDelivery(
        delivery: IWebhookDelivery,
        webhook: IWebhook
    ): Promise<void> {
        const startTime = Date.now();
        try {
            loggingService.debug('Attempting webhook delivery', { value:  { deliveryId: delivery._id,
                url: webhook.url,
                attempt: delivery.attempt
             } });
            const response = await axios({
                method: delivery.request.method,
                url: delivery.request.url,
                headers: delivery.request.headers,
                data: delivery.request.body,
                timeout: webhook.timeout,
                validateStatus: () => true,
                maxRedirects: 5,
            });
            const responseTime = Date.now() - startTime;
            delivery.response = {
                statusCode: response.status,
                headers: response.headers as Record<string, string>,
                body: this.truncateResponseBody(JSON.stringify(response.data)),
                responseTime,
                timestamp: new Date()
            };
            if (response.status >= 200 && response.status < 300) {
                await this.markDeliverySuccess(delivery, responseTime);
            } else if (response.status >= 500 && delivery.retriesLeft > 0) {
                await this.scheduleRetry(delivery, webhook, `HTTP ${response.status}`);
            } else {
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

    private async handleAxiosError(
        error: AxiosError,
        delivery: IWebhookDelivery,
        webhook: IWebhook,
        responseTime: number
    ): Promise<void> {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
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
            await this.markDeliveryFailed(delivery, {
                type: 'network_error',
                message: error.message,
                code: error.code
            });
        } else if (error.response) {
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
            await this.markDeliveryFailed(delivery, {
                type: 'request_error',
                message: error.message,
                code: error.code
            });
        }
    }

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
        await this.queueDelivery(retryDelivery._id!.toString(), delay);
        loggingService.info('Webhook retry scheduled', { value:  { 
            deliveryId: delivery._id,
            retryDeliveryId: retryDelivery._id,
            attempt: nextAttempt,
            delay,
            reason
         } });
    }

    private calculateRetryDelay(
        attempt: number,
        initialDelay: number,
        backoffMultiplier: number
    ): number {
        const jitter = Math.random() * 0.3 + 0.85;
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1) * jitter;
        return Math.min(delay, 3600000);
    }

    private async markDeliverySuccess(
        delivery: IWebhookDelivery,
        responseTime: number
    ): Promise<void> {
        delivery.status = 'success';
        await delivery.save();
        await webhookService.updateWebhookStats(
            delivery.webhookId.toString(),
            true,
            responseTime
        );
        loggingService.info('Webhook delivered successfully', { value:  { 
            deliveryId: delivery._id,
            webhookId: delivery.webhookId,
            responseTime
         } });
    }

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
        await webhookService.updateWebhookStats(
            delivery.webhookId.toString(),
            false
        );
        loggingService.error('Webhook delivery failed', {
            deliveryId: delivery._id,
            webhookId: delivery.webhookId,
            error
        });
        await this.checkWebhookHealth(delivery.webhookId.toString());
    }

    private async checkWebhookHealth(webhookId: string): Promise<void> {
        try {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentFailures = await WebhookDelivery.countDocuments({
                webhookId,
                status: 'failed',
                createdAt: { $gte: oneDayAgo }
            });
            if (recentFailures > 50) {
                await Webhook.findByIdAndUpdate(webhookId, {
                    active: false,
                    'metadata.deactivatedAt': new Date(),
                    'metadata.deactivationReason': 'Too many failures'
                });
                loggingService.warn('Webhook deactivated due to excessive failures', { value:  { webhookId,
                    recentFailures
                 } });
            }
        } catch (error) {
            loggingService.error('Error checking webhook health', { error, webhookId });
        }
    }

    private truncateResponseBody(body: string, maxLength: number = 10000): string {
        if (body.length <= maxLength) {
            return body;
        }
        return body.substring(0, maxLength) + '... [truncated]';
    }

    async processPendingDeliveries(): Promise<void> {
        try {
            if (!this.redisClient) {
                loggingService.warn('Redis client not initialized when processing pending deliveries');
                return;
            }
            const acceptableStatuses = ['ready', 'connect', 'connecting'];
            if (!acceptableStatuses.includes(this.redisClient.status)) {
                loggingService.warn(`Redis not in acceptable state (${this.redisClient.status}) when processing pending deliveries, delaying...`);
                return;
            }
            const pendingDeliveries = await WebhookDelivery.find({
                status: 'pending',
                nextRetryAt: { $lte: new Date() }
            }).limit(100);
            if (pendingDeliveries.length === 0) {
                loggingService.info('No pending webhook deliveries to process');
                return;
            }
            loggingService.info(`Found ${pendingDeliveries.length} pending webhook deliveries`);
            for (const delivery of pendingDeliveries) {
                try {
                    await this.queueDelivery(delivery._id!.toString());
                } catch (error) {
                    loggingService.error('Error queueing pending delivery', {
                        error,
                        deliveryId: delivery._id
                    });
                }
            }
            loggingService.info(`Processed ${pendingDeliveries.length} pending webhook deliveries`);
        } catch (error) {
            loggingService.error('Error processing pending deliveries', { error });
        }
    }

    async getQueueStats(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }> {
        try {
            if (!this.deliveryQueue) {
                loggingService.warn('Queue not initialized when getting stats');
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
            loggingService.error('Error getting queue stats', { error });
            return { waiting: 0, active: 0, completed: 0, failed: 0 };
        }
    }

    async shutdown(): Promise<void> {
        try {
            if (this.deliveryWorker) {
                try {
                    await this.deliveryWorker.close();
                    loggingService.info('Webhook delivery worker closed successfully');
                } catch (err) {
                    loggingService.warn('Error closing delivery worker', { value:  { error: err  } });
                }
            }
            if (this.deliveryQueue) {
                try {
                    await this.deliveryQueue.close();
                    loggingService.info('Webhook delivery queue closed successfully');
                } catch (err) {
                    loggingService.warn('Error closing delivery queue', { value:  { error: err  } });
                }
            }
            if (this.bullConnection) {
                try {
                    await this.bullConnection.quit();
                    loggingService.info('BullMQ Redis connection closed successfully');
                } catch (err) {
                    loggingService.warn('Error closing BullMQ Redis connection', { value:  { error: err  } });
                    try {
                        this.bullConnection.disconnect();
                    } catch (disconnectErr) {
                        loggingService.warn('Error forcing BullMQ Redis disconnect', { value:  { error: disconnectErr  } });
                    }
                }
            }
            if (this.redisClient) {
                try {
                    await this.redisClient.quit();
                    loggingService.info('Redis client closed successfully');
                } catch (err) {
                    loggingService.warn('Error closing Redis client', { value:  { error: err  } });
                    try {
                        this.redisClient.disconnect();
                    } catch (disconnectErr) {
                        loggingService.warn('Error forcing Redis disconnect', { value:  { error: disconnectErr  } });
                    }
                }
            }
            loggingService.info('Webhook delivery service shut down');
        } catch (error) {
            loggingService.error('Error during webhook delivery service shutdown', { error });
        }
    }

    /**
     * Circuit breaker utilities for Redis operations
     */
    private static isRedisCircuitBreakerOpen(): boolean {
        if (this.redisFailureCount >= this.MAX_REDIS_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastRedisFailureTime;
            if (timeSinceLastFailure < this.REDIS_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.redisFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordRedisFailure(): void {
        this.redisFailureCount++;
        this.lastRedisFailureTime = Date.now();
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.DB_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Reset circuit breaker state
        this.redisFailureCount = 0;
        this.lastRedisFailureTime = 0;
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
    }
}

export const webhookDeliveryService = WebhookDeliveryService.getInstance();