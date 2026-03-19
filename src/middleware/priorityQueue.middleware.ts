/**
 * Priority Queue Middleware
 *
 * Extracts priority information from requests and manages queue entry/exit.
 * Supports priority headers and automatic priority calculation based on user tier.
 */

import { Request, Response, NextFunction } from 'express';
import {
  priorityQueueService,
  PriorityLevel,
} from '../services/priorityQueue.service';
import { loggingService } from '../common/services/logging.service';

/**
 * Parse priority from header
 */
function parsePriorityHeader(priorityHeader?: string): number | undefined {
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
 * Priority Queue Middleware
 *
 * Can be used in two modes (configured via GATEWAY_QUEUE_MODE env):
 * 1. Queue mode: Enqueues to Redis sorted set, acquires slot when at front (priority-ordered processing)
 * 2. Passthrough mode: Tracks priority metadata, simple concurrency limit via acquireSlot
 */
export async function priorityQueueMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enablePriorityQueue = process.env.ENABLE_PRIORITY_QUEUE !== 'false';

    if (!enablePriorityQueue) {
      return next();
    }

    const priorityHeader = Array.isArray(req.headers['costkatana-priority'])
      ? req.headers['costkatana-priority'][0]
      : req.headers['costkatana-priority'];
    const explicitPriority = parsePriorityHeader(priorityHeader);

    const context = req.gatewayContext;
    const userTier = (context as any)?.userTier || 'free';

    const requestIdHeader = req.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader)
      ? requestIdHeader[0]
      : requestIdHeader;

    const priorityLevel = explicitPriority ?? PriorityLevel.NORMAL;

    if (await priorityQueueService.isQueueOverCapacity()) {
      loggingService.warn('Priority queue over capacity', {
        requestId: requestId || 'unknown',
        userTier,
      });

      if (priorityLevel === PriorityLevel.BULK) {
        loggingService.info(
          'Rejecting low-priority request due to queue capacity',
          {
            requestId: requestId || 'unknown',
            userTier,
            priorityLevel,
          },
        );
        res.status(429).json({
          error: 'Service temporarily unavailable',
          message:
            'The service is currently experiencing high load. Please try again later.',
          retryAfter: 300,
          queueStatus: 'over-capacity',
        });
        return;
      }

      res.setHeader('CostKatana-Queue-Status', 'over-capacity');
    }

    if (await priorityQueueService.wouldExceedMaxWaitTime()) {
      loggingService.warn('Priority queue max wait time would be exceeded', {
        requestId: requestId || 'unknown',
        userTier,
      });

      res.setHeader('CostKatana-Queue-Status', 'high-latency');
    }

    if (context) {
      (context as any).requestPriority =
        explicitPriority || PriorityLevel.NORMAL;
      (context as any).userTier = userTier;
    }

    if (explicitPriority) {
      res.setHeader('CostKatana-Request-Priority', explicitPriority.toString());
    }

    const stats = await priorityQueueService.getQueueStats();
    res.setHeader('CostKatana-Queue-Depth', stats.queueDepth.toString());

    // Enforce concurrency limit with priority ordering - wait for slot if needed
    await priorityQueueService.acquireSlot(req, res, priorityLevel);

    loggingService.debug('Priority queue middleware processed', {
      requestId: requestId || 'unknown',
      explicitPriority,
      userTier,
      queueDepth: stats.queueDepth,
    });

    next();
  } catch (error) {
    const errorRequestId = Array.isArray(req.headers['x-request-id'])
      ? req.headers['x-request-id'][0]
      : req.headers['x-request-id'];
    loggingService.error('Priority queue middleware error', {
      error: error instanceof Error ? error.message : String(error),
      requestId: errorRequestId || 'unknown',
    });

    // Don't block requests on queue errors
    next();
  }
}

/**
 * Queue status endpoint handler
 */
export async function getQueueStatus(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const [stats, isOverCapacity, wouldExceedMaxWait] = await Promise.all([
      priorityQueueService.getQueueStats(),
      priorityQueueService.isQueueOverCapacity(),
      priorityQueueService.wouldExceedMaxWaitTime(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        ...stats,
        isOverCapacity,
        wouldExceedMaxWait,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    loggingService.error('Failed to get queue status', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve queue status',
    });
  }
}
