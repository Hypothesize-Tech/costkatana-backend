import { Router } from 'express';
import { CacheController } from '../controllers/cache.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);


// Get cache statistics
router.get('/stats', asyncHandler(CacheController.getCacheStats));

// Clear cache
router.delete('/clear', asyncHandler(CacheController.clearCache));

// Export cache data
router.get('/export', asyncHandler(CacheController.exportCache));

// Import cache data
router.post('/import', asyncHandler(CacheController.importCache));

// Warmup cache
router.post('/warmup', asyncHandler(CacheController.warmupCache));

export default router;
