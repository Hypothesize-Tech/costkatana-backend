import express from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { AdminDashboardController } from '../../controllers/adminDashboard.controller';

const router = express.Router();

// Apply authentication and admin authorization to all routes
router.use(authenticate);
router.use(authorize('admin'));

// User Growth & Engagement
router.get('/analytics/user-growth', AdminDashboardController.getUserGrowthTrends);
router.get('/analytics/engagement', AdminDashboardController.getUserEngagementMetrics);
router.get('/analytics/user-segments', AdminDashboardController.getUserSegments);

// Anomaly Detection & Alerts
router.get('/alerts', AdminDashboardController.getCurrentAlerts);
router.get('/anomalies/spending', AdminDashboardController.detectSpendingAnomalies);
router.get('/anomalies/errors', AdminDashboardController.detectErrorAnomalies);

// Model/Service Comparison
router.get('/analytics/model-comparison', AdminDashboardController.getModelComparison);
router.get('/analytics/service-comparison', AdminDashboardController.getServiceComparison);

// Feature Analytics
router.get('/analytics/feature-usage', AdminDashboardController.getFeatureUsageStats);
router.get('/analytics/feature-adoption', AdminDashboardController.getFeatureAdoptionRates);
router.get('/analytics/feature-cost', AdminDashboardController.getFeatureCostAnalysis);

// Project & Workspace Analytics
router.get('/analytics/projects', AdminDashboardController.getProjectAnalytics);
router.get('/analytics/workspaces', AdminDashboardController.getWorkspaceAnalytics);
router.get('/analytics/projects/:projectId/trends', AdminDashboardController.getProjectTrends);

// User Management Routes
router.get('/users', AdminDashboardController.getAllUsers);
router.get('/users/stats', AdminDashboardController.getUserStats);
router.get('/users/:userId', AdminDashboardController.getUserDetail);
router.patch('/users/:userId/status', AdminDashboardController.updateUserStatus);
router.patch('/users/:userId/role', AdminDashboardController.updateUserRole);
router.delete('/users/:userId', AdminDashboardController.deleteUser);

// Activity Feed Routes - place before dynamic routes like /users/:userId
router.get('/analytics/activity/recent', AdminDashboardController.getRecentActivity);
router.get('/analytics/activity/feed', AdminDashboardController.initializeActivityFeed);

export default router;

