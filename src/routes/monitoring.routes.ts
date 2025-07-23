import { Router } from 'express';
import { MonitoringController } from '../controllers/monitoring.controller';
import { authenticate, requirePermission } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

/**
 * Intelligent Monitoring Routes
 * These routes provide AI usage pattern analysis and smart recommendations
 */

// Trigger intelligent monitoring for current user
router.post(
    '/analyze',
    authenticate,
    requirePermission('read'),
    asyncHandler(MonitoringController.triggerUserMonitoring)
);

// Get current usage status and predictions
router.get(
    '/status',
    authenticate,
    requirePermission('read'),
    asyncHandler(MonitoringController.getUserUsageStatus)
);

// Get smart recommendations
router.get(
    '/recommendations',
    authenticate,
    requirePermission('read'),
    asyncHandler(MonitoringController.getSmartRecommendations)
);

// Admin-only: Trigger daily monitoring for all users
router.post(
    '/daily-monitoring',
    authenticate,
    requirePermission('admin'),
    asyncHandler(MonitoringController.triggerDailyMonitoring)
);

export { router as monitoringRoutes }; 