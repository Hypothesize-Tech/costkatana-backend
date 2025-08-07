import { Response, NextFunction } from 'express';
import { CacheService } from '../services/cache.service';
import { logger } from '../utils/logger';

export class CacheController {
  static async checkCache(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const { prompt, model, provider, includeFallbacks, includeCacheDetails } = req.body;

      if (!prompt) {
        res.status(400).json({
          success: false,
          message: 'Prompt is required',
        });
        return;
      }

      const cacheResult = await CacheService.checkCache({
        prompt,
        model: model || 'gpt-4o-mini',
        provider: provider || 'openai',
        includeFallbacks: includeFallbacks !== false,
        includeCacheDetails: includeCacheDetails || false,
      });

      res.json({
        success: true,
        message: 'Cache check completed',
        data: cacheResult,
      });
    } catch (error: any) {
      logger.error('Cache check error:', error);
      next(error);
    }
  }

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

      const stats = CacheService.getStats();

      res.json({
        success: true,
        data: stats,
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

      CacheService.clearCache();

      res.json({
        success: true,
        message: 'Cache cleared successfully',
      });
    } catch (error: any) {
      logger.error('Clear cache error:', error);
      next(error);
    }
  }
}
