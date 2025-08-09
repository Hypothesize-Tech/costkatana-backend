import { Router } from 'express';
import { TrackingController } from '../controllers/tracking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Track manual request
router.post('/manual', asyncHandler(TrackingController.trackManualRequest));

export default router;
