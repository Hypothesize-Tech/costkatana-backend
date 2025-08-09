import { Request, Response } from 'express';
import { redisService } from '../services/redis.service';

export const getCacheMetrics = async (_req: Request, res: Response) => {
  try {
    const stats = await redisService.getCacheStats();
    res.status(200).json(stats);
  } catch (error) {
    console.error('Error fetching cache stats:', error);
    res.status(500).json({ message: 'Failed to fetch cache stats' });
  }
};
