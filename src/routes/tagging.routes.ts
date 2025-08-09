import { Router } from 'express';
import { TaggingController } from '../controllers/tagging.controller';
import { authenticate } from '../middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Tag analytics routes
router.get('/analytics', TaggingController.getTagAnalytics);
router.post('/analytics/batch', TaggingController.getBatchTagAnalytics);
router.get('/:tag/breakdown', TaggingController.getTagCostBreakdown);
router.post('/compare', TaggingController.compareTags);

// Real-time metrics
router.get('/realtime', TaggingController.getRealTimeMetrics);

// Tag management
router.post('/hierarchy', TaggingController.createTagHierarchy);
router.get('/suggestions', TaggingController.getTagSuggestions);

// Cost allocation
router.post('/allocation-rules', TaggingController.createCostAllocationRule);

export default router; 