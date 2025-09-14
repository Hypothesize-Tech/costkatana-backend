/**
 * Cortex Training Data Routes
 * 
 * Routes for managing and accessing Cortex training data
 */

import { Router } from 'express';
import { CortexTrainingDataController } from '../controllers/cortexTrainingData.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get training data statistics
router.get('/stats', asyncHandler(CortexTrainingDataController.getTrainingStats));

// Export training data for model training (with filters)
router.get('/export', asyncHandler(CortexTrainingDataController.exportTrainingData));

// Add user feedback to training data
router.post('/feedback/:sessionId', asyncHandler(CortexTrainingDataController.addUserFeedback));

// Get training insights and analytics
router.get('/insights', asyncHandler(CortexTrainingDataController.getTrainingInsights));

export default router;
