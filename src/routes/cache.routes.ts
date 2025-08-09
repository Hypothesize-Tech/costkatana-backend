import { Router } from 'express';
import { CacheController } from '../controllers/cache.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Check cache status
router.post('/check', asyncHandler(CacheController.checkCache));

// Get cache statistics
router.get('/stats', asyncHandler(CacheController.getCacheStats));

// Clear cache
router.delete('/clear', asyncHandler(CacheController.clearCache));

export default router;
