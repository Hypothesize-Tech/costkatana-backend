import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../common/logger/logger.service';
import { Queue, Worker } from 'bullmq';
import IORedis, { Redis, RedisOptions } from 'ioredis';
import { isRedisEnabled } from '../../config/redis';
import axios, { AxiosError } from 'axios';
import { Webhook, WebhookDocument } from '../../schemas/webhook/webhook.schema';
import {
  WebhookDelivery,
  WebhookDeliveryDocument,
} from '../../schemas/webhook/webhook-delivery.schema';
import { WebhookService } from './webhook.service';

export interface WebhookDeliveryJob {
  deliveryId: string;
  attempt: number;
}

@Injectable()
export class WebhookDeliveryService implements OnModuleInit, OnModuleDestroy {
  private deliveryQueue!: Queue<WebhookDeliveryJob>;
  private deliveryWorker!: Worker<WebhookDeliveryJob>;
  private redisClient!: Redis;
  private bullConnection!: Redis;

  /** When true, Redis is unavailable and we use MongoDB-backed processing (persistent). */
  private useDatabaseBackedFallback = false;
  private dbFallbackPollIntervalId: ReturnType<typeof setInterval> | null =
    null;
  private static readonly DB_FALLBACK_POLL_MS = 15000;
  private static readonly DB_FALLBACK_LOCK_MS = 120000;

  // Circuit breaker for database operations
  private static dbFailureCount = 0;
  private static readonly MAX_DB_FAILURES = 5;
  private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
  private static lastDbFailureTime = 0;

  constructor(
    @InjectModel(Webhook.name) private webhookModel: Model<WebhookDocument>,
    @InjectModel(WebhookDelivery.name)
    private webhookDeliveryModel: Model<WebhookDeliveryDocument>,
    private logger: LoggerService,
    private webhookService: WebhookService,
  ) {}

  async onModuleInit() {
    await this.initializeRedis();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  private async initializeRedis() {
    try {
      if (!isRedisEnabled()) {
        this.logger.log(
          '🔧 Webhook service: Redis disabled - using database-backed fallback',
        );
        this.createDatabaseBackedFallback();
        this.initializeQueue();
        return;
      }

      const inLocalDev =
        process.env.NODE_ENV === 'development' &&
        !process.env.REDIS_HOST &&
        !process.env.REDIS_URL;
      if (inLocalDev) {
        const localRedisUrl = 'redis://127.0.0.1:6379';
        this.logger.log(
          `🔧 Webhook service: Using local Redis at ${localRedisUrl}`,
        );
        const commonOpts: RedisOptions = {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          connectTimeout: 5000,
          retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 1000, 3000);
          },
          enableOfflineQueue: true,
        };
        this.redisClient = new IORedis(localRedisUrl, commonOpts);
      } else {
        const redisUrl = process.env.REDIS_URL;
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
          enableOfflineQueue: true,
        };
        if (redisUrl) {
          this.logger.log(
            `🔧 Webhook service: Connecting to Redis using URL: ${redisUrl.substring(0, 8)}...`,
          );
          this.redisClient = new IORedis(redisUrl, commonOpts);
        } else {
          const host = process.env.REDIS_HOST || '127.0.0.1';
          const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);
          this.logger.log(
            `🔧 Webhook service: Connecting to Redis at ${host}:${port}`,
          );
          this.redisClient = new IORedis({
            host,
            port,
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB ?? '0', 10),
            ...commonOpts,
          });
        }
      }
      this.bullConnection = this.redisClient.duplicate();

      this.redisClient.on('connect', () =>
        this.logger.log('Redis client connecting'),
      );
      this.redisClient.on('ready', () => {
        this.logger.log('Redis client ready');
        this.initializeQueue();
      });
      this.redisClient.on('error', (err) => {
        if (
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ECONNREFUSED')
        ) {
          this.logger.warn(
            'Redis connection issue - using database-backed fallback',
            { error: err.message },
          );
          this.createDatabaseBackedFallback();
        } else {
          this.logger.error('Redis client error', { error: err.message });
        }
        if (!this.deliveryQueue) this.initializeQueue();
      });
      this.redisClient.on('close', () =>
        this.logger.warn('Redis connection closed'),
      );
      this.redisClient.on('reconnecting', () =>
        this.logger.log('Redis client reconnecting'),
      );
      this.initializeQueue();
    } catch (error) {
      this.logger.error('Failed to initialize Redis client', { error });
      this.createDatabaseBackedFallback();
      this.initializeQueue();
    }
  }

  /**
   * Database-backed fallback when Redis is unavailable.
   * Persists no data in memory; pending deliveries stay in MongoDB and are
   * processed by a poller. Survives restarts.
   */
  private createDatabaseBackedFallback(): void {
    if (this.useDatabaseBackedFallback) return;
    this.useDatabaseBackedFallback = true;
    this.logger.log(
      'Using database-backed fallback for webhook deliveries (persistent)',
    );
    this.redisClient = null as unknown as Redis;
    this.bullConnection = null as unknown as Redis;
    this.deliveryQueue = {
      add: async (
        _name: string,
        data: WebhookDeliveryJob,
        options?: { delay?: number },
      ) => {
        const delay = options?.delay ?? 0;
        if (delay > 0) {
          setTimeout(() => this.processDelivery(data), delay);
        } else {
          setImmediate(() => this.processDelivery(data));
        }
      },
      getWaitingCount: async () => {
        return this.webhookDeliveryModel.countDocuments({ status: 'pending' });
      },
      getActiveCount: async () => 0,
      getCompletedCount: async () => {
        return this.webhookDeliveryModel.countDocuments({ status: 'success' });
      },
      getFailedCount: async () => {
        return this.webhookDeliveryModel.countDocuments({ status: 'failed' });
      },
      close: async () => {},
    } as unknown as Queue<WebhookDeliveryJob>;
    this.deliveryWorker = {
      on: () => this.deliveryWorker,
      close: async () => {},
    } as unknown as Worker<WebhookDeliveryJob>;
    this.startDatabaseFallbackPoller();
    this.logger.log('Database-backed fallback active');
  }

  private startDatabaseFallbackPoller(): void {
    if (this.dbFallbackPollIntervalId) return;
    this.dbFallbackPollIntervalId = setInterval(() => {
      this.pollPendingDeliveries().catch((err) => {
        this.logger.error('DB fallback poll error', { error: err });
      });
    }, WebhookDeliveryService.DB_FALLBACK_POLL_MS);
  }

  private async pollPendingDeliveries(): Promise<void> {
    const lockThreshold = new Date(
      Date.now() - WebhookDeliveryService.DB_FALLBACK_LOCK_MS,
    );
    const doc = await this.webhookDeliveryModel.findOneAndUpdate(
      {
        status: 'pending',
        $or: [
          { 'metadata.processingStartedAt': { $exists: false } },
          { 'metadata.processingStartedAt': { $lt: lockThreshold } },
        ],
      },
      { $set: { 'metadata.processingStartedAt': new Date() } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!doc) return;
    try {
      await this.processDelivery({
        deliveryId: doc._id.toString(),
        attempt: doc.attempt ?? 1,
      });
    } catch (err) {
      this.logger.error('Failed to process delivery from poller', {
        deliveryId: doc._id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async initializeQueue() {
    try {
      if (this.deliveryQueue) {
        this.logger.debug(
          'Queue already initialized, skipping BullMQ initialization',
        );
        return;
      }
      const redisDisabled = !isRedisEnabled();
      if (redisDisabled || !this.bullConnection) {
        this.logger.log(
          'Using database-backed fallback for webhook deliveries (no Redis)',
        );
        this.createDatabaseBackedFallback();
        return;
      }
      const queueOptions: any = {
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false,
        },
      };
      if (
        this.bullConnection &&
        typeof this.bullConnection.status === 'string'
      ) {
        queueOptions.connection = this.bullConnection as any;
      }
      this.deliveryQueue = new Queue<WebhookDeliveryJob>(
        'webhook-deliveries',
        queueOptions,
      );

      const workerOptions: any = {
        concurrency: 5,
        lockDuration: 30000,
        maxStalledCount: 1,
      };
      if (
        this.bullConnection &&
        typeof this.bullConnection.status === 'string'
      ) {
        workerOptions.connection = this.bullConnection as any;
      }
      this.deliveryWorker = new Worker<WebhookDeliveryJob>(
        'webhook-deliveries',
        async (job) => this.processDelivery(job.data),
        workerOptions,
      );
      this.deliveryWorker.on('failed', (job, err) => {
        this.logger.error('Webhook delivery job failed', {
          jobId: job?.id,
          error: err,
          deliveryId: job?.data?.deliveryId,
        });
      });
      this.deliveryWorker.on('completed', (job) => {
        this.logger.debug('Webhook delivery job completed', {
          jobId: job?.id,
          deliveryId: job?.data?.deliveryId,
        });
      });
      this.deliveryWorker.on('error', (err) => {
        if (err.message && err.message.includes('connect ETIMEDOUT')) {
          this.logger.debug(
            'Webhook delivery worker Redis connection timeout (expected when Redis unavailable)',
            {
              message: err.message,
            },
          );
        } else {
          this.logger.error('Webhook delivery worker error', { error: err });
        }
      });
      this.logger.log('Webhook delivery queue initialized with BullMQ');
    } catch (error) {
      this.logger.error('Failed to initialize webhook delivery queue', {
        error,
      });
      this.createDatabaseBackedFallback();
    }
  }

  async queueDelivery(deliveryId: string, delay?: number): Promise<void> {
    try {
      if (!this.deliveryQueue) {
        this.logger.warn('Queue not initialized when queueing delivery', {
          deliveryId,
        });
        try {
          await this.initializeRedis();
        } catch (initError) {
          this.logger.error('Failed to initialize Redis on demand', {
            error: initError,
          });
          const job: WebhookDeliveryJob = { deliveryId, attempt: 1 };
          await this.processDelivery(job);
          return;
        }
      }
      const jobData: WebhookDeliveryJob = {
        deliveryId,
        attempt: 1,
      };
      await this.deliveryQueue.add('process-delivery', jobData, {
        delay: delay || 0,
      });
      this.logger.debug('Webhook delivery queued', { deliveryId, delay });
    } catch (error) {
      this.logger.error('Error queueing webhook delivery', {
        error,
        deliveryId,
      });
      try {
        this.logger.log('Attempting direct processing as fallback', {
          deliveryId,
        });
        const job: WebhookDeliveryJob = { deliveryId, attempt: 1 };
        await this.processDelivery(job);
      } catch (processError) {
        this.logger.error('Direct processing fallback also failed', {
          error: processError,
        });
        throw error;
      }
    }
  }

  private async processDelivery(jobData: WebhookDeliveryJob): Promise<void> {
    const { deliveryId } = jobData;
    try {
      // Check database circuit breaker
      if (WebhookDeliveryService.isDbCircuitBreakerOpen()) {
        this.logger.warn(
          'Webhook delivery processing skipped - database circuit breaker open',
          { deliveryId },
        );
        return;
      }

      const delivery = await this.webhookDeliveryModel.findById(deliveryId);
      if (!delivery) {
        this.logger.error('Delivery not found', { deliveryId });
        return;
      }
      if (delivery.status !== 'pending') {
        return;
      }
      const webhook = await this.webhookModel.findById(delivery.webhookId);
      if (!webhook) {
        await this.markDeliveryFailed(delivery, {
          type: 'webhook_not_found',
          message: 'Associated webhook not found',
        });
        return;
      }
      if (!webhook.active) {
        await this.markDeliveryFailed(delivery, {
          type: 'webhook_inactive',
          message: 'Webhook is inactive',
        });
        return;
      }

      // Reset failure count on successful database operations
      WebhookDeliveryService.dbFailureCount = 0;

      await this.attemptDelivery(delivery, webhook);
    } catch (error) {
      WebhookDeliveryService.recordDbFailure();
      this.logger.error('Error processing webhook delivery', {
        error,
        deliveryId,
      });
    }
  }

  private async attemptDelivery(
    delivery: WebhookDeliveryDocument,
    webhook: WebhookDocument,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      this.logger.debug('Attempting webhook delivery', {
        deliveryId: delivery._id,
        url: webhook.url,
        attempt: delivery.attempt,
      });
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
        timestamp: new Date(),
      };
      if (response.status >= 200 && response.status < 300) {
        await this.markDeliverySuccess(delivery, responseTime);
      } else if (response.status >= 500 && delivery.retriesLeft > 0) {
        await this.scheduleRetry(delivery, webhook, `HTTP ${response.status}`);
      } else {
        await this.markDeliveryFailed(delivery, {
          type: 'http_error',
          message: `HTTP ${response.status}`,
          code: response.status.toString(),
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
          details: error,
        });
      }
    }
  }

  private async handleAxiosError(
    error: AxiosError,
    delivery: WebhookDeliveryDocument,
    webhook: WebhookDocument,
    responseTime: number,
  ): Promise<void> {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      delivery.response = {
        statusCode: 0,
        headers: {},
        body: '',
        responseTime,
        timestamp: new Date(),
      };
      if (delivery.retriesLeft > 0) {
        await this.scheduleRetry(delivery, webhook, 'Timeout');
      } else {
        await this.markDeliveryFailed(delivery, {
          type: 'timeout',
          message: `Request timed out after ${webhook.timeout}ms`,
          code: error.code,
        });
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      await this.markDeliveryFailed(delivery, {
        type: 'network_error',
        message: error.message,
        code: error.code,
      });
    } else if (error.response) {
      delivery.response = {
        statusCode: error.response.status,
        headers: error.response.headers as Record<string, string>,
        body: this.truncateResponseBody(JSON.stringify(error.response.data)),
        responseTime,
        timestamp: new Date(),
      };
      if (error.response.status >= 500 && delivery.retriesLeft > 0) {
        await this.scheduleRetry(
          delivery,
          webhook,
          `HTTP ${error.response.status}`,
        );
      } else {
        await this.markDeliveryFailed(delivery, {
          type: 'http_error',
          message: `HTTP ${error.response.status}`,
          code: error.response.status.toString(),
        });
      }
    } else {
      await this.markDeliveryFailed(delivery, {
        type: 'request_error',
        message: error.message,
        code: error.code,
      });
    }
  }

  private async scheduleRetry(
    delivery: WebhookDeliveryDocument,
    webhook: WebhookDocument,
    reason: string,
  ): Promise<void> {
    const nextAttempt = delivery.attempt + 1;
    const delay = this.calculateRetryDelay(
      nextAttempt,
      webhook.retryConfig?.initialDelay || 5000,
      webhook.retryConfig?.backoffMultiplier || 2,
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
        retriesLeft: delivery.retriesLeft,
      },
    };
    await delivery.save();
    const retryDelivery = new this.webhookDeliveryModel({
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
        previousAttemptId: delivery._id,
      },
    });
    await retryDelivery.save();
    await this.queueDelivery(retryDelivery._id.toString(), delay);
    this.logger.log('Webhook retry scheduled', {
      deliveryId: delivery._id,
      retryDeliveryId: retryDelivery._id,
      attempt: nextAttempt,
      delay,
      reason,
    });
  }

  private calculateRetryDelay(
    attempt: number,
    initialDelay: number,
    backoffMultiplier: number,
  ): number {
    const jitter = Math.random() * 0.3 + 0.85;
    const delay =
      initialDelay * Math.pow(backoffMultiplier, attempt - 1) * jitter;
    return Math.min(delay, 3600000);
  }

  private async markDeliverySuccess(
    delivery: WebhookDeliveryDocument,
    responseTime: number,
  ): Promise<void> {
    delivery.status = 'success';
    await delivery.save();
    await this.webhookService.updateWebhookStats(
      delivery.webhookId.toString(),
      true,
      responseTime,
    );
    this.logger.log('Webhook delivered successfully', {
      deliveryId: delivery._id,
      webhookId: delivery.webhookId,
      responseTime,
    });
  }

  private async markDeliveryFailed(
    delivery: WebhookDeliveryDocument,
    error: {
      type: string;
      message: string;
      code?: string;
      details?: any;
    },
  ): Promise<void> {
    delivery.status = 'failed';
    delivery.error = error;
    await delivery.save();
    await this.webhookService.updateWebhookStats(
      delivery.webhookId.toString(),
      false,
    );
    this.logger.error('Webhook delivery failed', {
      deliveryId: delivery._id,
      webhookId: delivery.webhookId,
      error,
    });
    await this.checkWebhookHealth(delivery.webhookId.toString());
  }

  private async checkWebhookHealth(webhookId: string): Promise<void> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentFailures = await this.webhookDeliveryModel.countDocuments({
        webhookId,
        status: 'failed',
        createdAt: { $gte: oneDayAgo },
      });
      if (recentFailures > 50) {
        await this.webhookModel.findByIdAndUpdate(webhookId, {
          active: false,
          'metadata.deactivatedAt': new Date(),
          'metadata.deactivationReason': 'Too many failures',
        });
        this.logger.warn('Webhook deactivated due to excessive failures', {
          webhookId,
          recentFailures,
        });
      }
    } catch (error) {
      this.logger.error('Error checking webhook health', { error, webhookId });
    }
  }

  private truncateResponseBody(
    body: string,
    maxLength: number = 10000,
  ): string {
    if (body.length <= maxLength) {
      return body;
    }
    return body.substring(0, maxLength) + '... [truncated]';
  }

  async processPendingDeliveries(): Promise<void> {
    try {
      if (!this.redisClient) {
        this.logger.warn(
          'Redis client not initialized when processing pending deliveries',
        );
        return;
      }
      const acceptableStatuses = ['ready', 'connect', 'connecting'];
      if (!acceptableStatuses.includes(this.redisClient.status)) {
        this.logger.warn(
          `Redis not in acceptable state (${this.redisClient.status}) when processing pending deliveries, delaying...`,
        );
        return;
      }
      const pendingDeliveries = await this.webhookDeliveryModel
        .find({
          status: 'pending',
          nextRetryAt: { $lte: new Date() },
        })
        .limit(100);
      if (pendingDeliveries.length === 0) {
        this.logger.log('No pending webhook deliveries to process');
        return;
      }
      this.logger.log(
        `Found ${pendingDeliveries.length} pending webhook deliveries`,
      );
      for (const delivery of pendingDeliveries) {
        try {
          await this.queueDelivery(delivery._id.toString());
        } catch (error) {
          this.logger.error('Error queueing pending delivery', {
            error,
            deliveryId: delivery._id,
          });
        }
      }
      this.logger.log(
        `Processed ${pendingDeliveries.length} pending webhook deliveries`,
      );
    } catch (error) {
      this.logger.error('Error processing pending deliveries', { error });
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
        this.logger.warn('Queue not initialized when getting stats');
        return { waiting: 0, active: 0, completed: 0, failed: 0 };
      }
      const [waiting, active, completed, failed] = await Promise.all([
        this.deliveryQueue.getWaitingCount().catch(() => 0),
        this.deliveryQueue.getActiveCount().catch(() => 0),
        this.deliveryQueue.getCompletedCount().catch(() => 0),
        this.deliveryQueue.getFailedCount().catch(() => 0),
      ]);
      return { waiting, active, completed, failed };
    } catch (error) {
      this.logger.error('Error getting queue stats', { error });
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
  }

  async shutdown(): Promise<void> {
    try {
      if (this.dbFallbackPollIntervalId) {
        clearInterval(this.dbFallbackPollIntervalId);
        this.dbFallbackPollIntervalId = null;
        this.logger.log('Database fallback poller stopped');
      }
      if (this.deliveryWorker) {
        try {
          await this.deliveryWorker.close();
          this.logger.log('Webhook delivery worker closed successfully');
        } catch (err) {
          this.logger.warn('Error closing delivery worker', { error: err });
        }
      }
      if (this.deliveryQueue) {
        try {
          await this.deliveryQueue.close();
          this.logger.log('Webhook delivery queue closed successfully');
        } catch (err) {
          this.logger.warn('Error closing delivery queue', { error: err });
        }
      }
      if (
        this.bullConnection &&
        typeof this.bullConnection.quit === 'function'
      ) {
        try {
          await this.bullConnection.quit();
          this.logger.log('BullMQ Redis connection closed successfully');
        } catch (err) {
          this.logger.warn('Error closing BullMQ Redis connection', {
            error: err,
          });
          try {
            this.bullConnection.disconnect();
          } catch (disconnectErr) {
            this.logger.warn('Error forcing BullMQ Redis disconnect', {
              error: disconnectErr,
            });
          }
        }
      }
      if (this.redisClient && typeof this.redisClient.quit === 'function') {
        try {
          await this.redisClient.quit();
          this.logger.log('Redis client closed successfully');
        } catch (err) {
          this.logger.warn('Error closing Redis client', { error: err });
          try {
            this.redisClient.disconnect();
          } catch (disconnectErr) {
            this.logger.warn('Error forcing Redis disconnect', {
              error: disconnectErr,
            });
          }
        }
      }
      this.logger.log('Webhook delivery service shut down');
    } catch (error) {
      this.logger.error('Error during webhook delivery service shutdown', {
        error,
      });
    }
  }

  // Circuit breaker utilities
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
}
