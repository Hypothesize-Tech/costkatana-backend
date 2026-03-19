import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PriorityQueueService } from '../services/priority-queue.service';
import {
  GatewayContext,
  PriorityLevel,
} from '../interfaces/gateway.interfaces';

@Injectable()
export class PriorityQueueMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PriorityQueueMiddleware.name);

  constructor(private priorityQueueService: PriorityQueueService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || 'unknown';

    try {
      this.logger.log('=== PRIORITY QUEUE MIDDLEWARE STARTED ===', {
        component: 'PriorityQueueMiddleware',
        operation: 'use',
        type: 'priority_queue',
        requestId,
        path: req.originalUrl,
        method: req.method,
      });

      const context = (req as any).gatewayContext as GatewayContext;
      if (!context) {
        this.logger.warn(
          'No gateway context found, skipping priority queue processing',
          {
            component: 'PriorityQueueMiddleware',
            operation: 'use',
            type: 'priority_queue_no_context',
            requestId,
          },
        );
        return next();
      }

      // Check if priority queue is enabled
      const enablePriorityQueue = process.env.ENABLE_PRIORITY_QUEUE !== 'false';

      if (!enablePriorityQueue) {
        this.logger.debug('Priority queue disabled, skipping', {
          component: 'PriorityQueueMiddleware',
          operation: 'use',
          type: 'priority_queue_disabled',
          requestId,
        });
        return next();
      }

      // Extract priority from header
      const priorityHeader = Array.isArray(req.headers['costkatana-priority'])
        ? req.headers['costkatana-priority'][0]
        : req.headers['costkatana-priority'];
      const explicitPriority =
        this.priorityQueueService.parsePriorityHeader(priorityHeader);

      // Get user tier from gateway context (set by auth middleware)
      const userTier = (context as any)?.userTier || 'free';

      // Extract request ID safely
      const requestIdHeader = req.headers['x-request-id'];
      const safeRequestId = Array.isArray(requestIdHeader)
        ? requestIdHeader[0]
        : requestIdHeader;

      // Check if queue is over capacity
      if (await this.priorityQueueService.isQueueOverCapacity()) {
        this.logger.warn('Priority queue over capacity', {
          component: 'PriorityQueueMiddleware',
          operation: 'use',
          type: 'priority_queue_over_capacity',
          requestId: safeRequestId || 'unknown',
          userTier,
        });

        // Reject low-priority requests when queue is over capacity
        if (userTier === 'free' || explicitPriority === PriorityLevel.LOW) {
          this.logger.warn(
            'Rejecting low-priority request due to queue capacity',
            {
              component: 'PriorityQueueMiddleware',
              operation: 'use',
              type: 'request_rejected_capacity',
              requestId: safeRequestId || 'unknown',
              userTier,
              priority: explicitPriority,
            },
          );

          return res.status(429).json({
            error: 'Service temporarily unavailable',
            message:
              'The service is currently experiencing high demand. Please try again later.',
            retryAfter: 300, // 5 minutes
            code: 'QUEUE_OVER_CAPACITY',
          });
        }

        res.setHeader('CostKatana-Queue-Status', 'over-capacity');
      }

      // Check if max wait time would be exceeded
      if (await this.priorityQueueService.wouldExceedMaxWaitTime()) {
        this.logger.warn('Priority queue max wait time would be exceeded', {
          component: 'PriorityQueueMiddleware',
          operation: 'use',
          type: 'priority_queue_max_wait_exceeded',
          requestId: safeRequestId || 'unknown',
          userTier,
        });

        res.setHeader('CostKatana-Queue-Status', 'high-latency');
      }

      // Store priority metadata in context
      if (context) {
        (context as any).requestPriority =
          explicitPriority || PriorityLevel.NORMAL;
        (context as any).userTier = userTier;
      }

      // Add priority header to response for debugging
      if (explicitPriority !== undefined) {
        res.setHeader(
          'CostKatana-Request-Priority',
          explicitPriority.toString(),
        );
      }

      // Get queue stats
      const stats = await this.priorityQueueService.getQueueStats();
      res.setHeader('CostKatana-Queue-Depth', stats.queueDepth.toString());

      // Acquire a processing slot (concurrency limit) - releases on res finish
      await this.priorityQueueService.acquireSlot(req, res, explicitPriority ?? PriorityLevel.NORMAL);

      this.logger.debug('Priority queue middleware processed', {
        component: 'PriorityQueueMiddleware',
        operation: 'use',
        type: 'priority_queue_processed',
        requestId: safeRequestId || 'unknown',
        explicitPriority,
        userTier,
        queueDepth: stats.queueDepth,
      });

      // Continue to next middleware (passthrough mode when queue is disabled)
      this.logger.log('=== PRIORITY QUEUE MIDDLEWARE COMPLETED ===', {
        component: 'PriorityQueueMiddleware',
        operation: 'use',
        type: 'priority_queue_completed',
        requestId,
        processingTime: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      const errorRequestId = Array.isArray(req.headers['x-request-id'])
        ? req.headers['x-request-id'][0]
        : req.headers['x-request-id'];

      this.logger.error('Priority queue middleware error', {
        component: 'PriorityQueueMiddleware',
        operation: 'use',
        type: 'priority_queue_error',
        requestId: errorRequestId || 'unknown',
        error: error instanceof Error ? error.message : String(error),
        processingTime: `${Date.now() - startTime}ms`,
      });

      // Don't block requests on queue errors
      next();
    }
  }
}

/**
 * Queue status endpoint handler
 */
export class PriorityQueueControllerHandler {
  constructor(private priorityQueueService: PriorityQueueService) {}

  async getQueueStatus(res: Response): Promise<void> {
    try {
      const result = await this.priorityQueueService.getQueueStatus();

      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve queue status',
      });
    }
  }
}
