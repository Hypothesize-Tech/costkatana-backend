import { Router } from 'express';
import { UsageController } from '../controllers/usage.controller';
import { authenticate, optionalAuth, requirePermission } from '../middleware/auth.middleware';
import { validate, validateQuery } from '../middleware/validation.middleware';
import { trackUsageSchema, paginationSchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// Routes that support optional authentication (API key access)
// Track usage - key functionality for API integration
router.post('/track', optionalAuth, validate(trackUsageSchema), asyncHandler(UsageController.trackUsage));

// Track usage from SDK - supports API key authentication
router.post('/track-sdk', optionalAuth, asyncHandler(UsageController.trackUsageFromSDK));

// Get usage data - read-only, supports API key
router.get('/', optionalAuth, validateQuery(paginationSchema), asyncHandler(UsageController.getUsage));

// Get usage by project - read-only, supports API key
router.get('/project/:projectId', optionalAuth, validateQuery(paginationSchema), asyncHandler(UsageController.getUsageByProject));

// Get usage statistics - read-only, supports API key
router.get('/stats', optionalAuth, asyncHandler(UsageController.getUsageStats));

// Routes that require full authentication (write operations beyond usage tracking)
// Bulk upload usage data
router.post('/bulk', authenticate, requirePermission('write', 'admin'), asyncHandler(UsageController.bulkUploadUsage));

// Update usage data
router.put('/:usageId', authenticate, requirePermission('write', 'admin'), asyncHandler(UsageController.updateUsage));

// Delete usage data
router.delete('/:usageId', authenticate, requirePermission('admin'), asyncHandler(UsageController.deleteUsage));

// Detect anomalies
router.get('/anomalies', asyncHandler(UsageController.detectAnomalies));

// Search usage
router.get('/search', validateQuery(paginationSchema), asyncHandler(UsageController.searchUsage));

// Export usage data
router.get('/export', asyncHandler(UsageController.exportUsage));

// Real-time usage tracking dashboard routes
router.get('/realtime/summary', authenticate, asyncHandler(UsageController.getRealTimeUsageSummary));
router.get('/realtime/requests', authenticate, asyncHandler(UsageController.getRealTimeRequests));
router.get('/analytics', authenticate, asyncHandler(UsageController.getUsageAnalytics));

// Add the SSE route
router.get('/stream', authenticate, UsageController.streamUsageUpdates);

export default router;