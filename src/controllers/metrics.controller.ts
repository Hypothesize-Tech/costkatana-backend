import { Request, Response } from 'express';
import { redisService } from '../services/redis.service';
import { loggingService } from '../services/logging.service';

export const getCacheMetrics = async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    loggingService.info('Cache metrics retrieval initiated', {
      requestId: req.headers['x-request-id'] as string
    });

    loggingService.info('Cache metrics retrieval processing started', {
      requestId: req.headers['x-request-id'] as string
    });

    const stats = await redisService.getCacheStats();

    const duration = Date.now() - startTime;

    loggingService.info('Cache metrics retrieved successfully', {
      duration,
      hasStats: !!stats,
      requestId: req.headers['x-request-id'] as string
    });

    // Log business event
    loggingService.logBusiness({
      event: 'cache_metrics_retrieved',
      category: 'metrics_operations',
      value: duration,
      metadata: {
        hasStats: !!stats
      }
    });

    res.status(200).json(stats);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    loggingService.error('Cache metrics retrieval failed', {
      error: error.message || 'Unknown error',
      stack: error.stack,
      duration,
      requestId: req.headers['x-request-id'] as string
    });

    res.status(500).json({ message: 'Failed to fetch cache stats' });
  }
};
