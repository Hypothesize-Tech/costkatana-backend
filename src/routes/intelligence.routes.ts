import { Router } from 'express';
import { IntelligenceController } from '../controllers/intelligence.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Tips endpoints
router.get('/tips/personalized', IntelligenceController.getPersonalizedTips);
router.get('/tips/usage/:usageId', IntelligenceController.getTipsForUsage);
router.post('/tips/:tipId/interaction', IntelligenceController.trackTipInteraction);

// Quality scoring endpoints
router.post('/quality/score', IntelligenceController.scoreResponseQuality);
router.post('/quality/compare', IntelligenceController.compareQuality);
router.get('/quality/stats', IntelligenceController.getQualityStats);
router.put('/quality/:scoreId/feedback', IntelligenceController.updateQualityFeedback);

// Admin endpoints (should be restricted in production)
router.post('/tips/initialize', IntelligenceController.initializeTips);

export default router; 