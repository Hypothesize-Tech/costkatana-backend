import { Router } from 'express';
import { RequestFeedbackController } from '../controllers/requestFeedback.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All feedback routes require authentication
router.use(authenticate);

// Submit feedback for a specific request
router.post('/request/:requestId/feedback', RequestFeedbackController.submitFeedback);

// Get feedback for a specific request
router.get('/request/:requestId/feedback', RequestFeedbackController.getFeedbackByRequestId);

// Update implicit signals for a request
router.put('/request/:requestId/implicit-signals', RequestFeedbackController.updateImplicitSignals);

// Get feedback analytics for the authenticated user
router.get('/feedback/analytics', RequestFeedbackController.getFeedbackAnalytics);

// Get global feedback analytics (admin only)
router.get('/feedback/analytics/global', RequestFeedbackController.getGlobalFeedbackAnalytics);

export default router;