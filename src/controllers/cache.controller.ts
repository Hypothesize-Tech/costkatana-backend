import { Response, NextFunction } from 'express';

import { redisService } from '../services/redis.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';

export class CacheController {


  static async getCacheStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getCacheStats', req);

    try {

      // Get Redis stats only
      const redisStats = await redisService.getCacheStats();
      
      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getCacheStats', req, startTime, {
        totalHits: redisStats.hits,
        totalMisses: redisStats.misses
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
      ControllerHelper.handleError('getCacheStats', error, req, res, startTime);
    }
  }

  static async clearCache(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const { model, provider } = req.query;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('clearCache', req, {
      model: model as string || 'all',
      provider: provider as string || 'all'
    });

    try {
      
      // Clear Redis cache only
      const clearedRedis = await redisService.clearCache({
        userId: userId as string,
        model: model as string,
        provider: provider as string
      });

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('clearCache', req, startTime, {
        clearedEntries: clearedRedis || 0
      });

      res.json({
        success: true,
        message: 'Redis cache cleared successfully',
        details: {
          redis: clearedRedis
        }
      });
    } catch (error: any) {
      ControllerHelper.handleError('clearCache', error, req, res, startTime);
    }
  }

  /**
   * Export cache data for backup
   */
  static async exportCache(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('exportCache', req);

    try {

      const cacheData = await redisService.exportCache();
      
      const exportedEntries = cacheData.entries?.length || 0;

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('exportCache', req, startTime, {
        exportedEntries
      });
      
      res.json({
        success: true,
        data: cacheData,
        exportedAt: new Date().toISOString()
      });
    } catch (error: any) {
      ControllerHelper.handleError('exportCache', error, req, res, startTime);
    }
  }

  /**
   * Import cache data from backup
   */
  static async importCache(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const { entries } = req.body;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('importCache', req, {
      entriesCount: entries?.length || 0
    });

    try {
      
      if (!entries || !Array.isArray(entries)) {
        res.status(400).json({
          success: false,
          error: 'Invalid cache data format'
        });
        return;
      }
      
      await redisService.importCache({ entries });
      
      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('importCache', req, startTime, {
        importedEntries: entries.length
      });
      
      res.json({
        success: true,
        message: `Imported ${entries.length} cache entries successfully`
      });
    } catch (error: any) {
      ControllerHelper.handleError('importCache', error, req, res, startTime);
    }
  }

  /**
   * Warmup cache with predefined queries
   */
  static async warmupCache(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const { queries } = req.body;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('warmupCache', req, {
      queriesCount: queries?.length || 0
    });

    try {
      if (!queries || !Array.isArray(queries)) {
        res.status(400).json({
          success: false,
          error: 'Invalid warmup data format'
        });
        return;
      }
      
      await redisService.warmupCache(queries);
      
      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('warmupCache', req, startTime, {
        warmedUpEntries: queries.length
      });
      
      res.json({
        success: true,
        message: `Warmed up cache with ${queries.length} entries`
      });
    } catch (error: any) {
      ControllerHelper.handleError('warmupCache', error, req, res, startTime);
    }
  }
}
