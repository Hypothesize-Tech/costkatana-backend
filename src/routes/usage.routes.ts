import { Router } from 'express';
import { UsageController } from '../controllers/usage.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateQuery } from '../middleware/validation.middleware';
import { trackUsageSchema, paginationSchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Track new usage
router.post('/', validate(trackUsageSchema), asyncHandler(UsageController.trackUsage));

// Track new usage from SDK
router.post('/sdk', asyncHandler(UsageController.trackUsageFromSDK));

// Get usage data
router.get('/', validateQuery(paginationSchema), asyncHandler(UsageController.getUsage));

// Get usage statistics
router.get('/stats', asyncHandler(UsageController.getUsageStats));

// Detect anomalies
router.get('/anomalies', asyncHandler(UsageController.detectAnomalies));

// Search usage
router.get('/search', validateQuery(paginationSchema), asyncHandler(UsageController.searchUsage));

// Export usage data
router.get('/export', asyncHandler(UsageController.exportUsage));

export default router;