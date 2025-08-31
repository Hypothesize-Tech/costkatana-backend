import { Response, NextFunction } from 'express';

import { redisService } from '../services/redis.service';
import { loggingService } from '../services/logging.service';

export class CacheController {


  static async getCacheStats(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const userId = req.user?.id || req.userId;

    try {
      loggingService.info('Cache stats request initiated', {
        userId,
        requestId: req.headers['x-request-id'] as string
      });

      if (!userId) {
        loggingService.warn('Cache stats request failed - no user authentication', {
          requestId: req.headers['x-request-id'] as string
        });

        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      // Get Redis stats only
      const redisStats = await redisService.getCacheStats();
      
      const duration = Date.now() - startTime;

      loggingService.info('Cache stats retrieved successfully', {
        userId,
        duration,
        totalHits: redisStats.hits,
        totalMisses: redisStats.misses,
        totalRequests: redisStats.totalRequests,
        hitRate: (redisStats.hits / (redisStats.totalRequests || 1)) * 100,
        costSaved: redisStats.costSaved,
        tokensSaved: redisStats.tokensSaved || 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cache_stats_retrieved',
        category: 'cache_management',
        value: duration,
        metadata: {
          userId,
          totalHits: redisStats.hits,
          totalMisses: redisStats.misses,
          totalRequests: redisStats.totalRequests,
          hitRate: (redisStats.hits / (redisStats.totalRequests || 1)) * 100,
          costSaved: redisStats.costSaved,
          tokensSaved: redisStats.tokensSaved || 0
        }
      });
      
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
      const duration = Date.now() - startTime;
      
      loggingService.error('Cache stats retrieval failed', {
        userId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      next(error);
    }
  }

  static async clearCache(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const userId = req.user?.id || req.userId;
    const { model, provider } = req.query;

    try {
      loggingService.info('Cache clear request initiated', {
        userId,
        model: model as string || 'all',
        provider: provider as string || 'all',
        requestId: req.headers['x-request-id'] as string
      });

      if (!userId) {
        loggingService.warn('Cache clear request failed - no user authentication', {
          requestId: req.headers['x-request-id'] as string
        });

        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }
      
      // Clear Redis cache only
      const clearedRedis = await redisService.clearCache({
        userId: userId as string,
        model: model as string,
        provider: provider as string
      });

      const duration = Date.now() - startTime;

      loggingService.info('Cache cleared successfully', {
        userId,
        model: model as string || 'all',
        provider: provider as string || 'all',
        duration,
        clearedEntries: clearedRedis || 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cache_cleared',
        category: 'cache_management',
        value: duration,
        metadata: {
          userId,
          model: model as string || 'all',
          provider: provider as string || 'all',
          clearedEntries: clearedRedis || 0
        }
      });

      res.json({
        success: true,
        message: 'Redis cache cleared successfully',
        details: {
          redis: clearedRedis
        }
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cache clear failed', {
        userId,
        model: model as string || 'all',
        provider: provider as string || 'all',
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      next(error);
    }
  }

  /**
   * Export cache data for backup
   */
  static async exportCache(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const userId = req.user?.id || req.userId;

    try {
      loggingService.info('Cache export request initiated', {
        userId,
        requestId: req.headers['x-request-id'] as string
      });

      if (!userId) {
        loggingService.warn('Cache export request failed - no user authentication', {
          requestId: req.headers['x-request-id'] as string
        });

        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const cacheData = await redisService.exportCache();
      
      const duration = Date.now() - startTime;
      const exportedEntries = cacheData.entries?.length || 0;

      loggingService.info('Cache exported successfully', {
        userId,
        duration,
        exportedEntries,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cache_exported',
        category: 'cache_management',
        value: duration,
        metadata: {
          userId,
          exportedEntries
        }
      });
      
      res.json({
        success: true,
        data: cacheData,
        exportedAt: new Date().toISOString()
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cache export failed', {
        userId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      next(error);
    }
  }

  /**
   * Import cache data from backup
   */
  static async importCache(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const userId = req.user?.id || req.userId;
    const { entries } = req.body;

    try {
      loggingService.info('Cache import request initiated', {
        userId,
        entriesCount: entries?.length || 0,
        requestId: req.headers['x-request-id'] as string
      });

      if (!userId) {
        loggingService.warn('Cache import request failed - no user authentication', {
          requestId: req.headers['x-request-id'] as string
        });

        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }
      
      if (!entries || !Array.isArray(entries)) {
        loggingService.warn('Cache import failed - invalid data format', {
          userId,
          entriesCount: entries?.length || 0,
          isArray: Array.isArray(entries),
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Invalid cache data format'
        });
        return;
      }
      
      await redisService.importCache({ entries });
      
      const duration = Date.now() - startTime;

      loggingService.info('Cache imported successfully', {
        userId,
        duration,
        importedEntries: entries.length,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cache_imported',
        category: 'cache_management',
        value: duration,
        metadata: {
          userId,
          importedEntries: entries.length
        }
      });
      
      res.json({
        success: true,
        message: `Imported ${entries.length} cache entries successfully`
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cache import failed', {
        userId,
        entriesCount: entries?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      next(error);
    }
  }

  /**
   * Warmup cache with predefined queries
   */
  static async warmupCache(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const userId = req.user?.id || req.userId;
    const { queries } = req.body;

    try {
      loggingService.info('Cache warmup request initiated', {
        userId,
        queriesCount: queries?.length || 0,
        requestId: req.headers['x-request-id'] as string
      });

      if (!userId) {
        loggingService.warn('Cache warmup request failed - no user authentication', {
          requestId: req.headers['x-request-id'] as string
        });

        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }
      
      if (!queries || !Array.isArray(queries)) {
        loggingService.warn('Cache warmup failed - invalid data format', {
          userId,
          queriesCount: queries?.length || 0,
          isArray: Array.isArray(queries),
          requestId: req.headers['x-request-id'] as string
        });

        res.status(400).json({
          success: false,
          error: 'Invalid warmup data format'
        });
        return;
      }
      
      await redisService.warmupCache(queries);
      
      const duration = Date.now() - startTime;

      loggingService.info('Cache warmup completed successfully', {
        userId,
        duration,
        warmedUpEntries: queries.length,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cache_warmed_up',
        category: 'cache_management',
        value: duration,
        metadata: {
          userId,
          warmedUpEntries: queries.length
        }
      });
      
      res.json({
        success: true,
        message: `Warmed up cache with ${queries.length} entries`
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cache warmup failed', {
        userId,
        queriesCount: queries?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      next(error);
    }
  }
}
