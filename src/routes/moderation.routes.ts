import { Router } from 'express';
import { ModerationController } from '../controllers/moderation.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All moderation routes require authentication
router.use(authenticate);

// Get comprehensive moderation analytics
router.get('/analytics', asyncHandler(ModerationController.getModerationAnalytics));

// Get moderation threat samples for audit
router.get('/threats', asyncHandler(ModerationController.getModerationThreats));

// Get moderation configuration
router.get('/config', asyncHandler(ModerationController.getModerationConfig));

// Update moderation configuration
router.put('/config', asyncHandler(ModerationController.updateModerationConfig));

// Appeal a moderation decision
router.post('/appeal', asyncHandler(ModerationController.appealModerationDecision));

export default router;
