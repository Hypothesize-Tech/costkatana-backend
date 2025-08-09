import { Response, NextFunction } from 'express';

import { redisService } from '../services/redis.service';
import { logger } from '../utils/logger';

export class CacheController {


  static async getCacheStats(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      // Get Redis stats only
      const redisStats = await redisService.getCacheStats();
      
      res.json({
        success: true,
        data: {
          redis: {
            ...redisStats,
            provider: 'AWS ElastiCache',
            features: {
              semanticCaching: process.env.ENABLE_SEMANTIC_CACHE === 'true',
              deduplication: process.env.ENABLE_DEDUPLICATION === 'true',
              userScoped: true,
              modelSpecific: true
            }
          },
          combined: {
            totalHits: redisStats.hits,
            totalMisses: redisStats.misses,
            totalRequests: redisStats.totalRequests,
            overallHitRate: (redisStats.hits / (redisStats.totalRequests || 1)) * 100,
            totalCostSaved: redisStats.costSaved,
            totalTokensSaved: redisStats.tokensSaved || 0
          }
        },
      });
    } catch (error: any) {
      logger.error('Get cache stats error:', error);
      next(error);
    }
  }

  static async clearCache(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const { model, provider } = req.query;
      
      // Clear Redis cache only
      const clearedRedis = await redisService.clearCache({
        userId: userId as string,
        model: model as string,
        provider: provider as string
      });

      res.json({
        success: true,
        message: 'Redis cache cleared successfully',
        details: {
          redis: clearedRedis
        }
      });
    } catch (error: any) {
      logger.error('Clear cache error:', error);
      next(error);
    }
  }

  /**
   * Export cache data for backup
   */
  static async exportCache(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const cacheData = await redisService.exportCache();
      
      res.json({
        success: true,
        data: cacheData,
        exportedAt: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error('Export cache error:', error);
      next(error);
    }
  }

  /**
   * Import cache data from backup
   */
  static async importCache(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const { entries } = req.body;
      
      if (!entries || !Array.isArray(entries)) {
        res.status(400).json({
          success: false,
          error: 'Invalid cache data format'
        });
        return;
      }
      
      await redisService.importCache({ entries });
      
      res.json({
        success: true,
        message: `Imported ${entries.length} cache entries successfully`
      });
    } catch (error: any) {
      logger.error('Import cache error:', error);
      next(error);
    }
  }

  /**
   * Warmup cache with predefined queries
   */
  static async warmupCache(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const { queries } = req.body;
      
      if (!queries || !Array.isArray(queries)) {
        res.status(400).json({
          success: false,
          error: 'Invalid warmup data format'
        });
        return;
      }
      
      await redisService.warmupCache(queries);
      
      res.json({
        success: true,
        message: `Warmed up cache with ${queries.length} entries`
      });
    } catch (error: any) {
      logger.error('Warmup cache error:', error);
      next(error);
    }
  }
}
