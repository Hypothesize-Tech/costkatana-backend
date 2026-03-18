import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import {
  PriorityLevel,
  QueueStats,
  PriorityRequest,
} from '../interfaces/gateway.interfaces';

@Injectable()
export class PriorityQueueService {
  private readonly logger = new Logger(PriorityQueueService.name);

  constructor(private cacheService: CacheService) {}

  /**
   * Parse priority from header
   */
  parsePriorityHeader(priorityHeader?: string): number | undefined {
    if (!priorityHeader) {
      return undefined;
    }

    const lower = priorityHeader.toLowerCase();

    switch (lower) {
      case 'critical':
        return PriorityLevel.CRITICAL;
      case 'high':
        return PriorityLevel.HIGH;
      case 'normal':
        return PriorityLevel.NORMAL;
      case 'low':
        return PriorityLevel.LOW;
      case 'bulk':
        return PriorityLevel.BULK;
      default:
        // Try to parse as number
        const numPriority = parseInt(priorityHeader, 10);
        return isNaN(numPriority) ? undefined : numPriority;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    try {
      const queueKey = 'gateway:priority_queue';
      const processingKey = 'gateway:processing';
      const statsKey = 'gateway:queue_stats';

      // Get queue depth (total items in queue)
      const queueDepth = await this.cacheService.zcard(queueKey);

      // Get active workers (items currently being processed)
      const activeWorkers = await this.cacheService.scard(processingKey);

      // Get priority distribution
      const priorityDistribution: Record<string, number> = {};
      for (let priority = 0; priority <= 4; priority++) {
        const count = await this.cacheService.zcount(
          queueKey,
          priority,
          priority,
        );
        priorityDistribution[priority.toString()] = count;
      }

      // Get max wait time and average processing time from stored stats
      let maxWaitTime = 0;
      let averageProcessingTime = 0;

      try {
        const stats = await this.cacheService.get<{
          maxWaitTime?: number;
          averageProcessingTime?: number;
        }>(statsKey);
        if (stats && typeof stats === 'object') {
          maxWaitTime = stats.maxWaitTime ?? 0;
          averageProcessingTime = stats.averageProcessingTime ?? 0;
        }
      } catch (statsError) {
        this.logger.warn('Failed to retrieve queue stats from cache', {
          error:
            statsError instanceof Error ? statsError.message : 'Unknown error',
        });
      }

      const stats: QueueStats = {
        queueDepth,
        activeWorkers,
        maxWaitTime,
        averageProcessingTime,
        priorityDistribution,
      };

      this.logger.debug('Queue stats retrieved', {
        component: 'PriorityQueueService',
        operation: 'getQueueStats',
        type: 'queue_stats',
        stats,
      });

      return stats;
    } catch (error) {
      this.logger.error('Failed to get queue stats', {
        component: 'PriorityQueueService',
        operation: 'getQueueStats',
        type: 'queue_stats_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return default stats on error
      return {
        queueDepth: 0,
        activeWorkers: 0,
        maxWaitTime: 0,
        averageProcessingTime: 0,
        priorityDistribution: {
          '0': 0,
          '1': 0,
          '2': 0,
          '3': 0,
          '4': 0,
        },
      };
    }
  }

  /**
   * Check if queue is over capacity
   */
  async isQueueOverCapacity(): Promise<boolean> {
    try {
      const queueKey = 'gateway:priority_queue';
      const maxCapacity = parseInt(
        process.env.GATEWAY_QUEUE_MAX_CAPACITY || '1000',
      );

      const queueDepth = await this.cacheService.zcard(queueKey);

      const isOverCapacity = queueDepth >= maxCapacity;

      if (isOverCapacity) {
        this.logger.warn('Queue is over capacity', {
          component: 'PriorityQueueService',
          operation: 'isQueueOverCapacity',
          type: 'queue_over_capacity',
          queueDepth,
          maxCapacity,
        });
      }

      return isOverCapacity;
    } catch (error) {
      this.logger.error('Failed to check queue capacity', {
        component: 'PriorityQueueService',
        operation: 'isQueueOverCapacity',
        type: 'queue_capacity_check_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // Don't block on errors
    }
  }

  /**
   * Check if max wait time would be exceeded
   */
  async wouldExceedMaxWaitTime(): Promise<boolean> {
    try {
      const queueKey = 'gateway:priority_queue';
      const maxWaitTime = parseInt(
        process.env.GATEWAY_MAX_WAIT_TIME_MS || '300000',
      ); // 5 minutes default

      // Get the oldest item in the queue (lowest score in sorted set)
      const oldestItems = await this.cacheService.zrange(
        queueKey,
        0,
        0,
        'WITHSCORES',
      );

      if (oldestItems.length === 0) {
        // Queue is empty
        return false;
      }

      const oldestTimestamp = parseInt(oldestItems[1]);
      const waitTime = Date.now() - oldestTimestamp;
      const wouldExceed = waitTime >= maxWaitTime;

      if (wouldExceed) {
        this.logger.warn('Max wait time would be exceeded', {
          component: 'PriorityQueueService',
          operation: 'wouldExceedMaxWaitTime',
          type: 'max_wait_time_exceeded',
          currentWaitTime: waitTime,
          maxWaitTime,
          oldestTimestamp,
        });
      }

      return wouldExceed;
    } catch (error) {
      this.logger.error('Failed to check max wait time', {
        component: 'PriorityQueueService',
        operation: 'wouldExceedMaxWaitTime',
        type: 'max_wait_time_check_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // Don't block on errors
    }
  }

  /**
   * Enqueue a request for processing (future implementation)
   */
  async enqueueRequest(request: PriorityRequest): Promise<void> {
    try {
      const queueKey = 'gateway:priority_queue';

      // Create composite score: priority * timestamp_factor + timestamp
      // This ensures higher priority items are processed first, and within same priority, FIFO order
      const timestamp = request.createdAt.getTime();
      const priorityScore = request.priority * 1000000000000 + timestamp; // Priority gets higher weight

      // Store request data as JSON string with priority score
      const requestData = JSON.stringify({
        id: request.id,
        priority: request.priority,
        userTier: request.userTier,
        createdAt: request.createdAt.toISOString(),
        estimatedProcessingTime: request.estimatedProcessingTime,
      });

      await this.cacheService.zadd(queueKey, priorityScore, requestData);

      this.logger.log('Request enqueued for priority processing', {
        component: 'PriorityQueueService',
        operation: 'enqueueRequest',
        type: 'request_enqueued',
        requestId: request.id,
        priority: request.priority,
        userTier: request.userTier,
        priorityScore,
        queueSize: await this.cacheService.zcard(queueKey),
      });
    } catch (error) {
      this.logger.error('Failed to enqueue request', {
        component: 'PriorityQueueService',
        operation: 'enqueueRequest',
        type: 'enqueue_error',
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Dequeue next request for processing (future implementation)
   */
  async dequeueRequest(): Promise<PriorityRequest | null> {
    try {
      const queueKey = 'gateway:priority_queue';
      const processingKey = 'gateway:processing';

      // Get the highest priority item (lowest score in sorted set)
      const items = await this.cacheService.zrange(queueKey, 0, 0);

      if (items.length === 0) {
        this.logger.debug('No requests in queue', {
          component: 'PriorityQueueService',
          operation: 'dequeueRequest',
          type: 'queue_empty',
        });
        return null;
      }

      const requestData = items[0];
      const parsedRequest = JSON.parse(requestData);

      // Move to processing set
      await this.cacheService.sadd(processingKey, requestData);

      // Remove from queue
      await this.cacheService.zrem(queueKey, requestData);

      const priorityRequest: PriorityRequest = {
        id: parsedRequest.id,
        priority: parsedRequest.priority,
        userTier: parsedRequest.userTier,
        createdAt: new Date(parsedRequest.createdAt),
        estimatedProcessingTime: parsedRequest.estimatedProcessingTime,
      };

      this.logger.log('Request dequeued for processing', {
        component: 'PriorityQueueService',
        operation: 'dequeueRequest',
        type: 'request_dequeued',
        requestId: priorityRequest.id,
        priority: priorityRequest.priority,
        userTier: priorityRequest.userTier,
        queueSize: await this.cacheService.zcard(queueKey),
        processingCount: await this.cacheService.scard(processingKey),
      });

      return priorityRequest;
    } catch (error) {
      this.logger.error('Failed to dequeue request', {
        component: 'PriorityQueueService',
        operation: 'dequeueRequest',
        type: 'dequeue_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Acquire a processing slot - blocks until a slot is available (concurrency limit).
   * When GATEWAY_QUEUE_MODE=true, uses Redis sorted set for priority-ordered slot acquisition.
   */
  async acquireSlot(
    req: { headers?: Record<string, string | string[] | undefined> },
    res: { on: (event: string, fn: () => void) => void },
    priority: number,
  ): Promise<void> {
    const queueMode = process.env.GATEWAY_QUEUE_MODE === 'true';
    if (queueMode) {
      await this.acquireSlotWithQueue(req, res, priority);
    } else {
      await this.acquireSlotPassthrough(req, res, priority);
    }
  }

  /**
   * Queue mode: Enqueue request to Redis sorted set, wait until at front and slot available.
   */
  private async acquireSlotWithQueue(
    req: { headers?: Record<string, string | string[] | undefined> },
    res: { on: (event: string, fn: () => void) => void },
    priority: number,
  ): Promise<void> {
    const queueKey = 'gateway:priority_queue';
    const slotKey = 'gateway:active_slots';
    const maxConcurrent = parseInt('100',
      10,
    );
    const requestId =
      (Array.isArray(req.headers?.['x-request-id'])
        ? req.headers['x-request-id'][0]
        : req.headers?.['x-request-id']) || `pq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const slotId = `${requestId}:${Date.now()}`;
    const pollInterval = 50;
    const maxWaitMs = parseInt(
      process.env.GATEWAY_SLOT_ACQUIRE_TIMEOUT_MS || '30000',
      10,
    );

    const priorityRequest: PriorityRequest = {
      id: requestId,
      priority,
      userTier: 'free',
      createdAt: new Date(),
      estimatedProcessingTime: 0,
    };
    await this.enqueueRequest(priorityRequest);

    const startWait = Date.now();
    const requestData = JSON.stringify({
      id: priorityRequest.id,
      priority: priorityRequest.priority,
      userTier: priorityRequest.userTier,
      createdAt: priorityRequest.createdAt.toISOString(),
      estimatedProcessingTime: priorityRequest.estimatedProcessingTime,
    });

    try {
      while (true) {
        const [frontItem] = await this.cacheService.zrange(queueKey, 0, 0);
        const slotCount = await this.cacheService.scard(slotKey);
        const isAtFront = frontItem === requestData;
        const hasSlot = slotCount < maxConcurrent;

        if (isAtFront && hasSlot) {
          await this.cacheService.zrem(queueKey, requestData);
          await this.cacheService.sadd(slotKey, slotId);
          await this.cacheService.expire(slotKey, 3600);

          res.on('finish', () => {
            this.releaseSlot(slotKey, slotId).catch((err) => {
              this.logger.warn('Failed to release slot', { slotId, error: err instanceof Error ? err.message : String(err) });
            });
          });
          return;
        }

        if (Date.now() - startWait > maxWaitMs) {
          await this.cacheService.zrem(queueKey, requestData);
          this.logger.warn('Queue mode slot acquire timeout', { requestId, priority });
          return;
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }
    } catch (error) {
      await this.cacheService.zrem(queueKey, requestData).catch(() => {});
      throw error;
    }
  }

  /**
   * Passthrough mode: Simple concurrency limit without priority ordering.
   */
  private async acquireSlotPassthrough(
    req: { headers?: Record<string, string | string[] | undefined> },
    res: { on: (event: string, fn: () => void) => void },
    priority: number,
  ): Promise<void> {
    const maxConcurrent = parseInt(
      process.env.GATEWAY_MAX_CONCURRENT_REQUESTS || '100',
      10,
    );
    const slotKey = 'gateway:active_slots';
    const requestId =
      (Array.isArray(req.headers?.['x-request-id'])
        ? req.headers['x-request-id'][0]
        : req.headers?.['x-request-id']) || `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const slotId = `${requestId}:${Date.now()}`;
    const pollInterval = 50;
    const maxWaitMs = parseInt(
      process.env.GATEWAY_SLOT_ACQUIRE_TIMEOUT_MS || '30000',
      10,
    );
    const startWait = Date.now();

    while (true) {
      const current = await this.cacheService.scard(slotKey);
      if (current < maxConcurrent) {
        await this.cacheService.sadd(slotKey, slotId);
        await this.cacheService.expire(slotKey, 3600);

        res.on('finish', () => {
          this.releaseSlot(slotKey, slotId).catch((err) => {
            this.logger.warn('Failed to release slot', {
              slotId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        });
        return;
      }

      if (Date.now() - startWait > maxWaitMs) {
        this.logger.warn('Slot acquire timeout', {
          requestId,
          priority,
          maxConcurrent,
        });
        return;
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  private async releaseSlot(slotKey: string, slotId: string): Promise<void> {
    await this.cacheService.srem(slotKey, slotId);
  }

  /**
   * Get queue status for endpoint
   */
  async getQueueStatus(): Promise<{
    success: boolean;
    data: QueueStats & {
      isOverCapacity: boolean;
      wouldExceedMaxWait: boolean;
      timestamp: string;
    };
  }> {
    try {
      const stats = await this.getQueueStats();
      const isOverCapacity = await this.isQueueOverCapacity();
      const wouldExceedMaxWait = await this.wouldExceedMaxWaitTime();

      return {
        success: true,
        data: {
          ...stats,
          isOverCapacity,
          wouldExceedMaxWait,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get queue status', {
        component: 'PriorityQueueService',
        operation: 'getQueueStatus',
        type: 'queue_status_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        data: {
          queueDepth: 0,
          activeWorkers: 0,
          maxWaitTime: 0,
          averageProcessingTime: 0,
          priorityDistribution: {
            '0': 0,
            '1': 0,
            '2': 0,
            '3': 0,
            '4': 0,
          },
          isOverCapacity: false,
          wouldExceedMaxWait: false,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }
}
