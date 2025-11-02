import express from 'express';
import { AdminUserAnalyticsController } from '../../controllers/adminUserAnalytics.controller';
import { authenticate, authorize } from '../../middleware/auth.middleware';

const router = express.Router();

/**
 * All routes require admin authentication
 */
router.use(authenticate);
router.use(authorize('admin'));

/**
 * Get platform summary statistics
 * GET /api/admin/users/spending/summary
 */
router.get('/summary', AdminUserAnalyticsController.getPlatformSummary);

/**
 * Get all users spending summary
 * GET /api/admin/users/spending
 */
router.get('/', AdminUserAnalyticsController.getAllUsersSpending);

/**
 * Get spending trends
 * GET /api/admin/users/spending/trends?timeRange=daily|weekly|monthly
 */
router.get('/trends', AdminUserAnalyticsController.getSpendingTrends);

/**
 * Export user spending data
 * GET /api/admin/users/spending/export?format=json|csv
 */
router.get('/export', AdminUserAnalyticsController.exportUserSpending);

/**
 * Get users filtered by service
 * GET /api/admin/users/spending/by-service/:service
 */
router.get('/by-service/:service', AdminUserAnalyticsController.getUsersByService);

/**
 * Get detailed spending for a specific user
 * GET /api/admin/users/spending/:userId
 */
router.get('/:userId', AdminUserAnalyticsController.getUserDetailedSpending);

export default router;

